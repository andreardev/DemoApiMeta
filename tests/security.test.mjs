import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { encrypt, decrypt, verifySignature, validPhone } from '../lib/security.mjs';

test('tokens encrypted with authenticated encryption and fresh IVs',()=>{
 const key='ab'.repeat(32), encrypted=encrypt('a-private-token',key);
 assert.equal(decrypt(encrypted,key),'a-private-token');
 assert.notEqual(encrypt('a-private-token',key),encrypted);
 assert.throws(()=>decrypt(encrypted,'cd'.repeat(32)));
 const parts=encrypted.split('.');parts[2]='00'+parts[2].slice(2);
 assert.throws(()=>decrypt(parts.join('.'),key));
 assert.throws(()=>encrypt('secret','invalid'));
});
test('webhooks require exact HMAC over raw bytes',()=>{
 const raw=Buffer.from('{"a":1}'),secret='app-secret';
 const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(verifySignature(raw,signature,secret),true);
 assert.equal(verifySignature(Buffer.from('{"a":2}'),signature,secret),false);
 assert.equal(verifySignature(raw,'sha256=abc',secret),false);
 assert.equal(verifySignature(raw,signature,''),false);
 assert.equal(validPhone('525512345678'),true);
 assert.equal(validPhone('+525512345678'),false);
 assert.equal(validPhone('123'),false);
});
