import { verifySignature } from '../../../../lib/security.mjs';
import { adminClient, readBody, result, failure, AppError, rpc } from '../../../../lib/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  if (!process.env.META_VERIFY_TOKEN) return result({ error:'Webhook no configurado.' },503);
  if (params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === process.env.META_VERIFY_TOKEN && params.has('hub.challenge')) return new Response(params.get('hub.challenge'),{headers:{'Cache-Control':'no-store'}});
  return result({error:'Verificación inválida.'},403);
}
export async function POST(request) {
  try {
    if (!process.env.META_APP_SECRET) throw new AppError('Webhook no configurado.',503);
    const raw = await readBody(request,1024*1024);
    if (!verifySignature(raw,request.headers.get('x-hub-signature-256'),process.env.META_APP_SECRET)) throw new AppError('Firma inválida.',401);
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new AppError('JSON no válido.'); }
    const db = adminClient();
    if (payload.object === 'page' || payload.object === 'instagram') {
      for (const entry of payload.entry || []) {
        const pageId = entry.id;
        const { data: channels } = await db.from('meta_channels').select('channel,page_id').eq('page_id', pageId);
        const channel = channels?.[0]?.channel || (payload.object === 'instagram' ? 'instagram' : 'facebook');
        for (const event of entry.messaging || []) {
          const message = event.message;
          if (!message?.mid || !event.sender?.id || typeof message.text !== 'string') continue;
          const stamp = Number(event.timestamp || Date.now());
          await rpc(db,'record_meta_inbound',{meta_id:message.mid,channel_name:channel,meta_page_id:pageId,sender:event.sender.id,body:message.text,event_time:new Date(stamp)});
        }
      }
      return result({ok:true});
    }
    if (payload.object !== 'whatsapp_business_account') return result({ok:true});
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {}, phoneId = value.metadata?.phone_number_id;
        if (!phoneId || !entry.id) continue;
        for (const message of value.messages || []) {
          const timestamp = Number(message.timestamp);
          if (!message.id || !message.from || !Number.isFinite(timestamp) || timestamp <= 0) throw new AppError('Evento de mensaje inválido.');
          const content = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || `[${message.type || 'mensaje'} recibido]`;
          await rpc(db,'record_inbound',{meta_id:message.id,phone_id:phoneId,business_id:entry.id,sender:message.from,body:content,message_kind:message.type || 'unknown',event_time:new Date(timestamp*1000).toISOString()});
        }
        for (const status of value.statuses || []) {
          if (!['sent','delivered','read','failed'].includes(status.status) || !status.id) continue;
          await rpc(db,'record_delivery',{meta_id:status.id,event_status:status.status,event_error:status.errors?.[0]?.code ? String(status.errors[0].code) : null,phone_id:phoneId,business_id:entry.id});
        }
      }
    }
    // Acknowledge only after durable writes; Meta can retry any failed delivery.
    return result({ok:true});
  } catch (error) { return failure(error); }
}
