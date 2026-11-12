import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {multiCommand,multiRequest} from '../src/multi-actions.js';
import {prepareDailyCreation} from '../src/daily-records.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';
import {createWorker} from '../src/worker.js';

const now=new Date('2026-10-25T10:00:00Z'),phrase='Seçtiğim işlemleri onaylıyorum';
const allText='Birlikte yap: yarın saat 15.00 toplantı ajandaya ekle; sunumu hazırlamayı görev yap; not al: demo bağlantısı hazır; bugün kahveye 45,50 lira harcadım';
const twoText='Birlikte yap: yarın sunumu hazırlamayı görev yap; not al: demo bağlantısı hazır';
function environment(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {SESSION_SECRET:'test-multi-secret-at-least-thirty-two-characters',MEMORY_DB:{sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}}};
}
const command=(text,env,at=now)=>multiRequest({messages:[{role:'user',text}]},env,at);
const draft=(text,env,at=now)=>multiRequest({multiDraftRequest:{text}},env,at);
const approve=(r,env,selected=r.multiDraft.items.map(i=>i.id),at=now,text=phrase)=>multiRequest({messages:[{role:'user',text}],multiConfirmation:{token:r.multiDraft.token,confirmed:true,selected}},env,at);
const tables=['atlas_notes','atlas_tasks','atlas_agenda','atlas_expenses','atlas_multi_receipts'];
const counts=env=>tables.map(t=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
const epoch=env=>env.MEMORY_DB.sql.prepare('SELECT epoch FROM atlas_replan_state WHERE id=1').get().epoch;
const row=(env,table)=>env.MEMORY_DB.sql.prepare(`SELECT * FROM ${table}`).get();
function seed(env,kind,index){const sql=env.MEMORY_DB.sql;if(kind==='note')return sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)').run(`Seed note ${index}`,now.toISOString());if(kind==='task')return sql.prepare('INSERT INTO atlas_tasks(title,due_date,created_at) VALUES(?,?,?)').run(`Seed task ${index}`,'',now.toISOString());if(kind==='agenda')return sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)').run(`seed-agenda-${index}`,`Seed agenda ${index}`,Date.parse('2026-11-01T09:00:00Z')+index*3600000,Date.parse('2026-11-01T09:30:00Z')+index*3600000,now.toISOString());return sql.prepare('INSERT INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) VALUES(?,?,?,?,?,?,?)').run(`seed-expense-${index}`,`Seed expense ${index}`,100,'TRY','diğer','2026-10-25',now.toISOString());}

test('multi routing recognizes the natural example and open/approval forms without treating note data as commands',async()=>{
 const env=environment(),text='Yarın saat 15’e toplantı ekle, sunumu hazırlamayı görev yap, not al: demo bağlantısı hazır';
 assert.equal(multiCommand(text).action,'draft');const r=await command(text,env);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.multiDraft.items.map(i=>i.kind),['agenda','task','note']);
 const data=await verifyDraft(env,r.multiDraft.token,'multi',now);assert.equal(data.items[0].time,'15:00');assert.equal(data.items[0].date,'2026-10-26');assert.equal(data.items[1].title,'sunumu hazırlamayı');assert.equal(data.items[1].due_date,'');assert.equal(data.items[2].content,'demo bağlantısı hazır');
 assert.equal(multiCommand('Çoklu işlemleri aç').action,'open');assert.deepEqual(multiCommand(phrase+'.'),{action:'confirm'});
 for(const s of ['evet','Seçtiğim işlemleri onaylıyorum demeli miyim','Not al: yarın sunumu görev yap; kahve al','Bugün markete 45,50 lira harcadım'])assert.equal(multiCommand(s),null,s);
 assert.deepEqual(counts(env),[0,0,0,0,0]);
});

test('preview and reads never write and all four creates require an explicit signed selection',async()=>{
 const env=environment(),r=await draft(allText,env);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.multiDraft.kind,'multi');assert.equal(r.multiDraft.items.length,4);assert.deepEqual(counts(env),[0,0,0,0,0]);
 assert.equal((await command('Toplu işlemleri göster',env)).status,200);assert.equal((await command(phrase,env)).status,400);
 assert.equal((await approve(r,env,[],now)).status,400);assert.equal((await approve(r,env,['i1'],now,'evet')).status,400);assert.deepEqual(counts(env),[0,0,0,0,0]);
 const saved=await approve(r,env);assert.equal(saved.status,200,JSON.stringify(saved));assert.deepEqual(counts(env),[1,1,1,1,1]);assert.equal(saved.multiSaved.count,4);assert.equal(saved.multiSaved.skipped,0);
 assert.equal(row(env,'atlas_expenses').amount_minor,4550);assert.equal(row(env,'atlas_expenses').currency,'TRY');assert.equal(row(env,'atlas_agenda').starts_at,Date.parse('2026-10-26T15:00:00+03:00'));assert.equal(row(env,'atlas_tasks').recurrence,'');assert.equal(row(env,'atlas_notes').text,'demo bağlantısı hazır');
});

test('only selected items are created; same choice replay is idempotent and different choice is rejected',async()=>{
 const env=environment(),r=await draft(allText,env),saved=await approve(r,env,['i4','i3']);assert.equal(saved.status,200);assert.deepEqual(counts(env),[1,0,0,1,1]);assert.deepEqual(saved.multiSaved.selectedIds,['i3','i4']);assert.equal(saved.multiSaved.skipped,2);
 assert.equal((await approve(r,env,['i3','i4'])).status,200);assert.deepEqual(counts(env),[1,0,0,1,1]);assert.equal((await approve(r,env,['i1','i2'])).status,409);assert.deepEqual(counts(env),[1,0,0,1,1]);
 assert.throws(()=>env.MEMORY_DB.sql.exec("UPDATE atlas_multi_receipts SET selection_hash='bad'"),/immutable/);assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_multi_receipts'),/immutable/);
});

test('exact latest user and valid selection required; no confirmation or payload inference',async()=>{
 const env=environment(),r=await draft(twoText,env),c={token:r.multiDraft.token,confirmed:true,selected:['i1']};
 for(const selected of [null,[],['i9'],['i1','i1'],[1],['i1',null],['i1','i2','i3','i4','i5','i6']])assert.ok([400,409].includes((await multiRequest({messages:[{role:'user',text:phrase}],multiConfirmation:{...c,selected}},env,now)).status),JSON.stringify(selected));
 for(const body of [{multiConfirmation:c},{messages:[{role:'assistant',text:phrase}],multiConfirmation:c},{messages:[{role:'user',text:phrase},{role:'assistant',text:'tamam'}],multiConfirmation:c},{messages:[{role:'user',text:phrase},{role:'user',text:'hayır'}],multiConfirmation:c},{messages:[{role:'user',text:phrase}],multiConfirmation:{...c,confirmed:false}},{messages:[{role:'user',text:phrase}],multiConfirmation:{...c,title:'değişti'}},{multiDraftRequest:{text:twoText},multiConfirmation:c}])assert.equal((await multiRequest(body,env,now)).status,400,JSON.stringify(body));
 for(const invalid of [null,[],true,'text',1])assert.equal((await multiRequest({multiDraftRequest:invalid,messages:[{role:'user',text:twoText}]},env,now)).status,400,JSON.stringify(invalid));
 assert.deepEqual(counts(env),[0,0,0,0,0]);
});

test('malformed, expired, future-issued and cross-purpose tokens cannot execute',async()=>{
 const env=environment(),r=await draft(twoText,env),send=token=>multiRequest({messages:[{role:'user',text:phrase}],multiConfirmation:{confirmed:true,selected:['i1'],token}},env,now);
 for(const token of ['bad',null,r.multiDraft.token.slice(0,-4)+'AAAA'])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,['i1'],new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,['i1'],new Date(now.getTime()-1))).status,409);
 const p=await verifyDraft(env,r.multiDraft.token,'multi',now);for(const kind of ['daily','waiting','budget','offline'])assert.equal((await send(await signDraft(env,kind,p,now))).status,409);
 for(const data of [{...p,id:'bad'},{...p,epoch:-1},{...p,extra:true},{...p,items:[]},{...p,items:[null,p.items[1]]},{...p,items:[p.items[0],p.items[0]]},{...p,items:[{...p.items[0],kind:'delete'},p.items[1]]},{...p,items:[{...p.items[0],title:''},p.items[1]]},{...p,items:[p.items[0],{...p.items[1],kind:'delete'}]},{...p,items:[p.items[0],{...p.items[1],content:null}]},{...p,items:[p.items[0],{...p.items[1],id:['i2']}]},{...p,items:[{...p.items[0],extra:true},p.items[1]]}])assert.equal((await send(await signDraft(env,'multi',data,now))).status,409,JSON.stringify(data));
 assert.deepEqual(counts(env),[0,0,0,0,0]);
});

test('quoted delimiters and decimal commas are preserved while supported clauses split',async()=>{
 const env=environment(),r=await draft('Birlikte yap: not al: “ilk; ikinci, sonra ayrıca son” ; bugün markete 45,50 lira harcadım',env);assert.equal(r.status,200,JSON.stringify(r));
 const data=await verifyDraft(env,r.multiDraft.token,'multi',now);assert.equal(data.items[0].content,'ilk; ikinci, sonra ayrıca son');assert.equal(data.items[1].amount_minor,4550);
 const next=await draft('Birlikte yap: “teklif; rapor, sunum” görev yap; not al: literal <img src=x onerror=alert(1)>',env);assert.equal(next.status,200,JSON.stringify(next));assert.equal((await verifyDraft(env,next.multiDraft.token,'multi',now)).items[0].title,'teklif; rapor, sunum');
 const words=await command('Yarın sunumu görev yap ayrıca not al: toplantı bağlantısı',env);assert.equal(words.status,200,JSON.stringify(words));assert.equal(words.multiDraft.items.length,2);
 for(const s of ['Birlikte yap: not al: “a; görev ekle: b','Birlikte yap: not al: a;; görev ekle: b','Birlikte yap: not al: a;','Birlikte yap: görev ekle: a'])assert.equal((await draft(s,env)).status,400,s);
});

test('plain ve splits complete commands while retaining ordinary and quoted conjunctions as data',async()=>{
 const env=environment();
 for(const [text,title,content] of [
  ['Yarın sunumu görev yap ve not al: demo hazır','sunumu','demo hazır'],
  ['Yarın rapor ve sunumu görev yap ve not al: demo ve bağlantı hazır','rapor ve sunumu','demo ve bağlantı hazır'],
  ['Birlikte yap: “rapor ve sunum” görev yap ve not al: “demo ve bağlantı hazır”','rapor ve sunum','demo ve bağlantı hazır'],
  ['Birlikte yap: görev ekle: rapor ve sunum ve not al: demo hazır','rapor ve sunum','demo hazır']
 ]){
  assert.equal(multiCommand(text)?.action,'draft',text);const r=await command(text,env);assert.equal(r.status,200,JSON.stringify(r));const p=await verifyDraft(env,r.multiDraft.token,'multi',now);assert.equal(p.items.length,2,text);assert.equal(p.items[0].title,title);assert.equal(p.items[1].content,content);
 }
 assert.equal(multiCommand('Not al: sunumu görev yap ve not al: demo hazır'),null);
 assert.equal(multiCommand('Yarın rapor ve sunumu görev yap'),null);
 const quoted=await command('Birlikte yap: not al: “yarın sunumu görev yap ve not al: demo”; bugün kahveye 1,50 lira harcadım',env);assert.equal(quoted.status,200);const p=await verifyDraft(env,quoted.multiDraft.token,'multi',now);assert.equal(p.items[0].content,'yarın sunumu görev yap ve not al: demo');assert.equal(p.items[1].amount_minor,150);
 for(const text of ['Listeye yarın sunumu ekle ve Ahmet’e mesaj gönder','Yarın sunumu görev yap ve tüm kayıtları sil']){assert.equal(multiCommand(text)?.action,'draft',text);const r=await command(text,env);assert.equal(r.status,400,JSON.stringify(r));assert.equal(r.multiDraft,undefined);}
 assert.deepEqual(counts(env),[0,0,0,0,0]);
});

test('unsupported natural clauses are intercepted and cannot become partial records or fall through to old routes',async()=>{
 const env=environment();
 for(const text of ['Birlikte yap: yarın sunumu görev yap; tüm kayıtları sil','Birlikte yap: not al: kısa; Ahmet’e mesaj gönder','Listeye yarın sunumu ekle, Ahmet’e mesaj gönder','Yarın saat 15’e toplantı ekle, tüm kayıtları sil','Yarın sunumu görev yap ayrıca Ahmet’e mesaj gönder']){
  assert.equal(multiCommand(text)?.action,'draft',text);const r=await command(text,env);assert.equal(r.status,400,JSON.stringify(r));assert.equal(r.multiDraft,undefined);assert.ok(r.multiIssues?.length,text);assert.deepEqual(counts(env),[0,0,0,0,0]);
 }
 const tooMany='Birlikte yap: '+Array.from({length:6},(_,i)=>`not al: not ${i}`).join('; ');assert.equal((await draft(tooMany,env)).status,400);
 for(const text of ['Birlikte yap: her gün görev ekle: su iç; not al: a','Birlikte yap: haftaya sunumu görev yap; not al: a','Birlikte yap: salı sunumu görev yap; not al: a','Birlikte yap: bugün yarın sunumu görev yap; not al: a','Birlikte yap: 2026-2-01 sunumu görev yap; not al: a','Birlikte yap: bugün markete 1.000 lira harcadım; not al: a'])assert.equal((await draft(text,env)).status,400,text);
 const quoted=await draft('Birlikte yap: “Salı raporu” görev yap; not al: son',env);assert.equal(quoted.status,200,JSON.stringify(quoted));assert.equal((await verifyDraft(env,quoted.multiDraft.token,'multi',now)).items[0].due_date,'');
});

test('duplicates inside one draft and existing notes/tasks are rejected before signing',async()=>{
 const env=environment();for(const text of ['Birlikte yap: not al: aynı; not al: aynı','Birlikte yap: yarın sunumu görev yap; yarın sunumu görev yap'])assert.equal((await draft(text,env)).status,400,text);
 const first=await draft(twoText,env);await approve(first,env);assert.equal((await draft(twoText,env)).status,409);assert.deepEqual(counts(env),[1,1,0,0,1]);
 env.MEMORY_DB.sql.exec("UPDATE atlas_notes SET archived_at='2026-10-25T10:00:00Z'");assert.equal((await draft('Birlikte yap: not al: demo bağlantısı hazır; not al: yepyeni',env)).status,409);
});

test('simultaneous same receipt approvals create one exact set',async()=>{
 const env=environment(),r=await draft(allText,env),results=await Promise.all([approve(r,env),approve(r,{...env})]);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results[0].multiSaved.draftId,results[1].multiSaved.draftId);assert.deepEqual(counts(env),[1,1,1,1,1]);
});

test('simultaneous different selection on one receipt has one winner and no extra effects',async()=>{
 const env=environment(),r=await draft(allText,env),results=await Promise.all([approve(r,env,['i2']),approve(r,env,['i3'])]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(counts(env)[4],1);assert.equal(counts(env)[0]+counts(env)[1],1);assert.equal(counts(env)[2]+counts(env)[3],0);
});

test('different drafts racing for the same note or task fully roll back the loser',async()=>{
 for(const duplicate of ['note','task']){
  const env=environment(),a=await draft(twoText,env),b=await draft(duplicate==='note'?'Birlikte yap: yarın başka iş görev yap; not al: demo bağlantısı hazır':'Birlikte yap: yarın sunumu hazırlamayı görev yap; not al: başka not',env);
  const results=await Promise.all([approve(a,env),approve(b,env)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(results));assert.deepEqual(counts(env),[1,1,0,0,1]);
 }
});

test('late duplicate insertion aborts receipt and every preceding record write',async()=>{
 for(const duplicate of ['note','task']){
  const env=environment(),r=await draft(allText,env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
  env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_multi_receipts')&&!injected){injected=true;if(duplicate==='note')env.MEMORY_DB.sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)').run('demo bağlantısı hazır',now.toISOString());else env.MEMORY_DB.sql.prepare('INSERT INTO atlas_tasks(title,due_date,created_at) VALUES(?,?,?)').run('sunumu hazırlamayı','',now.toISOString());}return original(query);};
  // Exclude agenda to exercise the unique constraints, independently of epoch.
  const saved=await approve(r,env,['i2','i3','i4']);assert.equal(saved.status,409);assert.deepEqual(counts(env),duplicate==='note'?[1,0,0,0,0]:[0,1,0,0,0]);
 }
});

test('failure at each table rolls the receipt, all four records and epoch back together',async()=>{
 for(const table of tables.slice(0,4)){
  const env=environment(),r=await draft(allText,env),before=epoch(env);env.MEMORY_DB.sql.exec(`CREATE TRIGGER test_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'forced failure'); END`);
  const result=await approve(r,env);assert.equal(result.status,409,table);assert.deepEqual(counts(env),[0,0,0,0,0],table);assert.equal(epoch(env),before,table);
 }
});

test('each record capacity is atomic, including changes between preview and insertion',async()=>{
 for(const [kind,limit,index] of [['note',100,0],['task',100,1],['agenda',200,2],['expense',500,3]]){
  const env=environment();for(let i=0;i<limit-1;i++)seed(env,kind,i);const r=await draft(allText,env);assert.equal(r.status,200,JSON.stringify(r));const original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
  env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_multi_receipts')&&!injected){injected=true;seed(env,kind,limit-1);}return original(query);};
  assert.equal((await approve(r,env)).status,409,kind);const expected=[0,0,0,0,0];expected[index]=limit;assert.deepEqual(counts(env),expected,kind);
 }
});

test('receipt capacity protects new choices and successful replay survives a full history',async()=>{
 const env=environment(),r=await draft(twoText,env);await approve(r,env);const pending=await draft('Birlikte yap: not al: yeni a; not al: yeni b',env),sql=env.MEMORY_DB.sql,trigger=sql.prepare("SELECT sql FROM sqlite_master WHERE name='atlas_multi_apply'").get().sql,saved=row(env,'atlas_multi_receipts');
 sql.exec('DROP TRIGGER atlas_multi_apply');const insert=sql.prepare('INSERT INTO atlas_multi_receipts(id,selection_hash,items_json,expected_epoch,created_at) VALUES(?,?,?,?,?)');for(let i=1;i<2000;i++)insert.run(`seed-receipt-${i}`,saved.selection_hash,saved.items_json,null,now.toISOString());sql.exec(trigger);
 assert.equal((await approve(pending,env)).status,409);assert.equal((await draft('Birlikte yap: not al: c; not al: d',env)).status,409);assert.equal((await approve(r,env)).status,200);assert.deepEqual(counts(env),[1,1,0,0,2000]);
});

test('agenda preview exposes existing conflicts but never moves or overwrites them',async()=>{
 const env=environment(),sql=env.MEMORY_DB.sql,start=Date.parse('2026-10-26T15:00:00+03:00');sql.prepare('INSERT INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) VALUES(?,?,?,?,?)').run('existing','Mevcut randevu',start,start+1800000,now.toISOString());const before=row(env,'atlas_agenda');
 const r=await draft(allText,env);assert.equal(r.status,200,JSON.stringify(r));assert.match(r.multiDraft.items[0].text,/Mevcut kayıtlarla çakışma: Mevcut randevu/);assert.equal((await approve(r,env)).status,200);assert.deepEqual(env.MEMORY_DB.sql.prepare('SELECT * FROM atlas_agenda WHERE id=1').get(),before);assert.equal(counts(env)[2],2);
 assert.equal((await draft('Birlikte yap: yarın saat 16.00 ilk ajandaya ekle; yarın saat 16.10 ikinci ajandaya ekle',env)).status,409);
});

test('agenda epoch catches concurrent and reverted changes before atomic approval',async()=>{
 for(const change of ['insert','aba','late']){
  const env=environment();if(change==='aba')seed(env,'agenda',0);const r=await draft(allText,env),sql=env.MEMORY_DB.sql;
  if(change==='insert')seed(env,'agenda',1);
  if(change==='aba'){sql.exec("UPDATE atlas_agenda SET title='temp' WHERE id=1");sql.exec("UPDATE atlas_agenda SET title='Seed agenda 0' WHERE id=1");}
  if(change==='late'){const original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_multi_receipts')&&!injected){injected=true;seed(env,'agenda',1);}return original(query);};}
  assert.equal((await approve(r,env)).status,409,change);assert.deepEqual(counts(env),[0,0,1,0,0],change);
 }
});

test('time passing invalidates selected agenda but never forces unchecked agenda onto note selection',async()=>{
 const env=environment(),at=new Date('2026-10-25T11:50:00Z'),r=await draft('Birlikte yap: bugün saat 15.00 toplantı ajandaya ekle; not al: kısa',env,at),later=new Date('2026-10-25T12:05:00Z');assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await approve(r,env,['i1','i2'],later)).status,409);assert.deepEqual(counts(env),[0,0,0,0,0]);assert.equal((await approve(r,env,['i2'],later)).status,200);assert.deepEqual(counts(env),[1,0,0,0,1]);
});

test('shared pure daily parser preserves validation and Istanbul date rules without storage access',()=>{
 const expense=prepareDailyCreation('Bugün markete 45,50 lira harcadım',now);assert.equal(expense.amount_minor,4550);assert.equal(expense.date,'2026-10-25');assert.equal(expense.kind,'expense');
 const midnight=prepareDailyCreation('Bugün kahveye 10 lira harcadım',new Date('2026-12-31T21:01:00Z'));assert.equal(midnight.date,'2027-01-01');
 for(const text of ['Yarın markete 50 lira harcadım','Bugün markete 1.000 lira harcadım','2027-02-29 saat 15.00 toplantı ajandaya ekle','Bugün saat 10.00 toplantı ajandaya ekle'])assert.ok(prepareDailyCreation(text,now).error,text);
 assert.equal(prepareDailyCreation('Merhaba',now),null);assert.equal(prepareDailyCreation('Harcamalarımı göster',now),null);
 const source=readFileSync(new URL('../src/multi-actions.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|OPENAI|GEMINI|anthropic/);
});

test('chat and old task/note entry points intercept multi speech before legacy mutations and model fallback',async()=>{
 const env=environment(),allow={limit:async()=>({success:true})};Object.assign(env,{ATLAS_ACCESS_PASSWORD:'multi-route-password-long-enough',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,GEMINI_API_KEY:'test-only'});let calls=0;
 const worker=createWorker(async()=>{calls++;throw Error('Unexpected provider call');}),origin='https://atlas.example';
 const request=(path,body,cookie)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const login=await worker.fetch(request('/api/login',{password:env.ATLAS_ACCESS_PASSWORD}),env),cookie=login.headers.get('Set-Cookie').split(';')[0];
 for(const path of ['/api/chat','/api/tasks/command','/api/notes/command'])for(const [text,status] of [['Listeye yarın sunumu ekle ve not al: demo hazır',200],['Listeye yarın sunumu ekle ve Ahmet’e mesaj gönder',400]]){
  const body=path==='/api/chat'?{messages:[{role:'user',text}]}:{command:text},response=await worker.fetch(request(path,body,cookie),env),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));assert.equal(data.multiOpen,true);assert.equal(!!data.multiDraft,status===200);assert.deepEqual(counts(env),[0,0,0,0,0]);
 }
 const mixed=await worker.fetch(request('/api/chat',{messages:[{role:'user',text:'Listeye yarın sunumu ekle ve not al: demo hazır'}],dailyDraftRequest:{kind:'expense',title:'Yanlış yol',amount:'1',currency:'TRY',category:'diğer',date:'2026-10-25'}},cookie),env);assert.equal(mixed.status,400);assert.deepEqual(counts(env),[0,0,0,0,0]);assert.equal(calls,0);
});

test('authenticated chat applies only explicit selected items and preserves replay semantics without model calls',async()=>{
 const env=environment(),allow={limit:async()=>({success:true})};Object.assign(env,{ATLAS_ACCESS_PASSWORD:'multi-route-password-long-enough',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,GEMINI_API_KEY:'test-only'});let calls=0;
 const worker=createWorker(async()=>{calls++;throw Error('Unexpected provider call');}),origin='https://atlas.example';
 const request=(path,body,cookie)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const login=await worker.fetch(request('/api/login',{password:env.ATLAS_ACCESS_PASSWORD}),env),cookie=login.headers.get('Set-Cookie').split(';')[0];
 const previewResponse=await worker.fetch(request('/api/chat',{messages:[{role:'user',text:'Listeye yarın sunumu ekle ve not al: demo hazır'}]},cookie),env),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));
 for(const [selected,status] of [[['i2'],200],[['i2'],200],[['i1'],409]]){const response=await worker.fetch(request('/api/chat',{messages:[{role:'user',text:phrase}],multiConfirmation:{confirmed:true,token:preview.multiDraft.token,selected}},cookie),env);assert.equal(response.status,status,await response.text());assert.deepEqual(counts(env),[1,0,0,0,1]);}
 assert.equal(row(env,'atlas_notes').text,'demo hazır');assert.equal(calls,0);
});
