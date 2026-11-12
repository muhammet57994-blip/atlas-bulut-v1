import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';
import {runPlanning,editPlan,savePlan} from '../src/planning.js';
import {runTaskCommand,listTasks} from '../src/tasks.js';import {naturalCommand,runNatural,taskReferences} from '../src/natural-commands.js';
import {searchCommand,sharedSearch} from '../src/shared-search.js';import {createWorker} from '../src/worker.js';
const now=new Date('2026-10-25T12:00:00Z');
function env(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {SESSION_SECRET:'s'.repeat(40),ATLAS_ACCESS_PASSWORD:'p'.repeat(24),LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{limit:async()=>({success:true})},MEMORY_DB:{prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}}};}
const noModel=()=>{throw Error('No external model call expected');};
const count=async e=>(await e.MEMORY_DB.prepare('SELECT COUNT(*) AS n FROM atlas_plans').first()).n;
async function tasks(e){for(const title of ['Video çek','Metni yaz','Kurgu yap'])await runTaskCommand(e.MEMORY_DB,'Listeye bugün '+title+' ekle',now);}
test('natural commands use actual last list order rather than IDs or model history',async()=>{
 const e=env();await tasks(e);await runTaskCommand(e.MEMORY_DB,'Görev 1 tamamlandı',now);
 const list=await runNatural(naturalCommand('İşlerimi oku'),null,e,now);assert.match(list.text,/1\. Görev 2/);
 const result=await runNatural(naturalCommand('İkinci işi tamamladım'),list.taskContext,e,now);assert.equal(result.status,200);assert.match(result.text,/görev 3 tamamlandı/);assert.equal((await listTasks(e.MEMORY_DB)).find(t=>t.id===2).done,0);
});
test('ambiguous references ask and follow-up ordinal executes only the requested action',async()=>{
 const e=env();await tasks(e);const before=await listTasks(e.MEMORY_DB);
 const ask=await runNatural(naturalCommand('Şunu yarına bırak'),null,e,now);assert.match(ask.text,/hangi işi/);assert.deepEqual(await listTasks(e.MEMORY_DB),before);
 const result=await runNatural(naturalCommand('İkincisi'),ask.taskContext,e,now);assert.equal(result.status,200);assert.equal((await listTasks(e.MEMORY_DB)).find(t=>t.id===2).due_date,'2026-10-26');
});
test('tampered, expired and stale task references never mutate the guessed target',async()=>{
 const e=env();await tasks(e);const list=await runNatural(naturalCommand('İşlerimi oku'),null,e,now);
 for(const [token,time] of [[list.taskContext.slice(0,-5)+'wrong',now],[list.taskContext,new Date(now.getTime()+600001)]]){const result=await runNatural(naturalCommand('İkinci işi tamamladım'),token,e,time);assert.match(result.text,/hangi işi/);assert.ok((await listTasks(e.MEMORY_DB)).every(t=>!t.done));}
 await runTaskCommand(e.MEMORY_DB,'Görev 2 yarına taşı',now);const result=await runNatural(naturalCommand('İkinci işi tamamladım'),list.taskContext,e,now);assert.equal(result.status,409);assert.ok((await listTasks(e.MEMORY_DB)).every(t=>!t.done));
});
test('exact title and unknown ordinal are handled safely; discussion is not a command',async()=>{
 const e=env();await tasks(e);assert.equal((await runNatural(naturalCommand('Metni yaz işini yarına bırak'),null,e,now)).status,200);
 for(const t of ['İkinci işi tamamladım mı','İlk işi yarına bıraksak mı','Bunu hatırla: ikinci işi tamamladım'])assert.equal(naturalCommand(t),null);
 const r=await runNatural(naturalCommand('İkincisi'),null,e,now);assert.match(r.text,/hangi işlemi/);
});
test('draft edits reorder, rename, add and remove without any persistence until explicit approval',async()=>{
 const e=env();await tasks(e);const before=await listTasks(e.MEMORY_DB);let r=await runPlanning('Günümü planla',e,noModel,now);
 for(const command of ['Birinci önceliği ikinci sıraya al','İlk önceliği çıkar','Plana Yürüyüş ekle','İkinci önceliği Video incele olarak değiştir']){r=await editPlan({token:r.planDraft.token},command,e,now);assert.equal(r.status,200,r.error);assert.equal(await count(e),0);}
 assert.deepEqual(r.planDraft.choices.map(c=>c.label),['Görev 1: Video çek (bugün)','Video incele','Yürüyüş']);
 const payload={token:r.planDraft.token,selected:r.planDraft.choices.map(c=>c.key)};assert.equal((await savePlan(payload,e,now)).status,400);
 assert.equal((await savePlan({...payload,confirmed:true},e,now)).status,200);assert.equal(await count(e),1);assert.deepEqual(await listTasks(e.MEMORY_DB),before);
 const saved=await e.MEMORY_DB.prepare('SELECT text FROM atlas_plans').first();assert.match(saved.text,/2\. Video incele\n3\. Yürüyüş/);
 await savePlan({...payload,confirmed:true},e,now);assert.equal(await count(e),1);
});
test('draft validation rejects ambiguous operations, invalid positions, invalid signatures and expired drafts',async()=>{
 const e=env();await tasks(e);const r=await runPlanning('Günümü planla',e,noModel,now),token=r.planDraft.token;
 for(const command of ['Bunu ikinci sıraya al','Onuncu önceliği çıkar','Birinci önceliği onuncu sıraya al','Planı onaylıyorum'])assert.equal((await editPlan({token},command,e,now)).status,400);
 assert.equal((await editPlan({token:token.slice(0,-5)+'wrong'},'İlk önceliği çıkar',e,now)).status,400);
 assert.equal((await editPlan({token},'İlk önceliği çıkar',e,new Date(now.getTime()+1800001))).status,409);
 assert.equal(await count(e),0);
});
test('search combines notes, memories and saved plans with literal Turkish matching',async()=>{
 const e=env(),db=e.MEMORY_DB;await db.prepare('INSERT INTO atlas_notes(text,created_at) VALUES (?,?)').bind('AI Studio ile İÇERİK hazırladım','2026-10-25T10:00:00Z').run();
 await db.prepare('INSERT INTO atlas_memories(id,text,created_at) VALUES (?,?,?)').bind('memory-1','İçerik üretmek için AI Studio kullanıyorum','2026-10-24T10:00:00Z').run();
 await db.prepare('INSERT INTO atlas_plans(draft_id,kind,title,plan_day,text,created_at) VALUES (?,?,?,?,?,?)').bind('draft-1','day','AI Studio','2026-10-25','İçerik çek','2026-10-25T11:00:00Z').run();
 const result=await sharedSearch(searchCommand('Her yerde ara: içerik'),e,now);assert.equal(result.searchResults.length,3);assert.equal(result.searchResults[0].source,'plan');
 assert.equal((await sharedSearch({query:"%' OR 1=1 --"},e,now)).searchResults.length,0);assert.equal((await sharedSearch({query:'AI Studio'},e,now)).searchResults.length,3);assert.equal(await count(e),1);
});
test('last-week dates are Monday–Sunday Istanbul creation dates, not rolling seven days',async()=>{
 const e=env();for(const [i,date] of ['2026-10-11T20:59:59Z','2026-10-11T21:00:00Z','2026-10-18T20:59:59Z','2026-10-18T21:00:00Z'].entries())await e.MEMORY_DB.prepare('INSERT INTO atlas_notes(text,created_at) VALUES (?,?)').bind('AI Studio '+i,date).run();
 const r=await sharedSearch(searchCommand('Geçen hafta AI Studio hakkında ne not almıştım?'),e,now);assert.equal(r.searchResults.length,2);assert.match(r.text,/2026-10-12 – 2026-10-18/);
 assert.equal(searchCommand('Bunu hatırla: AI Studio hakkında konuştuk'),null);
});
test('new routes require login and same-origin; draft edits and search do not call a model',async()=>{
 const e=env();await tasks(e);const w=createWorker(noModel),origin='https://atlas.test';
 const call=(body,cookie='',source=origin)=>w.fetch(new Request(origin+'/api/chat',{method:'POST',headers:{Origin:source,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),e);
 const body={messages:[{role:'user',text:'İşlerimi oku'}]};assert.equal((await call(body)).status,401);
 const login=await w.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:e.ATLAS_ACCESS_PASSWORD})}),e);const cookie=login.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await call(body,cookie,'https://evil.test')).status,403);assert.ok((await (await call(body,cookie)).json()).taskContext);
 const search=await call({messages:[{role:'user',text:'Her yerde ara: yok'}]},cookie);assert.equal(search.status,200);
 const d=await (await call({messages:[{role:'user',text:'Günümü planla'}]},cookie)).json();
 const edit={messages:[{role:'user',text:'İlk önceliği çıkar'}],planEdit:{token:d.planDraft.token}};assert.equal((await call(edit,cookie)).status,200);assert.equal(await count(e),0);
 assert.equal((await call({...edit,planConfirmation:{confirmed:true}},cookie)).status,400);
});
