// Explicit personal-data allowlist. Connection credentials, OAuth state and sessions
// are never queried. Downloads are read-only and never sent to a model.
const collections=[
 ['memories','atlas_memories','id,text,created_at',30],
 ['notes','atlas_notes','id,text,created_at,archived_at,revision',100],
 ['tasks','atlas_tasks','id,title,due_date,done,created_at,recurrence,completed_at',100],
 ['plans','atlas_plans','id,kind,title,plan_day,text,created_at',50],
 ['routines','atlas_routines','id,trigger,topic,steps,created_at',30],
 ['agenda','atlas_agenda','id,title,task_id,starts_at,ends_at,created_at,archived_at,revision',200],
 ['expenses','atlas_expenses','id,title,amount_minor,currency,category,spent_day,created_at,archived_at,revision',500],
 ['focus','atlas_focus_sessions','id,title,task_id,planned_seconds,elapsed_seconds,status,started_at_ms,started_day,last_started_at_ms,finished_at_ms,revision',200],
 ['contentCalendar','atlas_content_calendar','id,title,due_date,format,published,created_at',100],
 ['lists','atlas_lists','id,title,kind,state_json,revision,archived,created_at,updated_at',30],
 ['billPlans','atlas_bills','id,title,amount_minor,currency,recurrence,start_date,anchor_day,anchor_month,revision,archived,created_at,updated_at',100],
 ['billPayments','atlas_bill_payments','id,bill_id,due_date,title,amount_minor,planned_amount_minor,currency,paid_date,expense_id,created_at',2000],
 ['budgets','atlas_budgets','id,month,category,amount_minor,currency,archived,revision,created_at,updated_at',100],
 ['waiting','atlas_waiting','id,who,what,kind,followup_date,last_contact_date,status,archived,revision,created_at,updated_at',200]
];
import {reportError} from './log.js';
const enc=new TextEncoder();
const fail=(error,status=400)=>({status,error,backupOpen:true});
export function backupCommand(input){
 if(typeof input!=='string')return null;
 const t=input.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
 if(/^(?:yedeklerimi|yedeklemeyi|yedekleme|yedekler) (?:aç|göster)$|^(?:kayıtlarımın yedeğini|yedeğimi|yedek) (?:indir|al|hazırla)$|^kayıtlarımı dışa aktar$/u.test(t))return {format:'json'};
 if(/^(?:harcamalarımı|harcamaları|harcama defterimi) (?:excel(?:['’]e)?|csv(?:['’]ye)?) (?:aktar|indir)$|^harcamalarımı dışa aktar$/u.test(t))return {format:'csv'};
 if(/^(?:ajandamı|ajandayı) (?:takvim(?:e)?|dosyaya|ics) (?:aktar|indir)$|^ajandamı dışa aktar$/u.test(t))return {format:'ics'};
 return null;
}
export function backupPreview(command){return {status:200,backupOpen:true,backupFormat:command.format,text:'Efendim, yedekleme bölümünü açtım. Dosyayı cihazınıza indirmek için ilgili İndir düğmesine dokunun. Kayıtlarınız değişmez.'};}
// All cells are quoted; leading spreadsheet formula markers are neutralized.
function csvCell(value){let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(rows){const head=['Numara','Başlık','Tutar','Para birimi','Kategori','Tarih','Arşivde'];return '\uFEFF'+[head,...rows.map(r=>[r.id,r.title,(r.amount_minor/100).toFixed(2).replace('.',','),r.currency,r.category,r.spent_day,r.archived_at?'Evet':'Hayır'])].map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n';}
const icsText=value=>String(value).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/gu,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const utc=value=>new Date(value).toISOString().replace(/[-:]/gu,'').replace(/\.\d{3}Z$/u,'Z');
// RFC 5545 folding is measured in UTF-8 octets, without splitting characters.
function fold(line){let parts=[],chunk='',bytes=0;for(const ch of line){const size=enc.encode(ch).length;if(bytes+size>75){parts.push(chunk);chunk=' ';bytes=1;}chunk+=ch;bytes+=size;}parts.push(chunk);return parts.join('\r\n');}
function calendar(rows,now){const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ATLAS//Personal Agenda//TR','CALSCALE:GREGORIAN','METHOD:PUBLISH'];for(const r of rows.filter(x=>!x.archived_at))lines.push('BEGIN:VEVENT','UID:atlas-agenda-'+r.id+'@atlas.local','DTSTAMP:'+utc(now),'DTSTART:'+utc(r.starts_at),'DTEND:'+utc(r.ends_at),'SUMMARY:'+icsText(r.title),'END:VEVENT');lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';}
async function readRows(db,selected){
 const statements=selected.map(([,table,fields,max])=>db.prepare(`SELECT ${fields} FROM ${table} ORDER BY id LIMIT ${max+1}`));
 // D1 batch SELECTs share one transaction, giving a consistent export.
 if(typeof db.batch!=='function')throw Error('atomic snapshot unavailable');
 const result=await db.batch(statements);
 return Object.fromEntries(selected.map(([name,,fields,max],i)=>{
  const rows=result[i]?.results;if(!Array.isArray(rows)||rows.length>max)throw Error('bounds');
  // Also project returned fields to defend against overly broad DB adapters.
  return [name,rows.map(row=>Object.fromEntries(fields.split(',').map(key=>[key,row[key]])))];
 }));
}
export async function createBackup(body,env,now=new Date(),requestId=''){
 if(!env?.MEMORY_DB)return fail('Efendim, ortak kayıt deposu henüz hazır değil.',503);
 if(!body||typeof body!=='object'||Array.isArray(body)||!['json','csv','ics'].includes(body.format)||Object.keys(body).some(k=>k!=='format'))return fail('Efendim, JSON yedek, CSV harcama veya ICS ajanda biçimini seçin.');
 if(!Number.isFinite(now.getTime()))return fail('Yedek tarihi doğrulanamadı.',503);
 try{
  const selected=body.format==='json'?collections:collections.filter(c=>c[0]===(body.format==='csv'?'expenses':'agenda'));
  const data=await readRows(env.MEMORY_DB,selected),date=now.toISOString().slice(0,10);
  let content,mime,filename;
  if(body.format==='json'){
   data.routines=data.routines.map(({steps,...r})=>({...r,steps:JSON.parse(steps)}));
   data.lists=data.lists.map(({state_json,...r})=>({...r,items:JSON.parse(state_json).items}));
   content=JSON.stringify({application:'ATLAS',formatVersion:1,exportedAt:now.toISOString(),timezone:'Europe/Istanbul',scope:'current_personal_records_including_archives_and_bill_payment_declarations_budgets_and_waiting',excluded:['credentials','sessions','instagram_connection_and_statistics','change_history','task_completion_history','device_preferences','offline_device_cache','multi_action_receipts'],restoreSupported:false,counts:Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,rows.length])),data},null,2);
   mime='application/json;charset=utf-8';filename=`ATLAS-yedek-${date}.json`;
  }else if(body.format==='csv'){content=csv(data.expenses);mime='text/csv;charset=utf-8';filename=`ATLAS-harcamalar-${date}.csv`;
  }else{content=calendar(data.agenda,now);mime='text/calendar;charset=utf-8';filename=`ATLAS-ajanda-${date}.ics`;}
  if(enc.encode(content).byteLength>4*1024*1024)return fail('Yedek güvenli boyut sınırını aştı. Daha küçük bir dışa aktarma biçimini seçin; eksik dosya oluşturulmadı.',413);
  return {status:200,filename,mime,content,text:body.format==='ics'?'Efendim, arşiv dışındaki ajanda kayıtları indirilmeye hazır.':'Efendim, dosyanız indirilmeye hazır. Kayıtlar değiştirilmedi.'};
 }catch(error){reportError({stage:'backup.build',requestId,error});return fail('Efendim, yedek tam olarak hazırlanamadı. Eksik dosya oluşturulmadı; kayıtlarınız değişmedi.',503);}
}
