import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {backupCommand,backupPreview,createBackup} from '../src/backup.js';
const now=new Date('2026-10-25T12:00:00Z');
function setup(){
 const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 let batches=0;const db={prepare(q){const s=sql.prepare(q);return {async all(){return {results:s.all()};}};},async batch(statements){batches++;sql.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.all()));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{MEMORY_DB:db,GEMINI_API_KEY:'DO-NOT-EXPORT-API-KEY',SESSION_SECRET:'DO-NOT-EXPORT-SESSION',ATLAS_ACCESS_PASSWORD:'DO-NOT-EXPORT-PASSWORD'},batches:()=>batches};
}
test('voice exports are deterministic read-only navigation, not an implied save or restore',()=>{
 for(const text of ['Yedeğimi indir','Kayıtlarımın yedeğini indir','Yedekleme aç','Kayıtlarımı dışa aktar'])assert.equal(backupCommand(text).format,'json');
 assert.equal(backupCommand('Harcamalarımı Excel’e aktar').format,'csv');assert.equal(backupCommand('Ajandamı takvime aktar').format,'ics');
 for(const text of ['yedeklemeyi nasıl yapabilirim','Yedeği geri yükle','Şu dosyayı sil','yedeğimi indir diye söyle'])assert.equal(backupCommand(text),null);
 const d=backupPreview({format:'json'});assert.equal(d.backupOpen,true);assert.equal(d.content,undefined);
});
test('JSON exports approved personal records and archives consistently without credentials',async()=>{
 const s=setup();s.sql.prepare('INSERT INTO atlas_notes(text,created_at,archived_at) VALUES(?,?,?)').run('Arşivde not',now.toISOString(),now.toISOString());
 s.sql.prepare('INSERT INTO atlas_instagram_connection(id,encrypted_token,username,connected_at) VALUES(1,?,?,?)').run('DO-NOT-EXPORT-META-TOKEN','example',now.toISOString());
 const before=s.sql.prepare('SELECT total_changes() AS n').get().n;
 const r=await createBackup({format:'json'},s.env,now);assert.equal(r.status,200,r.error);assert.equal(s.batches(),1);assert.equal(r.filename,'ATLAS-yedek-2026-10-25.json');const j=JSON.parse(r.content);
 assert.equal(j.formatVersion,1);assert.equal(j.restoreSupported,false);assert.equal(j.data.notes[0].text,'Arşivde not');assert.equal(j.data.notes[0].archived_at,now.toISOString());assert.equal(j.counts.notes,1);
 assert.deepEqual(Object.keys(j.data).sort(),['agenda','billPayments','billPlans','budgets','contentCalendar','expenses','focus','lists','memories','notes','plans','routines','tasks','waiting']);
 assert.equal(Object.keys(j.counts).length,14);assert.ok(j.scope.includes('bill_payment_declarations'));assert.ok(j.excluded.includes('offline_device_cache'));assert.ok(j.excluded.includes('multi_action_receipts'));assert.deepEqual(j.counts.billPlans,0);assert.deepEqual(j.counts.billPayments,0);assert.equal(j.counts.budgets,0);assert.equal(j.counts.waiting,0);
 assert.ok(!r.content.includes('DO-NOT-EXPORT'));assert.ok(!r.content.includes('draft_id'));assert.equal(s.sql.prepare('SELECT total_changes() AS n').get().n,before);s.sql.close();
});
test('CSV preserves cents and Turkish text and neutralizes spreadsheet formula injection',async()=>{
 const s=setup(),titles=['=HYPERLINK("https://evil.invalid")',' +SUM(1;2)','@SUM(1)','-cmd','\t=1+2','Türkçe, "kahve"; çay\nyeni satır'];
 const insert=s.sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at,archived_at) VALUES(?,?,?,?,?,?,?,?)');
 titles.forEach((title,i)=>insert.run('expense-'+i,title,4550,'TRY','market','2026-10-25',now.toISOString(),i===0?now.toISOString():null));
 const r=await createBackup({format:'csv'},s.env,now);assert.equal(r.status,200,r.error);assert.ok(r.content.startsWith('\uFEFF'));assert.ok(r.content.includes('"45,50"'));assert.ok(r.content.includes('"Evet"'));
 for(const title of titles.slice(0,-1))assert.ok(r.content.includes('"\''+title.replaceAll('"','""')+'"'),title);
 assert.ok(r.content.includes('Türkçe, ""kahve""; çay\nyeni satır'));s.sql.close();
});

test('JSON includes task-linked agenda, archived bill plans and immutable payment declarations with current expenses separate',async()=>{
 const s=setup(),id=crypto.randomUUID(),paymentId=crypto.randomUUID();
 s.sql.prepare('INSERT INTO atlas_tasks(id,title,created_at) VALUES(1,?,?)').run('Açık iş',now.toISOString());
 s.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,task_id,starts_at,ends_at,created_at) VALUES(?,?,1,?,?,?)').run('DO-NOT-EXPORT-REPLAN-ID','Açık iş',now.getTime()+60000,now.getTime()+31*60000,now.toISOString());
 const before={title:'İnternet',title_key:'internet',amount_minor:45000,currency:'TRY',recurrence:'monthly',start_date:'2026-10-15',anchor_day:15,anchor_month:10,archived:0};
 s.sql.prepare('INSERT INTO atlas_bills(id,title,title_key,amount_minor,currency,recurrence,start_date,anchor_day,anchor_month,revision,archived,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,?,?,?,?,1,0,?,?,?)').run(id,before.title,before.title_key,before.amount_minor,before.currency,before.recurrence,before.start_date,before.anchor_day,before.anchor_month,now.toISOString(),now.toISOString(),'DO-NOT-EXPORT-BILL-OPERATION');
 const after={title:before.title,amount_minor:44000,planned_amount_minor:45000,currency:'TRY',due_date:'2026-10-15',paid_date:'2026-10-25'};
 s.sql.prepare('INSERT INTO atlas_bill_operations(id,bill_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,1,?,?,?)').run(paymentId,id,'pay',JSON.stringify(before),JSON.stringify(after),now.toISOString());
 s.sql.prepare('UPDATE atlas_bills SET archived=1,last_operation_id=? WHERE id=?').run('DO-NOT-EXPORT-JOURNAL',id);
 s.sql.prepare('UPDATE atlas_expenses SET title=?,amount_minor=43500,archived_at=?,revision=revision+1').run('Düzeltilmiş ödeme',now.toISOString());
 const changes=s.sql.prepare('SELECT total_changes() n').get().n,result=await createBackup({format:'json'},s.env,now),json=JSON.parse(result.content);
 assert.equal(result.status,200);assert.equal(json.data.agenda[0].task_id,1);assert.equal(json.counts.billPlans,1);assert.equal(json.counts.billPayments,1);assert.equal(json.data.billPlans[0].archived,1);
 assert.deepEqual(Object.keys(json.data.billPlans[0]),['id','title','amount_minor','currency','recurrence','start_date','anchor_day','anchor_month','revision','archived','created_at','updated_at']);
 assert.deepEqual(Object.keys(json.data.billPayments[0]),['id','bill_id','due_date','title','amount_minor','planned_amount_minor','currency','paid_date','expense_id','created_at']);
 assert.equal(json.data.billPayments[0].amount_minor,44000);assert.equal(json.data.billPayments[0].planned_amount_minor,45000);assert.equal(json.data.expenses[0].amount_minor,43500);assert.equal(json.data.expenses[0].title,'Düzeltilmiş ödeme');assert.equal(json.data.billPayments[0].expense_id,json.data.expenses[0].id);
 assert.ok(!result.content.includes('DO-NOT-EXPORT'));for(const forbidden of ['last_operation_id','title_key','snapshot_hash','expected_epoch','before_json','after_json'])assert.ok(!result.content.includes(forbidden));assert.equal(s.sql.prepare('SELECT total_changes() n').get().n,changes);
 const csv=await createBackup({format:'csv'},s.env,now);assert.ok(csv.content.includes('"435,00"'));assert.ok(!csv.content.includes('"440,00"'));s.sql.close();
});

test('bill export fields are explicitly projected and payment overflow fails without partial backup',async()=>{
 const rows={atlas_bills:[{id:'bill-identifier',title:'Plan',amount_minor:10000,currency:'TRY',recurrence:'once',start_date:'2026-10-25',anchor_day:25,anchor_month:10,revision:1,archived:0,created_at:now.toISOString(),updated_at:now.toISOString(),last_operation_id:'SECRET-OP',encrypted_token:'SECRET-TOKEN'}],atlas_bill_payments:[{id:'payment-id',bill_id:'bill-identifier',due_date:'2026-10-25',title:'Plan',amount_minor:10000,planned_amount_minor:10000,currency:'TRY',paid_date:'2026-10-25',expense_id:1,created_at:now.toISOString(),authorization:'SECRET-AUTH'}]};
 const queried=[],env={MEMORY_DB:{prepare(q){queried.push(q);const name=q.match(/FROM (\w+)/)[1];return {all:async()=>({results:rows[name]||[]})};},batch:statements=>Promise.all(statements.map(s=>s.all()))}};
 const result=await createBackup({format:'json'},env,now);assert.equal(result.status,200);assert.ok(!result.content.includes('SECRET'));assert.equal(queried.length,14);assert.ok(queried.every(q=>!/(atlas_replan|atlas_offline|atlas_bill_operations|atlas_budget_operations|atlas_waiting_operations|atlas_multi_receipts)/u.test(q)));
 rows.atlas_bill_payments=Array(2001).fill(rows.atlas_bill_payments[0]);const overflow=await createBackup({format:'json'},env,now);assert.equal(overflow.status,503);assert.equal(overflow.content,undefined);
});
test('ICS escapes injection, preserves Turkish characters and folds at 75 UTF-8 bytes',async()=>{
 const s=setup(),title='Görüşme; çay, kahve '+ 'ş'.repeat(55)+'\nBEGIN:VEVENT';
 const insert=s.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at,archived_at) VALUES(?,?,?,?,?,?)');
 insert.run('one',title,Date.parse('2026-10-26T13:00:00Z'),Date.parse('2026-10-26T13:30:00Z'),now.toISOString(),null);insert.run('two','ARŞİVDE',Date.parse('2026-10-26T14:00:00Z'),Date.parse('2026-10-26T14:30:00Z'),now.toISOString(),1);
 const r=await createBackup({format:'ics'},s.env,now);assert.equal(r.status,200,r.error);assert.ok(r.content.includes('DTSTART:20261026T130000Z'));assert.ok(!r.content.includes('ARŞİVDE'));
 for(const line of r.content.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
 const unfolded=r.content.replaceAll('\r\n ','');assert.ok(unfolded.includes('SUMMARY:Görüşme\\; çay\\, kahve'));assert.ok(unfolded.includes('\\nBEGIN:VEVENT'));assert.equal(unfolded.split('\r\nBEGIN:VEVENT\r\n').length-1,1);s.sql.close();
});
test('unsupported or mixed requests and missing data fail without partial exports',async()=>{
 const s=setup();for(const b of [null,[],{}, {format:'sql'}, {format:'json',confirmed:true}, {format:'csv',managementConfirmation:{}}])assert.equal((await createBackup(b,s.env,now)).status,400);
 assert.equal((await createBackup({format:'json'},{},now)).status,503);s.sql.exec('DROP TABLE atlas_routines');const r=await createBackup({format:'json'},s.env,now);assert.equal(r.status,503);assert.equal(r.content,undefined);s.sql.close();
});
test('extra database fields cannot accidentally enter export and overflowing collection is rejected',async()=>{
 const tableRows={atlas_expenses:[{id:1,title:'Market',amount_minor:150,currency:'TRY',category:'market',spent_day:'2026-10-25',created_at:now.toISOString(),archived_at:null,revision:1,encrypted_token:'LEAK'}]};
 const env={MEMORY_DB:{prepare(q){const name=q.match(/FROM (\w+)/)[1];return {all:async()=>({results:tableRows[name]||[]})};},batch:statements=>Promise.all(statements.map(s=>s.all()))}};
 const r=await createBackup({format:'csv'},env,now);assert.equal(r.status,200);assert.ok(!r.content.includes('LEAK'));tableRows.atlas_expenses=Array(501).fill(tableRows.atlas_expenses[0]);const bad=await createBackup({format:'csv'},env,now);assert.equal(bad.status,503);assert.equal(bad.content,undefined);
});
test('export refuses non-atomic adapters instead of producing a mixed-revision backup',async()=>{
 let queried=false;const env={MEMORY_DB:{prepare(){return {all:async()=>{queried=true;return {results:[]};}};}}};
 const r=await createBackup({format:'json'},env,now);assert.equal(r.status,503);assert.equal(r.content,undefined);assert.equal(queried,false);
});

test('JSON includes exact-month budgets and waiting declarations, including archives, without journals',async()=>{
 const s=setup(),budgetId=crypto.randomUUID(),waitingId=crypto.randomUUID();
 s.sql.prepare('INSERT INTO atlas_budgets(id,month,category,amount_minor,currency,archived,revision,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,1,3,?,?,?)').run(budgetId,'2028-02','market',500000,'TRY',now.toISOString(),now.toISOString(),'DO-NOT-EXPORT-BUDGET-OP');
 s.sql.prepare('INSERT INTO atlas_waiting(id,who,who_key,what,what_key,kind,followup_date,last_contact_date,status,archived,revision,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,?,?,?,?,1,2,?,?,?)').run(waitingId,'Ada','DO-NOT-EXPORT-WHO-KEY','Teklif yanıtı','DO-NOT-EXPORT-WHAT-KEY','reply','2026-11-01','2026-10-24','received',now.toISOString(),now.toISOString(),'DO-NOT-EXPORT-WAITING-OP');
 const before=s.sql.prepare('SELECT total_changes() AS n').get().n,r=await createBackup({format:'json'},s.env,now);assert.equal(r.status,200,r.error);const j=JSON.parse(r.content);
 assert.equal(j.counts.budgets,1);assert.equal(j.counts.waiting,1);assert.equal(Object.keys(j.counts).length,14);
 assert.deepEqual(j.data.budgets[0],{id:budgetId,month:'2028-02',category:'market',amount_minor:500000,currency:'TRY',archived:1,revision:3,created_at:now.toISOString(),updated_at:now.toISOString()});
 assert.deepEqual(j.data.waiting[0],{id:waitingId,who:'Ada',what:'Teklif yanıtı',kind:'reply',followup_date:'2026-11-01',last_contact_date:'2026-10-24',status:'received',archived:1,revision:2,created_at:now.toISOString(),updated_at:now.toISOString()});
 assert.ok(!r.content.includes('DO-NOT-EXPORT'));for(const forbidden of ['who_key','what_key','last_operation_id','before_json','after_json','items_json','expected_revision','selection_hash'])assert.ok(!r.content.includes(forbidden),forbidden);
 assert.equal(s.sql.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(s.batches(),1);s.sql.close();
});

test('budget and waiting exports project only explicit fields and fail entirely above their caps',async()=>{
 const rows={atlas_budgets:[{id:'budget-id',month:'2026-10',category:'market',amount_minor:500000,currency:'TRY',archived:0,revision:1,created_at:now.toISOString(),updated_at:now.toISOString(),last_operation_id:'SECRET-BUDGET',token:'SECRET-TOKEN'}],atlas_waiting:[{id:'waiting-id',who:'Ada',what:'Teklif',kind:'reply',followup_date:'',last_contact_date:'',status:'waiting',archived:0,revision:1,created_at:now.toISOString(),updated_at:now.toISOString(),who_key:'SECRET-KEY',last_operation_id:'SECRET-WAITING',encrypted_token:'SECRET-ENCRYPTED'}]};
 const queried=[],env={MEMORY_DB:{prepare(q){queried.push(q);const name=q.match(/FROM (\w+)/)[1];return {all:async()=>({results:rows[name]||[]})};},batch:statements=>Promise.all(statements.map(s=>s.all()))}};
 let r=await createBackup({format:'json'},env,now);assert.equal(r.status,200);assert.ok(!r.content.includes('SECRET'));assert.equal(queried.length,14);assert.ok(queried.every(q=>!/operations|receipts|connection|oauth|sessions/u.test(q.replace('atlas_focus_sessions','focus'))));
 rows.atlas_budgets=Array(101).fill(rows.atlas_budgets[0]);r=await createBackup({format:'json'},env,now);assert.equal(r.status,503);assert.equal(r.content,undefined);
 rows.atlas_budgets=[];rows.atlas_waiting=Array(201).fill(rows.atlas_waiting[0]);r=await createBackup({format:'json'},env,now);assert.equal(r.status,503);assert.equal(r.content,undefined);
});
