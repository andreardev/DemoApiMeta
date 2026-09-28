import { authenticated, readBody, result, failure, AppError, graph, rpc } from '../../../lib/server';
import { encrypt, decrypt, validUUID, validPhone } from '../../../lib/security.mjs';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  try {
    const { db, userDb, user } = await authenticated(request);
    let input;
    try { input = JSON.parse((await readBody(request)).toString()); } catch { throw new AppError('JSON no válido.'); }
    if (!input || !validUUID(input.workspace_id)) throw new AppError('Negocio no válido.');
    if (!['instagram','facebook'].includes(input.channel)) throw new AppError('Canal Meta no válido.');
    const wid = input.workspace_id;
    const role = await rpc(userDb, 'workspace_role', { wid });
    if (!['owner','admin'].includes(role)) throw new AppError('Solo un administrador puede configurar estos canales.', 403);
    if (input.action === 'connect') {
      if (!/^\d{5,40}$/.test(input.page_id || '') || typeof input.token !== 'string' || input.token.length < 20 || input.token.length > 4096) throw new AppError('Revisa el identificador de página y el token de Meta.');
      const fields = input.channel === 'instagram' ? 'id,name,username,instagram_business_account' : 'id,name,username';
      const page = await graph(`${input.page_id}?fields=${fields}`, input.token);
      if (String(page.id) !== String(input.page_id)) throw new AppError('Meta no devolvió la página solicitada.');
      if (input.channel === 'instagram' && !page.instagram_business_account?.id && !input.account_id) throw new AppError('La página no tiene una cuenta profesional de Instagram vinculada.');
      await rpc(db, 'connect_meta_channel', { wid, actor: user.id, channel_name: input.channel, meta_page_id: input.page_id, meta_account_id: input.account_id || page.instagram_business_account?.id || '', meta_name: page.name || '', meta_handle: page.username || '', ciphertext: encrypt(input.token) });
      return result({ ok: true, channel: input.channel, name: page.name || page.username || input.page_id });
    }
    if (input.action === 'disconnect') {
      await rpc(db, 'disconnect_meta_channel', { wid, channel_name: input.channel });
      return result({ ok: true });
    }
    if (input.action !== 'send') throw new AppError('Operación no válida.');
    if (!/^\d{5,80}$/.test(input.recipient || '') || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 4096) throw new AppError('Destinatario o mensaje no válido.');
    const { data: channel, error: channelError } = await db.from('meta_channels').select('*').eq('workspace_id',wid).eq('channel',input.channel).single();
    const { data: secret, error: secretError } = await db.from('meta_channel_credentials').select('encrypted_token').eq('workspace_id',wid).eq('channel',input.channel).single();
    if (channelError || secretError || !channel || !secret) throw new AppError(`Conecta ${input.channel} antes de enviar.`);
    const token = decrypt(secret.encrypted_token);
    const sender = input.channel === 'instagram' ? channel.account_id : channel.page_id;
    const provider = await graph(`${sender}/messages`, token, { method:'POST', body:JSON.stringify({ recipient:{ id:input.recipient }, message:{ text:input.body.trim() }, messaging_type:'RESPONSE' }) });
    return result({ ok:true, provider_id:provider.message_id || provider.id || null });
  } catch (error) { return failure(error); }
}
