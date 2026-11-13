import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {checkModelBudget,recordModelCall,dailyUsage,dailyCap,dayKey,secondsUntilMidnight} from '../src/request-budget.js';
import {modelRequest,BUDGET_MESSAGE} from '../src/models.js';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function setup(){
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const MEMORY_DB={prepare(sql){let args=[];const wrap={bind(...values){args=values;return wrap;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};return wrap;}};
 return {db,MEMORY_DB};
}
const base=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('ok')}});
const ok=()=>Response.json({candidates:[{content:{parts:[{text:'Merhaba.'}]},finishReason:'STOP'}]});
function post(path,body={},cookie){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
async function login(worker,env){return (await worker.fetch(post('/api/login',{password}),env)).headers.get('Set-Cookie').split(';')[0];}

test('the gate opens until the cap is recorded, then closes with a retry hint',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB,DAILY_MODEL_LIMIT:'20'},now=new Date('2026-11-13T09:00:00Z');
 for(let i=0;i<19;i++){assert.equal((await checkModelBudget(env,now)).allowed,true);await recordModelCall(env,now);}
 assert.equal((await checkModelBudget(env,now)).allowed,true);
 await recordModelCall(env,now);
 const blocked=await checkModelBudget(env,now);
 assert.equal(blocked.allowed,false);
 assert.equal(blocked.cap,20);
 assert.equal(blocked.used,20);
 assert.ok(blocked.retryAfter>0);
 assert.deepEqual(await dailyUsage(env,now),{used:20,cap:20,day:'model_calls_2026-11-13'});
});

test('a refused, failed, timed-out or quota-only call never increments the counter',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB},now=new Date('2026-11-13T09:00:00Z');
 const run=async(upstream)=>{try{await modelRequest(env,{contents:[]},{upstream});}catch{}return (await dailyUsage(env,now)).used;};
 assert.equal(await run(async()=>new Response('boom',{status:500})),0,'a 5xx is not a completed call');
 assert.equal(await run(async()=>new Response('quota',{status:429})),0,'a full quota chain is not a completed call');
 assert.equal(await run(async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}),0,'a timeout is not a completed call');
 assert.equal(await run(async()=>ok()),1,'a successful response counts exactly once');
 assert.equal(await run(async()=>ok()),2);
});

test('the day rolls over on Istanbul midnight, not UTC',()=>{
 assert.equal(dayKey(new Date('2026-11-13T20:59:00Z')),'model_calls_2026-11-13');
 assert.equal(dayKey(new Date('2026-11-13T21:01:00Z')),'model_calls_2026-11-14');
 assert.equal(secondsUntilMidnight(new Date('2026-11-13T20:59:00Z')),60);
 assert.ok(secondsUntilMidnight(new Date('2026-11-13T21:30:00Z'))<=86400);
});

test('an invalid cap falls back to the default and a missing table never blocks',async()=>{
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'5'}),300);
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'999999'}),300);
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'120'}),120);
 const broken={...base(),MEMORY_DB:{prepare(){throw new Error('no such table: atlas_settings');}}};
 assert.equal((await checkModelBudget(broken)).allowed,true);
 assert.equal(await recordModelCall(broken),false);
});

test('chat returns a friendly 429 once the day is spent, and local commands keep working',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB,DAILY_MODEL_LIMIT:'20'};
 let calls=0;
 const worker=createWorker(async()=>{calls++;return ok();});
 const cookie=await login(worker,env);
 assert.equal((await worker.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),env)).status,200);
 assert.equal(calls,1);
 assert.equal((await dailyUsage(env)).used,1,'the successful call was recorded');
 for(let i=1;i<20;i++)await recordModelCall(env);
 const blocked=await worker.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),env);
 assert.equal(blocked.status,429);
 assert.match(blocked.headers.get('Retry-After')||'',/^\d+$/u);
 assert.match((await blocked.json()).error,/ücretsiz model sınırına/u);
 assert.equal(calls,1,'no provider call is made after the cap');
 const memory=await worker.fetch(post('/api/memory/save',{confirmed:true,command:'Bunu hatırla: kahveyi sade içerim'},cookie),env);
 assert.equal(memory.status,200,'local commands do not need the model budget');
});

test('the visual assistant is gated by the same budget before any provider call',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB,DAILY_MODEL_LIMIT:'20'};
 let calls=0;
 const worker=createWorker(async()=>{calls++;return ok();});
 const cookie=await login(worker,env);
 for(let i=0;i<20;i++)await recordModelCall(env);
 const response=await worker.fetch(post('/api/visual/analyze',{confirmed:true,question:'Bu ekranda ne var?',images:[{mimeType:'image/png',data:PNG}]},cookie),env);
 assert.equal(response.status,429);
 assert.match((await response.json()).error,/ücretsiz analiz modellerinin sınırına/u);
 assert.equal(calls,0,'the provider is never reached while the budget is spent');
});
