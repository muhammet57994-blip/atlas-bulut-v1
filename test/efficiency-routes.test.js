import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {FREE_MODELS} from '../src/models.js';
const origin='https://atlas.example',password='test-password-at-least-twenty';
const allow={limit:async()=>({success:true})};
function environment(){return {ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'session-secret-at-least-thirty-two-characters',GEMINI_API_KEY:'FAKE_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')}};}
function request(path,body={},extra={}){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});}
async function login(w,e){return (await w.fetch(request('/api/login',{password}),e)).headers.get('Set-Cookie').split(';')[0];}
function chat(w,e,cookie,preferences,text='Merhaba'){return w.fetch(request('/api/chat',{messages:[{role:'user',text}],preferences},{Cookie:cookie}),e);}
const modelReply=()=>Response.json({candidates:[{content:{parts:[{text:'Efendim, merhaba.'}]}}]});
function withDatabase(e){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  e.MEMORY_DB={prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}};
  return sql;
}

test('authenticated concurrent chats share upstream work and later requests remain fresh',async()=>{
  let calls=0,release,started;
  const began=new Promise(resolve=>{started=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  const w=createWorker(async()=>{calls++;started();await blocked;return modelReply();}),e=environment();
  const [cookieA,cookieB]=await Promise.all([login(w,e),login(w,e)]);
  const a=chat(w,e,cookieA);await began;
  const b=chat(w,e,cookieB);await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(calls,1);release();
  const results=await Promise.all([a,b]);
  for(const result of results){assert.equal(result.status,200);assert.equal(result.headers.get('X-ATLAS-Engine'),'gemini');assert.deepEqual(await result.json(),{text:'Efendim, merhaba.'});}
  assert.equal((await chat(w,e,cookieA)).status,200);assert.equal(calls,2);
});

test('profiles shape ordinary model requests without accepting free text instructions',async()=>{
  const sent=[],w=createWorker(async(_url,options)=>{sent.push(JSON.parse(options.body));return modelReply();}),e=environment(),cookie=await login(w,e);
  const cases=[[undefined,'Merhaba',1024],[{responseStyle:'brief'},'Merhaba',768],[{responseStyle:'detailed',focus:'technical'},'Merhaba',2048],[{responseStyle:'brief'},'Ayrıntılı açıkla',2048],[{responseStyle:'INJECTME',focus:'INJECTME'},'Merhaba',1024]];
  for(const [prefs,text,tokens] of cases){assert.equal((await chat(w,e,cookie,prefs,text)).status,200);assert.equal(sent.at(-1).generationConfig.maxOutputTokens,tokens);assert.ok(!JSON.stringify(sent.at(-1)).includes('INJECTME'));assert.equal(sent.at(-1).tools,undefined);}
});

test('provider quota errors are sanitized, not retried or cached, with bounded retry suggestion',async()=>{
  let calls=0;const w=createWorker(async()=>{calls++;return new Response('FAKE_KEY provider private details',{status:429,headers:{'Retry-After':'120'}});}),e=environment(),cookie=await login(w,e);
  for(let i=0;i<2;i++){const r=await chat(w,e,cookie);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'120');const body=await r.json();assert.equal(body.retryRecommendation,120);assert.doesNotMatch(body.error,/FAKE_KEY|private|günlük/);}
  assert.equal(calls,FREE_MODELS.length*2,'each request walks the free chain once and no answer is cached');
});

test('center route preserves authentication, origin, rate and size protections without a model',async()=>{
  let calls=0;const keys=[],w=createWorker(async()=>{calls++;throw Error('unexpected');}),e=environment(),sql=withDatabase(e);
  e.CHAT_LIMIT={limit:async({key})=>{keys.push(key);return {success:true};}};
  assert.equal((await w.fetch(request('/api/center'),e)).status,401);
  const cookie=await login(w,e);
  assert.equal((await w.fetch(request('/api/center',{}, {Cookie:cookie,Origin:'https://evil.example'}),e)).status,403);
  assert.equal((await w.fetch(request('/api/center',{}, {Cookie:cookie}),{...e,CHAT_LIMIT:{limit:async()=>({success:false})}})).status,429);
  assert.equal((await w.fetch(request('/api/center',{padding:'x'.repeat(40000)},{Cookie:cookie}),e)).status,413);
  const r=await w.fetch(request('/api/center',{}, {Cookie:cookie}),e);assert.equal(r.status,200);assert.equal((await r.json()).center.modelCalled,false);assert.ok(keys.includes('atlas-center@shared'));
  for(const [text,opens] of [['Merkezimi aç',true],['Bana durum özeti ver',false],['Bugün neye odaklanayım',false]]){
    const response=await chat(w,e,cookie,{responseStyle:'detailed'},text);assert.equal(response.status,200);const body=await response.json();assert.equal(body.openCenter,opens?true:undefined);assert.match(body.text,/Efendim/);assert.equal(body.center.modelCalled,false);
  }
  assert.equal(calls,0);sql.close();
});

test('preferences do not bypass note and memory confirmations and new assets retain protection',async()=>{
  let calls=0;const w=createWorker(async()=>{calls++;return modelReply();}),e=environment(),sql=withDatabase(e),cookie=await login(w,e);
  for(const text of ['Not al: Yeni fikir','Bunu hatırla: Ankara']){
    const r=await chat(w,e,cookie,{responseStyle:'detailed',focus:'technical',confirmed:true},text);const body=await r.json();assert.equal(r.status,200);assert.ok(body.noteDraft||body.memoryDraft);assert.match(body.text,/onay/);
  }
  assert.equal(calls,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM atlas_notes').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM atlas_memories').get().n,0);
  for(const path of ['/experience.js','/experience.css']){const r=await w.fetch(new Request(origin+path),e);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok(r.headers.get('Content-Security-Policy'));}
  sql.close();
});
