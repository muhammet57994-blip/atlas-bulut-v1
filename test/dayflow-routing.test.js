import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createWorker} from '../src/worker.js';
import {dayInIstanbul} from '../src/tasks.js';
import {sharedApi} from '../scripts/shared-api.mjs';

const origin='https://atlas.example',password='safe-dayflow-password-at-least-twenty',allow={limit:async()=>({success:true})};
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const s={sql,modelCalls:0};s.env={ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'dayflow-session-secret-over-thirty-two-characters',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('asset')},MEMORY_DB:{prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:statement.run(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}}};
 s.worker=createWorker(async()=>{s.modelCalls++;throw Error('Unexpected model request');});return s;
}
const request=(path,body={},cookie,headers={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:JSON.stringify(body)});
async function session(s){return (await s.worker.fetch(request('/api/login',{password}),s.env)).headers.get('Set-Cookie').split(';')[0];}
async function post(s,path,body,cookie,status=200){const response=await s.worker.fetch(request(path,body,cookie),s.env),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
const chat=(s,cookie,text,extra={},status=200)=>post(s,'/api/chat',{messages:[{role:'user',text}],...extra},cookie,status);
const tables=['atlas_agenda','atlas_expenses','atlas_bills','atlas_bill_payments','atlas_bill_operations','atlas_replan_receipts','atlas_notes','atlas_record_changes','atlas_list_changes','atlas_offline_receipts'];
const counts=s=>tables.map(table=>s.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const draftNote=text=>({id:crypto.randomUUID(),type:'note-create',createdAt:new Date().toISOString(),text});
const seedTask=s=>s.sql.prepare('INSERT INTO atlas_tasks(title,created_at) VALUES(?,?)').run('İlk iş',new Date().toISOString());

test('dayflow and offline routes enforce auth, same-origin, methods, size, type and rate controls',async()=>{
 const s=setup(),cookie=await session(s),paths=['/api/dayflow','/api/offline/snapshot','/api/offline/review'];
 for(const path of paths){
  await post(s,path,{},null,401);
  assert.equal((await s.worker.fetch(request(path,{},cookie,{Origin:'https://evil.example'}),s.env)).status,403);
  assert.equal((await s.worker.fetch(request(path,{},cookie,{'Sec-Fetch-Site':'cross-site'}),s.env)).status,403);
  assert.equal((await s.worker.fetch(new Request(origin+path,{headers:{Cookie:cookie}}),s.env)).status,405);
  await post(s,path,{padding:'x'.repeat(40000)},cookie,413);
  assert.equal((await s.worker.fetch(request(path,{},cookie,{'Content-Type':'text/plain'}),s.env)).status,415);
  assert.equal((await s.worker.fetch(request(path,{},cookie),{...s.env,CHAT_LIMIT:{limit:async()=>({success:false})}})).status,429);
 }
 const r=await s.worker.fetch(request('/api/dayflow',{},cookie),s.env),d=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok(r.headers.get('Content-Security-Policy'));assert.equal(d.replanAvailable,true);assert.deepEqual(d.billItems,[]);assert.deepEqual(d.billPaymentItems,[]);assert.ok(Number.isFinite(d.serverNow));assert.equal(s.modelCalls,0);s.sql.close();
});

test('explicit offline selection and review endpoints neither expose unselected records nor apply drafts',async()=>{
 const s=setup(),cookie=await session(s);s.sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)').run('Seçilen',new Date().toISOString());s.sql.prepare('INSERT INTO atlas_notes(text,created_at) VALUES(?,?)').run('Özel diğer kayıt',new Date().toISOString());const before=counts(s);
 const empty=await post(s,'/api/offline/snapshot',{noteIds:[],listIds:[]},cookie);assert.deepEqual(empty.offlineSnapshot.notes,[]);
 const copy=await post(s,'/api/offline/snapshot',{noteIds:[1],listIds:[]},cookie);assert.deepEqual(copy.offlineSnapshot.notes.map(n=>n.text),['Seçilen']);assert.ok(!JSON.stringify(copy).includes('Özel diğer kayıt'));assert.ok(!JSON.stringify(copy).includes(s.env.SESSION_SECRET));
 await post(s,'/api/offline/snapshot',{noteIds:[1],listIds:[],all:true},cookie,400);
 const draft=draftNote('Yeni\nnot'),preview=await post(s,'/api/offline/review',{draft},cookie);assert.ok(preview.offlineDraft.token);assert.match(preview.text,/Henüz uygulanmadı/);assert.deepEqual(counts(s),before);
 await post(s,'/api/offline/review',{draft,confirmed:true},cookie,400);await post(s,'/api/offline/review',{draft:{...draft,token:'secret'}},cookie,400);assert.deepEqual(counts(s),before);assert.equal(s.modelCalls,0);s.sql.close();
});

test('new typed operations reject mixed families and malformed payloads before any handler or model',async()=>{
 const s=setup(),cookie=await session(s),fresh=['replanDraftRequest','replanConfirmation','billsDraftRequest','billsConfirmation','offlineConfirmation'],old=['managementDraftRequest','managementConfirmation','listsDraftRequest','listsConfirmation','dailyDraftRequest','dailyConfirmation','focusDraftRequest','focusConfirmation','routineDraftRequest','routineConfirmation','planEdit','planConfirmation'];
 for(const field of fresh){for(const value of [null,[],true,'bad',1])await chat(s,cookie,'Onay',{[field]:value},400);for(const other of [...fresh,...old].filter(k=>k!==field))await chat(s,cookie,'Onay',{[field]:{},[other]:{}},400);}
 assert.deepEqual(counts(s),tables.map(()=>0));assert.equal(s.modelCalls,0);s.sql.close();
});

test('dayflow previews route deterministically without model calls, writes or accidental routine shadowing',async()=>{
 const s=setup(),cookie=await session(s);seedTask(s);const before=counts(s),tomorrow=dayInIstanbul(new Date(),1);
 const replan=await chat(s,cookie,'Gün planı taslağı hazırla',{replanDraftRequest:{targetDate:tomorrow,startTime:'09:00',endTime:'18:00',taskIds:[1]}});assert.ok(replan.replanDraft);assert.equal(replan.replanDraft.blocks[0].date,tomorrow);
 const bill=await chat(s,cookie,'İnternet faturam her ayın15inde450lira');assert.ok(bill.billsDraft);assert.equal(bill.billsDraft.amount_minor,45000);
 for(const text of ['Faturalarımı göster','Yaklaşan ödemelerim','Bu ay sabit giderlerim ne'])assert.equal((await chat(s,cookie,text)).billsOpen,true);
 assert.equal((await chat(s,cookie,'Çevrimdışı kayıtlarımı aç')).offlineOpen,true);
 for(const text of ['Günümü toparla','Kalan işlerimi düzenle','Bugün bir saat geciktim, kalan işlerimi düzenle']){const response=await s.worker.fetch(request('/api/chat',{messages:[{role:'user',text}]},cookie),s.env),data=await response.json();assert.ok([200,409].includes(response.status),JSON.stringify(data));assert.equal(data.replanOpen,true);}
 for(const trigger of ['Günümü toparla','Faturalarımı göster','Çevrimdışı kayıtlarımı aç'])await chat(s,cookie,'Bu komutu öğren',{routineDraftRequest:{trigger,topic:'Günlük',steps:['records']}},400);
 assert.deepEqual(counts(s),before);assert.equal(s.modelCalls,0);s.sql.close();
});

test('new confirmations are purpose-bound and a read endpoint never applies them',async()=>{
 const s=setup(),cookie=await session(s);seedTask(s);const before=counts(s);
 const bill=await chat(s,cookie,'İnternet faturam her ayın 15inde 450 lira'),replan=await chat(s,cookie,'Gün planı',{replanDraftRequest:{targetDate:dayInIstanbul(new Date(),1)}}),offline=await post(s,'/api/offline/review',{draft:draftNote('Yeni')},cookie);
 for(const [field,text,token] of [['billsConfirmation','Ödeme kaydını onaylıyorum',replan.replanDraft.token],['billsConfirmation','Ödeme kaydını onaylıyorum',offline.offlineDraft.token],['replanConfirmation','Gün planını onaylıyorum',bill.billsDraft.token],['offlineConfirmation','Çevrimdışı taslağı onaylıyorum',bill.billsDraft.token]])await chat(s,cookie,text,{[field]:{token,confirmed:true}},409);
 for(const [field,text,token] of [['billsConfirmation','Ödeme kaydını onaylıyorum',bill.billsDraft.token],['replanConfirmation','Gün planını onaylıyorum',replan.replanDraft.token],['offlineConfirmation','Çevrimdışı taslağı onaylıyorum',offline.offlineDraft.token]]){
  await chat(s,cookie,text,{[field]:{token,confirmed:false}},400);await chat(s,cookie,'evet',{[field]:{token,confirmed:true}},400);await post(s,'/api/dayflow',{messages:[{role:'user',text}],[field]:{token,confirmed:true}},cookie);
 }
 assert.deepEqual(counts(s),before);assert.equal(s.modelCalls,0);s.sql.close();
});

test('two authenticated sessions share approved day plans, bill payment ledger and offline edits exactly once',async()=>{
 const s=setup(),a=await session(s),b=await session(s);seedTask(s);
 const replan=await chat(s,a,'Gün planı',{replanDraftRequest:{targetDate:dayInIstanbul(new Date(),1),taskIds:[1]}});await chat(s,b,'Gün planını onaylıyorum',{replanConfirmation:{token:replan.replanDraft.token,confirmed:true}});
 const bill=await chat(s,a,'İnternet faturam her ayın 15inde 450 lira');await chat(s,b,'Ödeme kaydını onaylıyorum',{billsConfirmation:{token:bill.billsDraft.token,confirmed:true}});
 const paid=await chat(s,a,'İnternet faturasını ödedim');assert.ok(paid.billsDraft);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM atlas_expenses').get().n,0);await chat(s,b,'Ödeme kaydını onaylıyorum',{billsConfirmation:{token:paid.billsDraft.token,confirmed:true}});await chat(s,a,'Ödeme kaydını onaylıyorum',{billsConfirmation:{token:paid.billsDraft.token,confirmed:true}});
 const draft=draftNote('Ortak\nnot'),offline=await post(s,'/api/offline/review',{draft},a);await chat(s,b,'Çevrimdışı taslağı onaylıyorum',{offlineConfirmation:{token:offline.offlineDraft.token,confirmed:true}});assert.equal((await post(s,'/api/offline/review',{draft},a)).offlineSaved.draftId,draft.id);
 const readA=await post(s,'/api/dayflow',{},a),readB=await post(s,'/api/dayflow',{},b);assert.deepEqual(readA.billItems,readB.billItems);assert.deepEqual(readA.billPaymentItems,readB.billPaymentItems);assert.deepEqual(readA.replanBlocks,readB.replanBlocks);assert.equal(readA.billPaymentItems.length,1);assert.equal(readA.replanBlocks.length,1);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM atlas_expenses').get().n,1);assert.equal(s.sql.prepare('SELECT text FROM atlas_notes').get().text,'Ortak\nnot');assert.equal(s.sql.prepare('SELECT done FROM atlas_tasks').get().done,0);assert.equal(s.modelCalls,0);s.sql.close();
});

test('new public assets retain no-store security headers and the desktop proxy only forwards fixed approved routes',async()=>{
 const s=setup();for(const path of ['/dayflow.js','/dayflow.css','/offline.html','/offline.js','/offline.css','/offline-store.js','/offline-entry.js','/sw.js']){const response=await s.worker.fetch(new Request(origin+path),s.env);assert.equal(response.status,200,path);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy'));}
 for(const path of ['/api/dayflow','/api/offline/snapshot','/api/offline/review']){
  let calls=0;const req=new Request('http://localhost:8790'+path,{method:'POST',headers:{Origin:'http://localhost:8790','Content-Type':'application/json'},body:'{}'});const response=await sharedApi(req,async(url,options)=>{calls++;assert.equal(url,'https://atlas-pasam-v1.pages.dev'+path);assert.equal(options.headers.get('Origin'),'https://atlas-pasam-v1.pages.dev');assert.equal(options.redirect,'manual');return Response.json({ok:true});},'test-device-token-0123456789abcdef');assert.equal(response.status,200);assert.equal(calls,1);
 }
 assert.equal((await sharedApi(new Request('http://localhost:8790/api/offline/review',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),()=>{throw Error('must not forward');})).status,403);assert.equal(s.modelCalls,0);s.sql.close();
});

test('HTML assets keep literal filenames without redirects, while the root maps explicitly to index.html',async()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.assets.html_handling,'none','Cloudflare must not redirect /offline.html to the unsupported /offline route');
 assert.equal(config.assets.run_worker_first,true,'The worker must enforce its explicit asset allowlist before asset handling');
 const seen=[],files=new Map(['/index.html','/offline.html'].map(path=>[path,readFileSync(new URL('../public'+path,import.meta.url),'utf8')]));
 const env={ASSETS:{fetch:async request=>{
  const url=new URL(request.url);seen.push({pathname:url.pathname,search:url.search,method:request.method,marker:request.headers.get('X-Release-Check')});
  // Model html_handling:none: the asset store only accepts literal file paths.
  // A fake that returns 200 for every path would miss both the root mapping and
  // the /offline.html -> /offline deployment regression.
  if(!files.has(url.pathname))return new Response('Missing exact asset filename',{status:404});
  return new Response(request.method==='HEAD'?null:files.get(url.pathname),{status:200,headers:{'Content-Type':'text/html;charset=utf-8'}});
 }}},worker=createWorker(async()=>{throw Error('HTML must never call a model');});
 const cases=[['/','/index.html',''],['/?source=launch','/index.html',''],['/index.html?source=direct','/index.html','?source=direct'],['/offline.html','/offline.html',''],['/offline.html?source=entry&mode=local','/offline.html','?source=entry&mode=local']];
 for(const method of ['GET','HEAD'])for(const [input,pathname,search] of cases){
  const response=await worker.fetch(new Request(origin+input,{method,headers:{'X-Release-Check':'asset-test'}}),env);
  assert.equal(response.status,200,input);assert.equal(response.headers.get('Location'),null,input);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(response.headers.get('Content-Security-Policy'));
  assert.deepEqual(seen.at(-1),{pathname,search,method,marker:'asset-test'});assert.equal(await response.text(),method==='HEAD'?'':files.get(pathname));
 }
 const before=seen.length;assert.equal((await worker.fetch(new Request(origin+'/offline'),env)).status,404);assert.equal(seen.length,before,'An extensionless page must not bypass the explicit allowlist');
});
