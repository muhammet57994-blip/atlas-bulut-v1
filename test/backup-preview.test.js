import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createBackup} from '../src/backup.js';

const source=await readFile(new URL('../public/backup-preview.js',import.meta.url),'utf8');
const groups=['memories','notes','tasks','plans','routines','agenda','expenses','focus','contentCalendar','lists','billPlans','billPayments','budgets','waiting'];
function fixture(){const data=Object.fromEntries(groups.map(group=>[group,[]]));return {application:'ATLAS',formatVersion:1,exportedAt:'2026-11-08T10:00:00.000Z',timezone:'Europe/Istanbul',scope:'current_personal_records_including_archives_and_bill_payment_declarations_budgets_and_waiting',excluded:['credentials','sessions','instagram_connection_and_statistics','change_history','task_completion_history','device_preferences','offline_device_cache','multi_action_receipts'],restoreSupported:false,counts:Object.fromEntries(groups.map(group=>[group,0])),data};}
function validate(document,size){const window={};vm.runInNewContext(source,{window,TextEncoder});return window.AtlasBackupPreview.validateText(typeof document==='string'?document:JSON.stringify(document),size);}

test('valid v1 export returns only date and aggregate counts',()=>{
 const doc=fixture();doc.data.notes.push({id:1,text:'private text',created_at:'2026-11-08T10:00:00.000Z',archived_at:null,revision:0});doc.counts.notes=1;
 const result=validate(doc);assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true,exportedAt:doc.exportedAt,counts:{...doc.counts},recordTotal:1});assert.equal(JSON.stringify(result).includes('private text'),false);
});

test('accepts the exact JSON emitted by the current exporter',async()=>{
 const env={MEMORY_DB:{prepare:()=>({}),batch:async statements=>statements.map(()=>({results:[]}))}};
 const backup=await createBackup({format:'json'},env,new Date('2026-11-08T10:00:00.000Z'));
 assert.equal(backup.status,200,backup.error);
 const result=validate(backup.content,new TextEncoder().encode(backup.content).byteLength);
 assert.equal(result.ok,true,result.error);
 assert.equal(result.recordTotal,0);
});

test('rejects malformed, oversized, unsupported and extended schemas',()=>{
 assert.match(validate('{').error,/JSON/u);
 assert.match(validate(JSON.stringify(fixture()),4*1024*1024+1).error,/4 MiB/u);
 const wrong=fixture();wrong.formatVersion=2;assert.equal(validate(wrong).ok,false);
 const extra=fixture();extra.credentials=[];assert.match(validate(extra).error,/biçiminde/u);
 const row=fixture();row.data.notes.push({id:1,text:'x',created_at:'x',archived_at:null,revision:0,secret:'no'});row.counts.notes=1;assert.match(validate(row).error,/beklenmeyen alan/u);
});

test('rejects count mismatches, duplicate IDs, unsafe integers and group overflow',()=>{
 const count=fixture();count.counts.notes=1;assert.match(validate(count).error,/sayıları/u);
 const dup=fixture();const row={id:1,text:'n',created_at:'x',archived_at:null,revision:0};dup.data.notes=[row,row];dup.counts.notes=2;assert.match(validate(dup).error,/yinelenen/u);
 const unsafe=fixture();unsafe.data.notes=[{id:1,text:'n',created_at:'x',archived_at:null,revision:9007199254740992}];unsafe.counts.notes=1;assert.match(validate(unsafe).error,/güvenli olmayan/u);
 const overflow=fixture();overflow.data.notes=Array.from({length:101},()=>row);overflow.counts.notes=101;assert.match(validate(overflow).error,/kayıt sayısı/u);
});

test('rejects malformed nested rows and broken payment relationships',()=>{
 const routine=fixture();routine.data.routines=[{id:'r-1',trigger:'x',topic:'x',steps:'not-an-array',created_at:'x'}];routine.counts.routines=1;assert.match(validate(routine).error,/Rutin/u);
 const list=fixture();list.data.lists=[{id:'l-1',title:'x',kind:'list',revision:1,archived:false,created_at:'x',updated_at:'x',items:[{id:'i',title:'x',quantity:'',status:'unknown',archived:false}]}];list.counts.lists=1;assert.match(validate(list).error,/Liste maddeleri/u);
 const payment=fixture();payment.data.billPayments=[{id:'p-1',bill_id:'missing',due_date:'x',title:'x',amount_minor:100,planned_amount_minor:100,currency:'TRY',paid_date:'x',expense_id:1,created_at:'x'}];payment.counts.billPayments=1;assert.match(validate(payment).error,/bağlantıları/u);
});

test('rejects untrusted unsupported values without echoing backup contents',()=>{
 const doc=fixture();doc.data.memories=[{id:'m-1',text:'private content',created_at:'x',unexpected:null}];doc.counts.memories=1;
 const result=validate(doc);assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes('private content'),false);
});
