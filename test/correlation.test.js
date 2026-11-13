import {test} from 'node:test';import assert from 'node:assert/strict';import {readdirSync,readFileSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// 1x1 transparent PNG, accepted by the vision validator.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const env=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',INSTAGRAM_APP_SECRET:'app-secret',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')}});
const brokenDb=()=>({prepare(){throw new Error('D1_ERROR: no such table: atlas_records');}});
function post(path,body={},cookie,extra={}){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(body)});}
async function login(w,e){const r=await w.fetch(post('/api/login',{password}),e);return r.headers.get('Set-Cookie').split(';')[0];}
function capture(t){const lines=[];t.mock.method(console,'error',(...args)=>lines.push(args.join(' ')));return lines;}
function correlate(response,lines,stage){
 const id=response.headers.get('X-ATLAS-Request-Id');
 assert.match(id,UUID,`${stage}: the response carries a request id`);
 const hits=lines.map(line=>JSON.parse(line)).filter(entry=>entry.event==='atlas_error'&&entry.stage===stage);
 assert.equal(hits.length,1,`${stage}: exactly one entry is logged`);
 assert.equal(hits[0].requestId,id,`${stage}: the log entry matches the response header`);
 return hits[0];
}

test('database read failures keep the response request id on every read route',async t=>{
 const lines=capture(t),w=createWorker(),e={...env(),MEMORY_DB:brokenDb()},cookie=await login(w,e);
 for(const [path,stage] of [['/api/everyday','db.budgets.read'],['/api/dayflow','db.replan.read'],['/api/daily','db.daily.read'],['/api/organize','db.management.read']]){
  const response=await w.fetch(post(path,{},cookie),e);
  assert.equal(response.status,503,path);
  correlate(response,lines,stage);
 }
});

test('later reads on a partially broken database keep the response request id',async t=>{
 const lines=capture(t),w=createWorker(),cookie=await login(w,env());
 const selective=tables=>({prepare(sql){if(tables.some(table=>sql.includes(table)))throw new Error('D1_ERROR: no such table: '+tables[0]);return {bind(){return this;},first:async()=>({}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})};}});
 const waiting=await w.fetch(post('/api/everyday',{},cookie),{...env(),MEMORY_DB:selective(['atlas_waiting'])});
 assert.equal(waiting.status,503);correlate(waiting,lines,'db.waiting.read');
 const focus=await w.fetch(post('/api/daily',{},cookie),{...env(),MEMORY_DB:selective(['atlas_focus_sessions'])});
 assert.ok(focus.status>=500);correlate(focus,lines,'db.focus.read');
 const lists=await w.fetch(post('/api/organize',{},cookie),{...env(),MEMORY_DB:selective(['atlas_lists'])});
 assert.equal(lists.status,503);correlate(lists,lines,'db.lists.read');
 const bills=await w.fetch(post('/api/dayflow',{},cookie),{...env(),MEMORY_DB:selective(['atlas_bills'])});
 assert.equal(bills.status,503);correlate(bills,lines,'db.bills.read');
});

test('the Instagram account read keeps the response request id',async t=>{
 const lines=capture(t),w=createWorker(),e={...env(),MEMORY_DB:brokenDb()},cookie=await login(w,e);
 const response=await w.fetch(post('/api/instagram/status',{},cookie),e);
 assert.ok(response.status>=400);
 correlate(response,lines,'instagram.account');
});

test('backup build failures keep the response request id',async t=>{
 const lines=capture(t),w=createWorker();
 // A database without batch() cannot produce an atomic snapshot.
 const e={...env(),MEMORY_DB:{prepare:()=>({bind(){return this;},first:async()=>({}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}};
 const cookie=await login(w,e);
 const response=await w.fetch(post('/api/backup',{format:'json'},cookie),e);
 assert.equal(response.status,503);
 correlate(response,lines,'backup.build');
});

test('the unauthenticated health probe keeps the response request id',async t=>{
 const lines=capture(t);
 const response=await createWorker().fetch(new Request(origin+'/api/health'),{...env(),MEMORY_DB:brokenDb()});
 assert.ok([200,503].includes(response.status),'health reports, never throws');
 correlate(response,lines,'health.db');
});

test('model failures keep the response request id',async t=>{
 const lines=capture(t);
 const provider=createWorker(async()=>new Response('boom',{status:500})),e=env(),cookie=await login(provider,e);
 const failed=await provider.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),e);
 assert.equal(failed.status,502);
 correlate(failed,lines,'model.chat.provider');
 const offline=createWorker(async()=>{throw new Error('boom');});
 const timedOut=await offline.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),e);
 assert.equal(timedOut.status,504);
 correlate(timedOut,lines,'model.chat');
 const speech=await offline.fetch(post('/api/speech',{text:'Merhaba'},cookie),e);
 assert.ok(speech.status>=500);
 correlate(speech,lines,'model.speech');
 const live=await offline.fetch(post('/api/live/token',{},cookie),e);
 assert.ok(live.status>=500);
 correlate(live,lines,'model.live');
 const vision=await offline.fetch(post('/api/visual/analyze',{confirmed:true,question:'Ne görüyorsun?',images:[{mimeType:'image/png',data:PNG}]},cookie),e);
 assert.ok(vision.status>=500);
 correlate(vision,lines,'model.vision');
 // Minimal JPEG frame: the validator checks the SOI/EOI markers only.
 const jpeg=Buffer.from([0xff,0xd8,0xff,...Array(12).fill(0),0xff,0xd9]).toString('base64');
 const instagram=await offline.fetch(post('/api/instagram/analyze',{confirmed:true,goal:'Büyümek istiyorum',images:[{mimeType:'image/jpeg',data:jpeg}]},cookie),e);
 assert.equal(instagram.status,504);
 correlate(instagram,lines,'model.instagram');
});

test('every reportError call passes a requestId',()=>{
 const dir=new URL('../src/',import.meta.url),offenders=[];
 for(const file of readdirSync(dir).filter(name=>name.endsWith('.js'))){
  const text=readFileSync(new URL(file,dir),'utf8');
  for(const match of text.matchAll(/reportError\(\{([^}]*)\}/g)) if(!/\brequestId\b/u.test(match[1])) offenders.push(file+': '+match[0].slice(0,90));
 }
 assert.deepEqual(offenders,[],'a new error sink must carry the request id');
});