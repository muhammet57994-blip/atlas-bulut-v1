import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
import {describeError,reportError,resetErrorStorm} from '../src/log.js';
import {offlineSnapshot} from '../src/offline.js';
import {managementRequest} from '../src/record-management.js';
const origin='https://atlas.example';
const password='test-access-password-long-2026';
const allow={limit:async()=>({success:true})};
const env=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')}});

test('every response carries a fresh request id, including rejections',async()=>{
 const w=createWorker(),e=env();
 const asset=await w.fetch(new Request(origin+'/'),e);
 assert.match(asset.headers.get('X-ATLAS-Request-Id'),/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
 const denied=await w.fetch(new Request(origin+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Merhaba'}]})}),e);
 assert.equal(denied.status,401);
 assert.match(denied.headers.get('X-ATLAS-Request-Id'),/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
 assert.notEqual(denied.headers.get('X-ATLAS-Request-Id'),asset.headers.get('X-ATLAS-Request-Id'));
});

test('unexpected failures log one sanitized entry tied to the request id',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const e=env();
 const broken={...e,ASSETS:{fetch:async()=>{throw new Error('asset failure '+e.SESSION_SECRET+' '+e.GEMINI_API_KEY);}}};
 const response=await createWorker().fetch(new Request(origin+'/'),broken);
 assert.equal(response.status,503);
 assert.equal(logged.length,1);
 const entry=JSON.parse(logged[0]);
 assert.equal(entry.event,'atlas_error');
 assert.equal(entry.message,'[omitted]','free-form messages are dropped, never logged');
 assert.equal(entry.stage,'worker.request');
 assert.equal(entry.route,'/');
 assert.equal(entry.requestId,response.headers.get('X-ATLAS-Request-Id'));
 assert.ok(!logged[0].includes(e.SESSION_SECRET),'session secret must not be logged');
 assert.ok(!logged[0].includes(e.GEMINI_API_KEY),'provider key must not be logged');
});

test('provider failures are recorded without leaking request content',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const e=env(),w=createWorker(async()=>new Response('FAKE_TEST_KEY private provider detail',{status:500}));
 const login=await w.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})}),e);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 const response=await w.fetch(new Request(origin+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({messages:[{role:'user',text:'gizli mesaj metni'}]})}),e);
 assert.equal(response.status,502);
 const text=logged.join('\n');
 assert.match(text,/"stage":"model\.chat\.provider"/u);
 assert.ok(!text.includes('FAKE_TEST_KEY'));
 assert.ok(!text.includes('gizli mesaj metni'));
});

test('module read failures reuse the request id of the response',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const e=env(),w=createWorker();
 const login=await w.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})}),e);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 const broken={...e,MEMORY_DB:{prepare(){throw new Error('D1_ERROR: no such table: atlas_notes');}}};
 const response=await w.fetch(new Request(origin+'/api/daily',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'}),broken);
 assert.equal(response.status,503);
 const id=response.headers.get('X-ATLAS-Request-Id');
 const entries=logged.map(line=>JSON.parse(line)).filter(entry=>entry.stage==='db.daily.read');
 assert.equal(entries.length,1,'the failed read is recorded once');
 assert.equal(entries[0].requestId,id,'the database entry is tied to the response request id');
 assert.equal(entries[0].table,'atlas_agenda');
 assert.ok(!logged.join('\n').includes(e.SESSION_SECRET));
});

test('module write requests record the request id they were called with',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const requestId='3f9e2a51-8c47-4b6d-9e0a-1d5c7b2f4a86';
 const result=await offlineSnapshot({noteIds:[1],listIds:[]},{...env(),MEMORY_DB:{prepare(){throw new Error('D1_ERROR: no such table: atlas_offline_receipts');}}},new Date('2026-11-12T09:00:00Z'),requestId);
 assert.equal(result.status,503);
 const entry=JSON.parse(logged.at(-1));
 assert.equal(entry.stage,'offline.request');
 assert.equal(entry.requestId,requestId);
 assert.match(entry.message,/^D1_ERROR: no such table: atlas_[a-z_]+$/u,'only the schema-level message survives, no record content');
 assert.ok(!logged.join('\n').includes(env().SESSION_SECRET));
});

test('internal snapshot reads inherit the request id from the entry point',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const requestId='8d41c6b2-9f3a-4e57-8c21-6b0d5a7e2f93';
 const result=await managementRequest({messages:[{role:'user',text:'kayıtlarımı göster'}]},{...env(),MEMORY_DB:{prepare(){throw new Error('D1_ERROR: no such table: atlas_record_changes');}}},new Date('2026-11-12T09:00:00Z'),requestId);
 assert.ok(result,'the listing command is recognised');
 const entry=logged.map(line=>JSON.parse(line)).find(item=>item.stage==='db.management.read');
 assert.ok(entry,'the read behind the listing is recorded');
 assert.equal(entry.requestId,requestId,'the nested read keeps the caller id instead of an empty one');
 assert.equal(entry.table,'atlas_record_changes');
});

test('worker.request and worker.crash entries always carry stage and request id',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const e=env();
 const requestFailure=await createWorker().fetch(new Request(origin+'/',{method:'GET'}),{...e,ASSETS:{fetch:async()=>{throw new Error('asset failure');}}});
 assert.equal(requestFailure.status,503);
 // The inner catch builds its route from new URL(request.url); an unparsable url
 // throws there too and lands in the outer worker.crash handler.
 const crashFailure=await createWorker().fetch({url:'bozuk adres',method:'GET',headers:new Headers()},e);
 assert.equal(crashFailure.status,503);
 const entries=logged.map(line=>JSON.parse(line));
 assert.deepEqual(entries.map(entry=>entry.stage),['worker.request','worker.crash'],'both failure paths are recorded once, in order');
 assert.deepEqual(entries.map(entry=>entry.requestId),[requestFailure.headers.get('X-ATLAS-Request-Id'),crashFailure.headers.get('X-ATLAS-Request-Id')],'each entry is tied to its own response');
 for(const entry of entries){
  assert.equal(entry.event,'atlas_error');
  assert.equal(typeof entry.stage,'string',`${entry.stage} stage must stay a string`);
  assert.ok(entry.stage.length>0,'stage is never empty');
  assert.match(entry.requestId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,'every entry carries the request uuid');
 }
});

test('an error storm is capped per stage per minute',()=>{
 const logged=[];const original=console.error;
 console.error=(...args)=>logged.push(args.join(' '));
 try{resetErrorStorm();for(let i=0;i<40;i++)reportError({stage:'storm.test',requestId:'0b7d4e2a-6f1c-4d3b-9a55-2c8f0e1d7a44',error:new Error('boom')});}
 finally{console.error=original;resetErrorStorm();}
 assert.equal(logged.length,30,'the free log budget keeps the first 30 lines per minute');
 assert.equal(JSON.parse(logged[0]).stage,'storm.test');
});

test('the log helper keeps only allowlisted fields and redacts key-like values',()=>{
 const described=describeError(Object.assign(new Error('failed for AIzaSyFAKEKEY1234567890'),{status:502}));
 assert.equal(described.name,'Error');
 assert.equal(described.status,502);
 assert.equal(described.message,'[omitted]');
 assert.ok(!described.message.includes('AIzaSy'));
 assert.equal(describeError(new Error('D1_ERROR: no such table: atlas_notes')).message,'D1_ERROR: no such table: atlas_notes');
 assert.equal(describeError(Object.assign(new Error('x'),{code:'D1_ERROR'})).code,'D1_ERROR');
 const logged=[];const original=console.error;
 console.error=(...args)=>logged.push(args.join(' '));
 try{reportError({stage:'db.read',requestId:'0b7d4e2a-6f1c-4d3b-9a55-2c8f0e1d7a44',error:new Error('boom'),meta:{table:'atlas_notes',prompt:'secret',route:'/api/chat'}});}
 finally{console.error=original;}
 const entry=JSON.parse(logged[0]);
 assert.equal(entry.stage,'db.read');
 assert.equal(entry.table,'atlas_notes');
 assert.equal(entry.route,'/api/chat');
 assert.equal(entry.requestId,'0b7d4e2a-6f1c-4d3b-9a55-2c8f0e1d7a44');
 assert.equal(entry.prompt,undefined);
});
