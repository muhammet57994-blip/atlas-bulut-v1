import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example', secret='long-test-secret-01234567890123456789';
const enc=new TextEncoder(), b64=b=>Buffer.from(b).toString('base64url');
test('expired and future sessions rejected even with valid signatures',async()=>{
 const env={ATLAS_ACCESS_PASSWORD:'long-test-password-123456',SESSION_SECRET:secret,LOGIN_LIMIT:{},CHAT_LIMIT:{}};
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const pwd=b64(await crypto.subtle.digest('SHA-256',enc.encode(env.ATLAS_ACCESS_PASSWORD)));
 for(const exp of [Math.floor(Date.now()/1000)-1,Math.floor(Date.now()/1000)+31*86400]){
 const payload=b64(JSON.stringify({exp,pwd}));const signature=b64(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
 const r=await createWorker().fetch(new Request(origin+'/api/session',{headers:{Cookie:`__Host-atlas=${payload}.${signature}`}}),env);
 assert.equal((await r.json()).authenticated,false);
 }
});
test('remembered session survives next-day visits, renews for 30 days and expires without renewal',async t=>{
 const e={ATLAS_ACCESS_PASSWORD:'long-test-password-123456',SESSION_SECRET:secret,LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{}},w=createWorker();
 const initial=Date.now();const clock=t.mock.method(Date,'now',()=>initial);
 const login=await w.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:e.ATLAS_ACCESS_PASSWORD})}),e);
 assert.match(login.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict; Max-Age=2592000/);
 const old=login.headers.get('Set-Cookie').split(';')[0];
 clock.mock.mockImplementation(()=>initial+86400000);
 const session=await w.fetch(new Request(origin+'/api/session',{headers:{Cookie:old}}),e);assert.equal((await session.json()).authenticated,true);
 const renewed=session.headers.get('Set-Cookie').split(';')[0];assert.notEqual(renewed,old);
 clock.mock.mockImplementation(()=>initial+30*86400000+1000);
 const stale=await w.fetch(new Request(origin+'/api/session',{headers:{Cookie:old}}),e);assert.equal((await stale.json()).authenticated,false);assert.equal(stale.headers.get('Set-Cookie'),null);
 assert.equal((await (await w.fetch(new Request(origin+'/api/session',{headers:{Cookie:renewed}}),e)).json()).authenticated,true);
 const rotated=await w.fetch(new Request(origin+'/api/session',{headers:{Cookie:renewed}}),{...e,ATLAS_ACCESS_PASSWORD:e.ATLAS_ACCESS_PASSWORD+'new'});assert.equal((await rotated.json()).authenticated,false);assert.equal(rotated.headers.get('Set-Cookie'),null);
 const out=await w.fetch(new Request(origin+'/api/logout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),e);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);
});
test('legacy live session upgrades, but cross-site and unauthenticated checks never renew',async()=>{
 const e={ATLAS_ACCESS_PASSWORD:'long-test-password-123456',SESSION_SECRET:secret,LOGIN_LIMIT:{},CHAT_LIMIT:{}},w=createWorker();
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const pwd=b64(await crypto.subtle.digest('SHA-256',enc.encode(e.ATLAS_ACCESS_PASSWORD)));
 const p=b64(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,pwd})),sig=b64(await crypto.subtle.sign('HMAC',key,enc.encode(p))),Cookie='__Host-atlas='+p+'.'+sig;
 const valid=await w.fetch(new Request(origin+'/api/session',{headers:{Cookie}}),e);assert.match(valid.headers.get('Set-Cookie'),/Max-Age=2592000/);
 for(const headers of [{},{Cookie,Origin:'https://evil.example'},{Cookie,'Sec-Fetch-Site':'cross-site'}])assert.equal((await w.fetch(new Request(origin+'/api/session',{headers}),e)).headers.get('Set-Cookie'),null);
});
test('stream size enforced without Content-Length',async()=>{
 const e={ATLAS_ACCESS_PASSWORD:'long-test-password-123456',SESSION_SECRET:secret,LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{}};
 const stream=new ReadableStream({start(c){c.enqueue(enc.encode('x'.repeat(33000)));c.close();}});
 const r=await createWorker().fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:stream,duplex:'half'}),e);
 assert.equal(r.status,413);
});
