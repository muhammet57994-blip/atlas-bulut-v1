import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {MIGRATIONS,REQUIRED_TABLES,SCHEMA_VERSION,healthSnapshot} from '../src/health.js';
const origin='https://atlas.example';
const password='test-access-password-long-2026';
const allow={limit:async()=>({success:true})};

function database(withSchema=true){
 const sql=new DatabaseSync(':memory:');
 if(withSchema)for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sql,db:{prepare(query){const statement=sql.prepare(query);return {async all(){return {results:statement.all()};},async first(){return statement.get()||null;},async run(){return {meta:statement.run()};}};}}};
}
const env=(overrides={})=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',GEMINI_MODEL:'gemini-3.5-flash-lite',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')},...overrides});
const get=(worker,environment)=>worker.fetch(new Request(origin+'/api/health'),environment);

test('required table list stays in sync with the migration files',()=>{
 const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
 assert.equal(SCHEMA_VERSION,files.at(-1).slice(0,4),'the reported schema version is the latest migration');
 const fromSql=new Set();
 for(const file of files){
  const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8');
  for(const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(atlas_[a-z_]+)/gu))fromSql.add(match[1]);
 }
 assert.deepEqual([...fromSql].sort(),[...REQUIRED_TABLES].sort());
 assert.equal(new Set(REQUIRED_TABLES).size,REQUIRED_TABLES.length);
 assert.deepEqual(MIGRATIONS.map(migration=>migration.name),files,'the ledger names every migration in order');
 for(const migration of MIGRATIONS){
  const sql=readFileSync(new URL('../migrations/'+migration.name,import.meta.url),'utf8');
  const tables=[...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(atlas_[a-z_]+)/gu)].map(match=>match[1]);
  assert.deepEqual(migration.tables,tables,`${migration.name} table list`);
  assert.equal(migration.version,migration.name.slice(0,4));
 }
});

test('missing and out-of-order migrations are named, and record content never leaves',async()=>{
 const {sql,db}=database();
 try{
  sql.exec("INSERT INTO atlas_memories(id,text,created_at) VALUES('1','gizli-kayit-icerigi','2026-11-12T00:00:00Z')");
  // A database that skipped 0011 but received the later migrations: the version
  // stops at the gap and the newer migrations are reported as ahead.
  sql.exec('DROP TABLE atlas_record_changes');
  const body=await (await get(createWorker(),env({MEMORY_DB:db}))).json();
  assert.equal(body.ok,false);
  assert.equal(body.db.reachable,true);
  assert.equal(body.schema.appliedVersion,'0010','the applied version stops at the first gap');
  assert.deepEqual(body.schema.migrations.missing,['0011_record_management.sql']);
  assert.deepEqual(body.schema.migrations.ahead,MIGRATIONS.slice(11).map(migration=>migration.name));
  assert.deepEqual(body.schema.missing,['atlas_record_changes']);
  assert.ok(!JSON.stringify(body).includes('gizli-kayit-icerigi'),'record text is never returned');
  assert.ok(!JSON.stringify(body).toUpperCase().includes('INSERT'));
 }finally{sql.close();}
});

test('health needs no session and reports schema, database and model state',async()=>{
 const {sql,db}=database();
 try{
  const response=await get(createWorker(),env({MEMORY_DB:db}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('X-ATLAS-Request-Id'),/^[0-9a-f]{8}-[0-9a-f]{4}-/u);
  assert.equal(response.headers.get('Set-Cookie'),null,'health must not start a session');
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.ready,true);
  assert.equal(body.db.reachable,true);
  assert.ok(Number.isSafeInteger(body.db.latencyMs)&&body.db.latencyMs>=0);
  assert.equal(body.schema.version,SCHEMA_VERSION);
 assert.equal(body.schema.appliedVersion,SCHEMA_VERSION);
 assert.equal(body.schema.applied,REQUIRED_TABLES.length);
 assert.deepEqual(body.schema.missing,[]);
 assert.deepEqual(body.schema.migrations.missing,[]);
 assert.deepEqual(body.schema.migrations.ahead,[]);
 assert.deepEqual(body.schema.migrations.applied,MIGRATIONS.map(migration=>migration.name));
  assert.deepEqual(body.model,{configured:true,approved:true});
  const text=JSON.stringify(body);
  assert.ok(!text.includes('FAKE_TEST_KEY'));
  assert.ok(!text.includes(password));
  assert.ok(!text.includes('test-session-secret'));
 }finally{sql.close();}
});

test('empty or missing database is reported as a schema gap, not as an unexplained failure',async()=>{
 const empty=database(false);
 try{
  const missingDb=await get(createWorker(),env({MEMORY_DB:empty.db}));
  assert.equal(missingDb.status,503);
  const partial=await missingDb.json();
  assert.equal(partial.ok,false);
  assert.equal(partial.db.reachable,true);
  assert.deepEqual(partial.schema.missing,REQUIRED_TABLES);
  const noDb=await (await get(createWorker(),env())).json();
  assert.equal(noDb.ok,false);
  assert.equal(noDb.db.reachable,false);
  assert.equal(noDb.schema.missing.length,REQUIRED_TABLES.length);
 }finally{empty.sql.close();}
});

test('health explains broken configuration while every private route stays closed',async()=>{
 const {sql,db}=database();
 try{
  for(const [overrides,expected,expectedChat] of [
   [{ATLAS_ACCESS_PASSWORD:'weak'},{ready:false},503],
   [{SESSION_SECRET:''},{ready:false},503],
   [{GEMINI_API_KEY:''},{configured:false},401],
   [{GEMINI_MODEL:'paid-model'},{approved:false},401]
  ]){
   const environment=env({MEMORY_DB:db,...overrides});
   const response=await get(createWorker(),environment);
   assert.equal(response.status,503,JSON.stringify(overrides));
   const body=await response.json();
   assert.equal(body.ok,false);
   for(const [field,value] of Object.entries(expected))assert.equal(body.model?.[field]??body[field],value);
   const chat=await createWorker().fetch(new Request(origin+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Merhaba'}]})}),environment);
   assert.equal(chat.status,expectedChat,'private routes never open on a broken configuration');
  }
 }finally{sql.close();}
});

test('health is rate limited and never leaks driver messages',async()=>{
 const blocked=await get(createWorker(),env({CHAT_LIMIT:{limit:async()=>({success:false})}}));
 assert.equal(blocked.status,429);
 const broken={prepare(){return {async all(){throw new Error('D1_ERROR: no such table: sqlite_master private-detail');}};}};
 const response=await get(createWorker(),env({MEMORY_DB:broken}));
 assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.db.reachable,false);
 assert.deepEqual(body.schema.missing,REQUIRED_TABLES);
 assert.ok(!JSON.stringify(body).includes('private-detail'));
 const direct=await healthSnapshot(env({MEMORY_DB:null}),{now:new Date('2026-11-12T10:00:00Z')});
 assert.equal(direct.payload.checkedAt,'2026-11-12T10:00:00.000Z');
 assert.equal(direct.payload.status,undefined,'the transport status is not repeated in the body');
 assert.equal(direct.status,503);
});

test('health never calls the model provider',async()=>{
 let calls=0;
 const worker=createWorker(async()=>{calls+=1;return new Response('{}',{status:500});});
 const {sql,db}=database();
 try{
  const response=await worker.fetch(new Request(origin+'/api/health'),env({MEMORY_DB:db}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).schema.version,SCHEMA_VERSION);
  assert.equal(calls,0,'diagnosis reads configuration and D1 only, it spends no provider quota');
 }finally{sql.close();}
});
