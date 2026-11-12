import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const tables={agenda:'atlas_agenda',expense:'atlas_expenses',note:'atlas_notes'};
const fields={agenda:['title','starts_at','ends_at','archived_at'],expense:['title','amount_minor','currency','category','spent_day','archived_at'],note:['text','archived_at']};
const labels={agenda:'Ajanda',expense:'Harcama',note:'Not'};
const categories=['market','ulaşım','yemek','fatura','diğer'],currencies=['TRY','USD','EUR'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const fail=(text,status=400)=>({status,error:text,text,managementOpen:'records'});
const unavailable=()=>fail('Efendim, kayıt yönetimi şu an hazır değil. Değişiklik yapılmadı.',503);
const stale=()=>fail('Efendim, kayıt veya değişiklik sırası değişmiş. Güncel kaydı yeniden seçip onaylayın; değişiklik yapılmadı.',409);
// Each forward operation may have at most one undo, bounding the immutable
// journal at 10,000 rows while reserving enough space to undo every change.
const forwardLimit=5000;
const capacity=()=>fail('Efendim, 5.000 kayıt değişikliği sınırına ulaşıldı. Geçmiş korunuyor; yeni düzenleme yapılmadı. Önceki değişiklikleri geri alabilirsiniz.',409);
const safeId=n=>Number.isSafeInteger(n)&&n>0;
const safeText=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=max&&!/[\u0000-\u001f\u007f]/u.test(s);
const safeNote=s=>typeof s==='string'&&s.trim().length>0&&s.length<=1000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s);
const snapshot=(kind,row)=>Object.fromEntries(fields[kind].map(f=>[f,row[f]??null]));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const money=(minor,currency)=>`${(minor/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`;
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(s)&&s>='2000-01-01'&&s<='2100-12-31'&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function minorAmount(s){
 if(typeof s!=='string'||!/^\d{1,9}(?:[.,]\d{1,2})?$/u.test(s.trim()))return null;
 const [whole,fraction='']=s.trim().split(/[.,]/u),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(n)&&n>0&&n<=99999999999?n:null;
}
function agendaRow(row){return {...row,date:dayInIstanbul(new Date(row.starts_at)),time:new Date(row.starts_at+10800000).toISOString().slice(11,16),durationMinutes:(row.ends_at-row.starts_at)/60000};}
function validSnapshot(kind,s){
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==fields[kind]?.length||fields[kind].some(f=>!Object.hasOwn(s,f)))return false;
 if(s.archived_at!==null&&(typeof s.archived_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(s.archived_at)||!Number.isFinite(Date.parse(s.archived_at))))return false;
 if(kind==='note')return safeNote(s.text);
 if(!safeText(s.title,200))return false;
 if(kind==='expense')return Number.isSafeInteger(s.amount_minor)&&s.amount_minor>0&&s.amount_minor<=99999999999&&currencies.includes(s.currency)&&categories.includes(s.category)&&validDate(s.spent_day);
 if(!Number.isSafeInteger(s.starts_at)||!Number.isSafeInteger(s.ends_at)||s.ends_at<=s.starts_at||(s.ends_at-s.starts_at)%60000!==0||s.ends_at-s.starts_at>86400000||s.starts_at%60000!==0)return false;
 return validDate(dayInIstanbul(new Date(s.starts_at)));
}
function describe(kind,s){
 const archive=s.archived_at?' (arşivde)':'';
 if(kind==='note')return `${s.text}${archive}`;
 if(kind==='expense')return `${s.spent_day}: ${s.title}; ${money(s.amount_minor,s.currency)}, ${s.category}${archive}`;
 const row=agendaRow(s);return `${row.date} ${row.time} (İstanbul), ${row.durationMinutes} dakika: ${s.title}${archive}`;
}

export function managementCommand(input){
 if(typeof input!=='string')return null;
 const original=input.normalize('NFC').trim().replace(/[.!?]+$/u,'').trim(),text=normalize(original);
 if(text==='değişikliği onaylıyorum')return {action:'confirm'};
 if(/^(?:kayıtlarımı|kayıt yönetimini|arşivimi) (?:aç|göster|listele|oku)$/u.test(text)||text==='kayıt yönetimi')return {action:'list'};
 if(text==='son kayıt değişikliğini geri al')return {action:'draft',request:{action:'undo'}};
 let m=text.match(/^(son harcamayı|harcama\s+([1-9]\d*)\s+tutarını)\s+([+-]?\d[\d.,]*)\s+(lira|tl|try|dolar|usd|euro|avro|eur)\s+(?:olarak düzelt|yap)$/u);
 if(m){const unit=m[4],currency=['dolar','usd'].includes(unit)?'USD':['euro','avro','eur'].includes(unit)?'EUR':'TRY';return {action:'draft',request:{kind:'expense',...(m[2]?{id:Number(m[2])}:{latest:true}),action:'edit',changes:{amount:m[3],currency}}};}
 m=text.match(/^ajanda\s+([1-9]\d*)\s+(bugün|yarın|dün|\d{4}-\d{2}-\d{2})\s+(?:saat\s+)?(\d{1,2})[.:](\d{2})(?:['’]?(?:ya|ye|a|e))?\s+taşı$/u);
 if(m)return {action:'draft',request:{kind:'agenda',id:Number(m[1]),action:'edit',changes:{date:m[2],time:m[3].padStart(2,'0')+':'+m[4]}}};
 m=original.match(/^not\s+([1-9]\d*)\s+metnini\s+(.+)\s+olarak düzelt$/iu);
 if(m)return {action:'draft',request:{kind:'note',id:Number(m[1]),action:'edit',changes:{text:m[2]}}};
 m=text.match(/^(ajanda|harcama|not)\s+([1-9]\d*)\s+(arşivle|arşivden çıkar)$/u);
 if(m)return {action:'draft',request:{kind:{ajanda:'agenda',harcama:'expense',not:'note'}[m[1]],id:Number(m[2]),action:m[3]==='arşivle'?'archive':'unarchive'}};
 // A mutation-looking command with an ambiguous target must never fall through
 // to a model that might claim to have changed it or guess a record by title.
 if(/^(?:son harcamayı|harcama\s|ajanda\s|not\s)/u.test(text)&&/(?:düzelt|taşı|arşivle|çıkar|yap)$/u.test(text))return {action:'invalid'};
 return null;
}

const latestQuery="SELECT c.* FROM atlas_record_changes c WHERE c.action != 'undo' AND NOT EXISTS (SELECT 1 FROM atlas_record_changes u WHERE u.undo_of = c.id) ORDER BY c.id DESC LIMIT 1";
export async function latestManagementChange(env){
 if(!env?.MEMORY_DB)return null;
 const row=await env.MEMORY_DB.prepare(latestQuery).first();
 return row?{source:'management',id:row.id,created_at:row.created_at}:null;
}
export async function readManagement(env,now=new Date(),requestId=''){
 const empty={recordItems:{agenda:[],expenses:[],notes:[]},changeItems:[]};
 if(!env?.MEMORY_DB)return {...unavailable(),...empty};
 try{
  const db=env.MEMORY_DB;
  const results=await Promise.all([
   db.prepare('SELECT id,title,starts_at,ends_at,created_at,revision,archived_at FROM atlas_agenda ORDER BY archived_at IS NOT NULL,starts_at DESC,id DESC LIMIT 200').all(),
   db.prepare('SELECT id,title,amount_minor,currency,category,spent_day,created_at,revision,archived_at FROM atlas_expenses ORDER BY archived_at IS NOT NULL,spent_day DESC,id DESC LIMIT 500').all(),
   db.prepare('SELECT id,text,created_at,revision,archived_at FROM atlas_notes ORDER BY archived_at IS NOT NULL,id DESC LIMIT 100').all(),
   db.prepare('SELECT c.id,c.record_kind,c.record_id,c.action,c.created_at,c.undo_of,c.after_json,EXISTS(SELECT 1 FROM atlas_record_changes u WHERE u.undo_of=c.id) AS undone FROM atlas_record_changes c ORDER BY c.id DESC LIMIT 30').all(),
   latestManagementChange(env)
  ]);
  return {recordItems:{agenda:results[0].results.map(agendaRow),expenses:results[1].results,notes:results[2].results},changeItems:results[3].results.map(({after_json,...r})=>({...r,undone:!!r.undone,title:JSON.parse(after_json).title??JSON.parse(after_json).text})),latestManagementChange:results[4],expenseArchivePolicy:'Arşivlenen harcamalar dönem toplamlarına dahildir.'};
 }catch(error){reportError({stage:'db.management.read',requestId,error,meta:{table:'atlas_record_changes'}});return {...unavailable(),...empty};}
}
async function getRecord(db,kind,id){return db.prepare(`SELECT * FROM ${tables[kind]} WHERE id = ?`).bind(id).first();}
async function conflicts(db,kind,id,s){
 if(kind!=='agenda'||s.archived_at!==null)return [];
 return (await db.prepare('SELECT id,title,starts_at,ends_at,revision FROM atlas_agenda WHERE archived_at IS NULL AND id != ? AND starts_at < ? AND ends_at > ? ORDER BY id').bind(id,s.ends_at,s.starts_at).all()).results.map(agendaRow);
}
const signature=rows=>rows.map(r=>`${r.id}:${r.revision}`).join(',');
function changedSnapshot(kind,row,input,now){
 const after=snapshot(kind,row),action=input.action;
 if(action==='archive'){
  if(row.archived_at)return fail('Efendim, bu kayıt zaten arşivde.',409);
  after.archived_at=now.toISOString();return after;
 }
 if(action==='unarchive'){
  if(!row.archived_at)return fail('Efendim, bu kayıt zaten etkin.',409);
  after.archived_at=null;return after;
 }
 const patch=input.changes;
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length)return fail('Efendim, değiştirmek istediğiniz alanı belirtin.');
 const allowed=kind==='agenda'?['title','date','time','durationMinutes']:kind==='expense'?['title','amount','currency','category','date']:['text'];
 if(Object.keys(patch).some(k=>!allowed.includes(k)))return fail('Efendim, bu kayıt için desteklenmeyen bir değişiklik istendi.');
 if(kind==='note'){
  if(!safeNote(patch.text))return fail('Efendim, not 1–1000 karakter olmalı ve geçersiz kontrol karakteri içermemeli.');
  after.text=patch.text.trim();return after;
 }
 if(Object.hasOwn(patch,'title')){
  if(!safeText(patch.title,200))return fail('Efendim, başlık 1–200 karakter olmalı ve kontrol karakteri içermemeli.');
  after.title=patch.title.trim();
 }
 if(kind==='expense'){
  if(Object.hasOwn(patch,'amount')){after.amount_minor=minorAmount(patch.amount);if(after.amount_minor===null)return fail('Efendim, tutarı binlik ayırıcı olmadan, en fazla iki kuruş hanesiyle yazın: 240 veya 240,50.');}
  for(const key of ['currency','category'])if(Object.hasOwn(patch,key))after[key]=patch[key];
  if(!currencies.includes(after.currency)||!categories.includes(after.category))return fail('Efendim, geçerli para birimi ve kategori seçin.');
  if(Object.hasOwn(patch,'date')){if(!validDate(patch.date)||patch.date>dayInIstanbul(now))return fail('Efendim, harcama tarihi geçerli bir bugün veya geçmiş gün olmalı.');after.spent_day=patch.date;}
  return after;
 }
 if(['date','time','durationMinutes'].some(k=>Object.hasOwn(patch,k))){
  const old=agendaRow(row),date=patch.date??old.date,time=patch.time??old.time,duration=patch.durationMinutes??old.durationMinutes;
  if(!validDate(date)||typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)||!Number.isInteger(duration)||duration<1||duration>1440)return fail('Efendim, geçerli gün, 00:00–23:59 arasında saat ve 1–1440 dakika arasında süre seçin.');
  after.starts_at=Date.parse(`${date}T${time}:00+03:00`);after.ends_at=after.starts_at+duration*60000;
  if(after.starts_at<=now.getTime())return fail('Efendim, ajandayı geçmiş bir saate taşımadım. Gelecek gün ve saat seçin.');
 }
 return after;
}
async function draftResult(env,d,now,conflictChanged=false){
 const conflictItems=await conflicts(env.MEMORY_DB,d.recordKind,d.id,d.after);
 d={...d,conflictSignature:signature(conflictItems)};
 const token=await signDraft(env,'management',d,now),title=`${labels[d.recordKind]} ${d.id} · ${d.action==='undo'?'Geri al':d.action==='archive'?'Arşivle':d.action==='unarchive'?'Arşivden çıkar':'Düzenle'}`;
 const warning=conflictItems.length?` Bu saat ${conflictItems.length} etkin ajanda kaydıyla çakışıyor: ${conflictItems.slice(0,3).map(r=>`${r.id}: ${r.time} ${r.title.slice(0,70)}`).join('; ')}.`:'';
 const policy=d.recordKind==='expense'&&d.action==='archive'?' Arşivlemek bu harcamayı dönem toplamından düşürmez.':'';
 const text=`Efendim, ${conflictChanged?'çakışan kayıtlar değişti; bu yeni taslağı tekrar kontrol edin. ':''}${title}. Önce: ${describe(d.recordKind,d.before)}. Sonra: ${describe(d.recordKind,d.after)}.${warning}${policy} Henüz değiştirilmedi. “Değişikliği onaylıyorum” diyerek onaylayın.`;
 return {status:200,managementOpen:'records',managementDraft:{kind:'management',token,title,text,recordKind:d.recordKind,id:d.id,action:d.action,before:d.before,after:d.after,conflicts:conflictItems},text,...(conflictChanged?{conflictChanged:true}:{})};
}
async function preview(env,input,now){
 if(!input||typeof input!=='object'||Array.isArray(input))return fail('Efendim, düzenlenecek kaydı seçin.');
 const db=env.MEMORY_DB;
 if(input.action==='undo'){
  if(input.changeId!==undefined&&!safeId(input.changeId))return fail('Efendim, geçerli bir değişiklik numarası seçin.');
  const source=await db.prepare(latestQuery).first();
  if(!source)return fail('Efendim, geri alınabilecek kayıt değişikliği yok.',409);
  if(input.changeId!==undefined&&input.changeId!==source.id)return stale();
  const row=await getRecord(db,source.record_kind,source.record_id),before=JSON.parse(source.after_json),after=JSON.parse(source.before_json);
  if(!row||!equal(snapshot(source.record_kind,row),before))return stale();
  return draftResult(env,{draftId:crypto.randomUUID(),recordKind:source.record_kind,id:row.id,action:'undo',revision:row.revision,before,after,undoOf:source.id},now);
 }
 if(!Object.hasOwn(tables,input.kind)||!['edit','archive','unarchive'].includes(input.action))return fail('Efendim, ajanda, harcama veya not kaydını ve işlem türünü seçin.');
 if((await db.prepare("SELECT COUNT(*) AS total FROM atlas_record_changes WHERE action != 'undo'").first()).total>=forwardLimit)return capacity();
 if(input.latest!==undefined&&(input.latest!==true||input.kind!=='expense'||input.id!==undefined))return fail('Efendim, yalnızca son harcama açıkça seçilebilir; diğer kayıtlar için numara kullanın.');
 if(input.latest!==true&&!safeId(input.id))return fail('Efendim, kaydın numarasını belirtin; başlığa göre tahmin yürütmedim.');
 const row=input.latest===true?await db.prepare('SELECT * FROM atlas_expenses WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1').first():await getRecord(db,input.kind,input.id);
 if(!row)return fail('Efendim, bu numarada kayıt bulunamadı.',404);
 const before=snapshot(input.kind,row),after=changedSnapshot(input.kind,row,input,now);
 if(after.error)return after;
 if(equal(before,after))return fail('Efendim, bu alanlar zaten istediğiniz gibi. Değişiklik yapılmadı.',409);
 if(!validSnapshot(input.kind,before)||!validSnapshot(input.kind,after))return fail('Efendim, kayıt alanları doğrulanamadı. Değişiklik yapılmadı.',409);
 return draftResult(env,{draftId:crypto.randomUUID(),recordKind:input.kind,id:row.id,action:input.action,revision:row.revision,before,after,undoOf:null},now);
}
function validDraft(d){
 if(!d||!Object.hasOwn(tables,d.recordKind)||!safeId(d.id)||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.draftId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/u.test(d.draftId)||!['edit','archive','unarchive','undo'].includes(d.action)||!validSnapshot(d.recordKind,d.before)||!validSnapshot(d.recordKind,d.after)||equal(d.before,d.after)||typeof d.conflictSignature!=='string'||!/^(?:\d+:\d+(?:,\d+:\d+)*)?$/u.test(d.conflictSignature))return false;
 if(d.action==='undo')return safeId(d.undoOf);
 if(d.undoOf!==null)return false;
 const rest=s=>Object.fromEntries(fields[d.recordKind].filter(f=>f!=='archived_at').map(f=>[f,s[f]]));
 if(d.action==='archive')return d.before.archived_at===null&&d.after.archived_at!==null&&equal(rest(d.before),rest(d.after));
 if(d.action==='unarchive')return d.before.archived_at!==null&&d.after.archived_at===null&&equal(rest(d.before),rest(d.after));
 return d.before.archived_at===d.after.archived_at;
}
async function confirmation(body,env,now,text,requestId=''){
 const c=body.managementConfirmation;
 if(!c||c.confirmed!==true||typeof c.token!=='string'||normalize(text)!=='değişikliği onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Değişikliği onaylıyorum” deyin. Değişiklik yapılmadı.');
 let d;
 try{d=await verifyDraft(env,c.token,'management',now);if(!validDraft(d))throw Error();}catch{return fail('Efendim, taslak doğrulanamadı veya 30 dakikalık onay süresi doldu. Yeniden hazırlayın.',409);}
 const db=env.MEMORY_DB;
 const existing=await db.prepare('SELECT id FROM atlas_record_changes WHERE draft_id = ?').bind(d.draftId).first();
 if(existing)return {status:200,text:'Efendim, bu değişiklik zaten uygulandı; ikinci kez uygulamadım.',managementSaved:{id:existing.id,recordKind:d.recordKind,recordId:d.id,replayed:true},managementOpen:'records',...await readManagement(env,now,requestId)};
 const row=await getRecord(db,d.recordKind,d.id);
 if(!row||row.revision!==d.revision||!equal(snapshot(d.recordKind,row),d.before))return stale();
 if(d.action==='undo'){
  const source=await db.prepare(latestQuery).first();
  if(!source||source.id!==d.undoOf||source.record_kind!==d.recordKind||source.record_id!==d.id||source.before_json!==JSON.stringify(d.after)||source.after_json!==JSON.stringify(d.before))return stale();
 }
 if(d.action==='edit'&&d.recordKind==='agenda'&&(d.before.starts_at!==d.after.starts_at||d.before.ends_at!==d.after.ends_at)&&d.after.starts_at<=now.getTime())return fail('Efendim, onay beklerken ajanda saati geçmiş. Yeni bir saatle taslak hazırlayın.',409);
 if(d.recordKind==='expense'&&d.after.spent_day>dayInIstanbul(now))return fail('Efendim, gelecekteki harcama tarihi onaylanamaz.',409);
 const items=await conflicts(db,d.recordKind,d.id,d.after);
 if(signature(items)!==d.conflictSignature)return draftResult(env,d,now,true);
 // Guard the complete before state and conflict set inside the same statement
 // that fires the atomic audit+update trigger, not merely in the preceding read.
 let condition=`r.id = ? AND r.revision = ? AND ${fields[d.recordKind].map(f=>`r.${f} IS ?`).join(' AND ')}`;
 const args=[d.id,d.revision,...fields[d.recordKind].map(f=>d.before[f])];
 if(d.recordKind==='agenda'&&d.after.archived_at===null){condition+=" AND (SELECT COALESCE(group_concat(id || ':' || revision,','),'') FROM (SELECT id,revision FROM atlas_agenda WHERE archived_at IS NULL AND id != ? AND starts_at < ? AND ends_at > ? ORDER BY id)) = ?";args.push(d.id,d.after.ends_at,d.after.starts_at,d.conflictSignature);}
 if(d.action==='undo'){condition+=" AND (SELECT c.id FROM atlas_record_changes c WHERE c.action != 'undo' AND NOT EXISTS (SELECT 1 FROM atlas_record_changes u WHERE u.undo_of = c.id) ORDER BY c.id DESC LIMIT 1) = ?";args.push(d.undoOf);}
 else{condition+=" AND (SELECT COUNT(*) FROM atlas_record_changes WHERE action != 'undo') < ?";args.push(forwardLimit);}
 condition+=' AND NOT EXISTS (SELECT 1 FROM atlas_record_changes WHERE draft_id = ?)';args.push(d.draftId);
 try{
  await db.prepare(`INSERT INTO atlas_record_changes(draft_id,record_kind,record_id,action,before_revision,before_json,after_json,created_at,undo_of) SELECT ?,?,?,?,?,?,?,?,? FROM ${tables[d.recordKind]} r WHERE ${condition}`).bind(d.draftId,d.recordKind,d.id,d.action,d.revision,JSON.stringify(d.before),JSON.stringify(d.after),now.toISOString(),d.undoOf,...args).run();
 }catch{return fail('Efendim, değişiklik uygulanamadı. Aynı metinde başka bir not olabilir veya kayıt değişmiş olabilir. Güncel kaydı seçip yeniden hazırlayın.',409);}
 const saved=await db.prepare('SELECT id FROM atlas_record_changes WHERE draft_id = ?').bind(d.draftId).first();
 if(!saved){
  if(d.action!=='undo'&&(await db.prepare("SELECT COUNT(*) AS total FROM atlas_record_changes WHERE action != 'undo'").first()).total>=forwardLimit)return capacity();
  const current=await getRecord(db,d.recordKind,d.id);
  if(!current||current.revision!==d.revision||!equal(snapshot(d.recordKind,current),d.before))return stale();
  if(signature(await conflicts(db,d.recordKind,d.id,d.after))!==d.conflictSignature)return draftResult(env,d,now,true);
  return stale();
 }
 return {status:200,text:`Efendim, ${labels[d.recordKind]} ${d.id} için onayladığınız ${d.action==='undo'?'geri alma':'değişiklik'} uygulandı.${d.recordKind==='expense'?' Arşivlenen harcamalar dönem toplamlarına dahildir.':''}`,managementSaved:{id:saved.id,recordKind:d.recordKind,recordId:d.id},managementOpen:'records',...await readManagement(env,now,requestId)};
}
export async function managementRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.filter(m=>m?.role==='user').at(-1):null,text=typeof latest?.text==='string'?latest.text:'';
 const parsed=managementCommand(text),hasDraft=Object.hasOwn(body||{},'managementDraftRequest'),hasConfirmation=Object.hasOwn(body||{},'managementConfirmation');
 if(!parsed&&!hasDraft&&!hasConfirmation)return null;
 if(hasDraft&&hasConfirmation)return fail('Efendim, taslak hazırlama ile onay ayrı işlemlerdir. Değişiklik yapılmadı.');
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return unavailable();
 try{
  if(hasConfirmation||parsed?.action==='confirm')return await confirmation(body,env,now,text,requestId);
  if(hasDraft)return await preview(env,body.managementDraftRequest,now);
  if(parsed.action==='invalid')return fail('Efendim, kaydı numarasıyla ve alanıyla belirtin: “Harcama 3 tutarını 240 lira yap”, “Ajanda 2 yarın saat 16.00’ya taşı” veya “Not 2 metnini yeni metin olarak düzelt”.');
  if(parsed.action==='list')return {status:200,managementOpen:'records',text:'Efendim, etkin ve arşivlenmiş kayıtlarınız ile son değişiklikler açık. Arşivlenen harcamalar dönem toplamlarına dahildir.',...await readManagement(env,now,requestId)};
  const request=parsed.request;
  if(request.kind==='agenda'&&['bugün','yarın','dün'].includes(request.changes?.date))request.changes.date=dayInIstanbul(now,request.changes.date==='yarın'?1:request.changes.date==='dün'?-1:0);
  return await preview(env,request,now);
 }catch(error){reportError({stage:'management.request',requestId,error,meta:{table:'atlas_record_changes'}});return unavailable();}
}
