import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {consumeModelCall,dailyUsage,dailyCap,dayKey,secondsUntilMidnight} from '../src/request-budget.js';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
function setup(){
 const db=new DatabaseSync(':memory:');
 for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const MEMORY_DB={prepare(sql){let args=[];const wrap={bind(...values){args=values;return wrap;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};return wrap;}};
 return {db,MEMORY_DB};
}
const base=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('ok')}});
function post(path,body={},cookie){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}

test('the daily counter stops exactly at the cap and is shared across calls',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB,DAILY_MODEL_LIMIT:'20'},now=new Date('2026-11-13T09:00:00Z');
 for(let i=0;i<20;i++)assert.equal((await consumeModelCall(env,now)).ok,true);
 const blocked=await consumeModelCall(env,now);
 assert.equal(blocked.ok,false);
 assert.equal(blocked.cap,20);
 assert.equal(blocked.used,20);
 assert.ok(blocked.retryAfter>0);
 assert.deepEqual(await dailyUsage(env,now),{used:20,cap:20,day:'model_calls_2026-11-13'});
});

test('the day rolls over on Istanbul midnight, not UTC',()=>{
 const before=new Date('2026-11-13T20:59:00Z');
 const after=new Date('2026-11-13T21:01:00Z');
 assert.equal(dayKey(before),'model_calls_2026-11-13');
 assert.equal(dayKey(after),'model_calls_2026-11-14');
 assert.ok(secondsUntilMidnight(new Date('2026-11-13T21:30:00Z'))<=86400);
 assert.equal(secondsUntilMidnight(new Date('2026-11-13T20:59:00Z')),60);
});

test('an invalid cap falls back to the default and a missing table never blocks',async()=>{
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'5'}),300);
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'999999'}),300);
 assert.equal(dailyCap({DAILY_MODEL_LIMIT:'120'}),120);
 assert.equal(dailyCap({}),300);
 const broken={MEMORY_DB:{prepare(){throw new Error('no such table: atlas_settings');}}};
 assert.equal((await consumeModelCall(broken)).ok,true);
 assert.deepEqual(await dailyUsage(broken),{used:0,cap:300,day:dayKey()});
});

test('chat returns a friendly 429 once the day is spent, while local commands still work',async()=>{
 const {MEMORY_DB}=setup(),env={...base(),MEMORY_DB,DAILY_MODEL_LIMIT:'20'};
 let calls=0;
 const worker=createWorker(async()=>{calls++;return Response.json({candidates:[{content:{parts:[{text:'Merhaba.'}]},finishReason:'STOP'}]});});
 const login=await worker.fetch(post('/api/login',{password}),env);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 const first=await worker.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),env);
 assert.equal(first.status,200);
 assert.equal(calls,1);
 for(let i=1;i<20;i++)await consumeModelCall(env);
 const blocked=await worker.fetch(post('/api/chat',{messages:[{role:'user',text:'Merhaba'}]},cookie),env);
 assert.equal(blocked.status,429);
 assert.match(blocked.headers.get('Retry-After')||'',/^\d+$/u);
 assert.match((await blocked.json()).error,/ücretsiz model sınırına/u);
 assert.equal(calls,1,'no model call is made after the cap');
 const memory=await worker.fetch(post('/api/memory/save',{confirmed:true,command:'Bunu hatırla: kahveyi sade içerim'},cookie),env);
 assert.notEqual(memory.status,429,'local commands do not spend the model budget');
});
