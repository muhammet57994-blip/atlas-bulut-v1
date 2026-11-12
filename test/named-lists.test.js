import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {listsCommand,listsRequest,readLists,latestListsChange} from '../src/named-lists.js';
import {signDraft,verifyDraft} from '../src/daily-signing.js';

const now=new Date('2026-10-25T12:00:00Z');
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
const environment=()=>({MEMORY_DB:database(),SESSION_SECRET:'test-lists-secret-at-least-thirty-two-characters'});
const command=(text,env,at=now)=>listsRequest({messages:[{role:'user',text}]},env,at);
const draft=(input,env,at=now)=>listsRequest({listsDraftRequest:input},env,at);
const approve=(r,env,at=now,text='Liste değişikliğini onaylıyorum')=>listsRequest({messages:[{role:'user',text}],listsConfirmation:{token:r.listsDraft.token,confirmed:true}},env,at);
const count=(env,table)=>env.MEMORY_DB.sql.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
async function create(env,input={}){const r=await draft({action:'create',title:'Market',kind:'list',...input},env);assert.ok(r.listsDraft,JSON.stringify(r));const saved=await approve(r,env);assert.equal(saved.status,200,JSON.stringify(saved));return saved.listItems.find(i=>i.id===saved.listsSaved.list_id);}
async function change(env,input){const r=await draft(input,env);assert.ok(r.listsDraft,JSON.stringify(r));return approve(r,env);}

test('list command recognizer is deterministic and only full approval is a confirmation',()=>{
 for(const text of ['Market listesi oluştur','Market listesine iki litre süt ekle','Market listesine süt, yumurta ve kahve ekle','Reels projesi oluştur','Reels projesine çekim adımı ekle','Reels projesinin çekim adımını tamamla','Listelerimi göster','Projelerimi göster','Liste değişikliğini geri al'])assert.ok(listsCommand(text),text);
 assert.deepEqual(listsCommand('Liste değişikliğini onaylıyorum.'),{action:'confirm'});
 for(const text of ['merhaba','onaylıyorum','Liste değişikliğini onaylıyorum demem mi gerekiyor','Son değişikliği geri al','Bir proje yapmak istiyorum'])assert.equal(listsCommand(text),null,text);
});
test('creating is preview only and requires explicit signed approval, with idempotent replay',async()=>{
 const env=environment(),r=await command('Market listesi oluştur',env);
 assert.equal(r.status,200);assert.equal(r.listsDraft.kind,'lists');assert.equal(count(env,'atlas_lists'),0);assert.equal(count(env,'atlas_list_changes'),0);
 assert.equal((await approve(r,env,now,'evet')).status,400);assert.equal((await command('Liste değişikliğini onaylıyorum',env)).status,400);
 assert.equal((await listsRequest({listsConfirmation:{confirmed:true,token:r.listsDraft.token}},env,now)).status,400);
 assert.equal((await listsRequest({messages:[{role:'user',text:'Liste değişikliğini onaylıyorum'}],listsConfirmation:{confirmed:false,token:r.listsDraft.token}},env,now)).status,400);
 const saved=await approve(r,env);assert.equal(saved.status,200);assert.equal(saved.listItems[0].title,'market');assert.equal(saved.listItems[0].revision,1);
 assert.equal((await approve(r,env)).listsSaved.id,saved.listsSaved.id);assert.equal(count(env,'atlas_lists'),1);assert.equal(count(env,'atlas_list_changes'),1);
});
test('voice adds quantified and multiple items, projects have phases and progress',async()=>{
 const env=environment();await create(env);
 const milk=await command('Market listesine iki litre süt ekle',env);assert.match(milk.text,/2 litre süt/);assert.equal((await readLists(env)).listItems[0].items.length,0);
 let saved=await approve(milk,env);assert.equal(saved.listItems[0].items[0].quantity,'2 litre');assert.equal(saved.listItems[0].items[0].title,'süt');
 saved=await approve(await command('Market listesine yumurta ve kahve ekle',env),env);assert.equal(saved.listItems[0].items.length,3);
 await approve(await command('Reels projesi oluştur',env),env);await approve(await command('Reels projesine çekim adımı ekle',env),env);
 saved=await approve(await command('Reels projesinin çekim adımını başlat',env),env);let project=saved.listItems.find(r=>r.kind==='project');assert.equal(project.items[0].status,'doing');assert.equal(project.progress.percent,0);
 saved=await approve(await command('Reels projesinin çekim adımını tamamla',env),env);project=saved.listItems.find(r=>r.kind==='project');assert.equal(project.items[0].done,true);assert.deepEqual(project.progress,{done:1,total:1,percent:100});
 saved=await approve(await command('Reels projesinin çekim adımını yeniden aç',env),env);assert.equal(saved.listItems.find(r=>r.kind==='project').progress.done,0);
 const shown=await command('Market listesini göster',env);assert.match(shown.text,/2 litre süt/);assert.ok(shown.selectedListId);assert.equal((await command('Projelerimi göster',env)).listsView,'project');
});
test('all item and list changes remain previews; edit, rename, archive and restore retain identity',async()=>{
 const env=environment(),list=await create(env,{items:[{title:'Süt',quantity:2},{title:'Kahve'}]}),item=list.items[0];
 const proposed=await draft({action:'edit-item',listId:list.id,itemId:item.id,title:'Yulaf sütü',quantity:'3 litre'},env);assert.equal((await readLists(env)).listItems[0].items[0].title,'Süt');
 let result=await approve(proposed,env);assert.equal(result.listItems[0].items[0].quantity,'3 litre');assert.equal(result.listItems[0].items[0].id,item.id);
 result=await change(env,{action:'rename',listId:list.id,title:'Alışveriş'});assert.equal(result.listItems[0].title,'Alışveriş');
 result=await change(env,{action:'complete-item',listId:list.id,itemId:item.id});assert.deepEqual(result.listItems[0].progress,{done:1,total:2,percent:50});
 result=await change(env,{action:'archive-item',listId:list.id,itemId:item.id});assert.deepEqual(result.listItems[0].progress,{done:0,total:1,percent:0});assert.equal(result.listItems[0].items.length,2);
 assert.equal((await draft({action:'edit-item',listId:list.id,itemId:item.id,title:'Changed'},env)).status,409);
 await change(env,{action:'restore-item',listId:list.id,itemId:item.id});
 result=await change(env,{action:'archive',listId:list.id});assert.equal(result.listItems.length,0);assert.equal(result.archivedListItems[0].id,list.id);assert.equal(count(env,'atlas_lists'),1);
 assert.equal((await draft({action:'add-items',listId:list.id,items:[{title:'Çay'}]},env)).status,409);
 result=await change(env,{action:'restore',listId:list.id});assert.equal(result.listItems[0].items.length,2);assert.equal(result.archivedListItems.length,0);
});
test('quantity previews show every proposed item and preserve decimal commas',async()=>{
 const env=environment(),createDraft=await draft({action:'create',title:'Market',kind:'list',items:[{title:'Süt',quantity:'2 litre'},{title:'Çay',quantity:'1 paket'}]},env);
 assert.match(createDraft.text,/2 litre Süt/);assert.match(createDraft.text,/1 paket Çay/);await approve(createDraft,env);
 const r=await command('Market listesine 1,5 kilo elma, iki paket makarna ve 0,5 litre süt ekle',env);assert.ok(r.listsDraft,JSON.stringify(r));const saved=await approve(r,env);assert.deepEqual(saved.listItems[0].items.slice(2).map(i=>[i.title,i.quantity]),[['elma','1,5 kilo'],['makarna','2 paket'],['süt','0,5 litre']]);
 for(const text of ['Market listesine -2 süt ekle','Market listesine 0 litre su ekle','Market listesine 2litre süt ekle'])assert.equal((await command(text,env)).status,400,text);
 const list=saved.listItems[0],item=list.items[0];await change(env,{action:'edit-item',listId:list.id,itemId:item.id,quantity:'3 litre'});
 assert.match((await draft({action:'undo'},env)).text,/2 litre Süt/);
});
test('quantity validation trims whitespace before rejecting zero and negative values',async()=>{
 const env=environment();
 for(const quantity of [' -2 kilo ',' 0 litre '])assert.equal((await draft({action:'create',title:'Market',kind:'list',items:[{title:'Süt',quantity}]},env)).status,400,quantity);
 assert.equal(count(env,'atlas_lists'),0);
 const r=await draft({action:'create',title:'Market',kind:'list',items:[{title:'Süt',quantity:' 2 litre '}]},env);assert.equal(r.status,200);assert.match(r.text,/2 litre Süt/);
 const saved=await approve(r,env);assert.equal(saved.listItems[0].items[0].quantity,'2 litre');
});
test('approval rejects expiry, tampering, cross-purpose and malformed signed data without writes',async()=>{
 const env=environment(),r=await draft({action:'create',title:'Market',kind:'list'},env),send=token=>listsRequest({messages:[{role:'user',text:'Liste değişikliğini onaylıyorum'}],listsConfirmation:{confirmed:true,token}},env,now);
 for(const token of ['broken',r.listsDraft.token.slice(0,-4)+'AAAA'])assert.equal((await send(token)).status,409);
 assert.equal((await approve(r,env,new Date(now.getTime()+1800000))).status,409);assert.equal((await approve(r,env,new Date(now.getTime()-1))).status,409);
 const payload=await verifyDraft(env,r.listsDraft.token,'lists',now);
 assert.equal((await send(await signDraft(env,'daily',payload,now))).status,409);
 assert.equal((await send(await signDraft(env,'lists',{...payload,expectedRevision:-1},now))).status,409);
 assert.equal((await listsRequest({listsDraftRequest:{action:'create',title:'A',kind:'list'},listsConfirmation:{token:r.listsDraft.token,confirmed:true}},env,now)).status,400);
 assert.equal(count(env,'atlas_lists'),0);assert.equal(count(env,'atlas_list_changes'),0);
});
test('stale list revision rejects approval after another device changes any item',async()=>{
 const env=environment(),list=await create(env,{items:[{title:'Süt'}]}),first=await draft({action:'rename',listId:list.id,title:'Alışveriş'},env),second=await draft({action:'complete-item',listId:list.id,itemId:list.items[0].id},env);
 await approve(first,env);assert.equal((await approve(second,env)).status,409);assert.equal((await readLists(env)).listItems[0].items[0].done,false);
 assert.equal((await draft({action:'rename',listId:list.id,title:'Stale',revision:1},env)).status,409);
});
test('full state hash rejects changed aggregate even if a concurrent writer forgot revision',async()=>{
 const env=environment(),list=await create(env),r=await draft({action:'rename',listId:list.id,title:'Other'},env);
 const raw=env.MEMORY_DB.sql.prepare('SELECT state_json FROM atlas_lists WHERE id=?').get(list.id),state=JSON.parse(raw.state_json);state.title='Other device';env.MEMORY_DB.sql.prepare('UPDATE atlas_lists SET state_json=? WHERE id=?').run(JSON.stringify(state),list.id);
 assert.equal((await approve(r,env)).status,409);assert.equal(count(env,'atlas_list_changes'),1);
});
test('CAS inside atomic batch rejects a writer racing between validation and write',async()=>{
 const env=environment(),list=await create(env),r=await draft({action:'rename',listId:list.id,title:'Proposed'},env),batch=env.MEMORY_DB.batch.bind(env.MEMORY_DB);let injected=false;
 env.MEMORY_DB.batch=async statements=>{if(!injected){injected=true;env.MEMORY_DB.sql.prepare('UPDATE atlas_lists SET revision=revision+1 WHERE id=?').run(list.id);}return batch(statements);};
 assert.equal((await approve(r,env)).status,409);assert.equal((await readLists(env)).listItems[0].title,'Market');assert.equal(count(env,'atlas_list_changes'),1);
});
test('atomic journal failure rolls back list state, and absence of batch never mutates',async()=>{
 const env=environment(),list=await create(env),r=await draft({action:'rename',listId:list.id,title:'Proposed'},env);
 env.MEMORY_DB.sql.exec("CREATE TRIGGER journal_failure BEFORE INSERT ON atlas_list_changes BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
 assert.equal((await approve(r,env)).status,503);assert.equal((await readLists(env)).listItems[0].title,'Market');assert.equal((await readLists(env)).listItems[0].revision,1);
 env.MEMORY_DB.sql.exec('DROP TRIGGER journal_failure');delete env.MEMORY_DB.batch;assert.equal((await approve(r,env)).status,503);assert.equal((await readLists(env)).listItems[0].title,'Market');
});
test('duplicate naming races cannot create two active names; replay remains safe',async()=>{
 const env=environment(),a=await draft({action:'create',title:'İş',kind:'project'},env),b=await draft({action:'create',title:'İŞ',kind:'project'},env);
 await approve(a,env);assert.equal((await approve(b,env)).status,409);assert.equal(count(env,'atlas_lists'),1);
 assert.equal((await draft({action:'create',title:'iş',kind:'project'},env)).status,409);
 await create(env,{title:'iş',kind:'list'});assert.equal(count(env,'atlas_lists'),2);
});
test('undo has own signed preview, CAS, replay protection and retains archived new list',async()=>{
 const env=environment(),list=await create(env,{items:[{title:'Çay'}]});await change(env,{action:'rename',listId:list.id,title:'Alışveriş'});
 const latest=await latestListsChange(env);assert.equal(latest.source,'lists');assert.equal(latest.created_at,now.toISOString());
 const undo=await draft({action:'undo',changeId:latest.id},env);assert.equal((await readLists(env)).listItems[0].title,'Alışveriş');
 let saved=await approve(undo,env);assert.equal(saved.listItems[0].title,'Market');assert.equal(saved.listItems[0].revision,3);assert.equal(saved.listChangeItems.find(i=>i.id===latest.id).undone,true);
 await approve(undo,env);assert.equal(count(env,'atlas_list_changes'),3);assert.equal((await readLists(env)).listItems[0].revision,3);
 saved=await approve(await command('Liste değişikliğini geri al',env),env);assert.equal(saved.listItems.length,0);assert.equal(saved.archivedListItems[0].id,list.id);assert.equal(count(env,'atlas_lists'),1);assert.equal(await latestListsChange(env),null);
});
test('undo rejects stale or nonlatest change, including activity on a different list',async()=>{
 const env=environment(),a=await create(env),latest=await latestListsChange(env),undo=await draft({action:'undo',changeId:latest.id},env);await create(env,{title:'İş',kind:'project'});
 assert.equal((await approve(undo,env)).status,409);assert.equal((await draft({action:'undo',changeId:latest.id},env)).status,409);assert.equal((await readLists(env)).listItems.length,2);
 const newUndo=await draft({action:'undo'},env);await change(env,{action:'rename',listId:a.id,title:'Other'});assert.equal((await approve(newUndo,env)).status,409);
});
test('undo guard inside batch detects concurrent newer journal entry on another list',async()=>{
 const env=environment(),a=await create(env),b=await create(env,{title:'İş',kind:'project'}),undo=await draft({action:'undo'},env),batch=env.MEMORY_DB.batch.bind(env.MEMORY_DB);
 env.MEMORY_DB.batch=async statements=>{const row=env.MEMORY_DB.sql.prepare('SELECT state_json FROM atlas_lists WHERE id=?').get(a.id);env.MEMORY_DB.sql.prepare("INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone) VALUES(?,?,'rename','Other',?,?,1,2,?,0)").run(crypto.randomUUID(),a.id,row.state_json,row.state_json,new Date(now.getTime()+1).toISOString());return batch(statements);};
 assert.equal((await approve(undo,env)).status,409);assert.equal((await readLists(env)).listItems.find(i=>i.id===b.id).archived,false);
});
test('ambiguous item titles require explicit item id and archived titles are not silently selected',async()=>{
 const env=environment(),list=await create(env,{items:[{title:'Süt'},{title:'süt'}]});
 assert.equal((await command('Market listesinin süt maddesini tamamla',env)).status,409);
 await change(env,{action:'complete-item',listId:list.id,itemId:list.items[0].id});assert.equal((await readLists(env)).listItems[0].progress.done,1);
 await change(env,{action:'archive',listId:list.id});assert.equal((await command('Market listesine çay ekle',env)).status,404);assert.match((await command('Arşivlenmiş listelerimi göster',env)).text,/Market/);
});
test('bounded titles, quantities, requests and 100 total items including archive',async()=>{
 const env=environment();
 for(const input of [{action:'create',title:'',kind:'list'},{action:'create',title:'x'.repeat(201),kind:'list'},{action:'create',title:'bad\ncontrol',kind:'list'},{action:'create',title:'Good',kind:'other'},{action:'create',title:'Good',kind:'list',items:Array.from({length:21},()=>({title:'A'}))},{action:'create',title:'Good',kind:'list',items:[{title:'A',quantity:'x'.repeat(41)}]},{action:'create',title:'Good',kind:'list',items:[{title:'A',quantity:0}]}])assert.equal((await draft(input,env)).status,400,JSON.stringify(input));
 const list=await create(env);
 for(let n=0;n<5;n++)await change(env,{action:'add-items',listId:list.id,items:Array.from({length:20},(_,i)=>({title:`Item ${n*20+i}`}))});
 assert.equal((await readLists(env)).listItems[0].items.length,100);
 assert.equal((await draft({action:'add-items',listId:list.id,items:[{title:'Overflow'}]},env)).status,409);
 const item=(await readLists(env)).listItems[0].items[0];await change(env,{action:'archive-item',listId:list.id,itemId:item.id});assert.equal((await draft({action:'add-items',listId:list.id,items:[{title:'Overflow'}]},env)).status,409);
});
test('30 list total limit is enforced again at approval and retains replay safety',async()=>{
 const env=environment(),overflow=await draft({action:'create',title:'Overflow',kind:'list'},env);
 for(let i=0;i<30;i++)await create(env,{title:`List ${i}`});
 assert.equal((await approve(overflow,env)).status,409);assert.equal(count(env,'atlas_lists'),30);assert.equal((await draft({action:'create',title:'Another',kind:'list'},env)).status,409);
});
test('literal markup and SQL-like titles are retained safely, missing storage fails closed',async()=>{
 const env=environment(),title="x'); DROP TABLE atlas_lists; -- <img src=x onerror=alert(1)>";await create(env,{title});assert.equal((await readLists(env)).listItems[0].title,title);
 assert.equal(await command('Merhaba',{}),null);assert.equal((await command('Listelerimi göster',{})).status,503);assert.equal((await readLists({})).status,503);
 env.MEMORY_DB.sql.exec('DROP TABLE atlas_list_changes');assert.equal((await command('Listelerimi göster',env)).status,503);
 await assert.rejects(()=>latestListsChange(env));await assert.rejects(()=>latestListsChange({}));
});
test('history storage is bounded, still permits one undo per original and preserves replay',async()=>{
 const env=environment(),list=await create(env),last=await draft({action:'rename',listId:list.id,title:'Last'},env),row=env.MEMORY_DB.sql.prepare('SELECT state_json FROM atlas_lists WHERE id=?').get(list.id);
 const insert=env.MEMORY_DB.sql.prepare("INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone) VALUES(?,?,'rename','History',?,?,1,2,?,1)");
 for(let i=0;i<4998;i++)insert.run(crypto.randomUUID(),list.id,row.state_json,row.state_json,'2020-01-01T00:00:00.000Z');
 const saved=await approve(last,env);assert.equal(saved.status,200);assert.equal(count(env,'atlas_list_changes'),5000);
 assert.equal((await draft({action:'rename',listId:list.id,title:'Overflow'},env)).status,409);
 assert.equal((await approve(last,env)).status,200);assert.equal(count(env,'atlas_list_changes'),5000);
 const undone=await approve(await draft({action:'undo'},env),env);assert.equal(undone.status,200);assert.equal(undone.listItems[0].title,'Market');assert.equal(count(env,'atlas_list_changes'),5001);
});
