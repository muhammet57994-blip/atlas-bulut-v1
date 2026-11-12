import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {offlineCommand,offlineSnapshot,offlineReview,offlineConfirm} from '../src/offline.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';
import {managementRequest,latestManagementChange} from '../src/record-management.js';
import {listsRequest,latestListsChange} from '../src/named-lists.js';

const now=new Date('2026-10-25T10:00:00Z');
function environment(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={SESSION_SECRET:'offline-test-secret-longer-than-thirty-two-characters',writes:0,beforeWrite:null,afterWrite:null,queries:[]};
 env.MEMORY_DB={sql,prepare(query){env.queries.push(query);const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){if(env.beforeWrite){const hook=env.beforeWrite;env.beforeWrite=null;hook(query,args);}env.writes++;const result={meta:statement.run(...args)};if(env.afterWrite){const hook=env.afterWrite;env.afterWrite=null;hook(query,args);}return result;}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 return env;
}
const sql=env=>env.MEMORY_DB.sql;
const count=(env,table)=>sql(env).prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
function note(env,text='İlk not'){return Number(sql(env).prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)').run(text,now.toISOString()).lastInsertRowid);}
function list(env,{title='Market',kind='list',items=[],archived=false}={}){
 const id=crypto.randomUUID(),state={id,title,kind,archived,items:items.map(item=>({id:crypto.randomUUID(),title:'Süt',quantity:'',status:'todo',archived:false,...item}))};
 sql(env).prepare('INSERT INTO atlas_lists(id,title,title_key,kind,state_json,revision,archived,created_at,updated_at,last_operation_id) VALUES(?,?,?,?,?,1,?,?,?,?)').run(id,title,title.toLocaleLowerCase('tr-TR'),kind,JSON.stringify(state),archived?1:0,now.toISOString(),now.toISOString(),crypto.randomUUID());return state;
}
const local=(type,fields={})=>({id:crypto.randomUUID(),type,createdAt:now.toISOString(),...fields});
const review=(draft,env,at=now)=>offlineReview({draft},env,at);
const confirmation=(r,text='Çevrimdışı taslağı onaylıyorum')=>({messages:[{role:'user',text}],offlineConfirmation:{token:r.offlineDraft.token,confirmed:true}});
const approve=(r,env,at=now)=>offlineConfirm(confirmation(r),env,at);
const selected=(env,noteIds=[],listIds=[])=>offlineSnapshot({noteIds,listIds},env,now);
const noteRow=(env,id)=>sql(env).prepare('SELECT * FROM atlas_notes WHERE id=?').get(id);
const listRow=(env,id)=>sql(env).prepare('SELECT * FROM atlas_lists WHERE id=?').get(id);
async function editDraft(env,targetId,text='Yeni not'){const copy=await selected(env,[targetId]);return local('note-edit',{targetId,expectedTag:copy.offlineSnapshot.notes[0].etag,text});}
async function listDraft(env,targetId,type='list-add',extra={}){const copy=await selected(env,[],[targetId]);return local(type,{targetId,expectedTag:copy.offlineSnapshot.lists[0].etag,...(type==='list-add'?{title:'Yumurta',quantity:'2 adet'}:{}),...extra});}

test('offline navigation only recognizes explicit section commands',()=>{
 for(const command of ['Çevrimdışı kayıtlarımı aç','Çevrimdışı kayıtlarım','Çevrimdışı alanı göster'.replace('alanı','alan'),'Çevrimdışı bölüm aç'])assert.equal(offlineCommand(command),true,command);
 for(const command of ['merhaba','Çevrimdışı taslağı onaylıyorum','Çevrimdışı alanı açmak istiyorum',null,{},'Çevrimdışı kayıtlarımı aç ve hepsini kaydet'])assert.equal(offlineCommand(command),false,String(command));
});

test('snapshot returns only explicitly selected open notes/lists and an exact public field allowlist',async()=>{
 const env=environment(),one=note(env,'Seçilen not'),two=note(env,'Özel diğer not'),first=list(env,{items:[{title:'Seçilen madde'}]}),other=list(env,{title:'Özel diğer liste',items:[{title:'Özel madde'}]});
 const empty=await selected(env);assert.deepEqual(empty.offlineSnapshot.notes,[]);assert.deepEqual(empty.offlineSnapshot.lists,[]);
 const r=await selected(env,[one],[first.id]);assert.equal(r.status,200);assert.equal(r.offlineSnapshot.version,1);assert.equal(r.offlineSnapshot.capturedAt,now.toISOString());assert.deepEqual(r.offlineSnapshot.notes.map(n=>n.id),[one]);assert.deepEqual(r.offlineSnapshot.lists.map(l=>l.id),[first.id]);
 assert.deepEqual(Object.keys(r.offlineSnapshot.notes[0]).sort(),['id','text','revision','archived_at','etag'].sort());assert.deepEqual(Object.keys(r.offlineSnapshot.lists[0]).sort(),['id','title','kind','revision','archived','items','etag'].sort());assert.deepEqual(Object.keys(r.offlineSnapshot.lists[0].items[0]).sort(),['id','title','quantity','status','archived'].sort());
 const serialized=JSON.stringify(r);for(const privateValue of ['Özel diğer not','Özel diğer liste','Özel madde',env.SESSION_SECRET,'last_operation_id','offline_draft_id','state_json'])assert.ok(!serialized.includes(privateValue),privateValue);
 assert.match(r.offlineSnapshot.notes[0].etag,/^[a-f0-9]{64}$/u);assert.match(r.offlineSnapshot.lists[0].etag,/^[a-f0-9]{64}$/u);assert.equal(env.writes,0);assert.equal(noteRow(env,two).text,'Özel diğer not');assert.ok(listRow(env,other.id));
});

test('snapshot rejects over-selection, duplicates, malformed identifiers and unrelated fields',async()=>{
 const env=environment(),id=note(env),l=list(env);
 for(const input of [null,[],{noteIds:[id]},{noteIds:[],listIds:[],token:'secret'},{noteIds:[],listIds:[],all:true},{noteIds:[id,id],listIds:[]},{noteIds:['1'],listIds:[]},{noteIds:[0],listIds:[]},{noteIds:[1.1],listIds:[]},{noteIds:Array.from({length:21},(_,i)=>i+1),listIds:[]},{noteIds:[],listIds:[l.id,l.id]},{noteIds:[],listIds:['1']},{noteIds:[],listIds:Array.from({length:11},()=>crypto.randomUUID())}])assert.equal((await offlineSnapshot(input,env,now)).status,400,JSON.stringify(input));
 assert.equal((await selected(env,[999])).status,409);sql(env).prepare('UPDATE atlas_notes SET archived_at=? WHERE id=?').run(now.toISOString(),id);assert.equal((await selected(env,[id])).status,409);
 sql(env).prepare('UPDATE atlas_lists SET archived=1 WHERE id=?').run(l.id);assert.equal((await selected(env,[],[l.id])).status,409);assert.equal(env.writes,0);
});

test('local draft review is read-only; multiline note text is preserved on explicit approval',async()=>{
 const env=environment(),text='Birinci satır\nİkinci satır\n\tÜçüncü satır',d=local('note-create',{text}),r=await review(d,env);
 assert.equal(r.status,200);assert.equal(r.offlineDraft.kind,'offline');assert.equal(r.offlineDraft.id,d.id);assert.match(r.text,/Henüz uygulanmadı/);assert.ok(r.text.includes(text));assert.equal(env.writes,0);assert.equal(count(env,'atlas_notes'),0);assert.equal(count(env,'atlas_offline_receipts'),0);
 const saved=await approve(r,env);assert.equal(saved.status,200);assert.equal(saved.offlineSaved.draftId,d.id);const row=sql(env).prepare('SELECT * FROM atlas_notes').get();assert.equal(row.text,text);assert.equal(row.offline_draft_id,d.id);assert.equal(row.revision,0);assert.equal(count(env,'atlas_offline_receipts'),1);assert.equal(env.writes,1);
});

test('malformed local drafts and extra credential/token fields are rejected before writes',async()=>{
 const env=environment(),base=local('note-create',{text:'Not'}),n=note(env),l=list(env,{items:[{}]}),edit=await editDraft(env,n),add=await listDraft(env,l.id),status=await listDraft(env,l.id,'list-item-status',{itemId:l.items[0].id,status:'done'});
 const bad=[null,[],{}, {...base,id:'bad'},{...base,type:'expense-create'},{...base,createdAt:'not a date'},{...base,text:''},{...base,text:'x'.repeat(1001)},{...base,text:'bad\u0000control'},{...base,token:'secret'},{...base,SESSION_SECRET:'secret'},{...base,confirmed:true},{...base,targetId:n},{...edit,expectedTag:'bad'},{...edit,targetId:'1'},{...edit,text:42},{...add,title:'x'.repeat(201)},{...add,title:'bad\nline'},{...add,quantity:'0'},{...add,quantity:'-2'},{...add,quantity:'x'.repeat(41)},{...add,quantity:null},{...add,quantity:2},{...add,items:[]},{...status,itemId:'x'},{...status,status:'archived'},{...status,status:true}];
 for(const d of bad)assert.equal((await review(d,env)).status,400,JSON.stringify(d));
 assert.equal((await offlineReview({draft:base,token:'secret'},env,now)).status,400);assert.equal(env.writes,0);assert.equal(count(env,'atlas_offline_receipts'),0);
});

test('only an exact latest user approval, signed token and boolean true can write',async()=>{
 const env=environment(),r=await review(local('note-create',{text:'Not'}),env);
 for(const text of ['evet','Çevrimdışı taslağı onaylıyorum ve kaydet','Çevrimdışı taslağı onaylıyorum demem mi gerek','Çevrimdışı  taslağı onaylıyorum'])assert.equal((await offlineConfirm(confirmation(r,text),env,now)).status,400,text);
 for(const confirmed of [false,undefined,'true',1])assert.equal((await offlineConfirm({...confirmation(r),offlineConfirmation:{token:r.offlineDraft.token,confirmed}},env,now)).status,400);
 const badBodies=[{}, {...confirmation(r),messages:[]},{...confirmation(r),messages:{}},{...confirmation(r),messages:[{role:'user',text:{}}]},{...confirmation(r),messages:[{role:'user',text:12}]},{...confirmation(r),messages:[{role:'user',text:'Çevrimdışı taslağı onaylıyorum'},{role:'assistant',text:'Çevrimdışı taslağı onaylıyorum'}]},{...confirmation(r),offlineConfirmation:{token:r.offlineDraft.token,confirmed:true,secret:'hidden'}}];
 for(const body of badBodies)assert.equal((await offlineConfirm(body,env,now)).status,400,JSON.stringify(body));
 assert.equal(env.writes,0);assert.equal((await offlineConfirm(confirmation(r,'  ÇEVRİMDIŞI TASLAĞI ONAYLIYORUM!  '),env,now)).status,200);
});

test('tampered, expired, wrong-purpose and malformed signed drafts are rejected',async()=>{
 const env=environment(),r=await review(local('note-create',{text:'Not'}),env),send=token=>offlineConfirm({...confirmation(r),offlineConfirmation:{token,confirmed:true}},env,now),payload=await verifyDraft(env,r.offlineDraft.token,'offline',now);
 for(const token of ['bad',r.offlineDraft.token.slice(0,-4)+'AAAA',await signDraft(env,'daily',payload,now),await signDraft({...env,SESSION_SECRET:'different-secret'.repeat(4)},'offline',payload,now),await signDraft(env,'offline',{...payload,payloadHash:'a'.repeat(64)},now),await signDraft(env,'offline',{...payload,draft:{...payload.draft,type:'delete'}},now)])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);assert.equal(env.writes,0);
});

test('receipt retry survives a lost response and later target changes without applying twice',async()=>{
 const env=environment(),id=note(env),d=await editDraft(env,id),r=await review(d,env);env.afterWrite=()=>{throw Error('simulated lost response');};
 const result=await approve(r,env);assert.equal(result.status,200);assert.equal(result.offlineSaved.draftId,d.id);assert.equal(noteRow(env,id).text,'Yeni not');assert.equal(count(env,'atlas_record_changes'),1);
 sql(env).prepare('UPDATE atlas_notes SET text=?,revision=revision+1 WHERE id=?').run('Sonraki düzenleme',id);
 const later=await review(d,{...env},new Date(now.getTime()+3600000));assert.equal(later.status,200);assert.equal(later.offlineSaved.draftId,d.id);assert.equal(later.offlineDraft,undefined);assert.equal(noteRow(env,id).text,'Sonraki düzenleme');assert.equal(count(env,'atlas_record_changes'),1);assert.equal(count(env,'atlas_offline_receipts'),1);
 const altered=await review({...d,text:'Farklı içerik'},env);assert.equal(altered.status,409);assert.match(altered.error,/başka bir içerik/);assert.equal(noteRow(env,id).text,'Sonraki düzenleme');
});

test('simultaneous approvals of one local draft create a single receipt and mutation',async()=>{
 const env=environment(),d=local('note-create',{text:'Tek not'}),one=await review(d,env),two=await review(d,env);const results=await Promise.all([approve(one,env),approve(two,{...env})]);
 assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(count(env,'atlas_notes'),1);assert.equal(count(env,'atlas_offline_receipts'),1);assert.equal((await approve(one,env)).offlineSaved.draftId,d.id);
});

test('stale note content or archive changes reject both review and outstanding approval',async()=>{
 for(const mutate of [(env,id)=>sql(env).prepare('UPDATE atlas_notes SET text=?,revision=revision+1 WHERE id=?').run('Başka metin',id),(env,id)=>sql(env).prepare('UPDATE atlas_notes SET archived_at=?,revision=revision+1 WHERE id=?').run(now.toISOString(),id),(env,id)=>{sql(env).prepare('UPDATE atlas_notes SET text=?,revision=revision+1 WHERE id=?').run('Geçici',id);sql(env).prepare('UPDATE atlas_notes SET text=?,revision=revision+1 WHERE id=?').run('İlk not',id);},(env,id)=>sql(env).prepare('UPDATE atlas_notes SET text=? WHERE id=?').run('Revizyonsuz değişim',id)]){
  const env=environment(),id=note(env),d=await editDraft(env,id),r=await review(d,env);mutate(env,id);const check=await review(d,env);assert.equal(check.status,409);assert.equal(check.offlineConflict,true);assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_offline_receipts'),0);assert.equal(count(env,'atlas_record_changes'),0);
 }
});

test('list additions and status edits preserve unrelated items and carry revision-bound copies',async()=>{
 const env=environment(),l=list(env,{kind:'project',items:[{title:'İlk adım'},{title:'Diğer adım',status:'doing'}]}),d=await listDraft(env,l.id),r=await review(d,env),before=listRow(env,l.id);
 assert.equal(env.writes,0);await approve(r,env);let row=listRow(env,l.id),state=JSON.parse(row.state_json);assert.equal(row.revision,2);assert.deepEqual(state.items.slice(0,2),l.items);assert.deepEqual(state.items[2],{id:'offline-'+d.id,title:'Yumurta',quantity:'2 adet',status:'todo',archived:false});assert.equal(row.title,before.title);assert.equal(row.kind,before.kind);
 const status=await listDraft(env,l.id,'list-item-status',{itemId:l.items[0].id,status:'done'});await approve(await review(status,env),env);state=JSON.parse(listRow(env,l.id).state_json);assert.equal(state.items[0].status,'done');assert.equal(state.items[1].status,'doing');assert.equal(count(env,'atlas_list_changes'),2);assert.equal(count(env,'atlas_offline_receipts'),2);
});

test('stale list revisions, edits reverted to original, archived records and items cannot apply',async()=>{
 for(const mutate of [(env,l)=>sql(env).prepare('UPDATE atlas_lists SET revision=revision+1 WHERE id=?').run(l.id),(env,l)=>sql(env).prepare('UPDATE atlas_lists SET archived=1,revision=revision+1 WHERE id=?').run(l.id),(env,l)=>{const changed={...l,items:l.items.map(i=>({...i,status:'done'}))};sql(env).prepare('UPDATE atlas_lists SET state_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(changed),l.id);sql(env).prepare('UPDATE atlas_lists SET state_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),l.id);},(env,l)=>sql(env).prepare('UPDATE atlas_lists SET state_json=? WHERE id=?').run(JSON.stringify({...l,title:'Revizyonsuz değişim'}),l.id)]){
  const env=environment(),l=list(env,{items:[{}]}),d=await listDraft(env,l.id),r=await review(d,env);mutate(env,l);assert.equal((await review(d,env)).status,409);assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_list_changes'),0);assert.equal(count(env,'atlas_offline_receipts'),0);
 }
 const env=environment(),l=list(env,{items:[{archived:true}]});const d=await listDraft(env,l.id,'list-item-status',{itemId:l.items[0].id,status:'done'});assert.equal((await review(d,env)).status,409);
});

test('note and list state races after preflight are rejected by the write guard',async()=>{
 for(const type of ['note','list']){
  const env=environment(),n=note(env),l=list(env),d=type==='note'?await editDraft(env,n):await listDraft(env,l.id),r=await review(d,env);
  env.beforeWrite=query=>{assert.match(query,/INSERT INTO atlas_offline_receipts/u);if(type==='note')sql(env).prepare('UPDATE atlas_notes SET text=? WHERE id=?').run('Başka cihaz',n);else sql(env).prepare('UPDATE atlas_lists SET revision=revision+1 WHERE id=?').run(l.id);};
  assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_offline_receipts'),0);assert.equal(count(env,'atlas_record_changes'),0);assert.equal(count(env,'atlas_list_changes'),0);if(type==='list')assert.equal(JSON.parse(listRow(env,l.id).state_json).items.length,0);else assert.equal(noteRow(env,n).text,'Başka cihaz');
 }
});

test('failed record/list journal inserts roll back receipt, target content and revision',async()=>{
 for(const type of ['note','list']){
  const env=environment(),n=note(env),l=list(env),d=type==='note'?await editDraft(env,n):await listDraft(env,l.id),r=await review(d,env),before=type==='note'?noteRow(env,n):listRow(env,l.id);
  sql(env).exec(`CREATE TRIGGER forced_failure BEFORE INSERT ON ${type==='note'?'atlas_record_changes':'atlas_list_changes'} BEGIN SELECT RAISE(ABORT,'forced journal failure'); END;`);
  assert.equal((await approve(r,env)).status,409);assert.deepEqual(type==='note'?noteRow(env,n):listRow(env,l.id),before);assert.equal(count(env,'atlas_offline_receipts'),0);assert.equal(count(env,'atlas_record_changes'),0);assert.equal(count(env,'atlas_list_changes'),0);
 }
});

test('note uniqueness includes archives and rejects duplicate create/edit races atomically',async()=>{
 const env=environment(),n=note(env,'Mevcut'),archived=note(env,'Arşivde');sql(env).prepare('UPDATE atlas_notes SET archived_at=? WHERE id=?').run(now.toISOString(),archived);
 for(const text of ['Mevcut','Arşivde'])assert.equal((await review(local('note-create',{text}),env)).status,409);
 assert.equal((await review(await editDraft(env,n,'Arşivde'),env)).status,409);
 const create=await review(local('note-create',{text:'Yarışan metin'}),env);env.beforeWrite=()=>note(env,'Yarışan metin');assert.equal((await approve(create,env)).status,409);assert.equal(count(env,'atlas_offline_receipts'),0);
 const change=await review(await editDraft(env,n,'Yeni yarış'),env);env.beforeWrite=()=>note(env,'Yeni yarış');assert.equal((await approve(change,env)).status,409);assert.equal(noteRow(env,n).text,'Mevcut');assert.equal(count(env,'atlas_record_changes'),0);assert.equal(count(env,'atlas_offline_receipts'),0);
});

test('100-note capacity includes archives and is enforced again during approval',async()=>{
 const env=environment(),d=local('note-create',{text:'Yeni'}),r=await review(d,env);for(let i=0;i<100;i++)note(env,'Seed '+i);sql(env).exec("UPDATE atlas_notes SET archived_at='2026-10-25'");
 assert.equal((await review(d,env)).status,409);assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_notes'),100);assert.equal(count(env,'atlas_offline_receipts'),0);
 const race=environment(),p=await review(local('note-create',{text:'Yarış'}),race);for(let i=0;i<99;i++)note(race,'Seed '+i);race.beforeWrite=()=>note(race,'Son yer');assert.equal((await approve(p,race)).status,409);assert.equal(count(race,'atlas_notes'),100);assert.equal(count(race,'atlas_offline_receipts'),0);
});

test('100 list items includes archives and capacity cannot be bypassed by a pending preview',async()=>{
 const env=environment(),l=list(env,{items:Array.from({length:99},(_,i)=>({title:'Madde '+i,archived:i%2===0}))}),d=await listDraft(env,l.id),r=await review(d,env);
 assert.equal((await approve(r,env)).status,200);assert.equal(JSON.parse(listRow(env,l.id).state_json).items.length,100);assert.equal((await review(await listDraft(env,l.id),env)).status,409);
 const before=count(env,'atlas_list_changes');assert.equal((await review(d,env)).offlineSaved.draftId,d.id);assert.equal(count(env,'atlas_list_changes'),before);
});

test('offline note edit participates in record-management latest change and approved undo',async()=>{
 const env=environment(),id=note(env,'Eski\nnot'),d=await editDraft(env,id,'Yeni\nnot');await approve(await review(d,env),env);
 const journal=sql(env).prepare('SELECT * FROM atlas_record_changes').get();assert.equal(journal.draft_id,'offline-'+d.id);assert.equal(journal.record_kind,'note');assert.equal(journal.record_id,id);assert.equal(journal.action,'edit');assert.equal((await latestManagementChange(env)).id,journal.id);
 const undo=await managementRequest({managementDraftRequest:{action:'undo'}},env,now);assert.ok(undo.managementDraft,JSON.stringify(undo));const undone=await managementRequest({messages:[{role:'user',text:'Değişikliği onaylıyorum'}],managementConfirmation:{token:undo.managementDraft.token,confirmed:true}},env,now);assert.equal(undone.status,200,JSON.stringify(undone));assert.equal(noteRow(env,id).text,'Eski\nnot');assert.equal(noteRow(env,id).revision,2);assert.equal((await review(d,env)).offlineSaved.draftId,d.id);assert.equal(noteRow(env,id).text,'Eski\nnot');
});

test('offline list mutations participate in list latest history and approved undo',async()=>{
 const env=environment(),l=list(env,{items:[{title:'Korunacak'}]}),d=await listDraft(env,l.id);await approve(await review(d,env),env);
 const journal=sql(env).prepare('SELECT * FROM atlas_list_changes').get();assert.equal(journal.id,'offline-'+d.id);assert.equal(journal.action,'add-items');assert.equal((await latestListsChange(env)).id,journal.id);
 const undo=await listsRequest({listsDraftRequest:{action:'undo'}},env,now);assert.ok(undo.listsDraft,JSON.stringify(undo));const undone=await listsRequest({messages:[{role:'user',text:'Liste değişikliğini onaylıyorum'}],listsConfirmation:{token:undo.listsDraft.token,confirmed:true}},env,now);assert.equal(undone.status,200,JSON.stringify(undone));assert.deepEqual(JSON.parse(listRow(env,l.id).state_json).items,l.items);assert.equal(listRow(env,l.id).revision,3);assert.equal((await review(d,env)).offlineSaved.draftId,d.id);assert.deepEqual(JSON.parse(listRow(env,l.id).state_json).items,l.items);
});

test('receipt and forward-history caps preserve local drafts without mutating target records',async()=>{
 for(const family of ['receipts','notes','lists']){
  const env=environment(),n=note(env),l=list(env),d=family==='notes'?await editDraft(env,n):family==='lists'?await listDraft(env,l.id):local('note-create',{text:'New'}),r=await review(d,env),noteBefore=noteRow(env,n),listBefore=listRow(env,l.id);
  if(family==='receipts'){
   sql(env).exec('DROP TRIGGER atlas_offline_guard; DROP TRIGGER atlas_offline_note_create;');
   sql(env).exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000) INSERT INTO atlas_offline_receipts(id,type,payload_hash,operation_id,target_id,expected_revision,before_json,after_json,title,created_at) SELECT 'seed-'||i,'note-create',printf('%064d',0),'operation-'||i,NULL,0,NULL,'{}','seed','2026-10-25' FROM n;");
  }else if(family==='notes'){
   sql(env).exec('DROP TRIGGER atlas_record_changes_note_guard; DROP TRIGGER atlas_record_changes_note_apply;');
   sql(env).prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at) SELECT 'seed-'||i,'note',?,'edit',0,'{}','{}','2026-10-25' FROM n").run(n);
  }else sql(env).prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone) SELECT 'seed-'||i,?,'add-items','seed','{}','{}',1,2,'2026-10-25',0 FROM n").run(l.id);
  const checked=await review(d,env);assert.equal(checked.status,409,family);assert.equal((await approve(r,env)).status,409,family);assert.deepEqual(noteRow(env,n),noteBefore);assert.deepEqual(listRow(env,l.id),listBefore);assert.equal(count(env,'atlas_offline_receipts'),family==='receipts'?2000:0);
 }
});

test('receipt/history limits are rechecked inside the write when another device takes the last slot',async()=>{
 for(const family of ['receipts','notes','lists']){
  const env=environment(),n=note(env),l=list(env),d=family==='notes'?await editDraft(env,n):family==='lists'?await listDraft(env,l.id):local('note-create',{text:'New'}),r=await review(d,env),noteBefore=noteRow(env,n),listBefore=listRow(env,l.id);
  if(family==='receipts'){
   sql(env).exec('DROP TRIGGER atlas_offline_note_create;');
   sql(env).exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1999) INSERT INTO atlas_offline_receipts(id,type,payload_hash,operation_id,target_id,expected_revision,before_json,after_json,title,created_at) SELECT 'seed-'||i,'note-create',printf('%064d',0),'operation-'||i,NULL,0,NULL,'{\"text\":\"Seed receipt\"}','seed','2026-10-25' FROM n;");
   env.beforeWrite=()=>sql(env).exec("INSERT INTO atlas_offline_receipts VALUES('last-seed','note-create',printf('%064d',0),'last-operation',NULL,0,NULL,'{\"text\":\"Last receipt\"}','seed','2026-10-25')");
  }else if(family==='notes'){
   sql(env).exec('DROP TRIGGER atlas_record_changes_note_guard; DROP TRIGGER atlas_record_changes_note_apply;');
   sql(env).prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<4999) INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at) SELECT 'seed-'||i,'note',?,'edit',0,'{}','{}','2026-10-25' FROM n").run(n);
   env.beforeWrite=()=>sql(env).prepare("INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at) VALUES('last-seed','note',?,'edit',0,'{}','{}','2026-10-25')").run(n);
  }else{
   sql(env).prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<4999) INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone) SELECT 'seed-'||i,?,'add-items','seed','{}','{}',1,2,'2026-10-25',0 FROM n").run(l.id);
   env.beforeWrite=()=>sql(env).prepare("INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone) VALUES('last-seed',?,'add-items','seed','{}','{}',1,2,'2026-10-25',0)").run(l.id);
  }
  const result=await approve(r,env);assert.equal(result.status,409,family);assert.equal(result.offlineConflict,true,family);assert.deepEqual(noteRow(env,n),noteBefore);assert.deepEqual(listRow(env,l.id),listBefore);assert.equal(count(env,'atlas_offline_receipts'),family==='receipts'?2000:0);
 }
});

test('immutable receipts and unavailable storage fail safely without external services',async()=>{
 const env=environment(),d=local('note-create',{text:'Not'});await approve(await review(d,env),env);
 assert.throws(()=>sql(env).exec("UPDATE atlas_offline_receipts SET title='changed'"),/immutable/u);assert.throws(()=>sql(env).exec('DELETE FROM atlas_offline_receipts'),/immutable/u);
 assert.equal((await offlineSnapshot({noteIds:[],listIds:[]},{},now)).status,503);assert.equal((await review(d,{})).status,503);assert.equal((await offlineConfirm({},{})).status,503);
 const broken=environment();sql(broken).exec('DROP TABLE atlas_offline_receipts');assert.equal((await review(d,broken)).status,503);
 const noSecret=environment();delete noSecret.SESSION_SECRET;assert.equal((await review(local('note-create',{text:'Yeni'}),noSecret)).status,503);assert.equal(noSecret.writes,0);
});
