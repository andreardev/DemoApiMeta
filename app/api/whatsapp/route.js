import { authenticated, readBody, result, failure, AppError, graph, rpc } from '../../../lib/server';
import { encrypt, decrypt, validUUID, validPhone } from '../../../lib/security.mjs';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request) {
  try {
    const { db, userDb, user } = await authenticated(request);
    let input;
    try { input = JSON.parse((await readBody(request)).toString()); } catch (error) { if (error instanceof AppError) throw error; throw new AppError('JSON no válido.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Solicitud no válida.');
    if (!validUUID(input.workspace_id)) throw new AppError('Negocio no válido.');
    const wid = input.workspace_id;
    const role = await rpc(userDb, 'workspace_role', { wid });
    if (!['owner', 'admin', 'agent'].includes(role)) throw new AppError('No tienes permisos para esta operación.', 403);
    if (input.action === 'connect') {
      if (!['owner','admin'].includes(role)) throw new AppError('Solo un administrador puede conectar WhatsApp.', 403);
      if (!/^\d{5,30}$/.test(input.phone_number_id || '') || !/^\d{5,30}$/.test(input.waba_id || '') || typeof input.token !== 'string' || input.token.length < 20 || input.token.length > 4096) throw new AppError('Revisa los identificadores y el token de Meta.');
      const ciphertext = encrypt(input.token);
      const phone = await graph(`${input.phone_number_id}?fields=id,display_phone_number,verified_name`, input.token);
      // Verify that the phone belongs to the declared WABA before storing either.
      let after = '', belongs = false;
      for (let page = 0; page < 10; page++) {
        const list = await graph(`${input.waba_id}/phone_numbers?fields=id&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`, input.token);
        if (list.data?.some(p => p.id === input.phone_number_id)) { belongs = true; break; }
        if (!list.paging?.next || !list.paging?.cursors?.after) break;
        after = list.paging.cursors.after;
      }
      if (!belongs) throw new AppError('El número no pertenece a la cuenta de WhatsApp indicada.');
      await rpc(db, 'connect_whatsapp', { wid, actor: user.id, phone_id: input.phone_number_id, business_id: input.waba_id, phone_display: phone.display_phone_number || '', business_name: phone.verified_name || '', ciphertext });
      return result({ ok: true });
    }
    if (input.action !== 'send') throw new AppError('Operación no válida.');
    if (!validUUID(input.request_id) || !validPhone(input.to)) throw new AppError('Ingresa un número internacional de 8 a 15 dígitos, sin + ni espacios.');
    if (!['text','template'].includes(input.kind)) throw new AppError('Tipo de mensaje no válido.');
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 4096) throw new AppError('El mensaje debe tener entre 1 y 4096 caracteres.');
    if (input.kind === 'template' && (!/^[a-z0-9_]{1,512}$/.test(input.body) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(input.language || ''))) throw new AppError('Nombre de plantilla o idioma no válido.');
    let parameters = [];
    if (input.kind === 'template') {
      if (input.parameters !== undefined && (!Array.isArray(input.parameters) || input.parameters.length > 20 || input.parameters.some(p => typeof p !== 'string' || p.length > 1000))) throw new AppError('Parámetros de plantilla no válidos.');
      parameters = input.parameters || [];
    }
    const { data: connection, error: connError } = await db.from('whatsapp_connections').select('*').eq('workspace_id',wid).single();
    const { data: secret, error: secretError } = await db.from('whatsapp_credentials').select('encrypted_token').eq('workspace_id',wid).single();
    if (connError || secretError || !connection || !secret) throw new AppError('Conecta WhatsApp antes de enviar.');
    const token = decrypt(secret.encrypted_token);
    const content = input.kind === 'template' ? JSON.stringify({ template: input.body, language: input.language, parameters }) : input.body.trim();
    const fresh = await rpc(db,'reserve_message',{ wid,actor:user.id,request_id:input.request_id,recipient:input.to,body:content,message_kind:input.kind });
    if (!fresh) {
      const { data, error } = await db.from('messages').select('id,status,error_code').eq('id',input.request_id).eq('workspace_id',wid).single();
      if (error) throw error;
      return result({ message: data, duplicate: true });
    }
    let provider;
    try {
      const payload = { messaging_product:'whatsapp',recipient_type:'individual',to:input.to,type:input.kind };
      if (input.kind === 'text') payload.text = { preview_url:false,body:input.body.trim() };
      else payload.template = { name:input.body,language:{code:input.language},...(parameters.length ? { components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}] } : {}) };
      provider = await graph(`${connection.phone_number_id}/messages`,token,{method:'POST',body:JSON.stringify(payload)});
    } catch (error) {
      // An ambiguous timeout may already have sent the message. Never resend automatically.
      await rpc(db,'finish_message',{request_id:input.request_id,meta_id:null,result_status:error.metaCode ? 'failed':'unknown',result_error:error.metaCode || 'NETWORK_UNCERTAIN'});
      if (error.metaCode) throw error;
      return result({ message:{id:input.request_id,status:'unknown'}, warning:'No se pudo confirmar el envío. Revisa la actividad antes de intentar otro mensaje.' });
    }
    const providerId = provider.messages?.[0]?.id;
    await rpc(db,'finish_message',{request_id:input.request_id,meta_id:providerId || null,result_status:providerId ? 'accepted':'unknown',result_error:providerId ? null:'NO_MESSAGE_ID'});
    return result({ message:{id:input.request_id,status:providerId ? 'accepted':'unknown'} });
  } catch (error) { return failure(error); }
}

