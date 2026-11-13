import {test} from 'node:test';import assert from 'node:assert/strict';import {createWorker} from '../src/worker.js';
const origin='https://atlas.example';const password='test-access-password-long-2026';const allow={limit:async()=>({success:true})};
const env=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')}});

function req(path,headers={}){return new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});}

test('POST endpoints reject foreign Origin, Referer, cross-site and disallowed fetch modes',async()=>{
 const w=createWorker(),e=env();
 for(const headers of [{Origin:'https://evil.example'},{Origin:''},{Origin:'null'},{Origin:origin,Referer:'https://evil.example/panel'},{Origin:origin,Referer:'not a url'},{Origin:origin,'Sec-Fetch-Site':'cross-site'},{Origin:origin,'Sec-Fetch-Site':'banana'},{Origin:origin,'Sec-Fetch-Mode':'no-cors'},{Origin:origin,'Sec-Fetch-Mode':'websocket'}]){
  assert.equal((await w.fetch(req('/api/organize',headers),e)).status,403,JSON.stringify(headers)+' must be refused');
 }
});

test('POST endpoints accept same-origin, absent and navigate-mode requests',async()=>{
 const w=createWorker(),e=env();
 for(const headers of [{Origin:origin},{},{'Sec-Fetch-Site':'same-origin'},{'Sec-Fetch-Mode':'navigate'},{'Origin':origin,'Referer':origin+'/'}]){
  // no session cookie -> origin gate passes and auth rejects with 401
  assert.equal((await w.fetch(req('/api/organize',headers),e)).status,401,JSON.stringify(headers)+' must pass the origin gate');
 }
});

test('GET /api/everyday applies the same origin gate',async()=>{
 const w=createWorker(),e=env();
 assert.equal((await w.fetch(new Request(origin+'/api/everyday',{method:'GET',headers:{Origin:'https://evil.example'}}),e)).status,403);
 assert.equal((await w.fetch(new Request(origin+'/api/everyday',{method:'GET',headers:{Referer:'https://evil.example/panel'}}),e)).status,403);
 assert.equal((await w.fetch(new Request(origin+'/api/everyday',{method:'GET',headers:{'Sec-Fetch-Site':'cross-site'}}),e)).status,403);
 assert.equal((await w.fetch(new Request(origin+'/api/everyday',{method:'GET',headers:{'Sec-Fetch-Mode':'no-cors'}}),e)).status,403);
 // absent headers pass the gate and then fail authentication
 assert.equal((await w.fetch(new Request(origin+'/api/everyday',{method:'GET'}),e)).status,401);
});