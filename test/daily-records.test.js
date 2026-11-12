import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {dailyCommand,dailyRequest,readDaily} from '../src/daily-records.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T10:00:00Z');
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}};
}
function environment(){return {MEMORY_DB:database(),SESSION_SECRET:'test-daily-secret-at-least-thirty-two-characters'};}
const command=(text,env,at=now)=>dailyRequest({messages:[{role:'user',text}]},env,at);
const draft=(data,env,at=now)=>dailyRequest({dailyDraftRequest:data},env,at);
const approve=(r,env,at=now,text='Kaydı onaylıyorum')=>dailyRequest({messages:[{role:'user',text}],dailyConfirmation:{token:r.dailyDraft.token,confirmed:true}},env,at);
const agenda=(extra={})=>({kind:'agenda',title:'Müşteri araması',date:'2026-10-26',time:'15:00',durationMinutes:30,...extra});
const expense=(extra={})=>({kind:'expense',title:'Market',amount:'45,50',currency:'TRY',category:'market',date:'2026-10-25',...extra});
const count=(env,table)=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;

test('only recognized agenda and expense intents are routed; exact full confirmation',()=>{
 for(const text of ['Ajandamı aç','Ajandamı göster','Ajandamı oku','Bugünkü randevularım','Yarınki randevularım','Harcamalarımı göster','Bu ay market toplamım ne','Bu ay ne kadar harcadım'])assert.ok(dailyCommand(text),text);
 for(const text of ['Merhaba','Kaydı onaylıyorum diye söylemem mi gerekiyor','Randevular ne işe yarar','Geçen gün harcadığım parayı düşünüyorum'])assert.equal(dailyCommand(text),null,text);
 assert.deepEqual(dailyCommand('Kaydı onaylıyorum.'),{action:'confirm'});
});
test('voice agenda creates Istanbul preview only; explicit approval and duplicate replay',async()=>{
 const env=environment();
 const r=await command('Yarın saat 15.00’te müşteriyi aramayı hatırlat',env);
 assert.equal(r.status,200);assert.equal(r.dailyDraft.title,'müşteriyi aramayı');assert.equal(r.dailyDraft.date,'2026-10-26');assert.equal(r.dailyDraft.time,'15:00');assert.equal(r.dailyDraft.starts_at,Date.parse('2026-10-26T12:00:00Z'));
 assert.equal(count(env,'atlas_agenda'),0);
 assert.equal((await approve(r,env,now,'evet')).status,400);assert.equal(count(env,'atlas_agenda'),0);
 const saved=await approve(r,env,now,'Kaydı onaylıyorum.');assert.equal(saved.status,200);assert.equal(saved.dailySaved.kind,'agenda');assert.equal(count(env,'atlas_agenda'),1);
 assert.equal((await approve(r,env)).dailySaved.id,saved.dailySaved.id);assert.equal(count(env,'atlas_agenda'),1);
 const today=await command('Bugün 16.30’da kargoyu hatırlat',env);assert.equal(today.dailyDraft.time,'16:30');assert.equal(today.dailyDraft.title,'kargoyu');
 const iso=await command('2026-10-28 saat 14:00 toplantıyı hatırlat',env);assert.equal(iso.dailyDraft.date,'2026-10-28');assert.equal(iso.dailyDraft.title,'toplantıyı');
});
test('missing or invalid agenda date/time stays in agenda; past time is never rolled forward',async()=>{
 const env=environment();
 for(const text of ['Yarın müşteriyi aramayı hatırlat','Saat 15.00 müşteriyi hatırlat','Bugün yarın saat 15.00 ara hatırlat','2026-02-30 saat 15:00 toplantıyı hatırlat','Bugün saat 25:00 ara hatırlat','Bugün saat 12:00 ara hatırlat','Bugün saat 15:00 ve saat 16:00 toplantı hatırlat']){
  const r=await command(text,env);assert.equal(r.status,400,text);assert.equal(r.dailyOpen,'agenda');assert.ok(!r.dailyDraft);
 }
 assert.equal((await draft(agenda({durationMinutes:0}),env)).status,400);
 assert.equal((await draft(agenda({durationMinutes:1441}),env)).status,400);
 assert.equal(count(env,'atlas_agenda'),0);
});
test('Istanbul midnight, leap date and month/year rollover use real local calendar days',async()=>{
 const env=environment(),at=new Date('2026-12-31T21:01:00Z');
 const r=await command('Bugün saat 08.00 kahvaltıyı hatırlat',env,at);assert.equal(r.dailyDraft.date,'2027-01-01');
 const tomorrow=await command('Yarın saat 09.00 koşuyu hatırlat',env,at);assert.equal(tomorrow.dailyDraft.date,'2027-01-02');
 assert.equal((await draft(agenda({date:'2028-02-29'}),env)).status,200);
 assert.equal((await draft(agenda({date:'2027-02-29'}),env)).status,400);
 const spent=await command('Dün ulaşım için 45,50 lira harcadım',env,at);assert.equal(spent.dailyDraft.date,'2026-12-31');assert.equal(spent.dailyDraft.amount_minor,4550);
});
test('expense amounts stay exact integer cents; ambiguous, negative, zero and future values rejected',async()=>{
 const env=environment();
 for(const [value,cents] of [['420',42000],['45,50',4550],['0.01',1],['1,1',110],['999999999.99',99999999999]]){
  const r=await draft(expense({amount:value}),env);assert.equal(r.dailyDraft.amount_minor,cents,value);
 }
 for(const value of ['-1','0','1.000','1,000','1.234,50','1,234.50','2,345','1e2','NaN','Infinity','1 200','1000000000','1.'])assert.equal((await draft(expense({amount:value}),env)).status,400,value);
 assert.equal((await draft(expense({date:'2026-10-26'}),env)).status,400);
 assert.equal((await command('Yarın markete 420 lira harcadım',env)).status,400);
 assert.equal((await command('Bugün markete -420 lira harcadım',env)).status,400);
 for(const text of ['Bugün markete 1 200 lira harcadım','Gelecek hafta markete 420 lira harcadım','2026-2-30 markete 420 lira harcadım','Pazartesi markete 420 lira harcadım'])assert.equal((await command(text,env)).status,400,text);
 const r=await command('Bugün markete 420 lira harcadım',env);assert.equal(r.dailyDraft.amount_minor,42000);assert.equal(r.dailyDraft.category,'market');assert.equal(count(env,'atlas_expenses'),0);
 await approve(r,env);await approve(r,env);assert.equal(count(env,'atlas_expenses'),1);
});
test('monthly and category totals include all records but keep currencies separate; last30 display cap',async()=>{
 const env=environment();
 for(const [index,item] of [expense({amount:'0,10'}),expense({amount:'0.20'}),expense({amount:'12.34',currency:'USD'}),expense({amount:'5',currency:'EUR',category:'yemek'}),expense({amount:'999',date:'2026-09-30'})].entries()){
  const r=await draft({...item,title:`Harcama ${index}`},env);assert.equal((await approve(r,env)).status,200);
 }
 const r=await command('Bu ay ne kadar harcadım',env);assert.deepEqual(r.expenseTotals.map(x=>({...x})),[{currency:'EUR',amount_minor:500},{currency:'TRY',amount_minor:30},{currency:'USD',amount_minor:1234}]);assert.equal(r.expenseItems.length,4);assert.deepEqual(r.expensePeriod,{from:'2026-10-01',to:'2026-10-25'});
 const market=await command('Bu ay market toplamım ne',env);assert.equal(market.expenseItems.length,3);assert.ok(!market.expenseTotals.some(r=>r.currency==='EUR'));
 const insert=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) VALUES(?,?,?,?,?,?,?)');
 for(let n=0;n<40;n++)insert.run(`seed-${n}`,'Seed',1,'TRY','market','2026-10-25',now.toISOString());
 const snapshot=await readDaily(env,now);assert.equal(snapshot.expenseItems.length,30);assert.equal(snapshot.expenseTotals.find(r=>r.currency==='TRY').amount_minor,70);
});
test('approval rejects invalid, expired, tampered, cross-purpose and malformed signed tokens',async()=>{
 const env=environment(),r=await draft(expense(),env);
 assert.equal((await command('Kaydı onaylıyorum',env)).status,400);
 assert.equal((await dailyRequest({dailyConfirmation:{token:r.dailyDraft.token,confirmed:true}},env,now)).status,400);
 const send=token=>dailyRequest({messages:[{role:'user',text:'Kaydı onaylıyorum'}],dailyConfirmation:{token,confirmed:true}},env,now);
 assert.equal((await send('broken')).status,409);
 assert.equal((await send(r.dailyDraft.token.slice(0,-4)+'AAAA')).status,409);
 const later=new Date(now.getTime()+1800000);assert.equal((await approve(r,env,later)).status,409);
 const future=new Date(now.getTime()-1);assert.equal((await approve(r,env,future)).status,409);
 const payload=await verifyDraft(env,r.dailyDraft.token,'daily',now);
 assert.equal((await send(await signDraft(env,'focus',payload,now))).status,409);
 assert.equal((await send(await signDraft(env,'daily',{...payload,amount_minor:-5},now))).status,409);
 assert.equal((await dailyRequest({dailyConfirmation:{token:r.dailyDraft.token,confirmed:false}},env,now)).status,400);
 assert.equal((await dailyRequest({dailyDraftRequest:expense(),dailyConfirmation:{token:r.dailyDraft.token,confirmed:true}},env,now)).status,400);
 assert.equal(count(env,'atlas_expenses'),0);
});
test('agenda conflicts are previewed, checked again at approval, and never overwrite',async()=>{
 const env=environment();
 const first=await draft(agenda(),env),parallel=await draft(agenda({title:'İkinci görüşme',time:'15:15'}),env);
 assert.equal(first.dailyDraft.conflicts.length,0);assert.equal(parallel.dailyDraft.conflicts.length,0);
 await approve(first,env);const refresh=await approve(parallel,env);
 assert.equal(refresh.status,200);assert.equal(refresh.conflictChanged,true);assert.equal(refresh.dailyDraft.conflicts.length,1);assert.equal(count(env,'atlas_agenda'),1);
 assert.match(refresh.text,/çakış/);assert.notEqual(refresh.dailyDraft.token,parallel.dailyDraft.token);
 await approve(refresh,env);assert.equal(count(env,'atlas_agenda'),2);
 await approve(parallel,env);assert.equal(count(env,'atlas_agenda'),2);
 const adjacent=await draft(agenda({time:'15:45'}),env);assert.equal(adjacent.dailyDraft.conflicts.length,0);
});
test('agenda confirmation guards against conflicts inserted between recheck and write',async()=>{
 const env=environment(),r=await draft(agenda(),env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{
  if(query.startsWith('INSERT OR IGNORE INTO atlas_agenda')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)').run('concurrent-record','Başka cihaz',r.dailyDraft.starts_at,r.dailyDraft.ends_at,now.toISOString());}
  return original(query);
 };
 const refreshed=await approve(r,env);assert.equal(refreshed.conflictChanged,true);assert.equal(count(env,'atlas_agenda'),1);assert.equal(refreshed.dailyDraft.conflicts[0].title,'Başka cihaz');
});
test('bounded inserts enforce 200 agenda and 500 expense cap; existing approval replay survives full table',async()=>{
 const env=environment(),a=await draft(agenda(),env),e=await draft(expense(),env);await approve(a,env);await approve(e,env);
 const addAgenda=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)');
 for(let i=1;i<200;i++)addAgenda.run(`seed-agenda-${i}`,'Seed',Date.parse('2026-11-01T00:00:00Z')+i*3600000,Date.parse('2026-11-01T00:30:00Z')+i*3600000,now.toISOString());
 const addExpense=env.MEMORY_DB.sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) VALUES(?,?,?,?,?,?,?)');
 for(let i=1;i<500;i++)addExpense.run(`seed-expense-${i}`,'Seed',1,'TRY','diğer','2026-10-25',now.toISOString());
 assert.equal((await approve(await draft(agenda({time:'20:00'}),env),env)).status,409);assert.equal((await approve(await draft(expense({title:'Overflow'}),env),env)).status,409);
 assert.equal((await approve(a,env)).status,200);assert.equal((await approve(e,env)).status,200);assert.equal(count(env,'atlas_agenda'),200);assert.equal(count(env,'atlas_expenses'),500);
 assert.equal((await readDaily(env,now)).agendaItems.length,30);
});
test('titles are parameterized and preserve literal markup without SQL execution',async()=>{
 const env=environment(),title="x'); DROP TABLE atlas_expenses; -- <img src=x onerror=alert(1)>";
 const r=await draft(expense({title}),env);assert.equal(r.dailyDraft.title,title);await approve(r,env);assert.equal((await readDaily(env,now)).expenseItems[0].title,title);assert.equal(count(env,'atlas_expenses'),1);
 assert.equal((await draft(expense({title:'x'.repeat(201)}),env)).status,400);assert.equal((await draft(expense({title:'bad\ncontrol'}),env)).status,400);
});
test('missing or unmigrated DB safely reports unavailable only for recognized intent',async()=>{
 assert.equal((await command('Ajandamı aç',{})).status,503);assert.equal(await command('Merhaba',{}),null);
 assert.equal((await readDaily({},now)).status,503);
 const env=environment();env.MEMORY_DB.sql.exec('DROP TABLE atlas_expenses');assert.equal((await command('Harcamalarımı göster',env)).status,503);assert.equal((await readDaily(env,now)).status,503);
});
