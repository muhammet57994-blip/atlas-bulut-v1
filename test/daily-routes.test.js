import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {dayInIstanbul} from '../src/tasks.js';
import {sharedApi} from '../scripts/shared-api.mjs';
const origin='https://atlas.example',password='safe-test-password-at-least-twenty',allow={limit:async()=>({success:true})};
function setup(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));const env={ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'private-session-secret-thirty-two-characters',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')},MEMORY_DB:{prepare(q){const s=sql.prepare(q);let args=[];return{bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};},async run(){return{meta:s.run(...args)};}};}}};return {sql,env,w:createWorker(async()=>{throw Error('Unexpected model request');})};}
function req(path,body={},cookie,extra={}){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(body)});}
async function session(s){return(await s.w.fetch(req('/api/login',{password}),s.env)).headers.get('Set-Cookie').split(';')[0];}
async function post(s,path,body,cookie,status=200){const r=await s.w.fetch(req(path,body,cookie),s.env),d=await r.json();assert.equal(r.status,status,d.error);return d;}
const chat=(s,cookie,text,extra={},status=200)=>post(s,'/api/chat',{messages:[{role:'user',text}],...extra},cookie,status);
const counts=s=>['atlas_agenda','atlas_expenses','atlas_focus_sessions','atlas_plans','atlas_routines'].map(table=>s.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
test('daily route and assets retain authentication, origin, method, size and rate controls',async()=>{const s=setup(),cookie=await session(s);
 await post(s,'/api/daily',{},null,401);
 assert.equal((await s.w.fetch(req('/api/daily',{},cookie,{Origin:'https://evil.example'}),s.env)).status,403);
 assert.equal((await s.w.fetch(new Request(origin+'/api/daily',{headers:{Cookie:cookie}}),s.env)).status,405);
 await post(s,'/api/daily',{big:'x'.repeat(40000)},cookie,413);
 assert.equal((await s.w.fetch(req('/api/daily',{},cookie),{...s.env,CHAT_LIMIT:{limit:async()=>({success:false})}})).status,429);
 const d=await post(s,'/api/daily',{},cookie);assert.equal(d.focusAvailable,true);assert.ok(Number.isFinite(d.serverNow));assert.deepEqual(d.agendaItems,[]);
 for(const file of ['daily.js','daily.css']){const r=await s.w.fetch(new Request(origin+'/'+file),s.env);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok(r.headers.get('Content-Security-Policy'));}
 s.sql.close();
});
test('agenda and expense drafts require phrase and token; approved data is shared across sessions',async()=>{const s=setup(),a=await session(s),b=await session(s),before=counts(s);
 const agenda=await chat(s,a,'Yarın saat 15.00 müşteriyi aramayı hatırlat'),expense=await chat(s,a,'Bugün markete 420 lira harcadım');assert.ok(agenda.dailyDraft);assert.ok(expense.dailyDraft);assert.deepEqual(counts(s),before);
 await chat(s,b,'Kaydı onaylıyorum',{dailyConfirmation:{token:agenda.dailyDraft.token,confirmed:false}},400);
 await chat(s,b,'evet',{dailyConfirmation:{token:expense.dailyDraft.token,confirmed:true}},400);assert.deepEqual(counts(s),before);
 await chat(s,b,'Kaydı onaylıyorum',{dailyConfirmation:{token:agenda.dailyDraft.token,confirmed:true}});
 await chat(s,a,'Kaydı onaylıyorum',{dailyConfirmation:{token:expense.dailyDraft.token,confirmed:true}});
 await chat(s,b,'Kaydı onaylıyorum',{dailyConfirmation:{token:expense.dailyDraft.token,confirmed:true}});
 const snapA=await post(s,'/api/daily',{},a),snapB=await post(s,'/api/daily',{},b);assert.deepEqual(snapA.agendaItems,snapB.agendaItems);assert.equal(snapA.expenseTotals[0].amount_minor,42000);assert.deepEqual(counts(s),[1,1,0,0,0]);s.sql.close();
});
test('focus start pause resume finish each need independent approval and never complete the task',async()=>{const s=setup(),a=await session(s),b=await session(s);s.sql.exec("INSERT INTO atlas_tasks(title,created_at) VALUES('Günlük taslak','2026-10-25T00:00:00Z')");
 let d=await chat(s,a,'Görev 1 için 5 dakika odaklan');assert.ok(d.focusDraft);assert.equal(counts(s)[2],0);
 await chat(s,b,'Odağı onaylıyorum',{focusConfirmation:{token:d.focusDraft.token,confirmed:false}},400);
 await chat(s,b,'Odağı onaylıyorum',{focusConfirmation:{token:d.focusDraft.token,confirmed:true}});
 for(const [command,status] of [['Odağı duraklat','paused'],['Odağa devam et','running'],['Odağı bitir','finished']]){const old=s.sql.prepare('SELECT status FROM atlas_focus_sessions').get().status;d=await chat(s,a,command);assert.ok(d.focusDraft);assert.equal(s.sql.prepare('SELECT status FROM atlas_focus_sessions').get().status,old);await chat(s,b,'Odağı onaylıyorum',{focusConfirmation:{token:d.focusDraft.token,confirmed:true}});assert.equal(s.sql.prepare('SELECT status FROM atlas_focus_sessions').get().status,status);}
 assert.equal(s.sql.prepare('SELECT done FROM atlas_tasks').get().done,0);assert.equal(counts(s)[2],1);s.sql.close();
});
test('mixed operations, invalid payloads, cross-purpose and readonly endpoint cannot bypass approvals',async()=>{const s=setup(),c=await session(s),d=await chat(s,c,'Bugün markete 10 lira harcadım'),token=d.dailyDraft.token;
 const fields=['dailyDraftRequest','dailyConfirmation','focusDraftRequest','focusConfirmation','planEdit','planConfirmation','routineDraftRequest','routineConfirmation'];
 for(let i=0;i<fields.length;i++)for(let j=i+1;j<fields.length;j++)await chat(s,c,'Kaydı onaylıyorum',{[fields[i]]:{token,confirmed:true},[fields[j]]:{}},400);
 for(const field of fields)for(const value of [null,[],true,'bad'])await chat(s,c,'Kaydı onaylıyorum',{[field]:value},400);
 await chat(s,c,'Odağı onaylıyorum',{focusConfirmation:{token,confirmed:true}},400);
 await post(s,'/api/daily',{dailyConfirmation:{token,confirmed:true}},c);assert.deepEqual(counts(s),[0,0,0,0,0]);s.sql.close();
});
test('daily intents cannot become unreachable user routines and invalid times do not call the model',async()=>{const s=setup(),c=await session(s);
 for(const trigger of ['Ajandamı aç','25 dakika odaklan','Bu ay ne kadar harcadım'])await chat(s,c,'Bu komutu öğren',{routineDraftRequest:{trigger,topic:'Günlük',steps:['records']}},400);
 const error=await chat(s,c,'Yarın müşteriyi aramayı hatırlat',{},400);assert.equal(error.dailyOpen,'agenda');assert.deepEqual(counts(s),[0,0,0,0,0]);s.sql.close();
});
test('desktop daily snapshot forwards only to the fixed shared service with source checks',async()=>{
 let calls=0;const request=new Request('http://localhost:8790/api/daily',{method:'POST',headers:{Origin:'http://localhost:8790','Content-Type':'application/json'},body:'{}'});
 const r=await sharedApi(request,async(url,options)=>{calls++;assert.equal(url,'https://atlas-pasam-v1.pages.dev/api/daily');assert.equal(options.headers.get('Origin'),'https://atlas-pasam-v1.pages.dev');return Response.json({agendaItems:[]});},'test-device-token-0123456789abcdef');assert.equal(r.status,200);assert.equal(calls,1);
});
