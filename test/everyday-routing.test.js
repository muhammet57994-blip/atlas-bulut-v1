import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {sharedApi} from '../scripts/shared-api.mjs';

const origin='https://atlas.example',password='safe-everyday-password-at-least-twenty',allow={limit:async()=>({success:true})};
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const s={sql,modelCalls:0};s.env={ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'everyday-session-secret-over-thirty-two-characters',GEMINI_API_KEY:'not-used-in-native-actions',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')},MEMORY_DB:{prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}}};s.worker=createWorker(async()=>{s.modelCalls++;throw Error('Unexpected model request');});return s;
}
const request=(path,body={},cookie,headers={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:JSON.stringify(body)});
async function session(s){return (await s.worker.fetch(request('/api/login',{password}),s.env)).headers.get('Set-Cookie').split(';')[0];}
async function post(s,path,body,cookie,status=200){const response=await s.worker.fetch(request(path,body,cookie),s.env),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
const chat=(s,cookie,text,extra={},status=200)=>post(s,'/api/chat',{messages:[{role:'user',text}],...extra},cookie,status);
const tables=['atlas_budgets','atlas_budget_operations','atlas_waiting','atlas_waiting_operations','atlas_multi_receipts','atlas_agenda','atlas_expenses','atlas_notes','atlas_tasks'];
const counts=s=>tables.map(table=>s.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const two='Birlikte yap: yarın sunumu hazırlamayı görev yap; not al: demo bağlantısı hazır';

test('everyday read POST enforces authentication, same origin, size, type and rate limits',async()=>{
 const s=setup(),cookie=await session(s);
 await post(s,'/api/everyday',{},null,401);
 for(const headers of [{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await s.worker.fetch(request('/api/everyday',{},cookie,headers),s.env)).status,403);
 assert.equal((await s.worker.fetch(new Request(origin+'/api/everyday',{method:'PUT',headers:{Cookie:cookie}}),s.env)).status,405);
 await post(s,'/api/everyday',{padding:'x'.repeat(40000)},cookie,413);assert.equal((await s.worker.fetch(request('/api/everyday',{},cookie,{'Content-Type':'text/plain'}),s.env)).status,415);
 assert.equal((await s.worker.fetch(request('/api/everyday',{},cookie),{...s.env,CHAT_LIMIT:{limit:async()=>({success:false})}})).status,429);
 const response=await s.worker.fetch(request('/api/everyday',{month:'2028-02'},cookie),s.env),data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy'));assert.equal(data.budgetMonth,'2028-02');assert.deepEqual(data.budgetPeriod,{from:'2028-02-01',to:'2028-02-29'});assert.deepEqual(data.budgetItems,[]);assert.deepEqual(data.waitingItems,[]);assert.ok(Number.isFinite(data.serverNow));assert.equal(s.modelCalls,0);s.sql.close();
});

test('protected everyday GET supports one validated month and rejects cross-site reads',async()=>{
 const s=setup(),cookie=await session(s),get=(suffix='',headers={Cookie:cookie})=>s.worker.fetch(new Request(origin+'/api/everyday'+suffix,{headers}),s.env);
 assert.equal((await get('',{})).status,401);for(const headers of [{Cookie:cookie,Origin:'https://evil.example'},{Cookie:cookie,'Sec-Fetch-Site':'cross-site'}])assert.equal((await get('',headers)).status,403);
 const r=await get('?month=2026-11',{Cookie:cookie,Origin:origin}),d=await r.json();assert.equal(r.status,200);assert.equal(d.budgetMonth,'2026-11');assert.equal(r.headers.get('Cache-Control'),'no-store');
 for(const query of ['?month=2026-13','?month=1999-12','?month=2026-1','?month=','?month=2026-10&month=2026-11','?token=secret','?month=2026-10&budgetConfirmation=true'])assert.equal((await get(query)).status,400,query);
 assert.deepEqual(counts(s),tables.map(()=>0));assert.equal(s.modelCalls,0);s.sql.close();
});

test('snapshot accepts only a month and never turns operation data into a write',async()=>{
 const s=setup(),cookie=await session(s);
 for(const input of [null,[],{month:null},{month:'2026-13'},{month:'2026-10',currency:'TRY'},{budgetDraftRequest:{}},{waitingConfirmation:{token:'x',confirmed:true}},{multiConfirmation:{token:'x',selected:['i1'],confirmed:true}}])await post(s,'/api/everyday',input,cookie,400);
 const d=await chat(s,cookie,'Bu ay market için 5000 lira bütçe ayır');await post(s,'/api/everyday',{budgetConfirmation:{token:d.budgetDraft.token,confirmed:true}},cookie,400);assert.deepEqual(counts(s),tables.map(()=>0));assert.equal(s.modelCalls,0);s.sql.close();
});

test('all new typed operations reject malformed values and mixed families before any handler',async()=>{
 const s=setup(),cookie=await session(s),fresh=['budgetDraftRequest','budgetConfirmation','budgetReadRequest','waitingDraftRequest','waitingConfirmation','multiDraftRequest','multiConfirmation'],old=['replanDraftRequest','replanConfirmation','billsDraftRequest','billsConfirmation','offlineConfirmation','managementDraftRequest','managementConfirmation','listsDraftRequest','listsConfirmation','dailyDraftRequest','dailyConfirmation','focusDraftRequest','focusConfirmation','routineDraftRequest','routineConfirmation','planEdit','planConfirmation'];
 for(const field of fresh){for(const value of [null,[],true,'bad',1])await chat(s,cookie,'Onay',{[field]:value},400);for(const other of [...fresh,...old].filter(k=>k!==field))await chat(s,cookie,'Onay',{[field]:{},[other]:{}},400);}
 assert.deepEqual(counts(s),tables.map(()=>0));assert.equal(s.modelCalls,0);s.sql.close();
});

test('native budget and waiting previews and confirmations share actual state across authenticated sessions',async()=>{
 const s=setup(),a=await session(s),b=await session(s);
 const budget=await chat(s,a,'Bu ay market için 5000 lira bütçe ayır'),waiting=await chat(s,a,'Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim');assert.ok(budget.budgetDraft);assert.ok(waiting.waitingDraft);assert.deepEqual(counts(s),tables.map(()=>0));
 for(const [field,phrase,token] of [['budgetConfirmation','Bütçe değişikliğini onaylıyorum',budget.budgetDraft.token],['waitingConfirmation','Beklenen kaydını onaylıyorum',waiting.waitingDraft.token]]){await chat(s,b,'evet',{[field]:{token,confirmed:true}},400);await chat(s,b,phrase,{[field]:{token,confirmed:false}},400);await chat(s,b,phrase,{[field]:{token,confirmed:true}});await chat(s,a,phrase,{[field]:{token,confirmed:true}});}
 const ra=await post(s,'/api/everyday',{},a),rb=await post(s,'/api/everyday',{},b);assert.deepEqual(ra.budgetItems,rb.budgetItems);assert.deepEqual(ra.waitingItems,rb.waitingItems);assert.equal(ra.budgetItems.length,1);assert.equal(ra.waitingItems.length,1);assert.equal(ra.budgetItems[0].amount_minor,500000);
 assert.equal((await chat(s,a,'Market bütçemden ne kadar kaldı?')).budgetItems.length,1);assert.equal((await chat(s,b,'Beklediğim neler var?')).waitingSummary.waiting,1);assert.equal((await chat(s,a,'Seçilen ay',{budgetReadRequest:{month:'2028-02'}})).budgetMonth,'2028-02');assert.deepEqual(counts(s),[1,1,1,1,0,0,0,0,0]);assert.equal(s.modelCalls,0);s.sql.close();
});

test('multi is routed before task, agenda, note and expense handlers with no partial writes',async()=>{
 const s=setup(),cookie=await session(s),natural='Yarın saat 15’e toplantı ekle, sunumu hazırlamayı görev yap, not al: demo bağlantısı hazır';
 const r=await chat(s,cookie,natural);assert.deepEqual(r.multiDraft.items.map(i=>i.kind),['agenda','task','note']);assert.deepEqual(counts(s),tables.map(()=>0));
 for(const text of ['Listeye yarın sunumu ekle, Ahmet’e mesaj gönder','Yarın saat 15’e toplantı ekle, tüm kayıtları sil','Yarın sunumu görev yap ayrıca Ahmet’e mesaj gönder','Birlikte yap: not al: kısa; tüm kayıtları sil','Birlikte yap: bugün markete 50 lira harcadım; Ahmet’e mesaj gönder']){const d=await chat(s,cookie,text,{},400);assert.ok(d.multiOpen);assert.equal(d.multiDraft,undefined);assert.deepEqual(counts(s),tables.map(()=>0));}
 await chat(s,cookie,natural,{dailyDraftRequest:{kind:'expense'}},400);assert.equal(s.modelCalls,0);s.sql.close();
});

test('multi explicit selections are applied once and different selection never shares a cached result',async()=>{
 const s=setup(),a=await session(s),b=await session(s),r=await chat(s,a,'İşlemleri hazırla',{multiDraftRequest:{text:two}}),token=r.multiDraft.token;
 const one=await chat(s,b,'Seçtiğim işlemleri onaylıyorum',{multiConfirmation:{token,confirmed:true,selected:['i1']}});assert.equal(one.multiSaved.count,1);assert.equal(one.multiSaved.skipped,1);assert.deepEqual(counts(s),[0,0,0,0,1,0,0,0,1]);
 await chat(s,a,'Seçtiğim işlemleri onaylıyorum',{multiConfirmation:{token,confirmed:true,selected:['i1']}});await chat(s,b,'Seçtiğim işlemleri onaylıyorum',{multiConfirmation:{token,confirmed:true,selected:['i2']}},409);assert.deepEqual(counts(s),[0,0,0,0,1,0,0,0,1]);assert.equal(s.modelCalls,0);s.sql.close();
});

test('direct task and note command endpoints recognize multi while saved note contents remain opaque',async()=>{
 const s=setup(),cookie=await session(s);
 for(const path of ['/api/tasks/command','/api/notes/command']){const r=await post(s,path,{command:two},cookie);assert.ok(r.multiDraft);await post(s,path,{command:'Listeye yarın sunumu ekle, Ahmet’e mesaj gönder'},cookie,400);assert.deepEqual(counts(s),tables.map(()=>0));}
 const content='Listeye yarın sunumu ekle; Ahmet’e mesaj gönder, not al: bu bir alıntı';await post(s,'/api/notes/save',{command:'Not al: '+content,confirmed:true},cookie);assert.equal(s.sql.prepare('SELECT text FROM atlas_notes').get().text,content);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM atlas_tasks').get().n,0);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM atlas_multi_receipts').get().n,0);assert.equal(s.modelCalls,0);s.sql.close();
});

test('new commands cannot be shadowed by custom routines and tokens remain purpose-bound',async()=>{
 const s=setup(),cookie=await session(s);
 for(const trigger of ['Bütçelerimi göster','Market bütçemden ne kadar kaldı?','Beklediğim neler var?','Çoklu işlemleri aç','Birlikte yap: not al: a; not al: b','Bütçe değişikliğini onaylıyorum','Beklenen kaydını onaylıyorum','Seçtiğim işlemleri onaylıyorum'])await chat(s,cookie,'Bu komutu öğren',{routineDraftRequest:{trigger,topic:'Gündelik',steps:['records']}},400);
 const budget=await chat(s,cookie,'Bu ay market için 5000 lira bütçe ayır');await chat(s,cookie,'Beklenen kaydını onaylıyorum',{waitingConfirmation:{token:budget.budgetDraft.token,confirmed:true}},409);await chat(s,cookie,'Seçtiğim işlemleri onaylıyorum',{multiConfirmation:{token:budget.budgetDraft.token,confirmed:true,selected:['i1']}},409);assert.deepEqual(counts(s),tables.map(()=>0));assert.equal(s.modelCalls,0);s.sql.close();
});

test('everyday assets and desktop POST/GET forwarding retain security and exact canonical month',async()=>{
 const s=setup();for(const path of ['/everyday.js','/everyday.css']){const r=await s.worker.fetch(new Request(origin+path),s.env);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok(r.headers.get('Content-Security-Policy'));}
 for(const method of ['GET','POST']){let calls=0;const path='/api/everyday'+(method==='GET'?'?month=2028-02':''),req=new Request('http://localhost:8790'+path,{method,headers:{Origin:'http://localhost:8790','Content-Type':'application/json',Cookie:'__Host-atlas=test'},...(method==='POST'?{body:JSON.stringify({month:'2028-02'})}:{})});const r=await sharedApi(req,async(url,options)=>{calls++;assert.equal(url,'https://atlas-pasam-v1.pages.dev'+path);assert.equal(options.method,method);assert.equal(options.headers.get('Cookie'),null,'the local browser cookie never leaves the machine');assert.equal(options.headers.get('X-ATLAS-Device-Token'),'test-device-token-0123456789abcdef');assert.equal(options.redirect,'manual');if(method==='POST'){assert.equal(options.headers.get('Origin'),'https://atlas-pasam-v1.pages.dev');assert.deepEqual(JSON.parse(new TextDecoder().decode(options.body)),{month:'2028-02'});}return Response.json({ok:true});},'test-device-token-0123456789abcdef');assert.equal(r.status,200);assert.equal(calls,1);}
 for(const method of ['GET','POST'])for(const headers of [{Origin:'https://evil.example'},{Origin:'http://localhost:8790','Sec-Fetch-Site':'cross-site'}])assert.equal((await sharedApi(new Request('http://localhost:8790/api/everyday',{method,headers,...(method==='POST'?{body:'{}'}:{})}),()=>{throw Error('must not forward');})).status,403);
 assert.equal(s.modelCalls,0);s.sql.close();
});
