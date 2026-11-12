import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {managementCommand,managementRequest,readManagement,latestManagementChange} from '../src/record-management.js';
import {dailyRequest,readDaily} from '../src/daily-records.js';
import {notes,noteAction} from '../src/notes.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T10:00:00Z');
function environment(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {SESSION_SECRET:'record-management-tests-secret-over-thirty-two',MEMORY_DB:{sql,prepare(query){const s=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}}};
}
function seed(env){
 const sql=env.MEMORY_DB.sql;
 const a=sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)');
 a.run('seed-agenda-one','Görüşme',Date.parse('2026-10-26T12:00:00Z'),Date.parse('2026-10-26T12:30:00Z'),now.toISOString());
 a.run('seed-agenda-two','Sunum',Date.parse('2026-10-26T14:00:00Z'),Date.parse('2026-10-26T14:30:00Z'),now.toISOString());
 const e=sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) VALUES(?,?,?,?,?,?,?)');
 e.run('seed-expense-one','Market',42000,'TRY','market','2026-10-25',now.toISOString());
 e.run('seed-expense-two','Otobüs',4550,'TRY','ulaşım','2026-10-25',now.toISOString());
 const n=sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)');n.run('İlk düşünce',now.toISOString());n.run('İkinci düşünce',now.toISOString());
 return env;
}
const fresh=()=>seed(environment());
const command=(text,env,at=now)=>managementRequest({messages:[{role:'user',text}]},env,at);
const draft=(request,env,at=now)=>managementRequest({managementDraftRequest:request},env,at);
const edit=(kind,id,changes,env,at=now)=>draft({kind,id,action:'edit',changes},env,at);
const approve=(r,env,at=now,text='Değişikliği onaylıyorum')=>managementRequest({messages:[{role:'user',text}],managementConfirmation:{confirmed:true,token:r.managementDraft.token}},env,at);
const row=(env,table,id)=>env.MEMORY_DB.sql.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const auditCount=env=>env.MEMORY_DB.sql.prepare('SELECT COUNT(*) n FROM atlas_record_changes').get().n;

test('voice grammar uses exact numbered targets, latest expense, precise approval, and no title guesses',async()=>{
 const env=fresh();
 assert.equal(managementCommand('Merhaba'),null);
 assert.equal(managementCommand('Değişikliği onaylıyorum diye söylemem mi gerek'),null);
 assert.equal(managementCommand('Değişikliği onaylıyorum.').action,'confirm');
 for(const text of ['Kayıtlarımı göster','Arşivimi aç','Kayıt yönetimi'])assert.equal(managementCommand(text).action,'list');
 const latest=await command('Son harcamayı 240 lira olarak düzelt',env);
 assert.equal(latest.managementDraft.id,2);assert.equal(latest.managementDraft.after.amount_minor,24000);
 const numbered=await command('Harcama 1 tutarını 0,01 lira yap',env);
 assert.equal(numbered.managementDraft.id,1);assert.equal(numbered.managementDraft.after.amount_minor,1);
 const appointment=await command('Ajanda 2 yarın saat 16.00’ya taşı',env);
 assert.equal(appointment.managementDraft.after.starts_at,Date.parse('2026-10-26T13:00:00Z'));
 assert.equal(appointment.managementDraft.after.ends_at,Date.parse('2026-10-26T13:30:00Z'));
 const note=await command('Not 2 metnini İstanbul IŞIK Projesi olarak düzelt',env);
 assert.equal(note.managementDraft.after.text,'İstanbul IŞIK Projesi');
 for(const text of ['Harcama market tutarını 240 lira yap','Ajanda görüşmeyi yarın saat 16.00’ya taşı','Harcama 2 tutarını 1 200 lira yap','Ajanda 2 haftaya saat 16.00’ya taşı'])assert.equal((await command(text,env)).status,400,text);
 assert.equal(auditCount(env),0);assert.equal(row(env,'atlas_expenses',2).amount_minor,4550);
});

test('preview is read-only; explicit approval updates once and appends immutable before/after audit',async()=>{
 const env=fresh(),r=await edit('expense',1,{title:'Bakkal',amount:'240,15',category:'diğer',date:'2026-10-24'},env);
 assert.equal(r.status,200);assert.equal(r.managementDraft.kind,'management');assert.match(r.text,/Önce:/);assert.match(r.text,/Sonra:/);
 assert.equal(auditCount(env),0);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);
 assert.equal((await approve(r,env,now,'Evet')).status,400);
 const saved=await approve(r,env,now,'Değişikliği onaylıyorum.');
 assert.equal(saved.status,200);assert.equal(row(env,'atlas_expenses',1).amount_minor,24015);assert.equal(row(env,'atlas_expenses',1).title,'Bakkal');assert.equal(row(env,'atlas_expenses',1).revision,1);
 const journal=row(env,'atlas_record_changes',saved.managementSaved.id);
 assert.equal(JSON.parse(journal.before_json).amount_minor,42000);assert.equal(JSON.parse(journal.after_json).amount_minor,24015);
 assert.equal(journal.before_revision,0);assert.equal(journal.undo_of,null);
 assert.throws(()=>env.MEMORY_DB.sql.exec('UPDATE atlas_record_changes SET action=\'archive\''),/immutable/);
 assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_record_changes'),/immutable/);
 const replay=await approve(r,env);assert.equal(replay.managementSaved.replayed,true);assert.equal(auditCount(env),1);assert.equal(row(env,'atlas_expenses',1).revision,1);
});

test('missing flags, wrong phrases, tampering, expired/future and cross-purpose approvals never write',async()=>{
 const env=fresh(),r=await edit('expense',1,{amount:'240'},env);
 assert.equal((await command('Değişikliği onaylıyorum',env)).status,400);
 const send=token=>managementRequest({messages:[{role:'user',text:'Değişikliği onaylıyorum'}],managementConfirmation:{confirmed:true,token}},env,now);
 assert.equal((await managementRequest({managementConfirmation:{confirmed:true,token:r.managementDraft.token}},env,now)).status,400);
 assert.equal((await managementRequest({messages:[{role:'user',text:'Değişikliği onaylıyorum'}],managementConfirmation:{confirmed:false,token:r.managementDraft.token}},env,now)).status,400);
 assert.equal((await send('garbage')).status,409);assert.equal((await send(r.managementDraft.token.slice(0,-8)+'AAAAAAAA')).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);
 const d=await verifyDraft(env,r.managementDraft.token,'management',now);
 for(const kind of ['daily','focus','lists'])assert.equal((await send(await signDraft(env,kind,d,now))).status,409,kind);
 for(const bad of [{...d,id:0},{...d,recordKind:'atlas_notes'},{...d,revision:-1},{...d,after:{...d.after,amount_minor:0}},{...d,action:'archive'},{...d,action:'undo',undoOf:null},{...d,conflictSignature:'1); DROP TABLE atlas_notes; --'}])assert.equal((await send(await signDraft(env,'management',bad,now))).status,409);
 assert.equal((await managementRequest({managementDraftRequest:{action:'undo'},managementConfirmation:{confirmed:true,token:r.managementDraft.token}},env,now)).status,400);
 assert.equal(auditCount(env),0);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);
});

test('money edits are exact cents and reject ambiguity, overflow, negative, future and unsupported fields',async()=>{
 const env=fresh();
 for(const [value,cents] of [['0.01',1],['0,10',10],['240.15',24015],['999999999.99',99999999999]])assert.equal((await edit('expense',1,{amount:value},env)).managementDraft.after.amount_minor,cents);
 for(const value of ['0','-1','1,000','1.000','1,234.50','1.234,50','1e2','NaN','Infinity','1000000000',1,'1 200','+240','1.'])assert.equal((await edit('expense',1,{amount:value},env)).status,400,String(value));
 for(const changes of [{date:'2026-02-30'},{date:'2026-10-26'},{currency:'BTC'},{category:'belirsiz'},{amount_minor:123},{title:'x'.repeat(201)},{title:'bad\ncontrol'}])assert.equal((await edit('expense',1,changes,env)).status,400);
 assert.equal((await edit('expense','1',{amount:'5'},env)).status,400);assert.equal((await edit('expense',999,{amount:'5'},env)).status,404);
 assert.equal((await draft({kind:'note',latest:true,action:'archive'},env)).status,400);
 assert.equal((await edit('expense',1,{amount:'420'},env)).status,409);
 assert.equal(auditCount(env),0);
});

test('agenda edits validate Istanbul calendar, duration, midnight, past and elapsed approval',async()=>{
 const env=fresh();
 for(const changes of [{date:'2027-02-29'},{time:'24:00'},{time:'16.0'},{durationMinutes:0},{durationMinutes:1441},{durationMinutes:1.5},{date:'2026-10-24'},{date:'2026-10-25',time:'12:59'}])assert.equal((await edit('agenda',1,changes,env)).status,400);
 const leap=await edit('agenda',1,{date:'2028-02-29',time:'23:59',durationMinutes:60},env);
 assert.equal(leap.managementDraft.after.starts_at,Date.parse('2028-02-29T20:59:00Z'));assert.equal(leap.managementDraft.after.ends_at,Date.parse('2028-02-29T21:59:00Z'));
 const at=new Date('2026-12-31T21:01:00Z'),rollover=await command('Ajanda 1 yarın saat 16.00’ya taşı',env,at);
 assert.equal(rollover.managementDraft.after.starts_at,Date.parse('2027-01-02T13:00:00Z'));
 const soon=await edit('agenda',1,{date:'2026-10-25',time:'13:01'},env);
 assert.equal((await approve(soon,env,new Date('2026-10-25T10:02:00Z'))).status,409);assert.equal(auditCount(env),0);
});

test('two previews for one record use CAS; stale and replay-after-undo never resurrect an edit',async()=>{
 const env=fresh(),a=await edit('expense',1,{amount:'10'},env),b=await edit('expense',1,{amount:'20'},env);
 assert.equal((await approve(a,env)).status,200);assert.equal((await approve(b,env)).status,409);
 const undo=await command('Son kayıt değişikliğini geri al',env);assert.equal(undo.managementDraft.action,'undo');assert.equal(row(env,'atlas_expenses',1).amount_minor,1000);
 const done=await approve(undo,env);assert.equal(done.status,200);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);assert.equal(row(env,'atlas_expenses',1).revision,2);
 assert.equal((await approve(a,env)).managementSaved.replayed,true);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);
 assert.equal((await approve(undo,env)).managementSaved.replayed,true);assert.equal(auditCount(env),2);
 assert.equal(await latestManagementChange(env),null);
});

test('CAS checks entire before snapshot even if a legacy direct writer did not bump revision',async()=>{
 const env=fresh(),r=await edit('expense',1,{amount:'10'},env);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_expenses SET title=? WHERE id=1').run('Başka cihaz değiştirdi');
 assert.equal((await approve(r,env)).status,409);assert.equal(auditCount(env),0);
});

test('a target mutation inserted between recheck and journal commit is rejected atomically',async()=>{
 const env=fresh(),r=await edit('expense',1,{amount:'10'},env),prepare=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{
  if(query.startsWith('INSERT INTO atlas_record_changes')&&!injected){injected=true;env.MEMORY_DB.sql.exec('UPDATE atlas_expenses SET amount_minor=999,revision=revision+1 WHERE id=1');}
  return prepare(query);
 };
 assert.equal((await approve(r,env)).status,409);assert.equal(row(env,'atlas_expenses',1).amount_minor,999);assert.equal(auditCount(env),0);
});

test('agenda overlapping set is re-previewed after addition or modification and compared inside commit',async()=>{
 const env=fresh(),r=await edit('agenda',1,{time:'17:10'},env);
 assert.equal(r.managementDraft.conflicts.length,1);assert.equal(r.managementDraft.conflicts[0].id,2);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_agenda SET title=?,revision=revision+1 WHERE id=2').run('Yeni sunum');
 const refreshed=await approve(r,env);assert.equal(refreshed.conflictChanged,true);assert.match(refreshed.text,/Yeni sunum/);assert.equal(auditCount(env),0);
 assert.equal((await approve(refreshed,env)).status,200);assert.equal(auditCount(env),1);
 const move=await edit('agenda',1,{time:'20:00'},env),prepare=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{
  if(query.startsWith('INSERT INTO atlas_record_changes')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)').run('concurrent-agenda','Başka cihaz',Date.parse('2026-10-26T17:00:00Z'),Date.parse('2026-10-26T17:15:00Z'),now.toISOString());}
  return prepare(query);
 };
 const race=await approve(move,env);assert.equal(race.conflictChanged,true);assert.equal(race.managementDraft.conflicts.length,1);assert.equal(auditCount(env),1);
 assert.equal(row(env,'atlas_agenda',1).starts_at,Date.parse('2026-10-26T14:10:00Z'));
});

test('archive hides records without deletion or changing expense totals; unarchive and undo need approval',async()=>{
 const env=fresh();
 for(const [kind,id] of [['agenda',1],['expense',1],['note',1]]){
  const r=await draft({kind,id,action:'archive'},env);assert.equal(row(env,`atlas_${kind==='expense'?'expenses':kind==='note'?'notes':'agenda'}`,id).archived_at,null);
  assert.equal((await approve(r,env)).status,200);
 }
 assert.equal((await notes(env.MEMORY_DB)).length,1);
 assert.equal((await noteAction(env.MEMORY_DB,'Not al: İlk düşünce',true)).status,409);
 const daily=await readDaily(env,now);assert.equal(daily.agendaItems.length,1);assert.equal(daily.expenseItems.length,1);assert.equal(daily.expenseTotals[0].amount_minor,46550);assert.match(daily.expenseArchivePolicy,/dahildir/);
 const data=await readManagement(env,now);assert.equal(data.recordItems.agenda.length,2);assert.equal(data.recordItems.expenses.length,2);assert.equal(data.recordItems.notes.length,2);assert.equal(data.changeItems.length,3);
 assert.equal(data.recordItems.notes.find(r=>r.id===1).archived_at,now.toISOString());
 const restore=await command('Not 1 arşivden çıkar',env);assert.equal((await notes(env.MEMORY_DB)).length,1);assert.equal((await approve(restore,env)).status,200);assert.equal((await notes(env.MEMORY_DB)).length,2);
 const undo=await draft({action:'undo'},env);assert.equal(undo.managementDraft.recordKind,'note');assert.equal((await approve(undo,env)).status,200);assert.equal((await notes(env.MEMORY_DB)).length,1);
 assert.equal(env.MEMORY_DB.sql.prepare('SELECT COUNT(*) n FROM atlas_notes').get().n,2);
});

test('archived agenda is excluded from both new record and edit conflicts; restore checks conflicts',async()=>{
 const env=fresh();await approve(await draft({kind:'agenda',id:2,action:'archive'},env),env);
 const r=await edit('agenda',1,{time:'17:00'},env);assert.equal(r.managementDraft.conflicts.length,0);await approve(r,env);
 const add=await dailyRequest({dailyDraftRequest:{kind:'agenda',title:'Yeni',date:'2026-10-26',time:'17:00',durationMinutes:30}},env,now);
 assert.equal(add.dailyDraft.conflicts.length,1);assert.equal(add.dailyDraft.conflicts[0].id,1);
 const restore=await draft({kind:'agenda',id:2,action:'unarchive'},env);assert.equal(restore.managementDraft.conflicts.length,1);assert.match(restore.text,/çakışıyor/);
});

test('new daily agenda approvals re-preview when a conflicting record is edited with the same id',async()=>{
 const env=fresh(),input={kind:'agenda',title:'Yeni kayıt',date:'2026-10-26',time:'15:15',durationMinutes:30};
 const pending=await dailyRequest({dailyDraftRequest:input},env,now);
 assert.equal(pending.dailyDraft.conflicts.length,1);
 await approve(await edit('agenda',1,{title:'Düzenlenen görüşme'},env),env);
 const dailyApprove=r=>dailyRequest({messages:[{role:'user',text:'Kaydı onaylıyorum'}],dailyConfirmation:{token:r.dailyDraft.token,confirmed:true}},env,now);
 const changed=await dailyApprove(pending);assert.equal(changed.conflictChanged,true);assert.equal(changed.dailyDraft.conflicts[0].title,'Düzenlenen görüşme');
 assert.equal(env.MEMORY_DB.sql.prepare('SELECT COUNT(*) n FROM atlas_agenda').get().n,2);
 const prepare=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{
  if(query.startsWith('INSERT OR IGNORE INTO atlas_agenda')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('UPDATE atlas_agenda SET title=?,revision=revision+1 WHERE id=1').run('Yarışta değişen görüşme');}
  return prepare(query);
 };
 const raced=await dailyApprove(changed);assert.equal(raced.conflictChanged,true);assert.equal(raced.dailyDraft.conflicts[0].title,'Yarışta değişen görüşme');
 assert.equal(env.MEMORY_DB.sql.prepare('SELECT COUNT(*) n FROM atlas_agenda').get().n,2);
 assert.equal((await dailyApprove(raced)).status,200);assert.equal(env.MEMORY_DB.sql.prepare('SELECT COUNT(*) n FROM atlas_agenda').get().n,3);
});

test('undo stack supports successive reversals, separate approved audit rows, and stale undo protection',async()=>{
 const env=fresh();
 await approve(await edit('expense',1,{amount:'10'},env),env);
 await approve(await edit('expense',1,{amount:'20'},env),env);
 assert.equal((await latestManagementChange(env)).id,2);
 const undoSecond=await draft({action:'undo',changeId:2},env);await approve(undoSecond,env);assert.equal(row(env,'atlas_expenses',1).amount_minor,1000);
 const undoFirst=await draft({action:'undo',changeId:1},env);assert.equal(undoFirst.status,200);await approve(undoFirst,env);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);
 assert.equal(auditCount(env),4);assert.equal((await command('Son kayıt değişikliğini geri al',env)).status,409);
 assert.equal((await readManagement(env,now)).changeItems.filter(r=>r.undone).length,2);
 await approve(await edit('note',1,{text:'Yeni metin'},env),env);
 const pending=await draft({action:'undo'},env);
 await approve(await edit('expense',2,{amount:'5'},env),env);
 assert.equal((await approve(pending,env)).status,409);assert.equal(row(env,'atlas_notes',1).text,'Yeni metin');
 assert.equal((await draft({action:'undo',changeId:5},env)).status,409);
});

test('failed unique note constraint rolls back both record and audit; literal SQL and markup remain data',async()=>{
 const env=fresh(),duplicate=await edit('note',1,{text:'İkinci düşünce'},env);
 assert.equal((await approve(duplicate,env)).status,409);assert.equal(auditCount(env),0);assert.equal(row(env,'atlas_notes',1).text,'İlk düşünce');assert.equal(row(env,'atlas_notes',1).revision,0);
 const text="'); DROP TABLE atlas_notes; -- <img src=x onerror=alert(1)>";
 assert.equal((await approve(await edit('note',1,{text},env),env)).status,200);assert.equal(row(env,'atlas_notes',1).text,text);assert.equal(auditCount(env),1);
 for(const text of ['','x'.repeat(1001),'bad\u0000control'])assert.equal((await edit('note',1,{text},env)).status,400);
});

test('existing multiline notes can be edited, archived and restored without losing whitespace',async()=>{
 const env=fresh(),text='Birinci satır\nİkinci satır\r\n\tSon satır';
 env.MEMORY_DB.sql.prepare('UPDATE atlas_notes SET text=? WHERE id=1').run(text);
 assert.equal((await approve(await draft({kind:'note',id:1,action:'archive'},env),env)).status,200);
 assert.equal((await approve(await draft({action:'undo'},env),env)).status,200);assert.equal(row(env,'atlas_notes',1).text,text);
 const edited=text+'\nYeni satır';assert.equal((await approve(await edit('note',1,{text:edited},env),env)).status,200);assert.equal(row(env,'atlas_notes',1).text,edited);
});

test('journal guards reject mismatched state and falsified undo even when called directly',async()=>{
 const env=fresh(),r=await edit('expense',1,{amount:'10'},env),d=await verifyDraft(env,r.managementDraft.token,'management',now);
 const insert=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at,undo_of) VALUES(?,?,?,?,?,?,?,?,?)');
 assert.throws(()=>insert.run('test-stale-journal','expense',1,'edit',4,JSON.stringify(d.before),JSON.stringify(d.after),now.toISOString(),null),/stale/);
 assert.throws(()=>insert.run('test-fake-undo','expense',1,'undo',0,JSON.stringify(d.before),JSON.stringify(d.after),now.toISOString(),999),/invalid undo/);
 assert.equal(auditCount(env),0);assert.equal(row(env,'atlas_expenses',1).amount_minor,42000);
});

test('management reads are bounded and missing/unmigrated stores fail only recognized commands',async()=>{
 const env=fresh();for(let n=0;n<35;n++)await approve(await edit('expense',1,{amount:String(n+1)},env),env);
 assert.equal((await readManagement(env,now)).changeItems.length,30);
 assert.equal((await command('Kayıtlarımı göster',{})).status,503);assert.equal(await command('Merhaba',{}),null);assert.equal((await readManagement({},now)).status,503);
 env.MEMORY_DB.sql.exec('DROP TABLE atlas_record_changes');assert.equal((await command('Kayıtlarımı göster',env)).status,503);
});

test('5000 forward-change cap is atomic, preserves history/replay, and reserves capacity for undo',async()=>{
 const env=fresh(),first=await edit('expense',1,{amount:'10'},env);await approve(first,env);
 const pending=await edit('expense',2,{amount:'20'},env);
 let before=(await verifyDraft(env,first.managementDraft.token,'management',now)).after;
 const insert=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at,undo_of) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let n=2;n<=5000;n++){
  const after={...before,amount_minor:n%2===0?1:2};
  insert.run(`capacity-seed-${n}`,'expense',1,'edit',n-1,JSON.stringify(before),JSON.stringify(after),now.toISOString(),null);before=after;
 }
 assert.equal(auditCount(env),5000);assert.equal((await edit('note',1,{text:'Limit'},env)).status,409);
 const denied=await approve(pending,env);assert.equal(denied.status,409);assert.match(denied.text,/5.000/);assert.equal(row(env,'atlas_expenses',2).amount_minor,4550);
 assert.equal((await approve(first,env)).managementSaved.replayed,true);assert.equal(auditCount(env),5000);
 const undo=await draft({action:'undo'},env);assert.equal(undo.status,200);assert.equal((await approve(undo,env)).status,200);assert.equal(auditCount(env),5001);assert.equal(row(env,'atlas_expenses',1).amount_minor,2);
 assert.equal((await edit('note',1,{text:'Limit'},env)).status,409);
});
