import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {centerCommand,centerSnapshot} from '../src/center.js';
const now=new Date('2026-10-25T10:00:00Z');
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const queries=[];
 const env={MEMORY_DB:{prepare(q){queries.push(q);assert.match(q,/^SELECT\b/u);const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}};}}};
 const task=(title,date='',done=0)=>sql.prepare('INSERT INTO atlas_tasks(title,due_date,done,created_at) VALUES (?,?,?,?)').run(title,date,done,now.toISOString());
 return {sql,env,queries,task};
}
test('center matches only exact center phrases, preserving existing daily commands',()=>{
 for(const s of ['Merkezimi aç','Kişisel merkezimi aç','Bana durum özeti ver','Bugün neye odaklanayım','  KİŞİSEL MERKEZİMİ AÇ?! '])assert.equal(centerCommand(s),true,s);
 for(const s of ['Günümü planla','Bugün ne var','Merkezimi aç ve sil','Lütfen merkezimi aç',null,{}])assert.equal(centerCommand(s),false);
});
test('empty center and unavailable database are safe and require no model configuration',async()=>{
 const f=fixture(),r=await centerSnapshot(f.env,now);
 assert.equal(r.status,200);assert.deepEqual(r.center.counts,{openTasks:0,overdueTasks:0,notes:0,memories:0,plans:0,routines:0});
 assert.deepEqual(r.center.priorities,[]);assert.deepEqual(r.center.routines,[]);assert.deepEqual(r.center.recentPlans,[]);
 assert.match(r.text,/Efendim/);assert.match(r.text,/Açık görev yok/);assert.equal(r.center.modelCalled,false);assert.equal(f.queries.length,4);
 assert.equal((await centerSnapshot({},now)).status,503);assert.equal((await centerSnapshot(undefined,now)).status,503);
});
test('counts are independent and exact, lists bounded, and reads do not alter records',async()=>{
 const f=fixture();f.task('Gelecek','2026-11-01');f.task('Tarihsiz');f.task('Bugün','2026-10-25');f.task('Gecikmiş','2026-10-24');f.task('Bitmiş','2026-10-20',1);
 for(let i=1;i<=8;i++){
  f.sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES (?,?)').run('Not '+i,now.toISOString());
  f.sql.prepare('INSERT INTO atlas_plans(draft_id,kind,title,plan_day,text,created_at) VALUES (?,?,?,?,?,?)').run('p'+i,'day','Plan '+i,'2026-10-25','Taslak',now.toISOString());
  f.sql.prepare('INSERT INTO atlas_routines(draft_id,trigger,trigger_key,topic,steps,created_at) VALUES (?,?,?,?,?,?)').run('r'+i,'Komut '+i,'komut '+i,'Konu','["records"]',now.toISOString());
 }
 f.sql.exec("INSERT INTO atlas_memories VALUES ('m1','Hafıza','2026-10-25')");
 const changes=f.sql.prepare('SELECT total_changes() AS n').get().n,r=await centerSnapshot(f.env,now);
 assert.deepEqual(r.center.counts,{openTasks:4,overdueTasks:1,notes:8,memories:1,plans:8,routines:8});
 assert.deepEqual(r.center.priorities.map(t=>t.title),['Gecikmiş','Bugün','Tarihsiz']);assert.equal(r.center.routines.length,6);assert.deepEqual(r.center.recentPlans.map(p=>p.id),[8,7,6]);
 assert.equal(f.sql.prepare('SELECT total_changes() AS n').get().n,changes);assert.equal(f.queries.length,4);assert.ok(r.text.length<500);
});
test('Istanbul midnight changes due-date classification and ordering is deterministic',async()=>{
 const f=fixture();f.task('Sonraki','2026-10-26');f.task('Önce','2026-10-25');f.task('Aynı tarih','2026-10-25');
 const before=await centerSnapshot(f.env,new Date('2026-10-25T20:59:59Z'));
 assert.equal(before.center.day,'2026-10-25');assert.equal(before.center.counts.overdueTasks,0);assert.match(before.text,/gelecek: 2026-10-26/);
 const after=await centerSnapshot(f.env,new Date('2026-10-25T21:00:00Z'));
 assert.equal(after.center.day,'2026-10-26');assert.equal(after.center.counts.overdueTasks,2);assert.deepEqual(after.center.priorities.map(t=>t.id),[2,3,1]);assert.match(after.text,/Önce \(gecikmiş\)/);assert.match(after.text,/Sonraki \(bugün\)/);
});
test('future tasks are explicitly labeled, speech bounded and structured titles preserved',async()=>{
 const f=fixture();for(let i=0;i<5;i++)f.task(String(i)+'x'.repeat(199),'2026-11-01');
 const r=await centerSnapshot(f.env,now);assert.equal(r.center.priorities.length,3);assert.equal(r.center.priorities[0].title.length,200);assert.equal((r.text.match(/gelecek: 2026-11-01/g)||[]).length,3);assert.ok(r.text.length<500);
});
