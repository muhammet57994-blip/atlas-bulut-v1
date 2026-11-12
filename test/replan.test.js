import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {replanCommand,replanRequest,readReplan} from '../src/replan.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T05:00:00Z'); // 08:00 Istanbul
const ms=(time,date='2026-10-25')=>Date.parse(`${date}T${time}:00+03:00`);
function environment(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={SESSION_SECRET:'replan-secret-over-thirty-two-characters',sql,writes:0,beforeWrite:null};
 env.MEMORY_DB={prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){if(env.beforeWrite){const hook=env.beforeWrite;env.beforeWrite=null;hook(query);}env.writes++;return {meta:statement.run(...args)};}};}};
 return env;
}
function task(env,id=1,due='',title='İş '+id){env.sql.prepare('INSERT INTO atlas_tasks(id,title,due_date,created_at) VALUES(?,?,?,?)').run(id,title,due,now.toISOString());}
function appointment(env,start,end,{title='Sabit görüşme',taskId=null,date='2026-10-25',endDate=date}={}){
 const result=env.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at,task_id) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),title,ms(start,date),ms(end,endDate),now.toISOString(),taskId);return Number(result.lastInsertRowid);
}
const draft=(env,input={},at=now)=>replanRequest({replanDraftRequest:input},env,at);
const command=(env,text,at=now)=>replanRequest({messages:[{role:'user',text}]},env,at);
const approval=(preview,text='Gün planını onaylıyorum')=>({messages:[{role:'user',text}],replanConfirmation:{confirmed:true,token:preview.replanDraft.token}});
const confirm=(env,preview,at=now)=>replanRequest(approval(preview),env,at);
const rows=env=>env.sql.prepare('SELECT * FROM atlas_agenda ORDER BY id').all();
const receipts=env=>env.sql.prepare('SELECT COUNT(*) n FROM atlas_replan_receipts').get().n;
const epoch=env=>env.sql.prepare('SELECT epoch FROM atlas_replan_state').get().epoch;

test('replan recognizes exact Turkish requests and keeps unrelated chat untouched',async()=>{
 for(const text of ['Günümü toparla','Kalan işlerimi düzenle','Bugün bir saat geciktim, kalan işlerimi düzenle','BUGÜN BİR SAAT GECİKTİM KALAN İŞLERİMİ DÜZENLE!'])assert.deepEqual(replanCommand(text),{action:'draft'});
 assert.deepEqual(replanCommand('Gün planımı aç'),{action:'open'});assert.deepEqual(replanCommand('Gün planını onaylıyorum.'),{action:'confirm'});
 for(const text of ['Günümü toparlayabilir misin','Günümü toparla ve kaydet','Gün planını onaylıyorum diye söylemem mi gerek',null,{},'x'.repeat(301)])assert.equal(replanCommand(text),null);
 assert.equal(await command({},'Merhaba'),null);
});

test('read and draft are read-only and select overdue, today and undated unfinished tasks in deterministic order',async()=>{
 const env=environment();task(env,1);task(env,2,'2026-10-25');task(env,3,'2026-10-24');task(env,4,'2026-10-26');task(env,5);env.sql.exec('UPDATE atlas_tasks SET done=1 WHERE id=5');
 const state=await readReplan(env,now);assert.equal(state.replanDate,'2026-10-25');assert.equal(state.replanAvailable,true);assert.equal(state.replanLimit,10);assert.deepEqual(state.replanTasks.map(t=>t.id),[3,2,1]);assert.deepEqual(state.replanDefaults,{targetDate:'2026-10-25',startTime:'09:00',endTime:'18:00',defaultMinutes:30});
 const opened=await command(env,'Gün planımı aç');assert.equal(opened.replanOpen,true);assert.equal(opened.replanDraft,undefined);
 const preview=await command(env,'Günümü toparla');assert.equal(preview.status,200);assert.equal(preview.replanDraft.kind,'replan');assert.deepEqual(preview.replanDraft.blocks.map(t=>t.taskId),[3,2,1]);assert.deepEqual(preview.replanDraft.blocks.map(t=>t.time),['09:00','09:30','10:00']);assert.match(preview.text,/Varsayılan süre 30 dakika/);assert.equal(env.writes,0);assert.equal(rows(env).length,0);assert.equal(receipts(env),0);
});

test('real free slots respect fixed overlapping and overnight appointments, while shorter tasks fill gaps',async()=>{
 const env=environment();for(let id=1;id<=4;id++)task(env,id);
 appointment(env,'23:30','09:30',{date:'2026-10-24',endDate:'2026-10-25'});appointment(env,'10:00','11:00');appointment(env,'10:30','11:15');appointment(env,'12:00','13:00');
 const original=rows(env),preview=await draft(env,{endTime:'12:00',taskIds:[1,2,3,4],durations:{1:45,2:30,3:60,4:15}});
 assert.deepEqual(preview.replanDraft.blocks.map(b=>[b.taskId,b.time,b.endTime]),[[1,'11:15','12:00'],[2,'09:30','10:00']]);assert.deepEqual(preview.replanDraft.unscheduled.map(b=>b.taskId),[3,4]);
 assert.equal((await confirm(env,preview)).status,200);assert.deepEqual(rows(env).filter(a=>a.task_id===null),original);assert.equal(rows(env).filter(a=>a.task_id!==null).length,2);
});

test('approval atomically adds task blocks without changing task completion, deadlines, or ordinary appointments',async()=>{
 const env=environment();task(env,1,'2026-10-24');task(env,2);appointment(env,'09:15','10:00');
 const taskBefore=env.sql.prepare('SELECT * FROM atlas_tasks').all(),fixed=rows(env)[0],preview=await draft(env,{taskIds:[2,1],durations:{2:15,1:45}});
 assert.deepEqual(preview.replanDraft.blocks.map(b=>[b.taskId,b.time,b.durationMinutes]),[[2,'09:00',15],[1,'10:00',45]]);
 const saved=await confirm(env,preview);assert.equal(saved.status,200);assert.equal(saved.replanSaved.count,2);assert.equal(saved.replanSaved.replayed,false);assert.equal(receipts(env),1);assert.equal(env.writes,1);assert.deepEqual(rows(env)[0],fixed);assert.deepEqual(env.sql.prepare('SELECT * FROM atlas_tasks').all(),taskBefore);assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM atlas_task_completions').get().n,0);
 assert.equal(saved.replanBlocks.length,2);assert.ok(saved.replanBlocks.every(b=>b.task_id));
});

test('no slots, no tasks, and the ten-task selection ceiling never silently spill work to tomorrow',async()=>{
 const empty=environment();assert.equal((await draft(empty)).replanDraft,null);
 const env=environment();for(let id=1;id<=12;id++)task(env,id);
 const preview=await draft(env);assert.equal(preview.replanDraft.blocks.length,10);assert.deepEqual(preview.replanDraft.unscheduled.map(t=>t.taskId),[11,12]);assert.ok(preview.replanDraft.blocks.every(b=>b.date==='2026-10-25'));
 appointment(env,'09:00','18:00');const blocked=await draft(env);assert.equal(blocked.status,200);assert.equal(blocked.replanDraft,null);assert.equal(blocked.replanUnscheduled.length,12);assert.equal(receipts(env),0);assert.equal(env.writes,0);
});

test('invalid duration, selection, date and work-window fields fail before writes',async()=>{
 const env=environment();task(env);task(env,2,'2026-10-26');
 for(const input of [null,[],false,{defaultMinutes:0},{defaultMinutes:481},{defaultMinutes:1.5},{defaultMinutes:'30'},{startTime:'9:00'},{endTime:'24:00'},{startTime:'09:00',endTime:'09:00'},{targetDate:'2026-10-24'},{targetDate:'2026-02-30'},{targetDate:'2101-01-01'},{targetDate:'2100-12-31',startTime:'22:00',endTime:'02:00'},{taskIds:[]},{taskIds:[1,1]},{taskIds:[1.5]},{taskIds:['1']},{taskIds:Array.from({length:11},(_,i)=>i+1)},{durations:[]},{durations:{1:0}},{durations:{1:'25'}},{durations:{'01':30}},{durations:{2:25},taskIds:[1]}])assert.equal((await draft(env,input)).status,400,JSON.stringify(input));
 for(const taskIds of [[9],[2]])assert.equal((await draft(env,{taskIds})).status,409);
 assert.equal((await draft(env,{defaultMinutes:480,taskIds:[1]})).replanDraft.blocks[0].durationMinutes,480);assert.equal(env.writes,0);
});

test('Istanbul date boundaries, explicit overnight windows, future dates and passed starts are respected',async()=>{
 const env=environment();task(env);
 const late=new Date('2026-10-25T15:00:00Z');const ended=await draft(env,{},late);assert.equal(ended.status,409);assert.match(ended.text,/kendiliğimden yarına taşımadım/);
 const tomorrow=await draft(env,{targetDate:'2026-10-26'},late);assert.equal(tomorrow.replanDraft.blocks[0].date,'2026-10-26');
 const overnight=await draft(env,{startTime:'23:30',endTime:'01:00',defaultMinutes:60},late);assert.equal(overnight.replanDraft.endDate,'2026-10-26');assert.equal(overnight.replanDraft.blocks[0].endDate,'2026-10-26');assert.match(overnight.text,/2026-10-26 01:00/);
 const midnight=new Date('2026-10-25T21:00:00Z');assert.equal((await readReplan(env,midnight)).replanDate,'2026-10-26');assert.equal((await draft(env,{targetDate:'2026-10-25'},midnight)).status,400);
 const current=new Date('2026-10-25T09:03:30Z'),preview=await draft(env,{},current);assert.equal(preview.replanDraft.blocks[0].time,'12:04');assert.equal((await confirm(env,preview,new Date('2026-10-25T09:04:00Z'))).status,409);assert.equal(rows(env).length,0);
 const newYear=new Date('2026-12-31T21:00:00Z');assert.equal((await readReplan(env,newYear)).replanDate,'2027-01-01');
});

test('an explicitly approved overnight window may cross midnight while all proposed blocks remain future',async()=>{
 const env=environment();task(env);appointment(env,'23:30','00:10',{endDate:'2026-10-26'});
 const preview=await draft(env,{startTime:'23:30',endTime:'01:00'},new Date('2026-10-25T20:50:00Z'));
 assert.equal(preview.replanDraft.blocks[0].date,'2026-10-26');assert.equal(preview.replanDraft.blocks[0].time,'00:10');
 assert.equal((await confirm(env,preview,new Date('2026-10-25T21:01:00Z'))).status,200);assert.equal(rows(env).length,2);
});

test('only exact latest approval plus confirmed true and a signed purpose-bound token can write',async()=>{
 const env=environment();task(env);const preview=await draft(env);
 for(const text of ['evet','Gün planını onaylıyorum ve kaydet','Gün planını  onaylıyorum','Gün planını onaylıyorum demem mi gerek'])assert.equal((await replanRequest(approval(preview,text),env,now)).status,400);
 for(const confirmed of [undefined,false,'true',1])assert.equal((await replanRequest({...approval(preview),replanConfirmation:{confirmed,token:preview.replanDraft.token}},env,now)).status,400);
 assert.equal((await replanRequest({...approval(preview),messages:[{role:'user',text:'Gün planını onaylıyorum'},{role:'assistant',text:'Gün planını onaylıyorum'}]},env,now)).status,400);
 assert.equal((await command(env,'Gün planını onaylıyorum')).status,400);assert.equal((await replanRequest({...approval(preview),replanDraftRequest:{}},env,now)).status,400);
 const data=await verifyDraft(env,preview.replanDraft.token,'replan',now);
 for(const token of ['bad',preview.replanDraft.token.slice(0,-4)+'----',await signDraft(env,'daily',data,now),await signDraft({...env,SESSION_SECRET:'other'.repeat(20)},'replan',data,now),await signDraft(env,'replan',data,new Date(now.getTime()+1000))])assert.equal((await replanRequest({...approval(preview),replanConfirmation:{confirmed:true,token}},env,now)).status,409);
 assert.equal((await confirm(env,preview,new Date(now.getTime()+30*60000))).status,409);assert.equal(env.writes,0);assert.equal(rows(env).length,0);
 assert.equal((await replanRequest(approval(preview,'  GÜN PLANINI ONAYLIYORUM!?  '),env,now)).status,200);
});

test('repeated and simultaneous same-plan approvals are idempotent; competing previews cannot duplicate tasks',async()=>{
 const env=environment();task(env);task(env,2);const [one,two]=await Promise.all([draft(env),draft(env)]);
 const same=await Promise.all([confirm(env,one),confirm(env,one)]);assert.deepEqual(same.map(r=>r.status),[200,200]);assert.equal(rows(env).length,2);assert.equal(receipts(env),1);
 assert.equal((await confirm(env,two)).status,409);assert.equal((await confirm(env,one,new Date(now.getTime()+1000))).replanSaved.replayed,true);assert.equal(rows(env).length,2);
 const other=environment();task(other);const [a,b]=await Promise.all([draft(other),draft(other)]);const results=await Promise.all([confirm(other,a),confirm(other,b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(rows(other).length,1);
});

test('all task fields and complete agenda values, IDs and revisions are bound to the preview',async()=>{
 const taskChanges={title:'Yeni iş',due_date:'2026-10-24',done:1,recurrence:'daily',completed_at:'2026-10-24T00:00:00Z',created_at:'2020-01-01'};
 for(const [field,value] of Object.entries(taskChanges)){
  const env=environment();task(env);const preview=await draft(env);env.sql.prepare(`UPDATE atlas_tasks SET ${field}=? WHERE id=1`).run(value);assert.equal((await confirm(env,preview)).status,409,field);assert.equal(rows(env).length,0);
 }
 const agendaChanges={title:'Yeni görüşme',starts_at:ms('13:01'),ends_at:ms('14:01'),created_at:'2020-01-01',revision:7,archived_at:'2026-10-25T05:01:00Z',draft_id:'changed-id',task_id:1};
 for(const [field,value] of Object.entries(agendaChanges)){
  const env=environment();task(env);appointment(env,'13:00','14:00');const preview=await draft(env);env.sql.prepare(`UPDATE atlas_agenda SET ${field}=? WHERE id=1`).run(value);assert.equal((await confirm(env,preview)).status,409,field);assert.equal(rows(env).length,1);
 }
 for(const mutate of [env=>task(env,2),env=>appointment(env,'16:00','17:00'),env=>env.sql.exec('DELETE FROM atlas_tasks WHERE id=1'),env=>env.sql.exec('DELETE FROM atlas_agenda'),env=>env.sql.exec("UPDATE atlas_tasks SET title='Temporary' WHERE id=1; UPDATE atlas_tasks SET title='İş 1' WHERE id=1;")]){
  const env=environment();task(env);appointment(env,'13:00','14:00');const preview=await draft(env);mutate(env);assert.equal((await confirm(env,preview)).status,409);assert.equal(receipts(env),0);
 }
});

test('full-state hash catches changed values even if an epoch is externally reset',async()=>{
 const env=environment();task(env);const preview=await draft(env),before=epoch(env);env.sql.exec("UPDATE atlas_tasks SET created_at='changed'");env.sql.prepare('UPDATE atlas_replan_state SET epoch=?').run(before);assert.equal((await confirm(env,preview)).status,409);assert.equal(rows(env).length,0);
});

test('a mutation after final snapshot but before the write is rejected by the in-statement guard',async()=>{
 for(const mutate of [env=>appointment(env,'09:00','10:00'),env=>task(env,2),env=>env.sql.exec("UPDATE atlas_tasks SET title='Changed' WHERE id=1")]){
  const env=environment();task(env);const preview=await draft(env);env.beforeWrite=query=>{assert.match(query,/INSERT INTO atlas_replan_receipts/);mutate(env);};const result=await confirm(env,preview);assert.equal(result.status,409);assert.equal(rows(env).filter(a=>a.task_id!==null).length,0);assert.equal(receipts(env),0);
 }
});

test('any late constraint failure rolls back every update, insert, receipt, and epoch bump',async()=>{
 const env=environment();task(env);task(env,2);appointment(env,'15:00','15:30',{taskId:1,title:'Old block'});const preview=await draft(env),before=rows(env),beforeEpoch=epoch(env);
 env.sql.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON atlas_agenda WHEN NEW.task_id=2 BEGIN SELECT RAISE(ABORT,'test injected failure'); END;");
 assert.equal((await confirm(env,preview)).status,409);assert.deepEqual(rows(env),before);assert.equal(receipts(env),0);assert.equal(epoch(env),beforeEpoch);
});

test('selected linked blocks can move on approval and unselected blocks stay fixed',async()=>{
 const env=environment();task(env);task(env,2);task(env,3);const moving=appointment(env,'15:00','15:30',{taskId:1,title:'Old block'}),fixed=appointment(env,'09:00','10:00',{taskId:2,title:'Untouched task'});const old=rows(env);
 const preview=await draft(env,{taskIds:[1,3]});assert.equal(preview.replanDraft.blocks[0].agendaId,moving);assert.equal(preview.replanDraft.blocks[0].previous.time,'15:00');assert.equal(preview.replanDraft.blocks[0].time,'10:00');assert.equal((await confirm(env,preview)).status,200);
 const after=rows(env);assert.equal(after.length,3);assert.deepEqual(after.find(a=>a.id===fixed),old.find(a=>a.id===fixed));assert.equal(after.find(a=>a.id===moving).revision,1);assert.equal(after.find(a=>a.id===moving).draft_id,old.find(a=>a.id===moving).draft_id);
 const again=await draft(env,{taskIds:[1],startTime:'14:00'});assert.equal((await confirm(env,again)).status,200);assert.equal(rows(env).length,3);assert.equal(rows(env).find(a=>a.id===moving).starts_at,ms('14:00'));
});

test('unscheduled existing blocks are preserved and remain obstacles to other proposed tasks',async()=>{
 const env=environment();task(env);task(env,2);appointment(env,'09:00','09:30',{taskId:1});
 const preview=await draft(env,{endTime:'10:00',taskIds:[1,2],durations:{1:90,2:30}});assert.deepEqual(preview.replanDraft.blocks.map(b=>[b.taskId,b.time]),[[2,'09:30']]);assert.equal(preview.replanDraft.unscheduled[0].taskId,1);const old=rows(env)[0];await confirm(env,preview);assert.deepEqual(rows(env)[0],old);
});

test('the agenda cap includes archived records, permits updates at capacity, and is checked again during writes',async()=>{
 const env=environment();task(env);task(env,2);for(let i=0;i<199;i++)appointment(env,'08:00','08:01',{title:'Old '+i,date:'2026-10-24'});
 const preview=await draft(env);assert.equal(preview.replanDraft.blocks.length,1);assert.equal(preview.replanDraft.unscheduled.length,1);assert.equal((await confirm(env,preview)).status,200);assert.equal(rows(env).length,200);
 const update=await draft(env,{taskIds:[1],startTime:'15:00'});assert.equal(update.replanDraft.blocks[0].agendaId,200);assert.equal((await confirm(env,update)).status,200);assert.equal(rows(env).length,200);
 env.sql.exec("UPDATE atlas_agenda SET archived_at='2026-10-25' WHERE task_id IS NULL");const capped=await draft(env,{taskIds:[2]});assert.equal(capped.replanDraft,null);assert.match(capped.replanUnscheduled[0].reason,/200/);
 const race=environment();task(race);const p=await draft(race);race.beforeWrite=()=>{for(let i=0;i<200;i++)appointment(race,'08:00','08:01',{title:'Old '+i,date:'2026-10-24'});};assert.equal((await confirm(race,p)).status,409);assert.equal(rows(race).length,200);assert.equal(receipts(race),0);
});

test('malformed signed blocks cannot move ordinary appointments, overlap fixed slots or each other',async()=>{
 for(const alter of [d=>{d.blocks[0].agendaId=1;},d=>{d.blocks[0].starts_at=ms('10:00');d.blocks[0].ends_at=ms('10:30');},d=>{d.blocks[1].starts_at=d.blocks[0].starts_at;d.blocks[1].ends_at=d.blocks[0].ends_at;},d=>{d.blocks[1].taskId=d.blocks[0].taskId;},d=>{d.blocks[0].durationMinutes=1;},d=>{d.blocks[0].title='Changed';},d=>{d.blocks[0].starts_at=ms('08:00');d.blocks[0].ends_at=ms('08:30');}]){
  const env=environment();task(env);task(env,2);appointment(env,'10:00','11:00');const p=await draft(env),data=await verifyDraft(env,p.replanDraft.token,'replan',now),before=rows(env);alter(data);p.replanDraft.token=await signDraft(env,'replan',data,now);assert.equal((await confirm(env,p)).status,409);assert.deepEqual(rows(env),before);assert.equal(receipts(env),0);
 }
});

test('receipt history is bounded without deleting personal records',async()=>{
 const env=environment();task(env);const p=await draft(env);
 env.sql.exec('DROP TRIGGER atlas_replan_guard; DROP TRIGGER atlas_replan_apply;');
 env.sql.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO atlas_replan_receipts SELECT 'old-'||i,0,printf('%064d',0),'2026-10-25',0,60000,0,'[{}]','2026-10-25' FROM n;");
 const migration=readFileSync(new URL('../migrations/0013_replan.sql',import.meta.url),'utf8');env.sql.exec(migration.slice(migration.indexOf('CREATE TRIGGER atlas_replan_guard')));
 const result=await confirm(env,p);assert.equal(result.status,409);assert.match(result.text,/5000/);assert.equal(receipts(env),5000);assert.equal(rows(env).length,0);
});

test('missing storage, migration or signing secret fail safely without external calls',async()=>{
 assert.equal((await command({},'Günümü toparla')).status,503);assert.equal((await readReplan({},now)).replanAvailable,false);
 const env=environment();env.sql.exec('DROP TABLE atlas_replan_state');assert.equal((await draft(env)).status,503);assert.equal((await readReplan(env,now)).replanAvailable,false);
 const noSecret=environment();task(noSecret);delete noSecret.SESSION_SECRET;assert.equal((await draft(noSecret)).status,503);assert.equal(noSecret.writes,0);
});
