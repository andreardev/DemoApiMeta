import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
export function encrypt(value, key = process.env.ENCRYPTION_KEY) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('Falta configurar ENCRYPTION_KEY en el servidor.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.');
}
export function decrypt(value, key = process.env.ENCRYPTION_KEY) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('Falta configurar ENCRYPTION_KEY.');
  const [iv, tag, body] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(body, 'hex')), cipher.final()]).toString('utf8');
}
export function verifySignature(raw, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const actual = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(actual, expected);
}
export function validPhone(value) { return typeof value === 'string' && /^[1-9]\d{7,14}$/.test(value); }
export function validUUID(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
