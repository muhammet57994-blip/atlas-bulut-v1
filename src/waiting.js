import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const actions=['create','edit','set-status','archive','restore'],kinds=['reply','delivery'],statuses=['waiting','received','cancelled'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const fail=(text,status=400)=>({status,error:text,text,waitingOpen:true});
const unavailable=()=>fail('Efendim, ortak beklenenler deposu henüz hazır değil. Değişiklik yapılmadı.',503);
const stale=()=>fail('Efendim, bu beklenen kaydı başka bir işlemle değişti. Güncel kayıttan yeni bir taslak hazırlayın; değişiklik yapılmadı.',409);
const scope='Bu liste sizin onayladığınız manuel kayıtlardır. Mesajlar ve kargolar sorgulanmaz; otomatik bildirim veya mesaj gönderilmez.';
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{16,80}$/u.test(s);
const validText=(s,empty=false)=>typeof s==='string'&&s.trim().length>=(empty?0:1)&&s.trim().length<=200&&!/[\u0000-\u001f\u007f]/u.test(s);
function validDate(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(s)||s<'2000-01-01'||s>'2100-12-31')return false;
 const at=Date.parse(`${s}T12:00:00Z`);return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===s;
}
const stateKeys=['who','who_key','what','what_key','kind','followup_date','last_contact_date','status','archived'];
const state=row=>Object.fromEntries(stateKeys.map(k=>[k,row[k]]));
const sameState=(a,b)=>JSON.stringify(state(a))===JSON.stringify(state(b));
function validState(s){
 return !!s&&kinds.includes(s.kind)&&validText(s.who,s.kind==='delivery')&&validText(s.what)&&s.who===s.who.trim()&&s.what===s.what.trim()&&s.who_key===normalize(s.who)&&s.what_key===normalize(s.what)&&(s.followup_date===''||validDate(s.followup_date))&&(s.last_contact_date===''||validDate(s.last_contact_date))&&statuses.includes(s.status)&&[0,1].includes(s.archived);
}
const cleanState=s=>validState(s)&&Object.keys(s).length===stateKeys.length&&Object.keys(s).every(k=>stateKeys.includes(k));
async function waitingRows(db){const result=(await db.prepare('SELECT * FROM atlas_waiting ORDER BY created_at,id LIMIT 201').all()).results;if(result.length>200)throw Error('bounds');return result;}
export async function readWaiting(env,now=new Date(),requestId=''){
 const empty={waitingOpen:true,waitingItems:[],archivedWaitingItems:[],waitingSummary:null,waitingScope:scope};
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return {...unavailable(),...empty};
 try{
  const todayDate=dayInIstanbul(now),rows=await waitingRows(env.MEMORY_DB),waitingItems=[],archivedWaitingItems=[];
  for(const row of rows){if(!validState(row)||!Number.isSafeInteger(row.revision)||row.revision<1)throw Error('stored state');const item={id:row.id,who:row.who,what:row.what,kind:row.kind,followup_date:row.followup_date,last_contact_date:row.last_contact_date,status:row.status,archived:row.archived,revision:row.revision,created_at:row.created_at,updated_at:row.updated_at};(row.archived?archivedWaitingItems:waitingItems).push(item);}
  const sort=(a,b)=>(a.status==='waiting'?0:1)-(b.status==='waiting'?0:1)||(a.followup_date||'9999').localeCompare(b.followup_date||'9999')||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
  waitingItems.sort(sort);archivedWaitingItems.sort(sort);const pending=waitingItems.filter(r=>r.status==='waiting');
  const waitingSummary={todayDate,total:waitingItems.length,waiting:pending.length,received:waitingItems.filter(r=>r.status==='received').length,cancelled:waitingItems.filter(r=>r.status==='cancelled').length,overdue:pending.filter(r=>r.followup_date&&r.followup_date<todayDate).length,today:pending.filter(r=>r.followup_date===todayDate).length,upcoming:pending.filter(r=>r.followup_date>todayDate).length,dated:pending.filter(r=>r.followup_date).length,undated:pending.filter(r=>!r.followup_date).length};
  return {status:200,waitingOpen:true,waitingItems,archivedWaitingItems,waitingSummary,waitingScope:scope};
 }catch(error){reportError({stage:'db.waiting.read',requestId,error,meta:{table:'atlas_waiting'}});return {...unavailable(),...empty};}
}

export function waitingCommand(input){
 if(typeof input!=='string')return null;const text=normalize(input);
 if(text==='beklenen kaydını onaylıyorum')return {action:'confirm'};
 if(/^(?:beklediğim neler var|beklenenler(?:im)?(?:i)?(?: (?:göster|aç|oku|listele))?|beklediklerimi (?:göster|aç|oku|listele))$/u.test(text))return {action:'list'};
 const byId=text.match(/^beklenen\s+([a-z0-9-]{16,80})\s+(geldi|alındı|iptal et|yeniden bekle|arşivle|geri aç)$/u);
 if(byId){const action=byId[2]==='arşivle'?'archive':byId[2]==='geri aç'?'restore':'set-status';return {action:'draft',input:{action,id:byId[1],...(action==='set-status'?{status:byId[2]==='iptal et'?'cancelled':byId[2]==='yeniden bekle'?'waiting':'received'}:{})}};}
 if(/^kargo bekliyorum(?:\s|:|$)/u.test(text)||/^.+?['’](?:dan|den|tan|ten)\s+.+?\s+bekliyorum(?:\s|,|$)/u.test(text))return {action:'voice-create',text:input.trim().replace(/[.!?]+$/u,'').trim()};
 const received=text.match(/^(.+?)\s+geldi$/u);if(received)return {action:'received-name',name:received[1]};
 return null;
}
function naturalDate(input,now){
 const text=normalize(input),today=dayInIstanbul(now);if(validDate(text))return text;
 if(text==='tarihsiz'||text==='tarih yok')return '';
 if(text==='bugün')return today;if(text==='yarın')return dayInIstanbul(now,1);if(text==='öbür gün')return dayInIstanbul(now,2);
 const weekdays=['pazar','pazartesi','salı','çarşamba','perşembe','cuma','cumartesi'];
 if(weekdays.includes(text)){const current=new Date(`${today}T12:00:00Z`).getUTCDay();return dayInIstanbul(now,(weekdays.indexOf(text)-current+7)%7);}
 return null;
}
function fromVoice(text,now){
 let content=text,date='';
 // Dates are parsed only in an explicit trailing follow-up clause. A person
 // named Cuma or a title beginning with a weekday must remain content.
 const tail=content.match(/,\s*(?:takip tarihi\s+(.+)|(.+?)\s+tekrar kontrol edelim)$/iu);
 if(tail){date=naturalDate(tail[1]||tail[2],now);if(date===null)return fail('Efendim, takip tarihini bugün, yarın, hafta günü veya YYYY-AA-GG olarak belirtin; tarihsiz de seçebilirsiniz.');content=content.slice(0,tail.index).trim();}
 const delivery=content.match(/^kargo bekliyorum\s*:\s*(.+)$/iu);
 if(delivery){if(/,\s*(?:takip|son temas|kontrol)/iu.test(delivery[1]))return fail('Efendim, takip tarihini “, takip tarihi YYYY-AA-GG” olarak belirtin.');return {action:'create',who:'',what:delivery[1].trim(),kind:'delivery',followupDate:date};}
 const reply=content.match(/^(.+?)['’](?:dan|den|tan|ten)\s+(.+?)\s+bekliyorum$/iu);
 if(reply)return {action:'create',who:reply[1].trim(),what:reply[2].trim(),kind:'reply',followupDate:date};
 return fail('Efendim, “Ahmet’ten teklif bekliyorum, cuma tekrar kontrol edelim” veya “Kargo bekliyorum: kitap, takip tarihi 2026-10-30” diyebilirsiniz. Takip tarihi verilmezse taslak açıkça tarihsiz hazırlanır.');
}
function entryInput(input,base,now){
 const value=(key,stored,fallback)=>Object.hasOwn(input,key)?input[key]:base?base[stored]:fallback;
 const who=value('who','who',''),what=value('what','what',undefined),kind=value('kind','kind',undefined),followup_date=value('followupDate','followup_date',''),last_contact_date=value('lastContactDate','last_contact_date','');
 if(!kinds.includes(kind)||!validText(who,kind==='delivery')||!validText(what))return fail('Efendim, yanıt veya teslimat türünü seçin; ne beklediğinizi 1–200 karakterle belirtin. Yanıt için kişi veya kurum adı da gereklidir.');
 if((followup_date!==''&&!validDate(followup_date))||(last_contact_date!==''&&(!validDate(last_contact_date)||last_contact_date>dayInIstanbul(now))))return fail('Efendim, tarihleri YYYY-AA-GG biçiminde geçerli bir gün olarak seçin (2000–2100); son temas tarihi gelecekte olamaz. Tarihsiz bırakmak için alanı boş bırakın.');
 return {who:who.trim(),who_key:normalize(who),what:what.trim(),what_key:normalize(what),kind,followup_date,last_contact_date,status:base?.status||'waiting',archived:base?.archived??0};
}
async function prepareChange(db,input,now){
 if(!input||typeof input!=='object'||Array.isArray(input)||!actions.includes(input.action))return fail('Efendim, oluşturma, düzenleme, durum, arşivleme veya geri açma işlemi seçin.');
 const allowed=['archive','restore'].includes(input.action)?['action','id']:input.action==='set-status'?['action','id','status']:['action','id','who','what','kind','followupDate','lastContactDate'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))return fail('Efendim, taslakta desteklenmeyen bir alan var.');
 if(input.action==='create'){
  if(Object.hasOwn(input,'id'))return fail('Efendim, yeni kaydın numarası taslakta oluşturulur.');
  const after=entryInput(input,null,now);if(after.error)return after;return {action:input.action,id:crypto.randomUUID(),before:null,expectedRevision:0,after};
 }
 if(!validId(input.id))return fail('Efendim, Beklenenler bölümünden belirli bir kayıt seçin veya tam kayıt numarasını belirtin.');
 const row=await db.prepare('SELECT * FROM atlas_waiting WHERE id=?').bind(input.id).first();if(!row)return fail('Efendim, bu numarada beklenen kaydı bulunamadı.',404);if(!validState(row))throw Error('stored state');
 const common={action:input.action,id:row.id,before:state(row),expectedRevision:row.revision};
 if(input.action==='edit'){
  const after=entryInput(input,row,now);if(after.error)return after;if(sameState(after,row))return fail('Efendim, bu alanlarda bir değişiklik yok.');return {...common,after};
 }
 if(input.action==='set-status'){
  if(!statuses.includes(input.status))return fail('Efendim, bekleniyor, alındı veya iptal durumunu seçin.');
  if(row.archived)return fail('Efendim, arşivdeki kaydın durumunu değiştirmek için önce geri açma taslağını onaylayın.');
  if(row.status===input.status)return fail('Efendim, kayıt zaten bu durumda.');return {...common,after:{...state(row),status:input.status}};
 }
 const archived=input.action==='archive'?1:0;if(row.archived===archived)return fail(`Efendim, kayıt zaten ${archived?'arşivde':'aktif'}.`);return {...common,after:{...state(row),archived}};
}
const title=s=>`${s.who?s.who+': ':''}${s.what}`;
const statusLabel=s=>s==='received'?'alındı':s==='cancelled'?'iptal':'bekleniyor';
const publicKeys=['who','what','kind','followup_date','last_contact_date','status','archived'];
const publicState=s=>s?Object.fromEntries(publicKeys.map(key=>[key,s[key]])):null;
const changedFields=d=>d.before?publicKeys.filter(key=>d.before[key]!==d.after[key]):[];
const fieldLabels={who:'Kişi/kurum',what:'Beklenen',kind:'Tür',followup_date:'Takip tarihi',last_contact_date:'Son temas',status:'Durum',archived:'Arşiv'};
function displayField(key,value){
 if(key==='kind')return value==='reply'?'yanıt':'teslimat';
 if(key==='status')return statusLabel(value);
 if(key==='archived')return value?'arşivde':'aktif';
 if(key==='followup_date')return value||'tarihsiz';
 return value||'belirtilmedi';
}
function comparison(d){
 const fields=changedFields(d),line=s=>fields.map(key=>`${fieldLabels[key]}: “${displayField(key,s[key])}”`).join('; ');
 return `Önce: ${line(d.before)}. Sonra: ${line(d.after)}.`;
}
function describe(d){
 const s=d.after,details=`${title(s)}; tür: ${s.kind==='reply'?'yanıt':'teslimat'}; takip tarihi: ${s.followup_date||'tarihsiz'}; son temas: ${s.last_contact_date||'belirtilmedi'}; durum: ${statusLabel(s.status)}.`;
 const change=d.action==='archive'?'Kayıt arşivlenecek.':d.action==='restore'?'Kayıt arşivden geri açılacak.':d.action==='set-status'?`Durum “${statusLabel(d.before.status)}” yerine “${statusLabel(s.status)}” olarak kaydedilecek.`:d.action==='edit'?'Kayıt güncellenecek.':'Manuel beklenen kaydı oluşturulacak.';
 return `${details} ${change}${d.action==='edit'?' '+comparison(d):''} ${scope}`;
}
async function preview(env,input,now){
 const d=await prepareChange(env.MEMORY_DB,input,now);if(d.error)return d;d.draftId=crypto.randomUUID();
 const token=await signDraft(env,'waiting',d,now),text=`Efendim, ${describe(d)} Henüz kaydedilmedi. Kaydetmek için “Beklenen kaydını onaylıyorum” deyin.`;
 return {status:200,waitingOpen:true,text,waitingDraft:{kind:'waiting',action:d.action,id:d.id,title:title(d.after),who:d.after.who,what:d.after.what,recordKind:d.after.kind,followupDate:d.after.followup_date,lastContactDate:d.after.last_contact_date,status:d.after.status,archived:d.after.archived,before:publicState(d.before),after:publicState(d.after),changedFields:changedFields(d),token,text}};
}
function validDraft(d,now){
 if(!d||Object.keys(d).some(k=>!['action','id','before','expectedRevision','after','draftId'].includes(k))||!actions.includes(d.action)||!validId(d.id)||!validId(d.draftId)||!Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0||!cleanState(d.after))return false;
 if(d.after.last_contact_date>dayInIstanbul(now))return false;
 if(d.action==='create')return d.before===null&&d.expectedRevision===0&&d.after.archived===0&&d.after.status==='waiting';
 if(!cleanState(d.before)||d.expectedRevision<1)return false;
 if(d.action==='edit')return d.after.archived===d.before.archived&&d.after.status===d.before.status&&!sameState(d.before,d.after);
 if(d.action==='set-status')return d.before.archived===0&&d.after.archived===0&&d.before.status!==d.after.status&&sameState({...d.before,status:d.after.status},d.after);
 return d.before.archived===(d.action==='archive'?0:1)&&d.after.archived===(d.action==='archive'?1:0)&&sameState({...d.before,archived:d.after.archived},d.after);
}
async function savedResult(env,now,saved,replay=false,requestId=''){return {...await readWaiting(env,now,requestId),waitingOpen:true,waitingSaved:{id:saved.id,waiting_id:saved.waiting_id,action:saved.action},text:replay?'Efendim, bu değişiklik zaten kaydedilmiş. İkinci bir kayıt oluşturulmadı.':'Efendim, onayladığınız beklenen kaydı değişikliği kaydedildi. Bu manuel bir kayıttır; mesaj veya kargo sorgulanmadı.'};}
async function confirm(body,env,now,text,requestId=''){
 const c=body.waitingConfirmation;
 if(!c||c.confirmed!==true||typeof c.token!=='string'||c.token.length>24100||Object.keys(c).some(k=>!['token','confirmed'].includes(k))||normalize(text)!=='beklenen kaydını onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Beklenen kaydını onaylıyorum” diyerek onaylayın. Değişiklik yapılmadı.');
 let d;try{d=await verifyDraft(env,c.token,'waiting',now);if(!validDraft(d,now))throw Error();}catch{return fail('Efendim, taslak doğrulanamadı veya süresi doldu. Yeniden hazırlayın; değişiklik yapılmadı.',409);}
 const db=env.MEMORY_DB,existing=await db.prepare('SELECT id,waiting_id,action FROM atlas_waiting_operations WHERE id=?').bind(d.draftId).first();if(existing)return savedResult(env,now,existing,true,requestId);
 if(d.action!=='create'){const current=await db.prepare('SELECT * FROM atlas_waiting WHERE id=?').bind(d.id).first();if(!current||current.revision!==d.expectedRevision||!sameState(current,d.before))return stale();}
 try{
  // A single journal INSERT checks state and capacity and applies the whole
  // change through triggers. A failed record write rolls back its journal.
  await db.prepare('INSERT INTO atlas_waiting_operations(id,waiting_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(d.draftId,d.id,d.action,d.expectedRevision,d.before?JSON.stringify(d.before):null,JSON.stringify(d.after),now.toISOString()).run();
 }catch{
  const raced=await db.prepare('SELECT id,waiting_id,action FROM atlas_waiting_operations WHERE id=?').bind(d.draftId).first();if(raced)return savedResult(env,now,raced,true,requestId);
  const count=await db.prepare('SELECT (SELECT COUNT(*) FROM atlas_waiting) AS records,(SELECT COUNT(*) FROM atlas_waiting_operations) AS operations').first();
  if(d.action==='create'&&count.records>=200)return fail('Efendim, arşiv dahil 200 beklenen kaydı sınırına ulaşıldı. Kayıt oluşturulmadı.',409);
  if(count.operations>=5000)return fail('Efendim, beklenen kayıtlarının 5000 işlem sınırına ulaşıldı. Değişiklik yapılmadı.',409);
  const current=await db.prepare('SELECT * FROM atlas_waiting WHERE id=?').bind(d.id).first();if(d.action!=='create'&&(!current||current.revision!==d.expectedRevision||!sameState(current,d.before)))return stale();return unavailable();
 }
 return savedResult(env,now,{id:d.draftId,waiting_id:d.id,action:d.action},false,requestId);
}
function recordNames(row){const names=[row.what,`${row.who}: ${row.what}`,`${row.who} ${row.what}`];if(row.who)for(const suffix of ['dan','den','tan','ten'])for(const quote of ["'",'’'])names.push(`${row.who}${quote}${suffix} ${row.what}`);return new Set(names.map(normalize));}
export async function waitingRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.at(-1):null,text=latest?.role==='user'&&typeof latest.text==='string'?latest.text:'';
 const parsed=waitingCommand(text),hasDraft=Object.hasOwn(body||{},'waitingDraftRequest'),hasConfirmation=Object.hasOwn(body||{},'waitingConfirmation');
 if(!parsed&&!hasDraft&&!hasConfirmation)return null;
 if(hasDraft&&hasConfirmation)return fail('Efendim, taslak hazırlama ve onay ayrı işlemler olmalı. Değişiklik yapılmadı.');
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return unavailable();
 try{
  if(hasConfirmation||parsed?.action==='confirm')return await confirm(body,env,now,text,requestId);
  if(hasDraft)return await preview(env,body.waitingDraftRequest,now);
  if(parsed.action==='voice-create'){const input=fromVoice(parsed.text,now);return input.error?input:await preview(env,input,now);}
  if(parsed.action==='draft')return await preview(env,parsed.input,now);
  if(parsed.action==='received-name'){
   const matches=(await waitingRows(env.MEMORY_DB)).filter(r=>!r.archived&&recordNames(r).has(parsed.name));
   if(matches.length!==1)return fail(matches.length?'Efendim, bu ad birden fazla kayda uyuyor. Beklenenler bölümünden tam kayıt numarasını seçin; durum değiştirilmedi.':'Efendim, bu tam adla aktif bir kayıt bulunamadı. Beklenenler bölümünden kaydı seçin; durum değiştirilmedi.',matches.length?409:404);
   return await preview(env,{action:'set-status',id:matches[0].id,status:'received'},now);
  }
  const snapshot=await readWaiting(env,now,requestId);if(snapshot.error)return snapshot;const s=snapshot.waitingSummary;
  return {...snapshot,text:`Efendim, ${s.waiting} kayıt bekleniyor. Takip tarihi geçmiş: ${s.overdue}; bugün: ${s.today}; ileri tarihli: ${s.upcoming}; tarihsiz: ${s.undated}. ${scope}`};
 }catch(error){reportError({stage:'waiting.request',requestId,error});return unavailable();}
}
