import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>value===undefined?undefined:structuredClone(value);
function fakeIDB(){
 const backend={data:new Map(),transactions:[],created:false,tail:Promise.resolve(),failNextPut:false,deleteDatabaseCalls:0};
 const db={objectStoreNames:{contains:()=>backend.created},createObjectStore(){backend.created=true;},close(){},transaction(_name,mode){
  const operations=[],tx={aborted:false,oncomplete:null,onabort:null,onerror:null,abort(){this.aborted=true;},objectStore(){return {
   get(key){const request={};operations.push(()=>{request.result=clone(tx.data.get(key));request.onsuccess?.();});return request;},
   put(value,key){const copied=clone(value);operations.push(()=>{if(backend.failNextPut){backend.failNextPut=false;tx.onerror?.();tx.abort();}else tx.data.set(key,copied);});return {};},
   delete(key){operations.push(()=>tx.data.delete(key));return {};}
  };}};
  backend.transactions.push(mode);backend.tail=backend.tail.then(async()=>{tx.data=clone(backend.data);while(operations.length&&!tx.aborted){await tick();operations.shift()();}if(tx.aborted)tx.onabort?.();else{if(mode==='readwrite')backend.data=tx.data;tx.oncomplete?.();}});return tx;
 }};
 backend.api={open(){const request={};setImmediate(()=>{request.result=db;if(!backend.created)request.onupgradeneeded?.();request.onsuccess?.();});return request;},deleteDatabase(){backend.deleteDatabaseCalls++;throw Error('must never deleteDatabase');}};
 return backend;
}
function load(backend=fakeIDB(),timers={setTimeout,clearTimeout}){
 const notifications=[],network=[],window={indexedDB:backend.api,dispatchEvent(event){notifications.push(event.type);},BroadcastChannel:class{postMessage(value){notifications.push(value);}close(){}}};
 runInNewContext(source,{window,Event,TextEncoder,...timers,fetch:(...args)=>network.push(args)});return {store:window.AtlasOfflineStore,backend,notifications,network};
}
const date='2026-10-25T08:00:00.000Z',etag='a'.repeat(64),listId='list-identifier-000001',itemId='item-identifier-000001';
const snapshot=()=>({version:1,capturedAt:date,notes:[{id:1,text:'Seçilmiş not',revision:0,archived_at:null,etag}],lists:[{id:listId,title:'Market',kind:'list',revision:1,archived:false,items:[{id:itemId,title:'Süt',quantity:'2',status:'todo',archived:false}],etag}]});
const draft=(type='note-create',extra={})=>({id:randomUUID(),type,createdAt:date,...(type==='note-create'?{text:'Yerel not'}:{}),...extra});
const plain=value=>JSON.parse(JSON.stringify(value));

test('store performs no network or private writes on load/read and requires explicit generation-bound enable',async()=>{
 const {store,backend,network}=load();assert.equal(backend.transactions.length,0);assert.equal(await store.read(),null);assert.equal(await store.generation(),0);assert.equal(backend.data.size,0);
 await assert.rejects(store.enable(snapshot()));await assert.rejects(store.saveDraft(draft()));assert.equal(backend.data.size,0);
 const value=await store.enable(snapshot(),0);assert.equal(value.enabled,true);assert.equal(value.generation,0);assert.equal(value.snapshot.notes.length,1);assert.equal(network.length,0);assert.equal(backend.deleteDatabaseCalls,0);
 const read=await store.read();read.snapshot.notes[0].text='Mutated caller';assert.equal((await store.read()).snapshot.notes[0].text,'Seçilmiş not');
});

test('clear atomically deletes private data, retains and increments generation, and blocks late snapshot resurrection',async()=>{
 const backend=fakeIDB(),a=load(backend),b=load(backend);await a.store.enable(snapshot(),0);await a.store.saveDraft(draft());const generation=await a.store.generation();
 assert.equal(await b.store.clear(),1);assert.equal(await a.store.read(),null);assert.equal(await a.store.generation(),1);assert.deepEqual([...backend.data.keys()],['meta']);assert.equal(backend.deleteDatabaseCalls,0);
 await assert.rejects(a.store.enable(snapshot(),generation),/temizlendi/);assert.equal(await a.store.read(),null);assert.equal(await b.store.clear(),2);await a.store.enable(snapshot(),2);assert.equal((await b.store.read()).generation,2);
});

test('parallel tab mutations serialize without lost drafts or exceeding the twenty-draft limit',async()=>{
 const backend=fakeIDB(),a=load(backend),b=load(backend);await a.store.enable(snapshot(),0);
 const outcomes=await Promise.allSettled(Array.from({length:25},(_,i)=>(i%2?a.store:b.store).saveDraft(draft())));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,20);assert.equal((await a.store.read()).drafts.length,20);assert.equal(outcomes.filter(r=>r.status==='rejected').length,5);
 const pending=a.store.saveDraft(draft()),clear=b.store.clear();await assert.rejects(pending);await clear;assert.equal(await a.store.read(),null);
});

test('saveDraft allows only typed operations against the selected snapshot and matching original tag',async()=>{
 const {store}=load();await store.enable(snapshot(),0);
 const inputs=[draft(),draft('note-edit',{targetId:1,expectedTag:etag,text:'Düzeltme'}),draft('list-add',{targetId:listId,expectedTag:etag,title:'Ekmek',quantity:'1'}),draft('list-item-status',{targetId:listId,expectedTag:etag,itemId,status:'done'})];
 for(const input of inputs)await store.saveDraft(input);assert.equal((await store.read()).drafts.length,4);
 for(const input of [draft('note-edit',{targetId:2,expectedTag:etag,text:'Yanlış'}),draft('note-edit',{targetId:1,expectedTag:'b'.repeat(64),text:'Yanlış'}),draft('list-add',{targetId:'other-list-identifier',expectedTag:etag,title:'Yanlış'}),draft('list-item-status',{targetId:listId,expectedTag:etag,itemId:'other-item-identifier',status:'done'})])await assert.rejects(store.saveDraft(input),/uyuşmuyor/);
 const changed=snapshot();changed.notes[0].etag='b'.repeat(64);changed.lists[0].etag='c'.repeat(64);await store.enable(changed,0);assert.deepEqual(plain((await store.read()).drafts),inputs);await store.saveDraft(inputs[1]);assert.equal((await store.read()).drafts.length,4);await assert.rejects(store.saveDraft({...inputs[1],text:'Overwrite'}),/zaten/);
 await store.removeDraft(inputs[0].id);assert.equal((await store.read()).drafts.length,3);await store.removeDraft(inputs[0].id);assert.equal((await store.read()).drafts.length,3);
});

test('schema rejects credentials, signed tokens, unknown nested fields and malformed limits',async()=>{
 const {store}=load();
 for(const mutate of [s=>s.token='secret',s=>s.notes[0].auth='secret',s=>s.lists[0].items[0].token='secret',s=>s.notes.push({...s.notes[0]}),s=>s.notes[0].text='x'.repeat(1001),s=>s.lists[0].title='x'.repeat(201),s=>s.lists[0].items[0].quantity='x'.repeat(41),s=>s.lists[0].items=Array.from({length:101},(_,i)=>({...s.lists[0].items[0],id:'item-identifier-'+String(i).padStart(6,'0')})),s=>s.capturedAt='not a date',s=>s.notes[0].etag='signed.token',s=>s.lists[0].items[0].done=true,s=>s.notes=Array.from({length:21},(_,i)=>({...s.notes[0],id:i+1})),s=>s.lists=Array.from({length:11},(_,i)=>({...s.lists[0],id:'list-identifier-'+String(i).padStart(6,'0')}))]){
  const value=snapshot();mutate(value);await assert.rejects(store.enable(value,0));
 }
 assert.equal(await store.read(),null);await store.enable(snapshot(),0);
 for(const value of [draft('other'),{...draft(),token:'signed.token'},{...draft(),authorization:'secret'},{...draft(),expectedTag:etag},{...draft(),text:''},{...draft(),text:'x'.repeat(1001)},{...draft(),createdAt:'today'},{...draft(),id:'bad'},draft('list-add',{targetId:listId,expectedTag:etag,title:'Item',quantity:42}),draft('list-item-status',{targetId:listId,expectedTag:etag,itemId,status:'deleted'})])await assert.rejects(store.saveDraft(value));
 assert.equal((await store.read()).drafts.length,0);
});

test('archived targets and archived list items cannot receive new mutating drafts',async()=>{
 for(const [alter,input] of [[s=>s.notes[0].archived_at=date,draft('note-edit',{targetId:1,expectedTag:etag,text:'X'})],[s=>s.lists[0].archived=true,draft('list-add',{targetId:listId,expectedTag:etag,title:'X'})],[s=>s.lists[0].items[0].archived=true,draft('list-item-status',{targetId:listId,expectedTag:etag,itemId,status:'done'})]]){
  const {store}=load(),selected=snapshot();alter(selected);await store.enable(selected,0);await assert.rejects(store.saveDraft(input));assert.equal((await store.read()).drafts.length,0);
 }
});

test('local list fields share cloud validation while notes retain multiline text',async()=>{
 const {store}=load();await store.enable(snapshot(),0);
 for(const changes of [{title:'Line\nbreak'},{quantity:'-2'},{quantity:'0 kg'},{quantity:'\t2'},{quantity:'0,00'}])await assert.rejects(store.saveDraft(draft('list-add',{targetId:listId,expectedTag:etag,title:'Süt',quantity:'1',...changes})));
 await store.saveDraft(draft('note-create',{text:'İlk satır\nİkinci satır'}));assert.equal((await store.read()).drafts[0].text,'İlk satır\nİkinci satır');
});

test('stored corruption fails closed; clear can remove corrupt private values without exposing them',async()=>{
 const {store,backend}=load();await store.enable(snapshot(),0);backend.data.get('private').snapshot.token='private-secret';await assert.rejects(store.read());await assert.rejects(store.saveDraft(draft()));assert.equal(await store.clear(),1);assert.equal(await store.read(),null);
 backend.data.set('meta',{generation:'bad'});await assert.rejects(store.generation());await assert.rejects(store.enable(snapshot(),0));
});

test('transaction write failure rolls back private state and generation together',async()=>{
 const {store,backend}=load();await store.enable(snapshot(),0);await store.saveDraft(draft());const before=plain(await store.read());backend.failNextPut=true;await assert.rejects(store.clear());assert.deepEqual(plain(await store.read()),before);assert.equal(await store.generation(),0);
 backend.failNextPut=true;await assert.rejects(store.enable({...snapshot(),capturedAt:'2026-10-26T08:00:00.000Z'},0));assert.deepEqual(plain(await store.read()),before);
});

test('one-MiB aggregate bound and notification payloads contain no private copies',async()=>{
 const {store,notifications}=load(),large=snapshot();large.notes=[];large.lists=Array.from({length:10},(_,l)=>({id:'list-identifier-'+String(l).padStart(6,'0'),title:'Large',kind:'list',revision:1,archived:false,etag,items:Array.from({length:100},(_,i)=>({id:'item-identifier-'+String(i).padStart(6,'0'),title:'\ud800'.repeat(200),quantity:'\ud800'.repeat(40),status:'todo',archived:false}))}));
 await assert.rejects(store.enable(large,0),/1 MiB/);await store.enable(snapshot(),0);await store.saveDraft(draft());await store.clear();assert.ok(notifications.every(value=>value==='changed'||value==='atlas-offline-changed'));assert.equal(await store.read(),null);
});

function manualTimers(){const pending=new Map();let id=0;return {pending,setTimeout(fn,ms){pending.set(++id,{fn,ms});return id;},clearTimeout(key){pending.delete(key);},fire(){for(const {fn} of [...pending.values()])fn();}};}
test('an IndexedDB open that never answers times out and closes a late connection without saving data',async()=>{
 const timers=manualTimers(),request={},backend={api:{open:()=>request}},env=load(backend,timers);let closed=0;
 const pending=env.store.enable(snapshot(),0),rejected=assert.rejects(pending,/yanıt vermedi/);assert.equal([...timers.pending.values()][0].ms,15000);timers.fire();await rejected;
 request.result={close(){closed++;}};request.onsuccess();assert.equal(closed,1);assert.equal(env.notifications.length,0);
});

test('a stalled IndexedDB transaction aborts on timeout and ignores late read callbacks',async()=>{
 const timers=manualTimers(),requests=[];let aborted=0,writes=0;
 const tx={objectStore:()=>({get(){const request={result:undefined};requests.push(request);return request;},put(){writes++;},delete(){writes++;}}),abort(){aborted++;this.onabort?.();}};
 const db={objectStoreNames:{contains:()=>true},transaction:()=>tx,close(){}};
 const backend={api:{open(){const request={};setImmediate(()=>{request.result=db;request.onsuccess();});return request;}}};
 const {store}=load(backend,timers),pending=store.enable(snapshot(),0),rejected=assert.rejects(pending,/yanıt vermedi/);await tick();assert.equal([...timers.pending.values()][0].ms,10000);timers.fire();await rejected;assert.equal(aborted,1);
 for(const request of requests)request.onsuccess();tx.oncomplete();assert.equal(writes,0);
});
