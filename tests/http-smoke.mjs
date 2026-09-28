import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:3000';
const home=await fetch(origin);assert.equal(home.status,200);assert.match(await home.text(),/Nexo/);
assert.equal(home.headers.get('x-content-type-options'),'nosniff');
const health=await fetch(origin+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
const denied=await fetch(origin+'/api/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);
const webhook=await fetch(origin+'/api/webhooks/meta',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.ok([401,503].includes(webhook.status));
const verification=await fetch(origin+'/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test');assert.ok([403,503].includes(verification.status));
console.log('HTTP smoke passed: homepage, health, security headers, unauthenticated send and unsigned webhook rejected.');
