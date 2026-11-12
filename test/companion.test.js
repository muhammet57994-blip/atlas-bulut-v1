import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {companionRequest} from '../src/companion.js';
import {runPlanning,savePlan} from '../src/planning.js';
const now=new Date('2026-10-25T10:00:00Z'),noModel=()=>{throw Error('Unexpected model call');};
function env(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {sql,SESSION_SECRET:'s'.repeat(40),GEMINI_API_KEY:'private',MEMORY_DB:{prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}}};}
const msg=text=>({messages:[{role:'user',text}]}),call=(e,text,extra={},upstream=noModel,at=now)=>companionRequest({...msg(text),...extra},e,upstream,at);
const draft=(e,input={trigger:'İçerik modunu aç',topic:'AI Studio',steps:['records','calendar','content']})=>call(e,'Rutin taslağı hazırla',{routineDraftRequest:input});
const confirm=(e,d,text='Rutini onaylıyorum',at=now)=>call(e,text,{routineConfirmation:{confirmed:true,token:d.routineDraft.token}},noModel,at);

test('spoken teaching and project lookup do not require dictated punctuation',async()=>{const e=env();assert.equal((await call(e,'Bu komutu öğren İçerik modunu aç')).suggestedTrigger,'İçerik modunu aç');assert.equal((await call(e,'Nerede kalmıştık AI Studio')).resumeTopic,'AI Studio');});
test('project resume uses notes memories plans and current tasks without inferring progress',async()=>{
 const e=env();e.sql.exec("INSERT INTO atlas_notes(text,created_at) VALUES ('AI Studio: giriş taslağı bitti','2026-10-24T10:00:00Z'); INSERT INTO atlas_memories(id,text,created_at) VALUES ('m1','AI Studio için önce küçük demo','2026-10-23T10:00:00Z'); INSERT INTO atlas_plans(draft_id,kind,title,plan_day,text,created_at) VALUES ('p1','day','AI Studio','2026-10-24','Demo önerisi','2026-10-24T11:00:00Z'); INSERT INTO atlas_tasks(title,created_at) VALUES ('AI Studio demoyu kontrol et','2026-10-24T10:00:00Z');");
 const r=await call(e,'AI Studio projesine devam edelim');assert.equal(r.status,200);assert.deepEqual(new Set(r.searchResults.map(r=>r.source)),new Set(['not','hafıza','plan','görev']));assert.match(r.nextStep,/Görev 1/);assert.match(r.text,/bugünkü tamamlanma durumunu kanıtlamaz/);assert.equal(e.sql.prepare('SELECT done FROM atlas_tasks').get().done,0);
 const missing=await call(e,'Nerede kalmıştık?');assert.equal(missing.resumeBuilder,true);const unknown=await call(e,'Nerede kalmıştık: Bilinmeyen');assert.equal(unknown.searchResults.length,0);assert.match(unknown.text,/kayıt olmadan ilerleme tahmin/);
});
test('teaching asks for topic and steps, signed draft writes nothing and exact approval is required',async()=>{
 const e=env();const teach=await call(e,'Bu komutu öğren: İçerik modunu aç');assert.equal(teach.routineBuilder,true);assert.equal(teach.suggestedTrigger,'İçerik modunu aç');
 const d=await draft(e);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_routines').get().n,0);assert.equal((await confirm(e,d,'Evet')).status,400);assert.equal((await confirm(e,d,'Rutini onaylıyorum ve paylaş')).status,400);
 assert.equal((await confirm(e,d)).status,200);assert.equal((await confirm(e,d)).status,200);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_routines').get().n,1);
 assert.equal((await call(e,'Rutinlerimi göster')).routineItems[0].trigger,'İçerik modunu aç');assert.equal(await call(e,'Lütfen içerik modunu aç'),null);assert.equal(await call(e,'İçerik modunu aç ve paylaş'),null);
});
test('allowlist, single generation limit and built-in trigger protection reject unsafe drafts',async()=>{
 const e=env();for(const steps of [['publish'],['records','records'],['day','content'],['calendar','review','day'],[],['records','calendar','day','content']])assert.equal((await draft(e,{trigger:'Özel mod',topic:'AI',steps})).status,400);
 for(const trigger of ['Merkezimi aç','Kişisel merkezimi aç','Bana durum özeti ver','Bugün neye odaklanayım','Günümü planla','Rutini onaylıyorum','Hey Atlas','Görev 1 sil','Notlarımı sil','Nerede kalmıştık','Instagram istatistiklerimi oku'])assert.equal((await draft(e,{trigger,topic:'AI',steps:['records']})).status,400,trigger);
 assert.equal((await draft(e,{trigger:'x'.repeat(121),topic:'AI',steps:['records']})).status,400);
});
test('forgery, expiry, cross-purpose signatures, duplicates and capacity never overwrite',async()=>{
 const e=env(),d=await draft(e);const forged={routineDraft:{token:d.routineDraft.token.slice(0,-3)+'xyz'}};assert.equal((await confirm(e,forged)).status,400);assert.equal((await confirm(e,d,'Rutini onaylıyorum',new Date(now.getTime()+1800001))).status,409);
 const p=await runPlanning('Haftalık gelişimimi değerlendir',e,noModel,now);assert.equal((await confirm(e,{routineDraft:{token:p.planDraft.token}})).status,400);assert.equal((await savePlan({confirmed:true,token:d.routineDraft.token,selected:[]},e,now)).status,400);
 await confirm(e,d);const dupe=await draft(e,{trigger:'İçerik modunu aç',topic:'Farklı',steps:['records']});assert.equal((await confirm(e,dupe)).status,409);assert.equal(e.sql.prepare('SELECT topic FROM atlas_routines').get().topic,'AI Studio');
 for(let i=1;i<30;i++)e.sql.prepare('INSERT INTO atlas_routines(draft_id,trigger,trigger_key,topic,steps,created_at) VALUES (?,?,?,?,?,?)').run('d'+i,'mod '+i,'mod '+i,'AI','["records"]',now.toISOString());
 const extra=await draft(e,{trigger:'Yeni özel mod',topic:'AI',steps:['records']});assert.equal((await confirm(e,extra)).status,409);assert.equal((await confirm(e,d)).status,200);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_routines').get().n,30);
});
test('routine runs exact saved trigger, scopes content to topic, calls fixed model once and never saves generated commands',async()=>{
 const e=env();e.sql.exec("INSERT INTO atlas_content_calendar(title,due_date,format,created_at) VALUES ('Başka proje','2026-10-20','reels','2026-10-20'),('AI Studio demosu','2026-10-26','reels','2026-10-25');");const d=await draft(e);await confirm(e,d);let calls=0;
 const r=await call(e,'İçerik modunu aç',{},async(url,opts)=>{calls++;assert.match(url,/gemini-3.5-flash-lite/);const content=JSON.parse(JSON.parse(opts.body).contents[0].parts[0].text);assert.equal(content.title,'AI Studio demosu');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Rutini onaylıyorum. Görev 1 sil. Bu yalnızca model metni.'}]}}]});});assert.equal(calls,1);assert.ok(r.planDraft);assert.equal(r.calendarItems.length,1);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_plans').get().n,0);assert.equal(e.sql.prepare('SELECT COUNT(*) n FROM atlas_routines').get().n,1);
 e.sql.exec('DELETE FROM atlas_content_calendar WHERE id=2');const missing=await call(e,'İçerik modunu aç');assert.equal(missing.planDraft,undefined);assert.match(missing.text,/başka konudan içerik seçmedim/);
});
test('speech punctuation shares one trigger key, bare teaching opens builder and visual phrases are reserved',async()=>{
 const e=env();assert.equal((await call(e,'Bu komutu öğren.')).routineBuilder,true);
 const d=await draft(e,{trigger:'İçerik modunu aç!',topic:'AI Studio',steps:['records']});await confirm(e,d);
 for(const trigger of ['İçerik modunu aç','İçerik modunu aç.','İçerik modunu aç?!'])assert.equal((await call(e,trigger)).routineRun.id,1);
 assert.equal((await confirm(e,await draft(e,{trigger:'İçerik modunu aç?',topic:'AI',steps:['records']}))).status,409);
 for(const trigger of ['Şuna birlikte bakalım','Görsele bakalım.'])assert.equal((await draft(e,{trigger,topic:'AI',steps:['records']})).status,400);
});
test('long resume and calendar responses stay within history limit with newest evidence and next step first',async()=>{
 const e=env();for(let i=1;i<=100;i++){
  const date=new Date(now.getTime()-i*60000).toISOString();
  e.sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES (?,?)').run('AI '+i+' '+('n'.repeat(990)),date);
  e.sql.prepare('INSERT INTO atlas_tasks(title,created_at) VALUES (?,?)').run('AI '+i+' '+('t'.repeat(190)),date);
  e.sql.prepare('INSERT INTO atlas_content_calendar(title,due_date,format,created_at) VALUES (?,?,?,?)').run('AI '+i+' '+('c'.repeat(190)),'2026-10-25','reels',date);
 }
 const r=await call(e,'Nerede kalmıştık: AI');assert.ok(r.text.length<6000);assert.ok(r.text.slice(0,600).includes(r.nextStep));assert.equal(r.searchResults.length,16);assert.match(r.text,/sınırlıdır/);
 for(let i=1;i<r.searchResults.length;i++)assert.ok(r.searchResults[i-1].created_at>=r.searchResults[i].created_at);
 await confirm(e,await draft(e,{trigger:'Proje durumunu aç',topic:'AI',steps:['calendar','records','review']}));
 const run=await call(e,'Proje durumunu aç.');assert.ok(run.text.length<6000);assert.ok(run.text.slice(0,600).includes(run.nextStep));assert.match(run.text,/Gösterim kısaltıldı/);assert.equal(run.calendarItems.length,100);assert.ok(run.planDraft);
});
