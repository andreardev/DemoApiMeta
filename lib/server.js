import { createClient } from '@supabase/supabase-js';
export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function adminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AppError('El servicio aún no está configurado.', 503);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticated(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError('Inicia sesión para continuar.', 401);
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new AppError('Tu sesión venció. Inicia sesión de nuevo.', 401);
  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  return { db, userDb, user: data.user };
}
export async function readBody(request, limit = 20000) {
  if (Number(request.headers.get('content-length')) > limit) throw new AppError('Solicitud demasiado grande.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Solicitud vacía.');
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new AppError('Solicitud demasiado grande.', 413); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}
export function result(data, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function failure(error) {
  if (error instanceof AppError) return result({ error: error.message }, error.status);
  const reference = crypto.randomUUID();
  console.error(JSON.stringify({ event: 'server_error', reference, code: error.code || error.name || 'unknown' }));
  return result({ error: `No se pudo completar la operación. Referencia: ${reference}` }, 500);
}
export async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === 'P0001') throw new AppError(error.message);
    throw error;
  }
  return data;
}
export async function graph(path, token, options = {}) {
  const version = process.env.META_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version || '')) throw new AppError('Configura la versión de la API de Meta.', 503);
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000), cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const err = new AppError(`Meta rechazó la solicitud (código ${data.error?.code || response.status}). Revisa los permisos, la plantilla y el número conectado.`, 422);
    err.metaCode = String(data.error?.code || response.status);
    throw err;
  }
  return data;
}
