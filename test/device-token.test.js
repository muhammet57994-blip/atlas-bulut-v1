import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {sharedApi} from '../scripts/shared-api.mjs';
const origin='https://atlas.example';
const password='device-token-test-password-long-enough';
const DEVICE='test-device-token-0123456789abcdef';
const allow={limit:async()=>({success:true})};
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../migrations/0001_memory.sql',import.meta.url),'utf8'));
 return {sql,db:{prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}}};
}
const env=overrides=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'device-token-session-secret-32-characters',GEMINI_API_KEY:'FAKE',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')},...overrides});
const call=(worker,environment,path,{token,method='GET',body}={})=>worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(token?{'X-ATLAS-Device-Token':token}:{})},...(method==='POST'?{body:JSON.stringify(body??{})}:{})}),environment);

test('a device token opens private routes without any cookie',async()=>{
 const {sql,db}=database();
 try{
  const e=env({MEMORY_DB:db,ATLAS_DEVICE_TOKEN:DEVICE});
  const response=await call(createWorker(),e,'/api/memory/list',{method:'POST',token:DEVICE});
  assert.equal(response.status,200);
  assert.equal((await response.json()).items.length,0);
 }finally{sql.close();}
});

test('a device token never mints a browser session cookie',async()=>{
 const e=env({ATLAS_DEVICE_TOKEN:DEVICE});
 const response=await call(createWorker(),e,'/api/session',{token:DEVICE});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('Set-Cookie'),null,'the bridge must not hand a cloud cookie to the browser');
 assert.equal((await response.json()).authenticated,true);
 assert.equal((await (await call(createWorker(),e,'/api/session')).json()).authenticated,false);
});

test('wrong, short, oversized and unconfigured device tokens stay unauthorized',async()=>{
 const {sql,db}=database();
 try{
  for(const [overrides,token] of [
   [{ATLAS_DEVICE_TOKEN:DEVICE},'test-device-token-0123456789abcdeX'],
   [{ATLAS_DEVICE_TOKEN:DEVICE},'short'],
   [{ATLAS_DEVICE_TOKEN:DEVICE},'x'.repeat(600)],
   [{ATLAS_DEVICE_TOKEN:'too-short-to-trust'},'too-short-to-trust'],
   [{},DEVICE]
  ]){
   const e=env({MEMORY_DB:db,...overrides});
   const response=await call(createWorker(),e,'/api/memory/list',{method:'POST',token});
   assert.equal(response.status,401,JSON.stringify({overrides:Object.keys(overrides),length:token.length}));
  }
 }finally{sql.close();}
});

test('the local bridge strips the cookie and forwards only the device token',async()=>{
 const request=cookie=>new Request('http://localhost:8790/api/memory/list',{method:'POST',headers:{Origin:'http://localhost:8790','Content-Type':'application/json',Cookie:cookie},body:'{}'});
 let seen;
 const ok=await sharedApi(request('__Host-atlas=local-session'),(url,options)=>{seen=options.headers;return Response.json({items:[]});},DEVICE);
 assert.equal(ok.status,200);
 assert.equal(seen.get('Cookie'),null);
 assert.equal(seen.get('X-ATLAS-Device-Token'),DEVICE);
 assert.equal(seen.get('Origin'),'https://atlas-pasam-v1.pages.dev');
 let called=0;
 const refused=await sharedApi(request('__Host-atlas=local-session'),()=>{called+=1;return Response.json({});});
 assert.equal(refused.status,503);
 assert.equal(called,0,'without a device token nothing is forwarded');
 assert.match(await refused.text(),/ATLAS_DEVICE_TOKEN/u);
});

test('bridge and worker agree end to end on the device token',async()=>{
 const {sql,db}=database();
 try{
  const worker=createWorker(),e=env({MEMORY_DB:db,ATLAS_DEVICE_TOKEN:DEVICE});
  const response=await sharedApi(new Request('http://localhost:8790/api/memory/list',{method:'POST',headers:{Origin:'http://localhost:8790','Content-Type':'application/json',Cookie:'__Host-atlas=stale-local-cookie'},body:'{}'}),async(url,options)=>worker.fetch(new Request(url,options),e),DEVICE);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).items,[]);
 }finally{sql.close();}
});
