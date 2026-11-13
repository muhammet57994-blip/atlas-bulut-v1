import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
import {sweepExpired,maybeSweep,resetSweepThrottle} from '../src/cleanup.js';
import {createWorker} from '../src/worker.js';
const DAY=86400000;
function setup(){const db=new DatabaseSync(':memory:');for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));return db;}
function env(db){return {MEMORY_DB:{prepare(sql){let args=[];const wrap={bind(...values){args=values;return wrap;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};return wrap;}}};}
const iso=value=>new Date(value).toISOString();

function seed(db,now){
 const old=iso(now-31*DAY),fresh=iso(now-1000);
 db.prepare('INSERT INTO atlas_instagram_oauth VALUES(?,?)').run('old',Math.floor((now-2*3600000)/1000));
 db.prepare('INSERT INTO atlas_instagram_oauth VALUES(?,?)').run('fresh',Math.floor((now+600)/1000));
 const receipt='INSERT INTO atlas_offline_receipts(id,type,payload_hash,operation_id,target_id,expected_revision,before_json,after_json,title,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)';
 db.prepare(receipt).run('o-old','note-create','a'.repeat(64),'op-old',null,0,null,'{"text":"old note"}','t',old);
 db.prepare(receipt).run('o-new','note-create','b'.repeat(64),'op-new',null,0,null,'{"text":"new note"}','t',fresh);
 const multi='INSERT INTO atlas_multi_receipts(id,selection_hash,items_json,expected_epoch,created_at) VALUES(?,?,?,?,?)';
 db.prepare(multi).run('m-old','h','[{"kind":"task","id":"x","title":"old task","due_date":""}]',null,old);
 db.prepare(multi).run('m-new','h','[{"kind":"task","id":"y","title":"new task","due_date":""}]',null,fresh);
 db.prepare('INSERT INTO atlas_instagram_snapshots(day,captured_at,payload) VALUES(?,?,?)').run('2025-01-01',iso(now-200*DAY),'[]');
 db.prepare('INSERT INTO atlas_instagram_snapshots(day,captured_at,payload) VALUES(?,?,?)').run('2026-01-01',fresh,'[]');
 const budget='INSERT INTO atlas_budget_operations(id,budget_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)';
 db.prepare(budget).run('b-old','budget-old','create',0,null,'{"month":"2025-01","category":"market","amount_minor":1000,"currency":"TRY","archived":0}',old);
 db.prepare(budget).run('b-new','budget-new','create',0,null,'{"month":"2026-01","category":"market","amount_minor":1000,"currency":"TRY","archived":0}',fresh);
 const waiting='INSERT INTO atlas_waiting_operations(id,waiting_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)';
 db.prepare(waiting).run('w-old','wait-old','create',0,null,'{"who":"A","who_key":"a","what":"old","what_key":"old","kind":"reply","followup_date":"","last_contact_date":"","status":"waiting","archived":0}',old);
 db.prepare(waiting).run('w-new','wait-new','create',0,null,'{"who":"B","who_key":"b","what":"new","what_key":"new","kind":"reply","followup_date":"","last_contact_date":"","status":"waiting","archived":0}',fresh);
}

test('the sweep removes expired state and old receipts but keeps recent rows',async()=>{
 const db=setup(),now=Date.now();seed(db,now);
 const result=await sweepExpired(env(db),new Date(now));
 assert.deepEqual(result.skipped,[]);
 for(const [name,count] of Object.entries({oauthState:1,offlineReceipts:1,multiReceipts:1,snapshots:1,budgetOperations:1,waitingOperations:1,billOperations:0}))assert.equal(result.deleted[name],count,name);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_instagram_oauth WHERE state_hash='old'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_instagram_oauth WHERE state_hash='fresh'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_offline_receipts WHERE id='o-old'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_offline_receipts WHERE id='o-new'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_multi_receipts WHERE id='m-old'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_multi_receipts WHERE id='m-new'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_instagram_snapshots WHERE day='2025-01-01'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_budget_operations WHERE id='b-old'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_waiting_operations WHERE id='w-old'").get().n,0);
 db.close();
});

test('recent history still cannot be deleted by hand',async()=>{
 const db=setup(),now=Date.now();seed(db,now);
 assert.throws(()=>db.prepare("DELETE FROM atlas_offline_receipts WHERE id='o-new'").run(),/immutable offline receipt/u);
 assert.throws(()=>db.prepare("DELETE FROM atlas_multi_receipts WHERE id='m-new'").run(),/immutable multi receipt/u);
 db.close();
});

test('a second sweep is a no-op and a missing database is skipped',async()=>{
 const db=setup(),now=Date.now();seed(db,now);
 await sweepExpired(env(db),new Date(now));
 const again=await sweepExpired(env(db),new Date(now));
 assert.ok(Object.values(again.deleted).every(count=>count===0),JSON.stringify(again.deleted));
 const missing=await sweepExpired({},new Date(now));
 assert.deepEqual(missing.skipped,['MEMORY_DB']);
 db.close();
});

test('the cron handler sweeps through ctx.waitUntil',async()=>{
 const db=setup(),now=Date.now();seed(db,now);
 const pending=[];
 await createWorker().scheduled({},env(db),{waitUntil:promise=>pending.push(promise)});
 await Promise.all(pending);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM atlas_instagram_oauth WHERE state_hash='old'").get().n,0);
 assert.equal(pending.length,1);
 db.close();
});

test('the opportunistic sweep is throttled per isolate',async()=>{
 const db=setup(),now=Date.now();seed(db,now);
 resetSweepThrottle();
 const first=await maybeSweep(env(db),new Date(now),3600000);
 assert.ok(first,'the first call sweeps');
 const second=await maybeSweep(env(db),new Date(now),3600000);
 assert.equal(second,null,'the second call is throttled');
 resetSweepThrottle();
 db.close();
});