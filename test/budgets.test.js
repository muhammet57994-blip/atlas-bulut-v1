import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {budgetsCommand,budgetsRequest,readBudgets} from '../src/budgets.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T10:00:00Z');
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}};
}
const environment=()=>({MEMORY_DB:database(),SESSION_SECRET:'test-budget-secret-at-least-thirty-two-characters'});
const command=(text,env,at=now)=>budgetsRequest({messages:[{role:'user',text}]},env,at);
const draft=(input,env,at=now)=>budgetsRequest({budgetDraftRequest:input},env,at);
const approve=(r,env,at=now,text='Bütçe değişikliğini onaylıyorum')=>budgetsRequest({messages:[{role:'user',text}],budgetConfirmation:{token:r.budgetDraft.token,confirmed:true}},env,at);
const count=(env,table)=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
const plan=(extra={})=>({action:'create',month:'2026-10',category:'market',amount:'5000',currency:'TRY',...extra});
async function create(env,input={},at=now){const r=await draft(plan(input),env,at);assert.ok(r.budgetDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved.budgetAllItems.find(i=>i.id===saved.budgetSaved.budget_id);}
async function change(env,input,at=now){const r=await draft(input,env,at);assert.ok(r.budgetDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved;}
function expense(env,{amount_minor=10000,currency='TRY',category='market',spent_day='2026-10-25',archived_at=null}={}){
 return env.MEMORY_DB.sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at,archived_at) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'Harcama',amount_minor,currency,category,spent_day,now.toISOString(),archived_at).lastInsertRowid;
}
function seedBudget(env,index){
 const month=`${2000+Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;
 env.MEMORY_DB.sql.prepare('INSERT INTO atlas_budgets(id,month,category,amount_minor,currency,archived,revision,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,1,1,?,?,?)').run(`seed-budget-${String(index).padStart(16,'0')}`,month,'market',100,'TRY',now.toISOString(),now.toISOString(),`seed-operation-${index}`);
}

test('budget routing handles required voice phrases, reads and precise approval',()=>{
 for(const text of ['Bu ay market için 5000 lira bütçe ayır','Bu ay yemek için 4000 TL sınır koy','Bütçelerimi göster','Market bütçemden ne kadar kaldı?','Gelecek ay bütçelerimi göster','2028-02 bütçelerimi göster'])assert.ok(budgetsCommand(text),text);
 assert.deepEqual(budgetsCommand('Bütçe değişikliğini onaylıyorum.'),{action:'confirm'});
 assert.equal(budgetsCommand('merhaba'),null);assert.equal(budgetsCommand('evet'),null);
});

test('previews never write; latest actual user exact phrase and signed explicit consent are required',async()=>{
 const env=environment(),r=await draft(plan(),env);assert.equal(r.status,200);assert.equal(r.budgetDraft.kind,'budget');assert.equal(r.budgetDraft.before,null);assert.deepEqual(r.budgetDraft.after,{month:'2026-10',category:'market',amount_minor:500000,currency:'TRY',archived:0});
 assert.equal(count(env,'atlas_budgets'),0);assert.equal(count(env,'atlas_budget_operations'),0);assert.equal(count(env,'atlas_expenses'),0);
 for(const text of ['evet','onaylıyorum','Bütçe değişikliğini onaylıyorum ama 6000 olsun'])assert.equal((await approve(r,env,now,text)).status,400);
 assert.equal((await command('Bütçe değişikliğini onaylıyorum',env)).status,400);
 for(const body of [
  {budgetConfirmation:{token:r.budgetDraft.token,confirmed:true}},
  {messages:[{role:'assistant',text:'Bütçe değişikliğini onaylıyorum'}],budgetConfirmation:{token:r.budgetDraft.token,confirmed:true}},
  {messages:[{role:'user',text:'Bütçe değişikliğini onaylıyorum'},{role:'assistant',text:'Tamam'}],budgetConfirmation:{token:r.budgetDraft.token,confirmed:true}},
  {messages:[{role:'user',text:'Bütçe değişikliğini onaylıyorum'}],budgetConfirmation:{token:r.budgetDraft.token,confirmed:false}},
  {messages:[{role:'user',text:'Bütçe değişikliğini onaylıyorum'}],budgetConfirmation:{token:r.budgetDraft.token,confirmed:true,amount:'1'}},
  {budgetDraftRequest:plan(),budgetConfirmation:{token:r.budgetDraft.token,confirmed:true}},
  {budgetReadRequest:{month:'2026-10'},budgetDraftRequest:plan()}
 ])assert.equal((await budgetsRequest(body,env,now)).status,400);
 const saved=await approve(r,env,now,'Bütçe değişikliğini onaylıyorum.');assert.equal(saved.status,200);assert.equal(saved.budgetItems[0].revision,1);assert.equal(count(env,'atlas_budgets'),1);
});

test('voice numeric money and explicit month are preserved without guessing',async()=>{
 const env=environment();
 for(const [text,month,cents,currency,category] of [
  ['Bu ay market için 5000 lira bütçe ayır','2026-10',500000,'TRY','market'],
  ['Bu ay yemek için 4000 TL sınır koy','2026-10',400000,'TRY','yemek'],
  ['Gelecek ay ulaşım için 125,50 dolar bütçe ayır','2026-11',12550,'USD','ulaşım'],
  ['2028-02 için fatura için 12.50 EUR bütçe belirle','2028-02',1250,'EUR','fatura'],
  ['Önümüzdeki ay diğer için 0,01 avro bütçe ayır','2026-11',1,'EUR','diğer']
 ]){const r=await command(text,env);assert.equal(r.status,200,text);assert.equal(r.budgetDraft.month,month);assert.equal(r.budgetDraft.amount_minor,cents);assert.equal(r.budgetDraft.currency,currency);assert.equal(r.budgetDraft.category,category);assert.match(r.text,new RegExp(month));}
 for(const text of ['Market için 5000 lira bütçe ayır','Bu ay market için 5000 bütçe ayır','Bu ay market için 5.000 lira bütçe ayır','Bu ay market için 5,000 lira bütçe ayır','Bu ay market için -5000 TL bütçe ayır','Bu ay eğlence için 5000 TL bütçe ayır','Bu ay market için beş bin lira bütçe ayır','Bu ay market için 100 lira ve yemek için 200 lira bütçe ayır'])assert.equal((await command(text,env)).status,400,text);
 assert.equal(count(env,'atlas_budget_operations'),0);
});

test('forms reject malformed amounts, invalid periods and all unknown/conflicting fields',async()=>{
 const env=environment();
 for(const [value,cents] of [['5000',500000],['5000,00',500000],['0.01',1],['1,1',110],['999999999.99',99999999999]])assert.equal((await draft(plan({amount:value}),env)).budgetDraft.amount_minor,cents);
 for(const amount of ['0','-1','+1','1e2','5.000','5,000','5.000,00','5 000','1.','1000000000',5,null])assert.equal((await draft(plan({amount}),env)).status,400,String(amount));
 for(const extra of [{month:'2026-13'},{month:'2026-1'},{month:'1999-12'},{month:'2101-01'},{month:null},{category:'gıda'},{currency:'GBP'},{amount_minor:123},{foo:true},{id:crypto.randomUUID()},{archived:1},{action:'delete'}])assert.equal((await draft(plan(extra),env)).status,400,JSON.stringify(extra));
 const input=plan();delete input.amount;input.amount_minor=123;assert.equal((await draft(input,env)).budgetDraft.amount_minor,123);delete input.month;assert.equal((await draft(input,env)).status,400);
 assert.equal(count(env,'atlas_budgets'),0);
});

test('token tamper, expiry, future issue, purpose confusion and invalid signed state fail closed',async()=>{
 const env=environment(),r=await draft(plan(),env),send=token=>budgetsRequest({messages:[{role:'user',text:'Bütçe değişikliğini onaylıyorum'}],budgetConfirmation:{token,confirmed:true}},env,now);
 for(const token of ['bad',r.budgetDraft.token.slice(0,-4)+'AAAA'])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);
 const payload=await verifyDraft(env,r.budgetDraft.token,'budget',now);assert.equal((await send(await signDraft(env,'daily',payload,now))).status,409);
 for(const data of [{...payload,action:'delete'},{...payload,id:'1'},{...payload,expectedRevision:1},{...payload,foo:true},{...payload,after:{...payload.after,month:'2026-13'}},{...payload,after:{...payload.after,amount_minor:-1}},{...payload,after:{...payload.after,archived:1}},{...payload,after:{...payload.after,extra:1}}])assert.equal((await send(await signDraft(env,'budget',data,now))).status,409);
 assert.equal(count(env,'atlas_budgets'),0);
});

test('approval replay and same-token concurrent approvals apply once across devices',async()=>{
 const env=environment(),r=await draft(plan(),env),results=await Promise.all([approve(r,env),approve(r,{...env})]);assert.ok(results.every(x=>x.status===200),JSON.stringify(results));assert.equal(results[0].budgetSaved.id,results[1].budgetSaved.id);
 assert.equal((await approve(r,env)).status,200);assert.equal(count(env,'atlas_budgets'),1);assert.equal(count(env,'atlas_budget_operations'),1);
});

test('competing create previews cannot create two budgets for the same exact bucket',async()=>{
 const env=environment(),a=await draft(plan(),env),b=await draft(plan({amount:'6000'}),env),results=await Promise.all([approve(a,env),approve(b,env)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(count(env,'atlas_budgets'),1);assert.equal(count(env,'atlas_budget_operations'),1);
 assert.equal((await draft(plan(),env)).status,409);
});

test('live actual spending, remaining, progress and overruns are correct with currency isolation',async()=>{
 const env=environment();await create(env,{amount:'100'});await create(env,{category:'yemek',amount:'100'});await create(env,{currency:'USD',amount:'50'});
 expense(env,{amount_minor:13000});expense(env,{category:'yemek',amount_minor:2000});expense(env,{currency:'USD',amount_minor:1000});expense(env,{currency:'EUR',amount_minor:700});expense(env,{category:'ulaşım',amount_minor:900});expense(env,{spent_day:'2026-09-30',amount_minor:99000});
 const r=await readBudgets(env,now),market=r.budgetItems.find(i=>i.category==='market'&&i.currency==='TRY');assert.equal(market.spent_minor,13000);assert.equal(market.remaining_minor,0);assert.equal(market.overrun_minor,3000);assert.equal(market.progress_percent,130);
 assert.deepEqual(r.budgetSummary,[{currency:'EUR',limit_minor:0,spent_minor:700,budgeted_spent_minor:0,unbudgeted_spent_minor:700,remaining_minor:0,overrun_minor:0},{currency:'TRY',limit_minor:20000,spent_minor:15900,budgeted_spent_minor:15000,unbudgeted_spent_minor:900,remaining_minor:8000,overrun_minor:3000},{currency:'USD',limit_minor:5000,spent_minor:1000,budgeted_spent_minor:1000,unbudgeted_spent_minor:0,remaining_minor:4000,overrun_minor:0}]);
 assert.equal(r.budgetUnbudgetedItems.length,2);assert.equal(r.budgetItems.length,3);assert.equal((await command('Market bütçemden ne kadar kaldı?',env)).text.includes('USD'),true);assert.match(r.budgetTotalsScope,/birleştirilmez veya dönüştürülmez/);
});

test('expense corrections update category, amount, currency and month immediately',async()=>{
 const env=environment();await create(env,{amount:'100'});await create(env,{category:'yemek',currency:'EUR',amount:'200'});const id=expense(env,{amount_minor:2500});
 assert.equal((await readBudgets(env,now)).budgetItems.find(i=>i.category==='market').spent_minor,2500);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_expenses SET amount_minor=7500,category=?,currency=?,revision=revision+1 WHERE id=?').run('yemek','EUR',id);
 let r=await readBudgets(env,now);assert.equal(r.budgetItems.find(i=>i.category==='market').spent_minor,0);assert.equal(r.budgetItems.find(i=>i.category==='yemek').spent_minor,7500);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_expenses SET spent_day=?,revision=revision+1 WHERE id=?').run('2026-11-01',id);
 r=await readBudgets(env,now);assert.equal(r.budgetItems.find(i=>i.category==='yemek').spent_minor,0);const november=await readBudgets(env,now,'2026-11');assert.equal(november.budgetItems.length,0);assert.equal(november.budgetUnbudgetedItems[0].spent_minor,7500);
 assert.equal(count(env,'atlas_budget_operations'),2);
});

test('archived expenses remain in actual ledger totals and do not release a budget',async()=>{
 const env=environment();await create(env,{amount:'100'});const id=expense(env,{amount_minor:12500});
 let r=await readBudgets(env,now);assert.equal(r.budgetItems[0].overrun_minor,2500);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_expenses SET archived_at=?,revision=revision+1 WHERE id=?').run(now.toISOString(),id);
 r=await readBudgets(env,now);assert.equal(r.budgetItems[0].spent_minor,12500);assert.equal(r.budgetItems[0].remaining_minor,0);assert.equal(r.budgetItems[0].overrun_minor,2500);assert.match(r.budgetArchivePolicy,/dönem toplamlarına dahildir/);
 env.MEMORY_DB.sql.prepare('UPDATE atlas_expenses SET archived_at=NULL,revision=revision+1 WHERE id=?').run(id);assert.equal((await readBudgets(env,now)).budgetItems[0].spent_minor,12500);
});

test('exact months handle leap days and never inherit a prior-month budget or remainder',async()=>{
 const env=environment(),at=new Date('2028-02-20T10:00:00Z');await create(env,{month:'2028-02',amount:'100'},at);expense(env,{amount_minor:2000,spent_day:'2028-02-29'});expense(env,{amount_minor:3000,spent_day:'2028-03-01'});expense(env,{amount_minor:4000,spent_day:'2028-01-31'});
 const feb=await readBudgets(env,at);assert.deepEqual(feb.budgetPeriod,{from:'2028-02-01',to:'2028-02-29'});assert.equal(feb.budgetItems[0].spent_minor,2000);assert.equal(feb.budgetItems[0].remaining_minor,8000);
 const march=await readBudgets(env,new Date('2028-02-29T21:00:00Z'));assert.equal(march.budgetMonth,'2028-03');assert.equal(march.budgetItems.length,0);assert.equal(march.budgetUnbudgetedItems[0].spent_minor,3000);assert.equal(march.budgetAllItems.length,1);assert.equal(count(env,'atlas_budget_operations'),1);
 assert.deepEqual((await readBudgets(env,now,'2027-02')).budgetPeriod,{from:'2027-02-01',to:'2027-02-28'});
});

test('Istanbul midnight anchors natural previews to their clearly signed exact month',async()=>{
 const env=environment(),at=new Date('2026-12-31T20:59:00Z'),r=await command('Bu ay market için 5000 lira bütçe ayır',env,at);assert.equal(r.budgetDraft.month,'2026-12');assert.match(r.text,/2026-12/);
 const next=await command('Gelecek ay market için 5000 lira bütçe ayır',env,at);assert.equal(next.budgetDraft.month,'2027-01');
 const saved=await approve(r,env,new Date('2026-12-31T21:01:00Z'));assert.equal(saved.budgetItems[0].month,'2026-12');assert.equal(saved.budgetMonth,'2026-12');
 assert.equal((await readBudgets(env,new Date('2026-12-31T21:01:00Z'))).budgetItems.length,0);assert.equal(count(env,'atlas_budgets'),1);
});

test('explicit reads are read-only and missing budget differs from zero spending',async()=>{
 const env=environment();await create(env,{amount:'100'});expense(env,{category:'diğer',amount_minor:10});const before=count(env,'atlas_budget_operations');
 for(const text of ['Bütçelerimi göster','Market bütçemden ne kadar kaldı?','Yemek bütçemden ne kadar kaldı?','Gelecek ay bütçelerimi göster'])assert.equal((await command(text,env)).status,200);
 assert.match((await command('Yemek bütçemden ne kadar kaldı?',env)).text,/aktif bütçe belirlenmemiş/);assert.match((await command('Market bütçemden ne kadar kaldı?',env)).text,/100,00 TRY kaldı/);
 const r=await budgetsRequest({budgetReadRequest:{month:'2026-09'}},env,now);assert.equal(r.budgetMonth,'2026-09');assert.equal(r.budgetItems.length,0);assert.equal(count(env,'atlas_budget_operations'),before);
 for(const input of [null,{},[],{month:'2026-13'},{month:'2026-10',currency:'TRY'}])assert.equal((await budgetsRequest({budgetReadRequest:input},env,now)).status,400);
});

test('budget edits and archive/restore are explicit previews and never mutate expenses',async()=>{
 const env=environment(),b=await create(env);expense(env,{amount_minor:15000});const before=env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_expenses').get();
 const edit=await draft({action:'edit',id:b.id,amount:'200'},env);assert.equal(edit.budgetDraft.before.amount_minor,500000);assert.equal(edit.budgetDraft.after.amount_minor,20000);assert.match(edit.text,/Önce:/);assert.match(edit.text,/Sonra:/);assert.equal((await readBudgets(env,now)).budgetItems[0].amount_minor,500000);
 let saved=await approve(edit,env);assert.equal(saved.budgetItems[0].amount_minor,20000);assert.equal(saved.budgetItems[0].revision,2);
 const archive=await draft({action:'archive',id:b.id},env);assert.equal((await readBudgets(env,now)).budgetItems.length,1);saved=await approve(archive,env);assert.equal(saved.budgetItems.length,0);assert.equal(saved.archivedBudgetItems.length,1);assert.equal(saved.budgetUnbudgetedItems[0].spent_minor,15000);
 assert.equal((await draft(plan(),env)).status,409);assert.equal((await draft({action:'archive',id:b.id},env)).status,400);assert.equal((await draft({action:'restore',id:b.id,amount:'1'},env)).status,400);
 saved=await change(env,{action:'restore',id:b.id});assert.equal(saved.budgetItems.length,1);assert.equal(saved.budgetItems[0].remaining_minor,5000);assert.deepEqual(env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_expenses').get(),before);
 assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_budgets'),/archive/);assert.throws(()=>env.MEMORY_DB.sql.exec('UPDATE atlas_budget_operations SET action=action'),/immutable/);assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_budget_operations'),/immutable/);
});

test('stale revisions and unversioned state changes both reject old edits',async()=>{
 const env=environment(),b=await create(env),edit=await draft({action:'edit',id:b.id,amount:'6000'},env),archive=await draft({action:'archive',id:b.id},env);
 await change(env,{action:'edit',id:b.id,amount:'7000'});assert.equal((await approve(edit,env)).status,409);assert.equal((await approve(archive,env)).status,409);
 const stale=await draft({action:'edit',id:b.id,amount:'8000'},env);env.MEMORY_DB.sql.prepare('UPDATE atlas_budgets SET amount_minor=1 WHERE id=?').run(b.id);assert.equal((await approve(stale,env)).status,409);assert.equal(count(env,'atlas_budget_operations'),2);
});

test('state changed after application preflight is rejected inside the atomic insert',async()=>{
 const env=environment(),b=await create(env),r=await draft({action:'edit',id:b.id,amount:'6000'},env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_budget_operations')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('UPDATE atlas_budgets SET amount_minor=1 WHERE id=?').run(b.id);}return original(query);};
 assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_budget_operations'),1);assert.equal((await readBudgets(env,now)).budgetItems[0].revision,1);
});

test('concurrent conflicting edits apply one approved state and refuse the other',async()=>{
 const env=environment(),b=await create(env),a=await draft({action:'edit',id:b.id,amount:'10'},env),c=await draft({action:'edit',id:b.id,amount:'20'},env),results=await Promise.all([approve(a,env),approve(c,env)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(count(env,'atlas_budget_operations'),2);assert.equal((await readBudgets(env,now)).budgetItems[0].revision,2);
});

test('duplicate edit buckets and failed triggers roll back the journal and budget revision',async()=>{
 const env=environment(),b=await create(env);await create(env,{category:'yemek'});assert.equal((await draft({action:'edit',id:b.id,category:'yemek'},env)).status,409);
 const r=await draft({action:'edit',id:b.id,amount:'1'},env);env.MEMORY_DB.sql.exec("CREATE TRIGGER test_budget_apply_failure BEFORE UPDATE ON atlas_budgets BEGIN SELECT RAISE(ABORT,'forced budget failure'); END");
 assert.equal((await approve(r,env)).status,503);assert.equal(count(env,'atlas_budget_operations'),2);assert.equal((await readBudgets(env,now)).budgetItems.find(i=>i.id===b.id).revision,1);
});

test('100-budget cap includes archived records and is enforced for write races',async()=>{
 const env=environment(),r=await draft(plan(),env);await approve(r,env);for(let i=0;i<98;i++)seedBudget(env,i);const overflow=await draft(plan({category:'yemek'}),env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_budget_operations')&&!injected){injected=true;seedBudget(env,98);}return original(query);};
 const result=await approve(overflow,env);assert.equal(result.status,409);assert.match(result.text,/100 bütçe/);assert.equal(count(env,'atlas_budgets'),100);assert.equal(count(env,'atlas_budget_operations'),1);assert.equal((await approve(r,env)).status,200);
});

test('5000-operation cap rejects further writes while existing replay remains idempotent',async()=>{
 const env=environment(),r=await draft(plan(),env);const saved=await approve(r,env),b=saved.budgetItems[0],state={month:b.month,category:b.category,amount_minor:b.amount_minor,currency:b.currency,archived:0};
 const insert=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_budget_operations(id,budget_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)');
 for(let i=1;i<5000;i++){const after={...state,amount_minor:state.amount_minor===500000?500001:500000};insert.run(`history-operation-${String(i).padStart(16,'0')}`,b.id,'edit',i,JSON.stringify(state),JSON.stringify(after),now.toISOString());Object.assign(state,after);}
 const next=await draft({action:'edit',id:b.id,amount:'6000'},env),result=await approve(next,env);assert.equal(result.status,409);assert.match(result.text,/5000/);assert.equal(count(env,'atlas_budget_operations'),5000);assert.equal((await readBudgets(env,now)).budgetItems[0].revision,5000);assert.equal((await approve(r,env)).status,200);
});

test('missing schema, invalid stored state and unavailable signing fail closed',async()=>{
 assert.equal(await command('Merhaba',{}),null);assert.equal((await command('Bütçelerimi göster',{})).status,503);assert.equal((await readBudgets({},now)).status,503);
 const env=environment();env.SESSION_SECRET='short';assert.equal((await draft(plan(),env)).status,503);assert.equal(count(env,'atlas_budget_operations'),0);
 env.MEMORY_DB.sql.exec('DROP TABLE atlas_budget_operations');assert.equal((await draft(plan(),env)).status,503);
 const empty=environment();empty.MEMORY_DB.sql.exec('DROP TABLE atlas_expenses');assert.equal((await readBudgets(empty,now)).status,503);
});
