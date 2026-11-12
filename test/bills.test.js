import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {billsCommand,billsRequest,readBills} from '../src/bills.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T10:00:00Z');
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}};
}
const environment=()=>({MEMORY_DB:database(),SESSION_SECRET:'test-bills-secret-at-least-thirty-two-characters'});
const command=(text,env,at=now)=>billsRequest({messages:[{role:'user',text}]},env,at);
const draft=(input,env,at=now)=>billsRequest({billsDraftRequest:input},env,at);
const approve=(r,env,at=now,text='Ödeme kaydını onaylıyorum')=>billsRequest({messages:[{role:'user',text}],billsConfirmation:{token:r.billsDraft.token,confirmed:true}},env,at);
const count=(env,table)=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
const plan=(extra={})=>({action:'create',title:'İnternet faturam',amount:'450',currency:'TRY',recurrence:'monthly',date:'2026-10-15',...extra});
async function create(env,input={},at=now){const r=await draft(plan(input),env,at);assert.ok(r.billsDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved.billItems.find(i=>i.id===saved.billsSaved.bill_id);}
async function change(env,input,at=now){const r=await draft(input,env,at);assert.ok(r.billsDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved;}
function seedExpense(env,index){env.MEMORY_DB.sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) VALUES(?,?,?,?,?,?,?)').run(`expense-seed-${index}`,'Seed',1,'TRY','diğer','2026-10-25',now.toISOString());}
function seedBill(env,index){env.MEMORY_DB.sql.prepare('INSERT INTO atlas_bills(id,title,title_key,amount_minor,currency,recurrence,start_date,anchor_day,anchor_month,revision,archived,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,?,?,?,?,1,0,?,?,?)').run(`seed-bill-${String(index).padStart(16,'0')}`,`Seed ${index}`,`seed ${index}`,100,'TRY','monthly','2026-10-15',15,10,now.toISOString(),now.toISOString(),`seed-operation-${index}`);}

test('bill routing recognizes explicit commands and exact full approval only',()=>{
 for(const text of ['Faturalarımı göster','Aboneliklerimi aç','Yaklaşan ödemelerim','Bu ay sabit giderlerim ne','İnternet faturasını ödedim','İnternet faturam her ayın15inde450lira'])assert.ok(billsCommand(text),text);
 assert.deepEqual(billsCommand('Ödeme kaydını onaylıyorum.'),{action:'confirm'});
 for(const text of ['merhaba','evet','Ödeme kaydını onaylıyorum demem mi gerekiyor','İnternet faturaları pahalı','Bu faturayı ödemeli miyim'])assert.equal(billsCommand(text),null,text);
});

test('new plans are read-only previews until full phrase plus signed explicit confirmation',async()=>{
 const env=environment(),r=await draft(plan(),env);
 assert.equal(r.status,200);assert.equal(r.billsDraft.kind,'bills');assert.equal(count(env,'atlas_bills'),0);assert.equal(count(env,'atlas_bill_operations'),0);assert.equal(count(env,'atlas_expenses'),0);
 assert.equal((await approve(r,env,now,'evet')).status,400);
 assert.equal((await command('Ödeme kaydını onaylıyorum',env)).status,400);
 assert.equal((await billsRequest({billsConfirmation:{token:r.billsDraft.token,confirmed:true}},env,now)).status,400);
 assert.equal((await billsRequest({messages:[{role:'user',text:'Ödeme kaydını onaylıyorum'},{role:'assistant',text:'Tamam'}],billsConfirmation:{token:r.billsDraft.token,confirmed:true}},env,now)).status,400);
 assert.equal((await billsRequest({messages:[{role:'user',text:'Ödeme kaydını onaylıyorum'}],billsConfirmation:{token:r.billsDraft.token,confirmed:false}},env,now)).status,400);
 assert.equal((await billsRequest({messages:[{role:'user',text:'Ödeme kaydını onaylıyorum'}],billsConfirmation:{token:r.billsDraft.token,confirmed:true,paidAmount:'1'}},env,now)).status,400);
 assert.equal((await billsRequest({billsDraftRequest:plan(),billsConfirmation:{token:r.billsDraft.token,confirmed:true}},env,now)).status,400);
 const saved=await approve(r,env,now,'Ödeme kaydını onaylıyorum.');assert.equal(saved.status,200);assert.equal(saved.billItems[0].revision,1);assert.equal(saved.billItems[0].amount_minor,45000);
 const secondDevice={...env};assert.equal((await approve(r,secondDevice)).billsSaved.id,saved.billsSaved.id);assert.equal(count(env,'atlas_bills'),1);assert.equal(count(env,'atlas_bill_operations'),1);
});

test('voice monthly forms preserve exact money and choose the next Istanbul due date',async()=>{
 const env=environment();
 for(const text of ['İnternet faturam her ayın 15inde 450 lira','İnternet faturam her ayın15inde450lira','İnternet faturam her ayın 15’inde 450tl','İnternet faturam her ay 15 450 TRY']){
  const r=await command(text,env);assert.equal(r.status,200,text);assert.equal(r.billsDraft.amount_minor,45000);assert.equal(r.billsDraft.date,'2026-11-15');assert.equal(r.billsDraft.anchorDay,15);assert.equal(r.billsDraft.title,'İnternet faturam');
 }
 const foreign=await command('Servis aboneliğim her ayın 31inde 10,25 dolar',env);assert.equal(foreign.billsDraft.amount_minor,1025);assert.equal(foreign.billsDraft.currency,'USD');
 for(const text of ['İnternet faturam her ayın 0ında 450 lira','İnternet faturam her ayın 32inde 450 lira','İnternet faturam her ayın 15inde -450 lira','İnternet faturam her ayın 15inde 1.000 lira','İnternet faturam her ayın 15inde 1 200 lira','İnternet faturam her ayın 15inde 450 lira ve 500 lira','İnternet faturam her ayın 15450lira'])assert.equal((await command(text,env)).status,400,text);
 assert.equal(count(env,'atlas_bills'),0);
});

test('invalid form input, decimal ambiguity and conflicting fields cannot create plans',async()=>{
 const env=environment();
 for(const [value,cents] of [['0.01',1],['1,1',110],['45.50',4550],['999999999.99',99999999999]])assert.equal((await draft(plan({amount:value}),env)).billsDraft.amount_minor,cents);
 for(const value of ['0','-1','+1','1e2','1.000','1,000','1.234,50','1 000','1.','1000000000',1,null])assert.equal((await draft(plan({amount:value}),env)).status,400,String(value));
 for(const extra of [{currency:'GBP'},{recurrence:'daily'},{date:'2027-02-29'},{date:'2026-2-15'},{date:'1999-12-31'},{date:'2101-01-01'},{title:''},{title:'x'.repeat(201)},{title:'bad\ncontrol'},{anchorDay:31,date:'2026-10-15'},{amount_minor:123},{foo:'bar'},{id:crypto.randomUUID()},{dueDate:'2026-10-15'}])assert.equal((await draft(plan(extra),env)).status,400,JSON.stringify(extra));
 const input=plan();delete input.amount;input.amount_minor=123;assert.equal((await draft(input,env)).billsDraft.amount_minor,123);
 assert.equal(count(env,'atlas_bills'),0);
});

test('monthly 31 anchors clamp in February and recover in March without automatic writes',async()=>{
 const env=environment(),at=new Date('2027-02-01T10:00:00Z');
 const bill=await create(env,{date:'2027-01-31'},at),before=count(env,'atlas_bill_operations');
 const feb=await readBills(env,at);assert.equal(feb.billItems[0].nextDueDate,'2027-02-28');assert.equal(feb.billItems[0].nextUnpaidDueDate,'2027-01-31');assert.equal(feb.billOverdueItems[0].due_date,'2027-01-31');
 assert.deepEqual(feb.billUpcomingItems.map(p=>p.due_date),['2027-02-28']);
 const march=await readBills(env,new Date('2027-03-01T10:00:00Z'));assert.equal(march.billItems[0].nextDueDate,'2027-03-31');assert.equal(march.billItems[0].anchor_day,31);
 const draftPay=await draft({action:'pay',id:bill.id,dueDate:'2027-02-28'},env,at);assert.equal(draftPay.status,200);
 assert.equal((await draft({action:'pay',id:bill.id,dueDate:'2027-03-28'},env,at)).status,400);
 assert.equal(count(env,'atlas_bill_operations'),before);assert.equal(count(env,'atlas_expenses'),0);
});

test('yearly leap anniversaries clamp and recover, and one-time dates never repeat',async()=>{
 const env=environment();await create(env,{title:'Yıllık',recurrence:'yearly',date:'2028-02-29'});await create(env,{title:'Tek sefer',recurrence:'once',date:'2026-10-30'});
 const next=await readBills(env,new Date('2029-02-01T10:00:00Z'));assert.equal(next.billItems.find(b=>b.title==='Yıllık').nextDueDate,'2029-02-28');assert.equal(next.billItems.find(b=>b.title==='Tek sefer').nextDueDate,null);
 const leap=await readBills(env,new Date('2032-02-01T10:00:00Z'));assert.equal(leap.billItems.find(b=>b.title==='Yıllık').nextDueDate,'2032-02-29');
});

test('Istanbul midnight controls payment date, month totals and voice month rollover',async()=>{
 const env=environment(),at=new Date('2026-12-31T21:01:00Z');
 const r=await command('İnternet faturam her ayın 1inde 450 lira',env,at);assert.equal(r.billsDraft.date,'2027-01-01');
 const saved=await approve(r,env,at),bill=saved.billItems[0];const p=await draft({action:'pay',id:bill.id},env,at);assert.equal(p.billsDraft.paidDate,'2027-01-01');
 const paid=await approve(p,env,at);assert.equal(paid.billPaymentItems[0].paid_date,'2027-01-01');assert.deepEqual(paid.billPeriod,{from:'2027-01-01',to:'2027-01-31'});
});

test('paid statement only previews exact due date, date, amount and expense before confirmation',async()=>{
 const env=environment();await create(env);const r=await command('İnternet faturasını ödedim',env);
 assert.equal(r.billsDraft.action,'pay');assert.equal(r.billsDraft.dueDate,'2026-10-15');assert.equal(r.billsDraft.paidDate,'2026-10-25');assert.equal(r.billsDraft.paidAmount_minor,45000);
 assert.match(r.text,/450,00 TRY/);assert.match(r.text,/Bankaya erişilmez ve para gönderilmez/);assert.match(r.text,/harcama kaydı/);
 assert.equal(count(env,'atlas_bill_payments'),0);assert.equal(count(env,'atlas_expenses'),0);
 const saved=await approve(r,env);assert.equal(saved.status,200);assert.equal(count(env,'atlas_bill_payments'),1);assert.equal(count(env,'atlas_expenses'),1);
 const payment=saved.billPaymentItems[0],expense=env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_expenses').get();
 assert.equal(payment.expense_id,expense.id);assert.equal(payment.amount_minor,expense.amount_minor);assert.equal(payment.paid_date,expense.spent_day);assert.equal(expense.category,'fatura');assert.equal(expense.draft_id,'bill-payment:'+saved.billsSaved.id);assert.equal(payment.expenseEdited,false);
 assert.equal(saved.billItems[0].nextUnpaidDueDate,'2026-11-15');assert.equal(saved.billMonthlyTotals[0].unpaid_minor,0);assert.equal(saved.billMonthlyTotals[0].paid_minor,45000);
});

test('actual payment amount and date can be changed in a new signed preview',async()=>{
 const env=environment(),bill=await create(env),r=await draft({action:'pay',id:bill.id,dueDate:'2026-10-15',paidAmount:'475.25',paidDate:'2026-10-20'},env);
 assert.equal(r.billsDraft.amount_minor,45000);assert.equal(r.billsDraft.paidAmount_minor,47525);assert.match(r.text,/475,25 TRY/);assert.match(r.text,/2026-10-20/);
 await approve(r,env);const p=env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_bill_payments').get();assert.equal(p.amount_minor,47525);assert.equal(p.planned_amount_minor,45000);assert.equal(p.paid_date,'2026-10-20');
});

test('invalid actual payments never silently fall back to a planned amount or future date',async()=>{
 const env=environment(),bill=await create(env);
 for(const extra of [{paidAmount:'-1'},{paidAmount:'0'},{paidAmount:'1.000'},{paidAmount:10},{paidAmount:'1',paidAmount_minor:100},{paidDate:'2026-10-26'},{paidDate:'2026-02-30'},{paidDate:null},{dueDate:null},{dueDate:'2026-10-16'},{amount:'-1'},{currency:'USD'},{title:'Changed'}])assert.equal((await draft({action:'pay',id:bill.id,...extra},env)).status,400,JSON.stringify(extra));
 for(const extra of [{title:null},{currency:null},{date:null},{recurrence:null},{anchorDay:null},{anchorMonth:null}])assert.equal((await draft({action:'edit',id:bill.id,amount:'500',...extra},env)).status,400,JSON.stringify(extra));
 assert.equal(count(env,'atlas_bill_payments'),0);assert.equal(count(env,'atlas_expenses'),0);
});

test('duplicate previews, replay and simultaneous approvals create only one linked expense',async()=>{
 const env=environment(),bill=await create(env),a=await draft({action:'pay',id:bill.id,dueDate:'2026-10-15'},env),b=await draft({action:'pay',id:bill.id,dueDate:'2026-10-15'},env);
 const saved=await Promise.all([approve(a,env),approve(b,{...env})]);assert.ok(saved.every(r=>r.status===200),JSON.stringify(saved));assert.equal(saved[0].billsSaved.id,saved[1].billsSaved.id);
 await approve(a,env);await approve(b,env);assert.equal(count(env,'atlas_bill_payments'),1);assert.equal(count(env,'atlas_expenses'),1);assert.equal(count(env,'atlas_bill_operations'),2);
 assert.equal((await draft({action:'pay',id:bill.id,dueDate:'2026-10-15'},env)).status,409);
});

test('same title ambiguity requires an exact record and never guesses a substring match',async()=>{
 const env=environment();await create(env);await create(env,{title:'İnternet faturası'});
 const ambiguous=await command('İnternet faturasını ödedim',env);assert.equal(ambiguous.status,409);assert.match(ambiguous.text,/tam kayıt numarası/);
 assert.equal((await command('Net faturasını ödedim',env)).status,404);
 assert.equal(count(env,'atlas_expenses'),0);
 const id=(await readBills(env,now)).billItems[0].id;assert.equal((await command(`Fatura ${id} ödedim`,env)).billsDraft.id,id);
});

test('signed tokens reject tampering, expiry, future issue, wrong purpose and malformed payloads',async()=>{
 const env=environment(),r=await draft(plan(),env),send=token=>billsRequest({messages:[{role:'user',text:'Ödeme kaydını onaylıyorum'}],billsConfirmation:{confirmed:true,token}},env,now);
 for(const token of ['bad',r.billsDraft.token.slice(0,-4)+'AAAA'])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);
 const payload=await verifyDraft(env,r.billsDraft.token,'bills',now);
 assert.equal((await send(await signDraft(env,'daily',payload,now))).status,409);
 for(const data of [{...payload,action:'delete'},{...payload,id:'1'},{...payload,expectedRevision:2},{...payload,after:{...payload.after,amount_minor:-1}},{...payload,after:{...payload.after,start_date:'2026-02-30'}},{...payload,after:{...payload.after,archived:1}}])assert.equal((await send(await signDraft(env,'bills',data,now))).status,409);
 assert.equal(count(env,'atlas_bills'),0);
});

test('plan edits preserve immutable historical payments and linked expenses',async()=>{
 const env=environment(),bill=await create(env);await change(env,{action:'pay',id:bill.id});
 const before=env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_bill_payments').get(),expenseBefore=env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_expenses').get();
 const edited=await change(env,{action:'edit',id:bill.id,title:'Yeni internet',amount:'600',currency:'USD',date:'2026-11-30'});
 assert.equal(edited.billItems[0].amount_minor,60000);assert.equal(edited.billItems[0].nextDueDate,'2026-11-30');assert.equal(edited.billItems[0].anchor_day,30);
 assert.deepEqual(env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_bill_payments').get(),before);assert.deepEqual(env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_expenses').get(),expenseBefore);
 assert.throws(()=>env.MEMORY_DB.sql.exec('UPDATE atlas_bill_payments SET amount_minor=1'),/immutable/);assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_bill_payments'),/immutable/);
});

test('expense corrections are allowed and exposed separately from original payment declarations',async()=>{
 const env=environment(),bill=await create(env);await change(env,{action:'pay',id:bill.id});
 env.MEMORY_DB.sql.exec("UPDATE atlas_expenses SET amount_minor=47525,currency='EUR',spent_day='2026-10-20',title='Düzeltilmiş kayıt',revision=revision+1");
 const read=await readBills(env,now),p=read.billPaymentItems[0];assert.equal(p.expenseEdited,true);assert.equal(p.amount_minor,45000);assert.equal(p.currency,'TRY');assert.equal(p.paid_date,'2026-10-25');assert.equal(p.expense_amount_minor,47525);assert.equal(p.expense_currency,'EUR');assert.equal(p.expense_spent_day,'2026-10-20');assert.equal(read.billMonthlyTotals[0].paid_minor,45000);assert.match(read.billTotalsScope,/ilk ödeme beyanları/);
});

test('archive and restore are signed changes with no deletion or payment side effects',async()=>{
 const env=environment(),bill=await create(env),r=await draft({action:'archive',id:bill.id},env);
 assert.equal((await readBills(env,now)).billItems.length,1);const archived=await approve(r,env);assert.equal(archived.billItems.length,0);assert.equal(archived.archivedBillItems.length,1);assert.equal(archived.billMonthlyTotals.length,0);assert.equal(archived.billUpcomingItems.length,0);
 assert.equal((await draft({action:'pay',id:bill.id},env)).status,400);assert.equal((await draft({action:'archive',id:bill.id},env)).status,400);
 const restored=await change(env,{action:'restore',id:bill.id});assert.equal(restored.billItems.length,1);assert.equal(restored.billItems[0].start_date,'2026-10-15');assert.equal(count(env,'atlas_expenses'),0);assert.equal(count(env,'atlas_bills'),1);
});

test('stale edits and payments reject changed revisions and full state without silently re-previewing',async()=>{
 const env=environment(),bill=await create(env),pay=await draft({action:'pay',id:bill.id},env),edit=await draft({action:'edit',id:bill.id,amount:'500'},env);
 await change(env,{action:'edit',id:bill.id,title:'Yeni başlık'});assert.equal((await approve(pay,env)).status,409);assert.equal((await approve(edit,env)).status,409);assert.equal(count(env,'atlas_expenses'),0);
 const current=await draft({action:'pay',id:bill.id},env);env.MEMORY_DB.sql.prepare('UPDATE atlas_bills SET anchor_day=16,start_date=? WHERE id=?').run('2026-10-16',bill.id);
 assert.equal((await approve(current,env)).status,409);assert.equal(count(env,'atlas_bill_payments'),0);
});

test('state changing after the preflight read is checked again within the atomic write',async()=>{
 const env=environment(),bill=await create(env),r=await draft({action:'pay',id:bill.id},env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_bill_operations')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('UPDATE atlas_bills SET amount_minor=50000 WHERE id=?').run(bill.id);}return original(query);};
 assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_bill_payments'),0);assert.equal(count(env,'atlas_expenses'),0);assert.equal(count(env,'atlas_bill_operations'),1);
});

test('expense capacity failure rolls back journal, payment and bill revision, including a write race',async()=>{
 const env=environment(),bill=await create(env),r=await draft({action:'pay',id:bill.id},env);for(let i=0;i<499;i++)seedExpense(env,i);
 const original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_bill_operations')&&!injected){injected=true;seedExpense(env,499);}return original(query);};
 const result=await approve(r,env);assert.equal(result.status,409);assert.match(result.text,/500 kayıt/);assert.equal(count(env,'atlas_expenses'),500);assert.equal(count(env,'atlas_bill_payments'),0);assert.equal(count(env,'atlas_bill_operations'),1);assert.equal((await readBills(env,now)).billItems[0].revision,1);
});

test('a failing ledger insert rolls back the preceding expense insert and journal statement',async()=>{
 const env=environment(),bill=await create(env),r=await draft({action:'pay',id:bill.id},env);
 env.MEMORY_DB.sql.exec("CREATE TRIGGER test_fail_payment BEFORE INSERT ON atlas_bill_payments BEGIN SELECT RAISE(ABORT,'forced ledger failure'); END");
 assert.equal((await approve(r,env)).status,503);assert.equal(count(env,'atlas_expenses'),0);assert.equal(count(env,'atlas_bill_payments'),0);assert.equal(count(env,'atlas_bill_operations'),1);assert.equal((await readBills(env,now)).billItems[0].revision,1);
});

test('100-record cap includes archived plans; existing approval replay survives a full table',async()=>{
 const env=environment(),r=await draft(plan(),env);await approve(r,env);for(let i=1;i<100;i++)seedBill(env,i);
 const limit=await approve(await draft(plan({title:'Overflow'}),env),env);assert.equal(limit.status,409);assert.match(limit.text,/100 fatura/);assert.equal(count(env,'atlas_bills'),100);
 assert.equal((await approve(r,env)).status,200);assert.equal(count(env,'atlas_bill_operations'),1);
});

test('currency totals separate current planned dues, unpaid dues and original payment month',async()=>{
 const env=environment(),a=await create(env,{amount:'0.10',date:'2026-10-28'});await create(env,{title:'USD',amount:'12.34',currency:'USD',date:'2026-10-30'});await create(env,{title:'EUR',amount:'5',currency:'EUR',date:'2026-11-01'});
 await change(env,{action:'pay',id:a.id,dueDate:'2026-10-28',paidDate:'2026-10-25',paidAmount:'0.20'});
 const read=await readBills(env,now);assert.deepEqual(read.billMonthlyTotals,[{currency:'TRY',expected_minor:10,unpaid_minor:0,paid_minor:20},{currency:'USD',expected_minor:1234,unpaid_minor:1234,paid_minor:0}]);assert.deepEqual(read.billUpcomingTotals,[{currency:'EUR',amount_minor:500},{currency:'USD',amount_minor:1234}]);
 const before=count(env,'atlas_bill_operations');for(const text of ['Faturalarımı göster','Yaklaşan ödemelerim','Bu ay sabit giderlerim ne'])assert.equal((await command(text,env)).status,200);assert.equal(count(env,'atlas_bill_operations'),before);
});

test('literal markup and SQL-like titles remain data; unavailable stores fail closed',async()=>{
 const env=environment(),title="x'); DROP TABLE atlas_expenses; -- <img src=x onerror=alert(1)>";await create(env,{title});assert.equal((await readBills(env,now)).billItems[0].title,title);assert.equal(count(env,'atlas_expenses'),0);
 assert.equal(await command('Merhaba',{}),null);assert.equal((await command('Faturalarımı göster',{})).status,503);assert.equal((await readBills({},now)).status,503);
 env.MEMORY_DB.sql.exec('DROP TABLE atlas_bill_payments');assert.equal((await readBills(env,now)).status,503);
});
