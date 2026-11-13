import {test} from 'node:test';import assert from 'node:assert/strict';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.js';

// Minimal D1 shape: reads return the seeded rows, writes append to the same store.
function fakeDb(seed={}){
 const store=new Map(Object.entries(seed).map(([table,rows])=>[table,rows.map(row=>({...row}))]));
 const db={
  prepare(sql){
   let args=[];
   const api={
    bind(...values){args=values;return api;},
    async all(){const table=sql.match(/FROM (\w+)/u)?.[1];return {results:store.get(table)||[]};},
    async run(){
     const match=sql.match(/INSERT OR IGNORE INTO (\w+)\(([^)]+)\)/u);
     if(!match)throw new Error('unsupported write');
     const columns=match[2].split(',');
     const row=Object.fromEntries(columns.map((column,index)=>[column,args[index]]));
     const rows=store.get(match[1])||[];
     if(!rows.some(existing=>existing.id===row.id))rows.push(row);
     store.set(match[1],rows);
     return {meta:{changes:1}};
    }
   };
   return api;
  },
  async batch(statements){return Promise.all(statements.map(statement=>statement.all()));}
 };
 return {db,store};
}

test('an export carries a verifiable digest and a tampered copy is refused',async()=>{
 const {db}=fakeDb({atlas_memories:[{id:1,text:'kahveyi sade içerim',created_at:'2026-01-01T00:00:00Z'}],atlas_notes:[{id:1,text:'not',created_at:'2026-01-01T00:00:00Z',archived_at:null,revision:1}]});
 const backup=await createBackup({format:'json'},{MEMORY_DB:db},new Date('2026-05-05T10:00:00Z'));
 assert.equal(backup.status,200);
 const parsed=JSON.parse(backup.content);
 assert.match(parsed.integrity,/^sha256:[0-9a-f]{64}$/u);
 assert.equal(parsed.restoreSupported,false,'the app still advertises export-only');
 assert.deepEqual(await verifyBackup(backup.content),{ok:true,data:parsed.data});
 parsed.data.memories[0].text='değiştirildi';
 const tampered=await verifyBackup(JSON.stringify(parsed));
 assert.equal(tampered.ok,false);
 assert.equal(tampered.reason,'özet uyuşmuyor');
 assert.equal((await restoreBackup(JSON.stringify(parsed),{MEMORY_DB:fakeDb().db})).status,400,'a tampered file is never restored');
});

test('a verified export restores into an empty database row for row',async()=>{
 const seed={atlas_memories:[{id:1,text:'bir',created_at:'2026-01-01T00:00:00Z'},{id:2,text:'iki',created_at:'2026-01-02T00:00:00Z'}],atlas_notes:[{id:7,text:'not',created_at:'2026-01-01T00:00:00Z',archived_at:null,revision:3}]};
 const source=fakeDb(seed);
 const backup=await createBackup({format:'json'},{MEMORY_DB:source.db},new Date('2026-05-05T10:00:00Z'));
 const target=fakeDb();
 const restored=await restoreBackup(backup.content,{MEMORY_DB:target.db});
 assert.equal(restored.status,200);
 assert.equal(restored.restored,3);
 assert.deepEqual(target.store.get('atlas_memories').map(row=>row.text).sort(),['bir','iki']);
 assert.equal(target.store.get('atlas_notes')[0].revision,3);
 const again=await restoreBackup(backup.content,{MEMORY_DB:target.db});
 assert.equal(again.status,200,'restoring twice stays idempotent');
 assert.equal(target.store.get('atlas_memories').length,2);
});
