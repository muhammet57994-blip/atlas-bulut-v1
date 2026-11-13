import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
import {healthSnapshot} from '../src/health.js';
import {resetTelemetry} from '../src/telemetry.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const env=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')}});
function post(path,body={},cookie){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
async function login(w,e){return (await w.fetch(post('/api/login',{password}),e)).headers.get('Set-Cookie').split(';')[0];}

test('the diagnostics endpoint returns the recent sanitized errors to a session',async t=>{
 const w=createWorker(),e=env(),cookie=await login(w,e);
 const broken={...e,ASSETS:{fetch:async()=>{throw new Error('asset failure '+e.SESSION_SECRET);}}};
 const failed=await w.fetch(new Request(origin+'/'),broken);
 const id=failed.headers.get('X-ATLAS-Request-Id');
 const open=await w.fetch(new Request(origin+'/api/diagnostics'),e);
 assert.equal(open.status,401,'without a session only the auth gate answers');
 const response=await w.fetch(new Request(origin+'/api/diagnostics',{headers:{Cookie:cookie}}),e);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.ok(body.count>=1);
 const hit=body.items.find(item=>item.requestId===id);
 assert.ok(hit,'the failed request id is present');
 assert.equal(hit.stage,'worker.request');
 assert.ok(!JSON.stringify(body).includes(e.SESSION_SECRET),'errors stay sanitized');
});

test('health reports per-isolate model counters',async()=>{
 resetTelemetry();
 const worker=createWorker(async()=>new Response('quota',{status:429}));
 const cookie=await login(worker,env());
 await worker.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),env());
 const snapshot=await healthSnapshot(env(),{now:new Date()});
 assert.equal(snapshot.payload.model.stats.quota,4,'every free model answered 429');
 assert.equal(snapshot.payload.model.stats.requests,4);
 assert.ok(snapshot.payload.model.stats.models['gemini-3.5-flash-lite'],'per-model counters exist');
 resetTelemetry();
});

test('every response reports its duration and slow ones are logged',async t=>{
 const logged=[];t.mock.method(console,'log',(...args)=>logged.push(args.join(' ')));
 const fast=await createWorker().fetch(new Request(origin+'/'),env());
 assert.match(fast.headers.get('X-ATLAS-Duration-Ms') || '',/^\d+$/u);
 assert.ok(Number(fast.headers.get('X-ATLAS-Duration-Ms'))>=0);
 const slowEnv={...env(),ASSETS:{fetch:async()=>{await new Promise(resolve=>setTimeout(resolve,550));return new Response('<h1>ATLAS</h1>');}}};
 const slow=await createWorker().fetch(new Request(origin+'/'),slowEnv);
 const id=slow.headers.get('X-ATLAS-Request-Id');
 assert.ok(Number(slow.headers.get('X-ATLAS-Duration-Ms'))>=500);
 const entries=logged.map(line=>JSON.parse(line)).filter(entry=>entry.event==='atlas_request');
 const hit=entries.find(entry=>entry.requestId===id);
 assert.ok(hit,'the slow request is logged');
 assert.equal(hit.route,'/');
 assert.ok(hit.durationMs>=500);
});
