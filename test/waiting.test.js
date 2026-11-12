import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {waitingCommand,waitingRequest,readWaiting} from '../src/waiting.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T10:00:00Z');
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};}};
}
const environment=()=>({MEMORY_DB:database(),SESSION_SECRET:'test-waiting-secret-at-least-thirty-two-characters'});
const command=(text,env,at=now)=>waitingRequest({messages:[{role:'user',text}]},env,at);
const draft=(input,env,at=now)=>waitingRequest({waitingDraftRequest:input},env,at);
const approve=(r,env,at=now,text='Beklenen kaydını onaylıyorum')=>waitingRequest({messages:[{role:'user',text}],waitingConfirmation:{token:r.waitingDraft.token,confirmed:true}},env,at);
const count=(env,table='atlas_waiting')=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
const entry=(extra={})=>({action:'create',who:'Ahmet',what:'teklif',kind:'reply',followupDate:'2026-10-30',lastContactDate:'2026-10-24',...extra});
async function create(env,extra={},at=now){const r=await draft(entry(extra),env,at);assert.ok(r.waitingDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved.waitingItems.find(i=>i.id===saved.waitingSaved.waiting_id);}
async function change(env,input,at=now){const r=await draft(input,env,at);assert.ok(r.waitingDraft,JSON.stringify(r));const saved=await approve(r,env,at);assert.equal(saved.status,200,JSON.stringify(saved));return saved;}
function seed(env,index,archived=0){env.MEMORY_DB.sql.prepare('INSERT INTO atlas_waiting(id,who,who_key,what,what_key,kind,followup_date,last_contact_date,status,archived,revision,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)').run(`seed-waiting-${String(index).padStart(16,'0')}`,'Ahmet','ahmet',`İş ${index}`,`iş ${index}`,'reply','','','waiting',archived,now.toISOString(),now.toISOString(),`seed-${index}`);}

test('waiting commands route exact open, create, received and approval statements',()=>{
 for(const text of ['Beklediğim neler var?','Beklenenleri göster','Beklenenlerimi aç','Beklediklerimi oku','Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim','Kargo bekliyorum: kitap, takip tarihi 2026-10-30','teklif geldi'])assert.ok(waitingCommand(text),text);
 assert.deepEqual(waitingCommand('Beklenen kaydını onaylıyorum.'),{action:'confirm'});
 for(const text of ['merhaba','evet','Beklenen kaydını onaylıyorum demem gerekiyor mu','Teklif beklemek zor','Kargo nerede','Mesajları kontrol et'])assert.equal(waitingCommand(text),null,text);
});

test('every create remains read-only until exact real user approval plus signed confirmation',async()=>{
 const env=environment(),r=await draft(entry(),env);assert.equal(r.status,200);assert.equal(r.waitingDraft.kind,'waiting');assert.equal(r.waitingDraft.recordKind,'reply');assert.equal(count(env),0);assert.equal(count(env,'atlas_waiting_operations'),0);
 assert.equal((await approve(r,env,now,'evet')).status,400);
 assert.equal((await command('Beklenen kaydını onaylıyorum',env)).status,400);
 const confirmation={token:r.waitingDraft.token,confirmed:true};
 for(const body of [{waitingConfirmation:confirmation},{messages:[{role:'assistant',text:'Beklenen kaydını onaylıyorum'}],waitingConfirmation:confirmation},{messages:[{role:'user',text:'Beklenen kaydını onaylıyorum'},{role:'assistant',text:'tamam'}],waitingConfirmation:confirmation},{messages:[{role:'user',text:'Beklenen kaydını onaylıyorum'},{role:'user',text:'hayır'}],waitingConfirmation:confirmation},{messages:[{role:'user',text:'Beklenen kaydını onaylıyorum'}],waitingConfirmation:{...confirmation,confirmed:false}},{messages:[{role:'user',text:'Beklenen kaydını onaylıyorum'}],waitingConfirmation:{...confirmation,what:'değişti'}},{waitingDraftRequest:entry(),waitingConfirmation:confirmation}])assert.equal((await waitingRequest(body,env,now)).status,400);
 assert.equal(count(env),0);const saved=await approve(r,env,now,'Beklenen kaydını onaylıyorum.');assert.equal(saved.status,200);assert.equal(saved.waitingItems[0].revision,1);assert.equal(saved.waitingItems[0].status,'waiting');assert.equal(count(env,'atlas_waiting_operations'),1);
});

test('voice parses exact reply and delivery examples with honest missing-person and date labels',async()=>{
 const env=environment(),reply=await command('Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim',env);
 assert.equal(reply.waitingDraft.who,'Ahmet');assert.equal(reply.waitingDraft.what,'teklif');assert.equal(reply.waitingDraft.followupDate,'2026-10-30');assert.equal(reply.waitingDraft.recordKind,'reply');
 const delivery=await command('Kargo bekliyorum: kitap, takip tarihi 2026-10-30',env);assert.equal(delivery.waitingDraft.who,'');assert.equal(delivery.waitingDraft.what,'kitap');assert.equal(delivery.waitingDraft.recordKind,'delivery');assert.equal(delivery.waitingDraft.followupDate,'2026-10-30');
 const undated=await command("Ahmet'ten teklif bekliyorum",env);assert.equal(undated.waitingDraft.followupDate,'');assert.match(undated.text,/takip tarihi: tarihsiz/);assert.match(undated.text,/son temas: belirtilmedi/);
 assert.match(delivery.text,/manuel kayıt/);assert.match(delivery.text,/Mesajlar ve kargolar sorgulanmaz/);assert.match(delivery.text,/otomatik bildirim veya mesaj gönderilmez/);assert.equal(count(env),0);
});

test('date-looking people and titles never become inferred follow-up dates',async()=>{
 const env=environment();
 const a=await command('Cuma’dan pazartesi toplantı yanıtını bekliyorum',env);assert.equal(a.waitingDraft.who,'Cuma');assert.equal(a.waitingDraft.what,'pazartesi toplantı yanıtını');assert.equal(a.waitingDraft.followupDate,'');
 const b=await command('Kargo bekliyorum: yarın için kitap',env);assert.equal(b.waitingDraft.what,'yarın için kitap');assert.equal(b.waitingDraft.followupDate,'');
 const c=await command('Ahmet’ten teklif bekliyorum, tarihsiz tekrar kontrol edelim',env);assert.equal(c.waitingDraft.followupDate,'');
 for(const text of ['Kargo bekliyorum','Kargo bekliyorum: kitap, takip tarihi 2027-02-29','Ahmet’ten teklif bekliyorum, haftaya tekrar kontrol edelim','Kargo bekliyorum: kitap, takip tarihi 2026-13-01'])assert.equal((await command(text,env)).status,400,text);
});

test('Istanbul day, midnight, weekdays, leap dates and year rollover are deterministic',async()=>{
 const env=environment(),at=new Date('2026-12-31T21:01:00Z');
 const today=await command('Ahmet’ten teklif bekliyorum, bugün tekrar kontrol edelim',env,at);assert.equal(today.waitingDraft.followupDate,'2027-01-01');
 const tomorrow=await command('Ahmet’ten teklif bekliyorum, yarın tekrar kontrol edelim',env,at);assert.equal(tomorrow.waitingDraft.followupDate,'2027-01-02');
 const friday=await command('Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim',env,at);assert.equal(friday.waitingDraft.followupDate,'2027-01-01');
 assert.equal((await draft(entry({followupDate:'2028-02-29'}),env)).status,200);
 for(const d of ['2027-02-29','2028-02-30','2026-13-01','2026-2-01','1999-12-31','2101-01-01'])assert.equal((await draft(entry({followupDate:d}),env)).status,400,d);
});

test('invalid fields, unknown status and destructive actions never write',async()=>{
 const env=environment();
 for(const extra of [{who:''},{who:null},{what:''},{what:'x'.repeat(201)},{what:'bad\ncontrol'},{kind:'email'},{followupDate:null},{lastContactDate:null},{lastContactDate:'2026-10-26'},{lastContactDate:'2026-02-30'},{status:'received'},{archived:1},{id:crypto.randomUUID()},{trackingNumber:'42'},{sendMessage:true},{action:'delete'}])assert.equal((await draft(entry(extra),env)).status,400,JSON.stringify(extra));
 assert.equal((await draft(entry({kind:'delivery',who:''}),env)).status,200);assert.equal(count(env),0);
 const item=await create(env);for(const extra of [{who:null},{what:null},{kind:null},{followupDate:null},{lastContactDate:null},{status:'received'}])assert.equal((await draft({action:'edit',id:item.id,...extra},env)).status,400,JSON.stringify(extra));
 assert.equal((await draft({action:'set-status',id:item.id,status:'delivered'},env)).status,400);assert.equal((await draft({action:'edit',id:item.id},env)).status,400);assert.equal((await draft({action:'archive',id:'1'},env)).status,400);
 assert.equal(count(env,'atlas_waiting_operations'),1);
});

test('tampering, expiry, future issued, cross-purpose and invalid signed payloads fail closed',async()=>{
 const env=environment(),r=await draft(entry(),env),send=token=>waitingRequest({messages:[{role:'user',text:'Beklenen kaydını onaylıyorum'}],waitingConfirmation:{confirmed:true,token}},env,now);
 for(const token of ['bad',r.waitingDraft.token.slice(0,-4)+'AAAA'])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);
 const p=await verifyDraft(env,r.waitingDraft.token,'waiting',now);for(const purpose of ['daily','bills','budget','multi'])assert.equal((await send(await signDraft(env,purpose,p,now))).status,409);
 for(const data of [{...p,action:'delete'},{...p,id:'1'},{...p,expectedRevision:2},{...p,extra:true},{...p,after:{...p.after,archived:1}},{...p,after:{...p.after,status:'received'}},{...p,after:{...p.after,followup_date:'2027-02-29'}},{...p,after:{...p.after,last_contact_date:'2026-10-26'}},{...p,after:{...p.after,who_key:'someone else'}},{...p,after:{...p.after,extra:true}}])assert.equal((await send(await signDraft(env,'waiting',data,now))).status,409);
 assert.equal(count(env),0);assert.equal(count(env,'atlas_waiting_operations'),0);
});

test('received speech prepares the exact record and requires a new explicit approval',async()=>{
 const env=environment(),item=await create(env),r=await command('Ahmet’ten teklif geldi',env);assert.equal(r.waitingDraft.id,item.id);assert.equal(r.waitingDraft.action,'set-status');assert.equal(r.waitingDraft.status,'received');assert.match(r.text,/bekleniyor.*alındı/);
 assert.equal((await readWaiting(env,now)).waitingItems[0].status,'waiting');assert.equal((await approve(r,env,now,'geldi')).status,400);
 const saved=await approve(r,env);assert.equal(saved.waitingItems[0].status,'received');assert.equal(saved.waitingItems[0].revision,2);assert.equal(saved.waitingSummary.waiting,0);
 const reopen=await command(`Beklenen ${item.id} yeniden bekle`,env);assert.equal(reopen.waitingDraft.status,'waiting');await approve(reopen,env);
 assert.equal((await command(`Beklenen ${item.id} iptal et`,env)).waitingDraft.status,'cancelled');
});

test('ambiguous complete names require IDs including ambiguity with completed records',async()=>{
 const env=environment(),a=await create(env),b=await create(env,{who:'Ayşe'});
 assert.equal((await command('teklif geldi',env)).status,409);assert.equal((await command('klif geldi',env)).status,404);assert.equal((await command('Ahmet geldi',env)).status,404);
 assert.equal((await command('Ahmet’ten teklif geldi',env)).waitingDraft.id,a.id);
 await change(env,{action:'set-status',id:b.id,status:'received'});assert.equal((await command('teklif geldi',env)).status,409);
 const r=await command(`Beklenen ${a.id} geldi`,env);assert.equal(r.waitingDraft.id,a.id);assert.equal((await readWaiting(env,now)).waitingSummary.waiting,1);
});

test('same draft replay and racing confirmations have one record and immutable operation',async()=>{
 const env=environment(),r=await draft(entry(),env),saved=await Promise.all([approve(r,env),approve(r,{...env})]);
 assert.ok(saved.every(s=>s.status===200),JSON.stringify(saved));assert.equal(saved[0].waitingSaved.id,saved[1].waitingSaved.id);assert.equal(count(env),1);assert.equal(count(env,'atlas_waiting_operations'),1);
 assert.equal((await approve(r,env)).status,200);assert.throws(()=>env.MEMORY_DB.sql.exec("UPDATE atlas_waiting_operations SET action='archive'"),/immutable/);assert.throws(()=>env.MEMORY_DB.sql.exec('DELETE FROM atlas_waiting_operations'),/immutable/);
});

test('all edit, status, archive and restore changes are previews with preserved history',async()=>{
 const env=environment(),item=await create(env),r=await draft({action:'edit',id:item.id,who:'Ayşe',what:'yanıt',kind:'reply',followupDate:'',lastContactDate:''},env);
 assert.equal((await readWaiting(env,now)).waitingItems[0].who,'Ahmet');await approve(r,env);assert.equal((await readWaiting(env,now)).waitingItems[0].who,'Ayşe');
 await change(env,{action:'set-status',id:item.id,status:'cancelled'});const archive=await draft({action:'archive',id:item.id},env);assert.equal((await readWaiting(env,now)).waitingItems.length,1);
 const archived=await approve(archive,env);assert.equal(archived.waitingItems.length,0);assert.equal(archived.archivedWaitingItems[0].status,'cancelled');assert.equal(archived.waitingSummary.total,0);
 assert.equal((await draft({action:'set-status',id:item.id,status:'waiting'},env)).status,400);assert.equal((await draft({action:'archive',id:item.id},env)).status,400);
 const restored=await change(env,{action:'restore',id:item.id});assert.equal(restored.waitingItems[0].status,'cancelled');assert.equal(restored.waitingItems[0].revision,5);assert.equal(count(env),1);assert.equal(count(env,'atlas_waiting_operations'),5);
 assert.equal((await draft({action:'restore',id:item.id},env)).status,400);
});

test('edit preview exposes exact public before/after states and labels only changed fields',async()=>{
 const env=environment(),created=await draft(entry(),env);assert.equal(created.waitingDraft.before,null);assert.deepEqual(created.waitingDraft.changedFields,[]);
 const saved=await approve(created,env),item=saved.waitingItems[0],r=await draft({action:'edit',id:item.id,who:'',what:'kitap',kind:'delivery',followupDate:'',lastContactDate:''},env);
 assert.deepEqual(r.waitingDraft.before,{who:'Ahmet',what:'teklif',kind:'reply',followup_date:'2026-10-30',last_contact_date:'2026-10-24',status:'waiting',archived:0});
 assert.deepEqual(r.waitingDraft.after,{who:'',what:'kitap',kind:'delivery',followup_date:'',last_contact_date:'',status:'waiting',archived:0});
 assert.deepEqual(r.waitingDraft.changedFields,['who','what','kind','followup_date','last_contact_date']);
 assert.match(r.text,/Önce: Kişi\/kurum: “Ahmet”; Beklenen: “teklif”; Tür: “yanıt”; Takip tarihi: “2026-10-30”; Son temas: “2026-10-24”/);
 assert.match(r.text,/Sonra: Kişi\/kurum: “belirtilmedi”; Beklenen: “kitap”; Tür: “teslimat”; Takip tarihi: “tarihsiz”; Son temas: “belirtilmedi”/);
 assert.doesNotMatch(JSON.stringify(r.waitingDraft.before),/who_key|what_key/);assert.equal((await readWaiting(env,now)).waitingItems[0].what,'teklif');
 const signed=await verifyDraft(env,r.waitingDraft.token,'waiting',now);for(const key of Object.keys(r.waitingDraft.before)){assert.equal(r.waitingDraft.before[key],signed.before[key]);assert.equal(r.waitingDraft.after[key],signed.after[key]);}
 const onlyDate=await draft({action:'edit',id:item.id,followupDate:'2026-11-03'},env);assert.deepEqual(onlyDate.waitingDraft.changedFields,['followup_date']);assert.match(onlyDate.text,/Önce: Takip tarihi: “2026-10-30”\. Sonra: Takip tarihi: “2026-11-03”/);
 const status=await draft({action:'set-status',id:item.id,status:'received'},env);assert.equal(status.waitingDraft.before.status,'waiting');assert.equal(status.waitingDraft.after.status,'received');assert.deepEqual(status.waitingDraft.changedFields,['status']);
});

test('summary buckets count only nonarchived waiting entries and reading never mutates',async()=>{
 const env=environment();await create(env,{followupDate:'2026-10-24'});await create(env,{followupDate:'2026-10-25'});await create(env,{followupDate:'2026-10-26'});await create(env,{followupDate:''});
 const received=await create(env,{followupDate:'2026-10-24'});await change(env,{action:'set-status',id:received.id,status:'received'});
 const cancelled=await create(env,{followupDate:'2026-10-24'});await change(env,{action:'set-status',id:cancelled.id,status:'cancelled'});
 const archived=await create(env,{followupDate:'2026-10-24'});await change(env,{action:'archive',id:archived.id});const operations=count(env,'atlas_waiting_operations');
 const read=await readWaiting(env,now);assert.deepEqual(read.waitingSummary,{todayDate:'2026-10-25',total:6,waiting:4,received:1,cancelled:1,overdue:1,today:1,upcoming:1,dated:3,undated:1});
 assert.equal(read.archivedWaitingItems.length,1);assert.equal((await command('Beklediğim neler var?',env)).status,200);assert.equal(count(env,'atlas_waiting_operations'),operations);
 const midnight=await readWaiting(env,new Date('2026-10-25T21:01:00Z'));assert.equal(midnight.waitingSummary.todayDate,'2026-10-26');assert.equal(midnight.waitingSummary.overdue,2);assert.equal(midnight.waitingSummary.today,1);
});

test('CAS rejects changed state and even changes reverted to their original values',async()=>{
 const env=environment(),item=await create(env),stale=await draft({action:'set-status',id:item.id,status:'received'},env);
 await change(env,{action:'edit',id:item.id,what:'yeni teklif'});await change(env,{action:'edit',id:item.id,what:'teklif'});
 assert.equal((await approve(stale,env)).status,409);assert.equal((await readWaiting(env,now)).waitingItems[0].status,'waiting');
 const current=await draft({action:'archive',id:item.id},env);env.MEMORY_DB.sql.prepare('UPDATE atlas_waiting SET followup_date=? WHERE id=?').run('2026-10-31',item.id);
 assert.equal((await approve(current,env)).status,409);assert.equal(count(env,'atlas_waiting_operations'),3);
});

test('atomic insert rechecks complete state and revision after any preflight race',async()=>{
 const env=environment(),item=await create(env),r=await draft({action:'set-status',id:item.id,status:'received'},env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_waiting_operations')&&!injected){injected=true;env.MEMORY_DB.sql.prepare('UPDATE atlas_waiting SET who=? WHERE id=?').run('Ayşe',item.id);}return original(query);};
 assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_waiting_operations'),1);assert.equal(env.MEMORY_DB.sql.prepare('SELECT status FROM atlas_waiting').get().status,'waiting');
});

test('separate simultaneous mutations cannot overwrite each other',async()=>{
 const env=environment(),item=await create(env),a=await draft({action:'edit',id:item.id,what:'birinci'},env),b=await draft({action:'edit',id:item.id,what:'ikinci'},env);
 const results=await Promise.all([approve(a,env),approve(b,{...env})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(count(env,'atlas_waiting_operations'),2);assert.equal((await readWaiting(env,now)).waitingItems[0].revision,2);
});

test('forced create and update failures roll back journal and record changes',async()=>{
 const env=environment(),r=await draft(entry(),env);env.MEMORY_DB.sql.exec("CREATE TRIGGER test_waiting_create_fail BEFORE INSERT ON atlas_waiting BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 assert.equal((await approve(r,env)).status,503);assert.equal(count(env),0);assert.equal(count(env,'atlas_waiting_operations'),0);env.MEMORY_DB.sql.exec('DROP TRIGGER test_waiting_create_fail');
 const item=await create(env),update=await draft({action:'set-status',id:item.id,status:'received'},env);env.MEMORY_DB.sql.exec("CREATE TRIGGER test_waiting_update_fail BEFORE UPDATE ON atlas_waiting BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 assert.equal((await approve(update,env)).status,503);assert.equal(count(env,'atlas_waiting_operations'),1);assert.equal((await readWaiting(env,now)).waitingItems[0].revision,1);assert.equal((await readWaiting(env,now)).waitingItems[0].status,'waiting');
});

test('200-record cap includes archives and capacity races; known replay still succeeds',async()=>{
 const env=environment(),r=await draft(entry(),env);await approve(r,env);for(let i=1;i<199;i++)seed(env,i,1);
 const overflow=await draft(entry({what:'fazla'}),env),original=env.MEMORY_DB.prepare.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.prepare=query=>{if(query.startsWith('INSERT INTO atlas_waiting_operations')&&!injected){injected=true;seed(env,199,1);}return original(query);};
 const result=await approve(overflow,env);assert.equal(result.status,409);assert.match(result.text,/200 beklenen/);assert.equal(count(env),200);assert.equal(count(env,'atlas_waiting_operations'),1);assert.equal((await approve(r,env)).status,200);
});

test('5000 immutable operation cap rejects new writes atomically and permits saved replay',async()=>{
 const env=environment(),r=await draft(entry(),env),saved=await approve(r,env),item=saved.waitingItems[0],sql=env.MEMORY_DB.sql;
 // Seed history without applying states, then restore production guard/trigger.
 const trigger=sql.prepare("SELECT sql FROM sqlite_master WHERE name='atlas_waiting_operations_update'").get().sql;sql.exec('DROP TRIGGER atlas_waiting_operations_update');
 const row=sql.prepare('SELECT * FROM atlas_waiting').get(),keys=['who','who_key','what','what_key','kind','followup_date','last_contact_date','status','archived'],json=JSON.stringify(Object.fromEntries(keys.map(k=>[k,row[k]])));
 const insert=sql.prepare('INSERT INTO atlas_waiting_operations(id,waiting_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)');for(let i=1;i<5000;i++)insert.run(`seed-history-${i}`,item.id,'edit',1,json,json,now.toISOString());sql.exec(trigger);
 const edit=await draft({action:'edit',id:item.id,what:'değişen'},env),result=await approve(edit,env);assert.equal(result.status,409);assert.match(result.text,/5000 işlem/);assert.equal((await readWaiting(env,now)).waitingItems[0].revision,1);assert.equal(count(env,'atlas_waiting_operations'),5000);assert.equal((await approve(r,env)).status,200);
});

test('literal hostile content remains data, no external calls are made, unavailable stores fail closed',async()=>{
 const env=environment(),what="x'); DROP TABLE atlas_waiting; -- <img src=x onerror=alert(1)>";await create(env,{what});assert.equal((await readWaiting(env,now)).waitingItems[0].what,what);
 const source=readFileSync(new URL('../src/waiting.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|OPENAI|GEMINI|anthropic|api\.\w/);
 assert.equal(await command('Merhaba',{}),null);assert.equal((await command('Beklenenleri göster',{})).status,503);assert.equal((await readWaiting({},now)).status,503);assert.equal((await readWaiting(env,new Date('bad'))).status,503);
 env.MEMORY_DB.sql.exec('DROP TABLE atlas_waiting');assert.equal((await readWaiting(env,now)).status,503);
});
