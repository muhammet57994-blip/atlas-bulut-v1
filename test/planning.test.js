import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {planningCommand,runPlanning,savePlan} from '../src/planning.js';import {runTaskCommand,listTasks} from '../src/tasks.js';import {runCalendar} from '../src/calendar.js';import {createWorker} from '../src/worker.js';
const now=new Date('2026-10-24T12:00:00Z');
function env(){const sql=new DatabaseSync(':memory:');for(const f of ['0001_memory.sql','0002_tasks.sql','0006_organizer.sql','0007_plans.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {SESSION_SECRET:'s'.repeat(40),GEMINI_API_KEY:'private-key',MEMORY_DB:{prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}}};}
const noModel=()=>{throw Error('Unexpected external call');};
const count=async e=>(await e.MEMORY_DB.prepare('SELECT COUNT(*) AS n FROM atlas_plans').first()).n;
test('narrow Turkish voice commands do not treat discussion as approval',()=>{
 assert.equal(planningCommand('İçerik bir için paket hazırla.').id,1);assert.equal(planningCommand('Günümü planla').action,'day');
 for(const s of ['Planımı kaydedebilir miyiz','Planı onaylıyorum ve paylaş','Bunu hatırla: Günümü planla','İçerik 1 paylaş'])assert.equal(planningCommand(s),null);
});
test('day plan combines tasks and calendar, excludes future and completed, writes nothing before confirmation',async()=>{
 const e=env();await runTaskCommand(e.MEMORY_DB,'Listeye bugün geciken ekle',new Date('2026-10-22T09:00:00Z'));await runTaskCommand(e.MEMORY_DB,'Listeye yarın gelecek ekle',now);await runCalendar(e.MEMORY_DB,'Takvime bugün reels: Demo',now);
 const before=await listTasks(e.MEMORY_DB),r=await runPlanning('Günümü planla',e,noModel,now);assert.equal(r.planDraft.choices.length,2);assert.match(r.text,/geciken/);assert.match(r.text,/İçerik 1/);assert.ok(!r.text.includes('gelecek'));assert.equal(await count(e),0);
 const saved=await savePlan({confirmed:true,token:r.planDraft.token,selected:[r.planDraft.choices[1].key]},e,now);assert.equal(saved.status,200);assert.equal(await count(e),1);assert.deepEqual(await listTasks(e.MEMORY_DB),before);
 const read=await runPlanning('Plan 1 oku',e,noModel,now);assert.match(read.text,/Demo/);assert.ok(!read.text.includes('geciken'));
 await savePlan({confirmed:true,token:r.planDraft.token,selected:[r.planDraft.choices[0].key]},e,now);assert.equal(await count(e),1);assert.equal((await runPlanning('Plan 1 oku',e,noModel,now)).text,read.text);
});
test('forged, missing, expired, empty selection and cross-midnight approvals never save',async()=>{
 const e=env();await runTaskCommand(e.MEMORY_DB,'Listeye iş ekle',now);const r=await runPlanning('Günümü planla',e,noModel,now),token=r.planDraft.token;
 for(const body of [{token,selected:['task-1']},{confirmed:true,token,selected:[]},{confirmed:true,token,selected:['task-99']},{confirmed:true,token,selected:['task-1','task-1']},{confirmed:true,token:token.slice(0,-3)+'xyz',selected:['task-1']}])assert.equal((await savePlan(body,e,now)).status,400);
 assert.equal((await savePlan({confirmed:true,token,selected:['task-1']},e,new Date(now.getTime()+1800001))).status,409);
 const late=new Date('2026-10-24T20:59:00Z'),d=await runPlanning('Günümü planla',e,noModel,late);assert.equal((await savePlan({confirmed:true,token:d.planDraft.token,selected:['task-1']},e,new Date('2026-10-24T21:01:00Z'))).status,409);assert.equal(await count(e),0);
});
test('empty day and missing calendar do not fabricate plans or consume model quota',async()=>{
 const e=env();assert.equal((await runPlanning('Günümü planla',e,noModel,now)).planDraft,undefined);assert.equal((await runPlanning('İçerik paketi hazırla',e,noModel,now)).status,404);assert.equal((await runPlanning('Gün planımı oku',e,noModel,now)).status,404);
});
test('content package uses exactly one bounded existing-model call with only chosen topic, no private context',async()=>{
 const e=env();await runTaskCommand(e.MEMORY_DB,'Listeye private-task ekle',now);await runCalendar(e.MEMORY_DB,'Takvime yarın reels: ATLAS',now);let calls=0;
 const r=await runPlanning('İçerik 1 için paket hazırla',e,async(url,o)=>{calls++;assert.match(url,/gemini-3.5-flash-lite/);assert.equal(o.redirect,'manual');const b=JSON.parse(o.body);assert.equal(b.tools,undefined);assert.equal(b.generationConfig.maxOutputTokens,2000);assert.ok(!o.body.includes('private-task'));assert.ok(!o.body.includes('private-key'));assert.deepEqual(JSON.parse(b.contents[0].parts[0].text),{title:'ATLAS',format:'reels',date:'2026-10-25'});return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Konuşma, ekran yazıları, açıklama ve üç hikâye taslağı.'}]}}]});},now);
 assert.equal(calls,1);assert.equal(await count(e),0);assert.ok(r.planDraft);assert.equal((await savePlan({confirmed:true,token:r.planDraft.token,selected:[]},e,now)).status,200);assert.equal(await count(e),1);
});
test('quota and truncated model output never save or return approvable draft',async()=>{
 const e=env();await runCalendar(e.MEMORY_DB,'Takvime yarın reels: Deneme',now);
 for(const reply of [new Response('private-key',{status:429}),Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'eksik'}]}}]})]){let calls=0;const r=await runPlanning('İçerik paketi hazırla',e,async()=>{calls++;return reply;},now);assert.equal(calls,1);assert.equal(r.planDraft,undefined);assert.ok(!JSON.stringify(r).includes('private-key'));}assert.equal(await count(e),0);
});
test('weekly review uses real completion events and comparable saved IDs, preserves unknown values',async()=>{
 const e=env();await runTaskCommand(e.MEMORY_DB,'Listeye iş ekle',now);await runTaskCommand(e.MEMORY_DB,'Görev 1 tamamlandı',now);
 let r=await runPlanning('Haftalık gelişimimi değerlendir',e,noModel,now);assert.match(r.text,/1 görev tamamlama/);assert.match(r.text,/en az iki/);assert.equal(await count(e),0);
 for(const [day,metrics] of [['2026-10-22',{reach:20,views:null}],['2026-10-24',{reach:28,views:50}]])await e.MEMORY_DB.prepare('INSERT INTO atlas_instagram_snapshots(day,captured_at,payload) VALUES(?,?,?)').bind(day,day+'T10:00:00.000Z',JSON.stringify([{id:'1',title:'Demo',format:'REELS',metrics}])).run();
 r=await runPlanning('Haftalık gelişimimi değerlendir',e,noModel,now);assert.match(r.text,/erişim: \+8/);assert.ok(!r.text.includes('görüntülenme: +50'));assert.match(r.text,/neden-sonuç çıkarılamaz/);assert.equal(await count(e),0);
});
test('plan storage is bounded and does not overwrite existing records',async()=>{
 const e=env();for(let i=0;i<50;i++)await e.MEMORY_DB.prepare('INSERT INTO atlas_plans(draft_id,kind,title,plan_day,text,created_at) VALUES(?,?,?,?,?,?)').bind('d'+i,'review','Eski','2026-10-24','Metin',now.toISOString()).run();
 const d=await runPlanning('Haftalık gelişimimi değerlendir',e,noModel,now);assert.equal((await savePlan({confirmed:true,token:d.planDraft.token,selected:[]},e,now)).status,409);assert.equal(await count(e),50);
});
test('approval requires authenticated same-origin request and matching command; another device can read saved plan',async()=>{
 const e={...env(),ATLAS_ACCESS_PASSWORD:'p'.repeat(24),LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{limit:async()=>({success:true})}},w=createWorker(noModel),origin='https://atlas.example';
 const call=(path,body,cookie='',o=origin)=>w.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:o,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}),e);
 const login=async()=>(await call('login',{password:e.ATLAS_ACCESS_PASSWORD})).headers.get('Set-Cookie').split(';')[0],phone=await login(),pc=await login();
 const d=await (await call('chat',{messages:[{role:'user',text:'Haftalık gelişimimi değerlendir'}]},phone)).json();const body={messages:[{role:'user',text:'Planı onaylıyorum'}],planConfirmation:{confirmed:true,token:d.planDraft.token,selected:[]}};
 assert.equal((await call('chat',body)).status,401);assert.equal((await call('chat',body,phone,'https://evil.example')).status,403);assert.equal(await count(e),0);
 assert.equal((await call('chat',{...body,messages:[{role:'user',text:'Merhaba'}]},phone)).status,400);assert.equal((await call('chat',body,phone)).status,200);
 const read=await (await call('chat',{messages:[{role:'user',text:'Plan 1 oku'}]},pc)).json();assert.match(read.text,/gelişim değerlendirmesi/);
});
