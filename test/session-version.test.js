import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
import {resetSessionEpochCache,sessionEpoch} from '../src/session-version.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
function settingsDb(){
 const rows=new Map();
 return {prepare(sql){
  let args=[];
  const api={
   bind(...values){args=values;return api;},
   async first(){return rows.has('session_epoch')?{value:rows.get('session_epoch')}:undefined;},
   async run(){if(/INSERT INTO atlas_settings/u.test(sql))rows.set('session_epoch',args[0]);return {meta:{changes:1}};},
   async all(){return {results:[]};}
  };
  return api;
 }};
}
const base=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('ok')}});
function call(path,{method='GET',cookie,body}={}){
 return new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
async function login(worker,env){const response=await worker.fetch(call('/api/login',{method:'POST',body:{password}}),env);return response.headers.get('Set-Cookie').split(';')[0];}

test('revoking all sessions invalidates the cookie that requested it',async()=>{
 resetSessionEpochCache();
 const worker=createWorker(),env={...base(),MEMORY_DB:settingsDb()};
 const cookie=await login(worker,env);
 const open=await worker.fetch(call('/api/session',{cookie}),env);
 assert.equal((await open.json()).authenticated,true);
 const revoked=await worker.fetch(call('/api/session/revoke-all',{method:'POST',cookie,body:{}}),env);
 assert.equal(revoked.status,200);
 assert.match(revoked.headers.get('Set-Cookie')||'',/Max-Age=0/u);
 assert.equal((await (await worker.fetch(call('/api/session',{cookie}),env)).json()).authenticated,false,'the old cookie no longer opens a session');
 const fresh=await login(worker,env);
 assert.equal((await (await worker.fetch(call('/api/session',{cookie:fresh}),env)).json()).authenticated,true,'a new login uses the new epoch');
 assert.equal((await worker.fetch(call('/api/diagnostics',{cookie}),env)).status,401,'private routes reject the revoked cookie');
});

test('revocation needs a session, a database and the same origin',async()=>{
 resetSessionEpochCache();
 const worker=createWorker(),env={...base(),MEMORY_DB:settingsDb()};
 assert.equal((await worker.fetch(call('/api/session/revoke-all',{method:'POST',body:{}}),env)).status,401);
 const cookie=await login(worker,env);
 const foreign=new Request(origin+'/api/session/revoke-all',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:cookie},body:'{}'});
 assert.equal((await worker.fetch(foreign,env)).status,403);
 const noDb={...base()};
 const cookie2=await login(worker,noDb);
 assert.equal((await worker.fetch(call('/api/session/revoke-all',{method:'POST',cookie:cookie2,body:{}}),noDb)).status,503);
});

test('a missing settings table reads as epoch zero instead of failing',async()=>{
 resetSessionEpochCache();
 const env={MEMORY_DB:{prepare(){throw new Error('no such table: atlas_settings');}}};
 assert.equal(await sessionEpoch(env),0);
 assert.equal(await sessionEpoch(base()),0,'no database means no revocation list');
});
