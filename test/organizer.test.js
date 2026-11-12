import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runTaskCommand,listTasks,taskCommand} from '../src/tasks.js';
import {calendarCommand,runCalendar} from '../src/calendar.js';
import {instagramProgress,instagramProgressCommand} from '../src/instagram-progress.js';
import {seal} from '../src/instagram-account.js';
import {createWorker} from '../src/worker.js';
function db(){const sql=new DatabaseSync(':memory:');for(const f of ['0001_memory.sql','0002_tasks.sql','0004_instagram.sql','0006_organizer.sql'])sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {prepare(q){const s=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}};}
test('recurrence preserves stable IDs, skips missed occurrences, logs once and blocks early replay',async()=>{
 const d=db(),now=new Date('2026-12-31T21:30:00Z');
 await runTaskCommand(d,'Her gün görev ekle: Kontrol',now);
 assert.equal((await listTasks(d))[0].due_date,'2027-01-01');
 const later=new Date('2027-01-04T09:00:00Z');
 assert.equal((await runTaskCommand(d,'Görev 1 tamamlandı',later)).status,200);
 assert.equal((await listTasks(d))[0].due_date,'2027-01-05');assert.equal((await listTasks(d))[0].done,0);
 assert.equal((await runTaskCommand(d,'Görev 1 tamamlandı',later)).status,409);
 assert.match((await runTaskCommand(d,'Haftalık özet',later)).text,/1 tamamlama/);
 await runTaskCommand(d,'Görev 1 tekrarı durdur',later);assert.equal((await listTasks(d))[0].recurrence,'');
 assert.equal((await listTasks(d)).length,1);
});
test('weekly repeats keep weekday and a collision produces no completion record',async()=>{
 const d=db(),now=new Date('2026-10-24T09:00:00Z');await runTaskCommand(d,'Her hafta görev ekle: Plan',now);
 await runTaskCommand(d,'Görev 1 tamamlandı',new Date('2026-10-26T09:00:00Z'));
 assert.equal((await listTasks(d))[0].due_date,'2026-10-31');
 await runTaskCommand(d,'Her gün görev ekle: Aynı',now);await runTaskCommand(d,'Listeye yarın Aynı ekle',now);
 assert.equal((await runTaskCommand(d,'Görev 2 tamamlandı',now)).status,409);
 const log=await d.prepare('SELECT COUNT(*) AS n FROM atlas_task_completions WHERE task_id=2').first();assert.equal(log.n,0);
 for(const c of ['Her gün görev ekler misin','Görev 1 tekrarı durdurabilir miyiz'])assert.equal(taskCommand(c),null);
});
test('weekly summary uses Istanbul Monday boundary and does not invent old completions',async()=>{
 const d=db();await runTaskCommand(d,'Listeye iş ekle');await runTaskCommand(d,'Görev 1 tamamlandı',new Date('2026-10-25T20:59:00Z'));
 assert.match((await runTaskCommand(d,'Haftalık özet',new Date('2026-10-25T21:01:00Z'))).text,/0 tamamlama/);
 await runTaskCommand(d,'Listeye başka ekle');await runTaskCommand(d,'Görev 2 tamamlandı',new Date('2026-10-25T21:02:00Z'));
 assert.match((await runTaskCommand(d,'Haftalık özet',new Date('2026-10-25T21:03:00Z'))).text,/1 tamamlama/);
});
test('calendar validates dates, deduplicates, stores literal text, marks locally without publishing',async()=>{
 const d=db(),now=new Date('2026-12-31T22:00:00Z');
 for(const t of ['Takvime 2027-02-30 reels: yanlış','Takvime 2026-12-31 reels: geçmiş'])assert.equal((await runCalendar(d,t,now)).status,400);
 for(let i=0;i<2;i++)assert.equal((await runCalendar(d,'Takvime yarın reels: <script>örnek</script>',now)).status,200);
 const r=await runCalendar(d,'İçerik takvimimi göster',now);assert.equal(r.items.length,1);assert.equal(r.items[0].due_date,'2027-01-02');assert.equal(r.items[0].title,'<script>örnek</script>');
 assert.match((await runCalendar(d,'İçerik 1 paylaşıldı',now)).text,/Instagram’da işlem yapılmadı/);
 assert.equal((await runCalendar(d,'İçerik 99 paylaşıldı',now)).status,404);
 for(const t of ['Takvime bak ve paylaş','İçerik 1 paylaş','Takvime bir şey yazabilir miyiz'])assert.equal(calendarCommand(t),null);
});
async function connected(){const d=db(),secret='x'.repeat(40);await d.prepare('INSERT INTO atlas_instagram_connection(id,encrypted_token,username,connected_at) VALUES(1,?,?,?)').bind(await seal(JSON.stringify({token:'private-token',scopes:['instagram_business_basic','instagram_business_manage_insights'],expiresAt:Date.now()+600000}),secret),'celik38__','now').run();return {MEMORY_DB:d,SESSION_SECRET:secret};}
function meta(value=10){return async(url,r)=>{assert.equal(r.method,'GET');assert.equal(r.redirect,'manual');assert.equal(new URL(url).hostname,'graph.instagram.com');assert.ok(!url.includes('private-token'));
 if(url.includes('/me?'))return Response.json({user_id:'17841407597588263',username:'celik38__'});
 if(url.includes('/media?'))return Response.json({data:[{id:'12345',caption:'Demo',media_product_type:'REELS',media_type:'VIDEO',timestamp:'2026-10-23T12:00:00Z',like_count:2,comments_count:0}]});
 const metric=new URL(url).searchParams.get('metric');if(metric==='shares')return Response.json({error:{}},{status:400});return Response.json({data:[{name:metric,values:[{value}]}]});
};}
test('comparison reads only Meta, missing metrics stay missing, snapshots require explicit save and never overwrite',async()=>{
 const e=await connected();let r=await instagramProgress('compare',e,meta());assert.match(r.text,/Önceki ölçüm yok/);assert.match(r.text,/paylaşma: alınamadı/);
 assert.equal((await e.MEMORY_DB.prepare('SELECT COUNT(*) AS n FROM atlas_instagram_snapshots').first()).n,0);
 assert.equal((await instagramProgress('save',e,meta())).status,200);assert.match((await instagramProgress('save',e,meta(20))).text,/Üzerine yazılmadı/);
 r=await instagramProgress('compare',e,meta(25));assert.match(r.text,/erişim: 25 \(\+15\)/);assert.match(r.text,/eşit 72 saatlik ölçümler değildir/);
 assert.equal(instagramProgressCommand('Instagram ölçümünü kaydet'), 'save');assert.equal(instagramProgressCommand('Instagram ölçümünü kaydet ve paylaş'),null);
});
test('new chat commands require auth and origin, calendar and weekly summary need no external calls',async()=>{
 let calls=0;const w=createWorker(async()=>{calls++;throw Error('unexpected');}),origin='https://atlas.example',allow={limit:async()=>({success:true})};
 const e={MEMORY_DB:db(),ATLAS_ACCESS_PASSWORD:'a'.repeat(24),SESSION_SECRET:'s'.repeat(40),LOGIN_LIMIT:allow,CHAT_LIMIT:allow};
 const call=(path,body,cookie='',source=origin)=>w.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:source,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)}),e);
 const body={messages:[{role:'user',text:'İçerik takvimimi göster'}]};assert.equal((await call('chat',body)).status,401);
 const login=await call('login',{password:e.ATLAS_ACCESS_PASSWORD}),cookie=login.headers.get('Set-Cookie').split(';')[0];assert.equal((await call('chat',body,cookie,'https://evil.example')).status,403);
 for(const text of ['İçerik takvimimi göster','Haftalık özet'])assert.equal((await call('chat',{messages:[{role:'user',text}]},cookie)).status,200);assert.equal(calls,0);
});
