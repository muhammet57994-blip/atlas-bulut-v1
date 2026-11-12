import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {createWorker} from '../src/worker.js';import {sharedApi} from '../scripts/shared-api.mjs';
function env(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {sql,ATLAS_ACCESS_PASSWORD:'test-password-long-enough',SESSION_SECRET:'secret'.repeat(8),GEMINI_API_KEY:'test-key',LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{limit:async()=>({success:true})},MEMORY_DB:{prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}}};}
const origin='https://atlas.test',msg=text=>({messages:[{role:'user',text}]});
function caller(w,e){return (path,body,cookie='',source=origin)=>w.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:source,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),e);}
async function login(call,e){return (await call('login',{password:e.ATLAS_ACCESS_PASSWORD})).headers.get('Set-Cookie').split(';')[0];}
test('routine drafts and cross-device execution are protected and never save plans without separate approval',async()=>{
 const e=env(),w=createWorker(()=>{throw Error('Unexpected model');}),call=caller(w,e),body={...msg('Bu komutu öğren'),routineDraftRequest:{trigger:'Odak atölyesini aç',topic:'ATLAS',steps:['records','day']}};
 assert.equal((await call('chat',body)).status,401);const phone=await login(call,e),desktop=await login(call,e);assert.equal((await call('chat',body,phone,'https://evil.test')).status,403);
 const d=await (await call('chat',body,phone)).json();assert.ok(d.routineDraft);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_routines').get().n,0);
 assert.equal((await call('chat',{...body,routineConfirmation:{token:d.routineDraft.token,confirmed:true}},phone)).status,400);
 assert.equal((await call('chat',{...msg('Evet'),routineConfirmation:{token:d.routineDraft.token,confirmed:true}},phone)).status,400);
 assert.equal((await call('chat',{...msg('Rutini onaylıyorum'),routineConfirmation:{token:d.routineDraft.token,confirmed:true}},phone)).status,200);
 e.sql.prepare('INSERT INTO atlas_tasks(title,created_at) VALUES (?,?)').run('ATLAS demosu',new Date().toISOString());
 const r=await (await call('chat',msg('Odak atölyesini aç'),desktop)).json();assert.ok(r.planDraft);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_plans').get().n,0);assert.equal(e.sql.prepare('SELECT done FROM atlas_tasks').get().done,0);
 assert.equal((await (await call('chat',msg('Rutinlerimi göster'),desktop)).json()).routineItems.length,1);
});
test('visual route enforces authentication, origin, rate, size and consent before model access',async()=>{
 let calls=0;const e=env(),w=createWorker(async()=>{calls++;return Response.json({candidates:[{content:{parts:[{text:'Efendim, sağ üstteki başlığa bakın.'}]},finishReason:'STOP'}]});}),call=caller(w,e),body={images:[{mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,0,0,0,0,0,255,217]).toString('base64')}],question:'Bu ekranı açıkla',confirmed:true};
 assert.equal((await call('visual/analyze',body)).status,401);const cookie=await login(call,e);assert.equal((await call('visual/analyze',body,cookie,'https://evil.test')).status,403);assert.equal((await call('visual/analyze',{...body,confirmed:false},cookie)).status,400);
 assert.equal((await call('visual/analyze',{...body,extra:'x'.repeat(3*1024*1024)},cookie)).status,413);assert.equal(calls,0);
 assert.equal((await call('visual/analyze',body,cookie)).status,200);assert.equal(calls,1);e.CHAT_LIMIT={limit:async()=>({success:false})};assert.equal((await call('visual/analyze',body,cookie)).status,429);assert.equal(calls,1);
});
test('visual voice launcher is local metadata and desktop forwards only to the fixed shared service',async()=>{
 const e=env(),call=caller(createWorker(()=>{throw Error('No model');}),e),cookie=await login(call,e);assert.equal((await (await call('chat',msg('Şuna birlikte bakalım'),cookie)).json()).visualOpen,true);
 const request=new Request('http://localhost:8790/api/visual/analyze',{method:'POST',headers:{Origin:'http://localhost:8790','Content-Type':'application/json'},body:'{}'});
 const response=await sharedApi(request,async(url,options)=>{assert.equal(url,'https://atlas-pasam-v1.pages.dev/api/visual/analyze');assert.equal(options.headers.get('Origin'),'https://atlas-pasam-v1.pages.dev');return Response.json({ok:true});},'test-device-token-0123456789abcdef');assert.equal(response.status,200);
});
