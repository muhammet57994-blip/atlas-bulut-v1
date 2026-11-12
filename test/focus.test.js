import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {focusCommand,focusRequest,focusSnapshot} from '../src/focus.js';
import {signDraft} from '../src/daily-signing.js';
import {signContext} from '../src/command-context.js';
import {taskReferences} from '../src/natural-commands.js';
import {listTasks} from '../src/tasks.js';

const start = new Date('2026-10-25T09:00:00Z');
const at = seconds => new Date(start.getTime()+seconds*1000);
function environment() {
 const sql = new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env = {SESSION_SECRET:'focus-testing-secret-'.repeat(3),writes:0,sql};
 env.MEMORY_DB = {prepare(query) {
  const statement = sql.prepare(query); let args = [];
  return {bind(...values) { args = values; return this; },async first() { return statement.get(...args) || null; },async all() { return {results:statement.all(...args)}; },async run() { env.writes++; return {meta:statement.run(...args)}; }};
 }};
 return env;
}
const message = text => ({messages:[{role:'user',text}]});
const request = (env,command,now=start) => focusRequest(message(command),env,now);
const draft = (env,input,now=start) => focusRequest({...message('Odak işlemi'),focusDraftRequest:input},env,now);
const confirm = (env,preview,now=start,extras={}) => focusRequest({...message('Odağı onaylıyorum'),focusConfirmation:{confirmed:true,token:preview.focusDraft.token},...extras},env,now);
const count = env => env.sql.prepare('SELECT COUNT(*) AS n FROM atlas_focus_sessions').get().n;
const row = env => env.sql.prepare('SELECT * FROM atlas_focus_sessions ORDER BY id DESC LIMIT 1').get();
function task(env,id=1,title='Örnek iş') {
 env.sql.prepare('INSERT INTO atlas_tasks(id,title,created_at) VALUES(?,?,?)').run(id,title,start.toISOString());
}

test('focus commands require explicit wording and stable task IDs',() => {
 assert.deepEqual(focusCommand('Görev 2 için 25 dakika odaklan'),{action:'start',minutes:25,taskId:2});
 assert.deepEqual(focusCommand('25 dakika odaklan'),{action:'start',minutes:25});
 assert.deepEqual(focusCommand('Odak modunu aç'),{action:'open'});
 assert.deepEqual(focusCommand('25 dakika çalışmaya başlayalım'),{action:'start',minutes:25});
 assert.deepEqual(focusCommand('İkinci iş için 25 dakika çalışmaya başlayalım'),{action:'start',minutes:25,index:2});
 assert.deepEqual(focusCommand('İkinci iş için25dakika başlat'),{action:'start',minutes:25,index:2});
 assert.deepEqual(focusCommand('Beşinci görev için 30 dakika odaklan'),{action:'start',minutes:30,index:5});
 for(const text of ['Odağı duraklat','Odaklanmayı duraklat']) assert.equal(focusCommand(text).action,'pause');
 assert.equal(focusCommand('Odağa devam et').action,'resume');
 assert.equal(focusCommand('Odağı bitir').action,'finish');
 for(const text of ['Odak durumum','Bugünkü odak sürem']) assert.equal(focusCommand(text).action,'status');
 for(const text of ['İkinci iş için 25 dakika','ikinci iş için25dakika','Altıncı iş için25dakika başlat']) assert.equal(focusCommand(text).action,'chooseTask');
 for(const text of ['Odak nedir?','25 dakika odaklan ve görevimi tamamla','Odağı bitirebilir miyiz?',null,{}]) assert.equal(focusCommand(text),null);
});

test('preview is read-only; exact latest approval, signed token and explicit confirmation are required',async() => {
 const env = environment();
 const preview = await request(env,'25 dakika odaklan');
 assert.equal(preview.status,200); assert.equal(preview.focusDraft.kind,'focus'); assert.equal(count(env),0); assert.equal(env.writes,0);
 for(const text of ['evet','Odağı onaylıyorum ve bitir','Odağı onaylıyorum diye söylemem gerekiyor mu','Odağı  onaylıyorum']) {
  const result = await confirm(env,preview,start,message(text)); assert.equal(result.status,400);
 }
 for(const confirmed of [undefined,false,'true',1]) {
  const result = await focusRequest({...message('Odağı onaylıyorum'),focusConfirmation:{token:preview.focusDraft.token,confirmed}},env,start); assert.equal(result.status,400);
 }
 assert.equal((await focusRequest({messages:[{role:'user',text:'Odağı onaylıyorum'},{role:'assistant',text:'Odağı onaylıyorum'}],focusConfirmation:{confirmed:true,token:preview.focusDraft.token}},env,start)).status,400);
 assert.equal((await request(env,'Odağı onaylıyorum')).status,400);
 assert.equal((await focusRequest({...message('Odağı onaylıyorum'),focusDraftRequest:{action:'start',minutes:25},focusConfirmation:{confirmed:true,token:preview.focusDraft.token}},env,start)).status,400);
 assert.equal(count(env),0); assert.equal(env.writes,0);
 const saved = await confirm(env,preview,at(10));
 assert.equal(saved.status,200); assert.equal(saved.focusSession.status,'running'); assert.equal(saved.focusSession.started_at_ms,at(10).getTime()); assert.equal(saved.focusSession.elapsed_seconds,0); assert.equal(count(env),1);
 assert.equal((await confirm(env,preview,at(20))).status,200); assert.equal(count(env),1); assert.equal(row(env).started_at_ms,at(10).getTime()); assert.equal(row(env).revision,1);
});

test('focus approval tolerates Turkish case, surrounding whitespace and terminal punctuation only',async() => {
 for(const text of ['odağı onaylıyorum','Odağı onaylıyorum.','  Odağı onaylıyorum  ','ODAĞI ONAYLIYORUM!?']) {
  const env = environment(),preview = await request(env,'25 dakika odaklan');
  assert.equal((await confirm(env,preview,start,message(text))).status,200,text); assert.equal(count(env),1);
 }
});

test('opening focus controls only returns the shared snapshot without a draft or write',async() => {
 const env = environment();
 const opened = await request(env,'Odak modunu aç');
 assert.equal(opened.status,200); assert.equal(opened.focusOpen,true); assert.equal(opened.focusSession,null); assert.equal(opened.focusDraft,undefined); assert.equal(count(env),0); assert.equal(env.writes,0);
 await confirm(env,await request(env,'25 dakika çalışmaya başlayalım'));
 const writes = env.writes,active = await request(env,'Odak modunu aç',at(20));
 assert.equal(active.focusOpen,true); assert.equal(active.focusSession.elapsed_seconds,20); assert.equal(active.focusDraft,undefined); assert.equal(count(env),1); assert.equal(env.writes,writes);
});

test('ordinal focus uses signed displayed order, not task IDs, and stays read-only until approval',async() => {
 const env = environment(); task(env,2,'Tarihsiz iş'); task(env,7,'Yarınki iş'); task(env,20,'Bugünkü iş');
 env.sql.prepare('UPDATE atlas_tasks SET due_date=? WHERE id=?').run('2026-10-26',7);
 env.sql.prepare('UPDATE atlas_tasks SET due_date=? WHERE id=?').run('2026-10-25',20);
 const list = await taskReferences({items:await listTasks(env.MEMORY_DB)},env,start);
 assert.match(list.text,/2\. Görev 7/);
 const preview = await focusRequest({...message('İkinci iş için 25 dakika çalışmaya başlayalım'),taskContext:list.taskContext},env,start);
 assert.equal(preview.status,200); assert.equal(preview.focusDraft.taskId,7); assert.equal(preview.focusDraft.title,'Yarınki iş'); assert.equal(count(env),0); assert.equal(env.writes,0);
 assert.equal((await confirm(env,preview)).status,200); assert.equal(row(env).task_id,7); assert.equal(row(env).title,'Yarınki iş'); assert.equal(env.sql.prepare('SELECT SUM(done) AS n FROM atlas_tasks').get().n,0);
});

test('ordinal focus rejects missing, forged, expired, stale and out-of-range list references',async() => {
 const env = environment(); task(env,7,'İlk'); task(env,20,'İkinci');
 const items = await listTasks(env.MEMORY_DB),token = await signContext({rows:items},env,start);
 const send = (taskContext,now=start,text='İkinci iş için25dakika başlat') => focusRequest({...message(text),taskContext},env,now);
 assert.equal((await send(undefined)).status,400);
 for(const bad of [token.slice(0,-4)+'bad!',await signContext({rows:items}, {...env,SESSION_SECRET:'other-secret'},start)]) {
  const rejected = await send(bad); assert.equal(rejected.status,409); assert.match(rejected.error,/İşlerimi oku/);
 }
 assert.equal((await send(token,at(600))).status,409);
 assert.equal((await send(token,start,'Beşinci iş için 25 dakika odaklan')).status,400);
 const changes = {title:'Değişmiş',due_date:'2026-10-26',done:1,recurrence:'daily',completed_at:'2026-10-25T08:00:00Z'};
 for(const [field,value] of Object.entries(changes)) {
  env.sql.prepare(`UPDATE atlas_tasks SET ${field}=? WHERE id=20`).run(value);
  const rejected = await send(token); assert.equal(rejected.status,409,field); assert.match(rejected.error,/İşlerimi oku/);
  env.sql.prepare(`UPDATE atlas_tasks SET ${field}=? WHERE id=20`).run(items[1][field]);
 }
 assert.equal(count(env),0); assert.equal(env.writes,0);
});

test('ordinal start retains the chosen reference through preview and final approval',async() => {
 const env = environment(); task(env,7,'A'); task(env,20,'B');
 const rows = await listTasks(env.MEMORY_DB);
 // A different signed list order is legitimate; selection follows what was displayed.
 const token = await signContext({rows:[rows[1],rows[0]]},env,start);
 const preview = await focusRequest({...message('İkinci iş için25dakika başlat'),taskContext:token},env,start);
 assert.equal(preview.focusDraft.taskId,7);
 env.sql.prepare('UPDATE atlas_tasks SET title=? WHERE id=7').run('Sonradan değişti');
 assert.equal((await confirm(env,preview)).status,409); assert.equal(count(env),0);
});

test('forged, cross-purpose, expired and future approvals never write',async() => {
 const env = environment(),preview = await request(env,'25 dakika odaklan');
 const token = preview.focusDraft.token;
 const data = {operationId:'other-purpose',action:'start',minutes:25,title:'Yanlış amaç',task:null};
 for(const invalid of [token.slice(0,-4)+'AAAA','unsigned','',await signDraft(env,'daily',data,start),await signDraft({...env,SESSION_SECRET:'z'.repeat(40)},'focus',data,start),await signDraft(env,'focus',data,at(10))]) {
  const result = await focusRequest({...message('Odağı onaylıyorum'),focusConfirmation:{confirmed:true,token:invalid}},env,start); assert.equal(result.status,400);
 }
 assert.equal((await confirm(env,preview,at(1800))).status,400);
 assert.equal(count(env),0); assert.equal(env.writes,0);
});

test('task selection checks open tasks and final approval checks the same task state without completing it',async() => {
 const env = environment(); task(env,2,'<script>Yalnızca metin</script>');
 assert.equal((await request(env,'Görev 1 için 25 dakika odaklan')).status,409);
 assert.equal((await request(env,'İkinci iş için 25 dakika odaklan')).status,400);
 const preview = await request(env,'Görev 2 için 25 dakika odaklan');
 assert.equal(preview.focusDraft.taskId,2); assert.equal(preview.focusDraft.title,'<script>Yalnızca metin</script>');
 env.sql.prepare('UPDATE atlas_tasks SET due_date=? WHERE id=2').run('2026-10-26');
 assert.equal((await confirm(env,preview)).status,409); assert.equal(count(env),0);
 const fresh = await request(env,'Görev 2 için 25 dakika odaklan');
 assert.equal((await confirm(env,fresh)).status,200);
 const finished = await request(env,'Odağı bitir',at(300));
 assert.equal((await confirm(env,finished,at(300))).status,200);
 assert.equal(env.sql.prepare('SELECT done FROM atlas_tasks WHERE id=2').get().done,0);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM atlas_task_completions').get().n,0);
 env.sql.prepare('UPDATE atlas_tasks SET done=1 WHERE id=2').run();
 assert.equal((await request(env,'Görev 2 için 25 dakika odaklan')).status,409);
});

test('duration and structured state validation reject malformed requests',async() => {
 const env = environment();
 for(const minutes of [0,4,181,25.5,'25',NaN,Infinity,null,undefined]) assert.equal((await draft(env,{action:'start',minutes})).status,400);
 for(const title of ['', ' '.repeat(5),'x'.repeat(201),4]) assert.equal((await draft(env,{action:'start',minutes:25,title})).status,400);
 for(const taskId of [0,-1,1.2,'1',Number.MAX_SAFE_INTEGER+1]) assert.equal((await draft(env,{action:'start',minutes:25,taskId})).status,400);
 for(const value of [null,[],{},'start']) assert.equal((await focusRequest({...message('Odak'),focusDraftRequest:value},env,start)).status,400);
 const initial = await draft(env,{action:'start',minutes:5,title:'  Kısa odak  '}); await confirm(env,initial);
 assert.equal(row(env).title,'Kısa odak');
 for(const input of [{action:'pause'},{action:'pause',id:1},{action:'pause',id:1,revision:'1'},{action:'pause',id:2,revision:1}]) assert.ok([400,409].includes((await draft(env,input)).status));
 assert.equal(row(env).status,'running'); assert.equal(row(env).revision,1);
});

test('pause, resume and finish calculate actual elapsed time at approval and exclude paused time',async() => {
 const env = environment(); await confirm(env,await request(env,'25 dakika odaklan'));
 const initialWrites = env.writes;
 const pause = await request(env,'Odağı duraklat',at(60)); assert.equal(env.writes,initialWrites); assert.equal(row(env).status,'running');
 const paused = await confirm(env,pause,at(90)); assert.equal(paused.focusSession.elapsed_seconds,90); assert.equal(paused.focusSession.status,'paused'); assert.equal(row(env).last_started_at_ms,null);
 assert.equal((await focusSnapshot(env,at(180))).focusSession.elapsed_seconds,90);
 const resume = await draft(env,{action:'resume',id:1,revision:2},at(180)); assert.equal(row(env).status,'paused');
 const resumed = await confirm(env,resume,at(200)); assert.equal(resumed.focusSession.status,'running'); assert.equal(resumed.focusSession.elapsed_seconds,90); assert.equal(row(env).last_started_at_ms,at(200).getTime());
 const finish = await request(env,'Odağı bitir',at(260)); assert.equal(row(env).status,'running');
 const finished = await confirm(env,finish,at(290)); assert.equal(finished.focusSession.status,'finished'); assert.equal(finished.focusSession.elapsed_seconds,180); assert.equal(finished.focusTodaySeconds,180); assert.equal(row(env).revision,4);
 assert.equal((await focusSnapshot(env,at(900))).focusSession.elapsed_seconds,180);
});

test('simultaneous starts, stale state and replayed transitions cannot mutate twice',async() => {
 const env = environment();
 const [one,two] = await Promise.all([request(env,'25 dakika odaklan'),request(env,'30 dakika odaklan')]);
 const outcomes = await Promise.all([confirm(env,one),confirm(env,two)]);
 assert.deepEqual(outcomes.map(result => result.status).sort(),[200,409]); assert.equal(count(env),1);
 assert.equal((await request(env,'25 dakika odaklan')).status,409);
 const pause = await request(env,'Odağı duraklat',at(50)),finish = await request(env,'Odağı bitir',at(50));
 const concurrent = await Promise.all([confirm(env,pause,at(60)),confirm(env,pause,at(60))]);
 assert.deepEqual(concurrent.map(result => result.status),[200,200]); assert.equal(row(env).revision,2); assert.equal(row(env).elapsed_seconds,60);
 assert.equal((await confirm(env,finish,at(70))).status,409);
 assert.equal((await request(env,'Odağı duraklat',at(70))).status,409);
 const resume = await request(env,'Odağa devam et',at(80)); await confirm(env,resume,at(80));
 assert.equal((await confirm(env,pause,at(90))).status,409); assert.equal(row(env).status,'running'); assert.equal(row(env).revision,3);
 env.sql.prepare('UPDATE atlas_focus_sessions SET title=? WHERE id=1').run('Değişmiş');
 assert.equal((await confirm(env,finish,at(90))).status,409);
 assert.throws(() => env.sql.prepare("INSERT INTO atlas_focus_sessions(draft_id,title,planned_seconds,status,started_at_ms,started_day,last_started_at_ms,last_operation_id) VALUES('manual','Başka',300,'running',0,'2026-10-25',0,'manual')").run(),/UNIQUE/);
});

test('expired timers are computed read-only, capped, and require approval to finish',async() => {
 const env = environment(); task(env); await confirm(env,await request(env,'Görev 1 için 5 dakika odaklan'));
 const writes = env.writes;
 const expired = await focusSnapshot(env,at(1000));
 assert.equal(expired.focusSession.expired,true); assert.equal(expired.focusSession.remaining_seconds,0); assert.equal(expired.focusSession.elapsed_seconds,300); assert.equal(expired.focusSession.status,'running');
 assert.equal(row(env).elapsed_seconds,0); assert.equal(row(env).status,'running'); assert.equal(env.writes,writes);
 const status = await request(env,'Odak durumum',at(1000)); assert.match(status.text,/bitirmek için onay bekliyor/); assert.equal(env.writes,writes);
 const pause = await request(env,'Odağı duraklat',at(1000)); await confirm(env,pause,at(1000));
 assert.equal(row(env).elapsed_seconds,300); assert.equal((await request(env,'Odağa devam et',at(1100))).status,409);
 const finish = await request(env,'Odağı bitir',at(1100)); await confirm(env,finish,at(1100));
 assert.equal(row(env).status,'finished'); assert.equal(row(env).elapsed_seconds,300); assert.equal(env.sql.prepare('SELECT done FROM atlas_tasks WHERE id=1').get().done,0);
});

test('daily totals use Istanbul session start dates and do not double count paused time',async() => {
 const env = environment(),before = new Date('2026-10-25T20:59:00Z'),after = new Date('2026-10-25T21:01:00Z');
 await confirm(env,await request(env,'25 dakika odaklan',before),before);
 const tomorrow = await focusSnapshot(env,after); assert.equal(tomorrow.focusDay,'2026-10-26'); assert.equal(tomorrow.focusTodaySeconds,0); assert.equal(tomorrow.focusSession.elapsed_seconds,120); assert.equal(tomorrow.focusTodayLabel,'Bugün başlayan oturumlar');
 await confirm(env,await request(env,'Odağı bitir',after),after);
 await confirm(env,await request(env,'5 dakika odaklan',after),after);
 const later = new Date(after.getTime()+60000); await confirm(env,await request(env,'Odağı duraklat',later),later);
 const state = await focusSnapshot(env,new Date(after.getTime()+300000)); assert.equal(state.focusTodaySeconds,60); assert.equal(state.focusSession.elapsed_seconds,60);
 const year = environment(),newYear = new Date('2026-12-31T21:00:00Z'); await confirm(year,await request(year,'5 dakika odaklan',newYear),newYear); assert.equal(row(year).started_day,'2027-01-01');
});

test('the 200-session cap is enforced again at confirmation and preserves history',async() => {
 const env = environment(),preview = await request(env,'25 dakika odaklan');
 const insert = env.sql.prepare("INSERT INTO atlas_focus_sessions(draft_id,title,planned_seconds,elapsed_seconds,status,started_at_ms,started_day,finished_at_ms,last_operation_id) VALUES(?,?,300,60,'finished',?,'2026-10-25',?,?)");
 for(let i=0;i<200;i++) insert.run('old-'+i,'Önceki odak '+i,start.getTime(),start.getTime()+60000,'old-'+i);
 assert.equal((await confirm(env,preview)).status,409); assert.equal(count(env),200);
 assert.equal((await request(env,'25 dakika odaklan')).status,409); assert.equal(count(env),200);
 assert.equal((await focusSnapshot(env,start)).focusTodaySeconds,12000);
});

test('missing storage, migration and unrelated chat return safe results without external calls',async() => {
 assert.equal(await request({},'Merhaba'),null);
 assert.equal((await request({},'Odak durumum')).status,503);
 assert.deepEqual(await focusSnapshot({},start),{focusSession:null,focusTodaySeconds:0,focusTodayLabel:'Bugün başlayan oturumlar',focusDay:'2026-10-25',focusAvailable:false});
 const env = environment(); env.sql.exec('DROP TABLE atlas_focus_sessions');
 assert.equal((await focusSnapshot(env,start)).focusAvailable,false); assert.equal((await request(env,'25 dakika odaklan')).status,503);
 const noSecret = environment(); delete noSecret.SESSION_SECRET;
 assert.equal((await request(noSecret,'25 dakika odaklan')).status,503); assert.equal(count(noSecret),0);
});
