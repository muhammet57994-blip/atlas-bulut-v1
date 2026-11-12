import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const categories=['market','ulaşım','yemek','fatura','diğer'];
const currencies=['TRY','USD','EUR'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const fail=(text,status=400,kind)=>({status,error:text,text,...(kind?{dailyOpen:kind}:{})});
const unavailable=()=>fail('Efendim, ortak ajanda ve harcama deposu henüz hazır değil. Kayıt yapılmadı.',503);
const stamp=day=>Date.parse(`${day}T00:00:00+03:00`);
const validTitle=t=>typeof t==='string'&&t.trim().length>0&&t.trim().length<=200&&!/[\u0000-\u001f\u007f]/u.test(t);
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;
 const n=Date.parse(`${value}T12:00:00Z`);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;
}
function period(now){const today=dayInIstanbul(now);return {from:today.slice(0,7)+'-01',to:today};}
function money(cents,currency){return `${(cents/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`;}
function amountMinor(value){
 // A single decimal separator and at most two decimal places are deliberate:
 // thousands separators (1.000 / 1,000) must not silently change the amount.
 if(typeof value!=='string'||!/^\d{1,9}(?:[,.]\d{1,2})?$/u.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().split(/[,.]/u),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(minor)&&minor>0&&minor<=99999999999?minor:null;
}
function rowAgenda(r){return {...r,date:dayInIstanbul(new Date(r.starts_at)),time:new Date(r.starts_at+10800000).toISOString().slice(11,16),durationMinutes:(r.ends_at-r.starts_at)/60000};}
async function agendaRows(db,from,to,limit=30){return (await db.prepare('SELECT id,title,starts_at,ends_at,created_at FROM atlas_agenda WHERE archived_at IS NULL AND ends_at > ? AND starts_at < ? ORDER BY starts_at,id LIMIT ?').bind(from,to,limit).all()).results.map(rowAgenda);}
async function expenseRows(db,p,category){
 const filter=category?' AND category = ?':'',args=category?[p.from,p.to,category]:[p.from,p.to];
 const expenseItems=(await db.prepare(`SELECT id,title,amount_minor,currency,category,spent_day,created_at FROM atlas_expenses WHERE archived_at IS NULL AND spent_day >= ? AND spent_day <= ?${filter} ORDER BY spent_day DESC,id DESC LIMIT 30`).bind(...args).all()).results;
 const expenseTotals=(await db.prepare(`SELECT currency,SUM(amount_minor) AS amount_minor FROM atlas_expenses WHERE spent_day >= ? AND spent_day <= ?${filter} GROUP BY currency ORDER BY currency`).bind(...args).all()).results;
 return {expenseItems,expenseTotals,expensePeriod:p,expenseArchivePolicy:'Arşivlenen harcamalar dönem toplamlarına dahildir.',...(category?{expenseCategory:category}:{})};
}
export async function readDaily(env,now=new Date(),requestId=''){
 const empty={agendaItems:[],expenseItems:[],expenseTotals:[],expensePeriod:period(now)};
 if(!env?.MEMORY_DB)return {...unavailable(),...empty};
 try{return {agendaItems:await agendaRows(env.MEMORY_DB,now.getTime(),Date.parse('2101-01-01T00:00:00Z')), ...await expenseRows(env.MEMORY_DB,period(now))};}catch(error){reportError({stage:'db.daily.read',requestId,error,meta:{table:'atlas_agenda'}});return {...unavailable(),...empty};}
}

export function dailyCommand(input){
 if(typeof input!=='string')return null;
 const text=normalize(input);
 if(text==='kaydı onaylıyorum')return {action:'confirm'};
 if(/^(?:ajandamı|ajanda|randevularımı) (?:aç|göster|oku|listele)$/u.test(text)||text==='ajandam')return {action:'agenda-list'};
 if(/^(?:bugünkü|bugünün) randevularım(?:ı (?:aç|göster|oku))?$/u.test(text))return {action:'agenda-list',offset:0};
 if(/^(?:yarınki|yarının) randevularım(?:ı (?:aç|göster|oku))?$/u.test(text))return {action:'agenda-list',offset:1};
 if(/^(?:harcamalarımı|harcama defterimi|harcama defteri) (?:aç|göster|oku|listele)$/u.test(text)||text==='harcamalarım')return {action:'expense-list'};
 if(/^bu ay (?:ne kadar harcadım|harcama toplamım(?: ne)?|toplam harcamam(?: ne)?)$/u.test(text))return {action:'expense-list'};
 const total=text.match(/^bu ay (market|ulaşım|yemek|fatura|diğer) toplamım(?: ne)?$/u);
 if(total)return {action:'expense-list',category:total[1]};
 if(/(?:^|\s)harcadım$/u.test(text)||/^(?:harcama ekle|harcama kaydet)(?:\s|:|$)/u.test(text))return {action:'draft',kind:'expense',text:input.trim().replace(/[.!?]+$/u,'').trim()};
 if(/(?:^|\s)(?:hatırlat|ajandaya ekle)$/u.test(text)||/^(?:ajandaya ekle|randevu ekle)(?:\s|:|$)/u.test(text))return {action:'draft',kind:'agenda',text:input.trim().replace(/[.!?]+$/u,'').trim()};
 return null;
}
function voiceDate(text,now,kind){
 // Unsupported relative dates and malformed numeric dates must not turn into
 // today's expense merely because a supported date was not found.
 if(/(?:^|\s)(?:pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|haftaya|geçen|gelecek|öbür)(?=\s|$)/iu.test(text))return null;
 if(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/u.test(text)&&! /\b\d{4}-\d{2}-\d{2}\b/u.test(text))return null;
 const relative=[...text.matchAll(/(?:^|\s)(bugün|yarın|dün)(?=\s|$)/giu)].map(m=>m[1].toLocaleLowerCase('tr-TR'));
 const absolute=[...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu)].map(m=>m[0]);
 if(relative.length+absolute.length>1)return null;
 if(absolute.length)return validDate(absolute[0])?absolute[0]:null;
 if(relative.length)return dayInIstanbul(now,relative[0]==='yarın'?1:relative[0]==='dün'?-1:0);
 return kind==='expense'?dayInIstanbul(now):null;
}
function fromVoice(parsed,now){
 const date=voiceDate(parsed.text,now,parsed.kind);
 if(parsed.kind==='agenda'){
  const matches=[...parsed.text.matchAll(/(?:^|\s)(?:saat\s+)?(\d{1,2})[:.](\d{2})(?:['’]?(?:te|ta|de|da))?(?=\s|$)/giu)];
  if(!date||matches.length!==1)return fail('Efendim, ajanda için açık bir gün ve saat belirtin: “Yarın saat 15.00 müşteriyi aramayı hatırlat.” Formdan da seçebilirsiniz.',400,'agenda');
  const match=matches[0];
  const title=parsed.text.replace(match[0],' ').replace(/(?:^|\s)(bugün|yarın|dün)(?=\s|$)/giu,' ').replace(/\b\d{4}-\d{2}-\d{2}\b/gu,' ').replace(/^(?:ajandaya ekle|randevu ekle)\s*:?\s*/iu,'').replace(/\s*(?:hatırlat|ajandaya ekle)$/iu,'').replace(/\s+/gu,' ').trim();
  return {kind:'agenda',title,date,time:`${match[1].padStart(2,'0')}:${match[2]}`,durationMinutes:30};
 }
 const amounts=[...parsed.text.matchAll(/(?:^|\s)([+-]?\d[\d.,]*)\s*(lira|tl|try|dolar|usd|euro|avro|eur)(?=\s|$)/giu)];
 if(!date||amounts.length!==1)return fail('Efendim, tutarı ve günü açıkça söyleyin: “Bugün markete 420 lira harcadım.” Kuruş için “45,50 lira” yazabilirsiniz.',400,'expense');
 const match=amounts[0],unit=match[2].toLocaleLowerCase('tr-TR');
 if(/[\d.,+-]\s*$/u.test(parsed.text.slice(0,match.index)))return fail('Efendim, tutar ayracı belirsiz. Binlik ayırıcı kullanmadan “1200” veya “1200,50” yazın.',400,'expense');
 const currency=['dolar','usd'].includes(unit)?'USD':['euro','avro','eur'].includes(unit)?'EUR':'TRY';
 const title=parsed.text.replace(match[0],' ').replace(/(?:^|\s)(bugün|yarın|dün)(?=\s|$)/giu,' ').replace(/\b\d{4}-\d{2}-\d{2}\b/gu,' ').replace(/^(?:harcama ekle|harcama kaydet)\s*:?\s*/iu,'').replace(/\s*harcadım$/iu,'').replace(/\s+için$/iu,'').replace(/\s+/gu,' ').trim();
 const category=/market/iu.test(title)?'market':/ulaşım|taksi|otobüs|metro|dolmuş/iu.test(title)?'ulaşım':/yemek|restoran|kahve/iu.test(title)?'yemek':/fatura/iu.test(title)?'fatura':'diğer';
 return {kind:'expense',title,amount:match[1],currency,category,date};
}
function validateInput(input,now){
 if(!input||!['agenda','expense'].includes(input.kind))return fail('Efendim, ajanda veya harcama türünü seçin.');
 const kind=input.kind;
 if(!validTitle(input.title))return fail('Efendim, başlık 1–200 karakter olmalı.',400,kind);
 if(!validDate(input.date))return fail('Efendim, geçerli bir tarih seçin (2000–2100).',400,kind);
 const common={kind,title:input.title.trim(),date:input.date};
 if(kind==='agenda'){
  if(typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(input.time))return fail('Efendim, saati 00:00–23:59 arasında belirtin.',400,kind);
  const duration=input.durationMinutes??30;
  if(!Number.isInteger(duration)||duration<1||duration>1440)return fail('Efendim, süre 1–1440 dakika arasında olmalı.',400,kind);
  const starts_at=Date.parse(`${input.date}T${input.time}:00+03:00`),ends_at=starts_at+duration*60000;
  if(starts_at<=now.getTime())return fail('Efendim, bu saat geçmiş. Yeni bir gün ve saat seçin; kendiliğimden yarına taşımadım.',400,kind);
  return {...common,time:input.time,durationMinutes:duration,starts_at,ends_at};
 }
 const amount_minor=amountMinor(input.amount);
 if(amount_minor===null)return fail('Efendim, tutar sıfırdan büyük olmalı. Binlik ayırıcı kullanmadan “420” veya “45,50” yazın; en fazla iki kuruş hanesi kabul edilir.',400,kind);
 if(!currencies.includes(input.currency)||!categories.includes(input.category))return fail('Efendim, geçerli para birimi ve kategori seçin.',400,kind);
 if(input.date>dayInIstanbul(now))return fail('Efendim, gelecekte yapılacak harcamayı gerçekleşmiş olarak kaydedemem. Bugünü veya geçmiş bir tarihi seçin.',400,kind);
 return {...common,amount_minor,currency:input.currency,category:input.category};
}
// Shared pure parsing for the separately approved multi-action flow. No reads or writes.
export function prepareDailyCreation(command,now=new Date()){
 const parsed=dailyCommand(command);if(parsed?.action!=='draft')return null;
 const input=fromVoice(parsed,now);return input.error?input:validateInput(input,now);
}
async function conflicts(db,data){return (await db.prepare('SELECT id,title,starts_at,ends_at,created_at,revision FROM atlas_agenda WHERE archived_at IS NULL AND starts_at < ? AND ends_at > ? ORDER BY id').bind(data.ends_at,data.starts_at).all()).results.map(rowAgenda);}
const conflictSignature=items=>items.map(i=>`${i.id}:${i.revision}`).join(',');
async function preview(env,input,now,{draftId,conflictChanged=false}={}){
 const d=validateInput(input,now);if(d.error)return d;
 const conflictItems=d.kind==='agenda'?await conflicts(env.MEMORY_DB,d):[];
 const data={...d,draftId:draftId||crypto.randomUUID(),conflictIds:conflictSignature(conflictItems)};
 const token=await signDraft(env,'daily',data,now);
 const description=d.kind==='agenda'?`${d.date} saat ${d.time} (İstanbul), ${d.durationMinutes} dakika: ${d.title}.`:`${d.date}: ${d.title}, ${money(d.amount_minor,d.currency)}; kategori ${d.category}.`;
 const warning=conflictItems.length?` Bu saat ${conflictItems.length} kayıtla çakışıyor: ${conflictItems.slice(0,3).map(r=>`${r.time} ${r.title.slice(0,70)}`).join('; ')}. Mevcut kayıtlar korunacak.`:'';
 const text=`Efendim, ${conflictChanged?'saat çakışmaları değişti; güncel taslağı yeniden kontrol edin. ':''}${description}${warning} Henüz kaydedilmedi. Kaydetmek için “Kaydı onaylıyorum” deyin.`;
 return {status:200,text,dailyOpen:d.kind,dailyDraft:{...d,token,text,conflicts:conflictItems},...(conflictChanged?{conflictChanged:true}:{})};
}
function draftInput(d){return d.kind==='agenda'?{kind:d.kind,title:d.title,date:d.date,time:d.time,durationMinutes:d.durationMinutes}:{kind:d.kind,title:d.title,date:d.date,amount:`${Math.floor(d.amount_minor/100)}.${String(d.amount_minor%100).padStart(2,'0')}`,currency:d.currency,category:d.category};}
function validDraft(d){
 if(!d||!['agenda','expense'].includes(d.kind)||typeof d.draftId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/u.test(d.draftId)||!validTitle(d.title)||!validDate(d.date))return false;
 if(d.kind==='agenda')return typeof d.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(d.time)&&Number.isInteger(d.durationMinutes)&&d.durationMinutes>=1&&d.durationMinutes<=1440&&d.starts_at===Date.parse(`${d.date}T${d.time}:00+03:00`)&&d.ends_at===d.starts_at+d.durationMinutes*60000&&typeof d.conflictIds==='string'&&/^(?:\d+:\d+(?:,\d+:\d+)*)?$/u.test(d.conflictIds);
 return Number.isSafeInteger(d.amount_minor)&&d.amount_minor>0&&d.amount_minor<=99999999999&&currencies.includes(d.currency)&&categories.includes(d.category);
}
async function confirm(body,env,now,text,requestId=''){
 const c=body.dailyConfirmation;
 if(!c||c.confirmed!==true||typeof c.token!=='string'||c.token.length>12000||normalize(text)!=='kaydı onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Kaydı onaylıyorum” diyerek onaylayın. Kayıt yapılmadı.');
 let d;try{d=await verifyDraft(env,c.token,'daily',now);if(!validDraft(d))throw Error('invalid');}catch{return fail('Efendim, taslak doğrulanamadı veya süresi doldu. Yeniden hazırlayın; kayıt yapılmadı.',409);}
 const db=env.MEMORY_DB,table=d.kind==='agenda'?'atlas_agenda':'atlas_expenses';
 const existing=await db.prepare(`SELECT id FROM ${table} WHERE draft_id = ?`).bind(d.draftId).first();
 if(existing)return {status:200,dailySaved:{kind:d.kind,id:existing.id},dailyOpen:d.kind,text:'Efendim, bu kayıt zaten kaydedilmiş. İkinci kez eklemedim.',...await readDaily(env,now,requestId)};
 const input=draftInput(d),checked=validateInput(input,now);if(checked.error)return checked;
 if(d.kind==='agenda'){
  const latest=await conflicts(db,d);
  if(conflictSignature(latest)!==d.conflictIds)return preview(env,input,now,{draftId:d.draftId,conflictChanged:true});
  // Check the same conflict set inside the write as well: another device may
  // create an overlapping record between the read and this INSERT.
  await db.prepare("INSERT OR IGNORE INTO atlas_agenda(draft_id,title,starts_at,ends_at,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_agenda) < 200 AND (SELECT COALESCE(group_concat(id || ':' || revision,','),'') FROM (SELECT id,revision FROM atlas_agenda WHERE archived_at IS NULL AND starts_at < ? AND ends_at > ? ORDER BY id)) = ?").bind(d.draftId,d.title,d.starts_at,d.ends_at,now.toISOString(),d.ends_at,d.starts_at,d.conflictIds).run();
 }else await db.prepare('INSERT OR IGNORE INTO atlas_expenses(draft_id,title,amount_minor,currency,category,spent_day,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_expenses) < 500').bind(d.draftId,d.title,d.amount_minor,d.currency,d.category,d.date,now.toISOString()).run();
 const saved=await db.prepare(`SELECT id FROM ${table} WHERE draft_id = ?`).bind(d.draftId).first();
 if(!saved){
  if(d.kind==='agenda'&&conflictSignature(await conflicts(db,d))!==d.conflictIds)return preview(env,input,now,{draftId:d.draftId,conflictChanged:true});
  return fail(`Efendim, ${d.kind==='agenda'?'ajanda 200':'harcama defteri 500'} kayıt sınırına ulaştı. Yeni kayıt eklenmedi.`,409,d.kind);
 }
 return {status:200,dailySaved:{kind:d.kind,id:saved.id},dailyOpen:d.kind,text:`Efendim, ${d.kind==='agenda'?'ajanda':'harcama'} kaydı ${saved.id} kaydedildi: ${d.title}.`,...await readDaily(env,now,requestId)};
}

export async function dailyRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.filter(m=>m?.role==='user').at(-1):null;
 const text=typeof latest?.text==='string'?latest.text:'';
 const parsed=dailyCommand(text),hasDraft=Object.hasOwn(body||{},'dailyDraftRequest'),hasConfirmation=Object.hasOwn(body||{},'dailyConfirmation');
 if(!parsed&&!hasDraft&&!hasConfirmation)return null;
 if(hasDraft&&hasConfirmation)return fail('Efendim, taslak hazırlama ve onay ayrı işlemler olmalı. Kayıt yapılmadı.');
 if(!env?.MEMORY_DB)return unavailable();
 try{
  if(hasConfirmation||parsed?.action==='confirm')return await confirm(body,env,now,text,requestId);
  if(hasDraft)return await preview(env,body.dailyDraftRequest,now);
  if(parsed.action==='draft'){
   const input=fromVoice(parsed,now);if(input.error)return input;
   return await preview(env,input,now);
  }
  if(parsed.action==='agenda-list'){
   const day=parsed.offset===undefined?null:dayInIstanbul(now,parsed.offset),from=day?stamp(day):now.getTime(),to=day?from+86400000:Date.parse('2101-01-01T00:00:00Z');
   const agendaItems=await agendaRows(env.MEMORY_DB,from,to,200);
   const label=day?parsed.offset===0?'bugün':'yarın':'ajandanızda';
   return {status:200,dailyOpen:'agenda',agendaItems,text:agendaItems.length?`Efendim, ${label} ${agendaItems.length} kayıt var. ${agendaItems.slice(0,3).map(r=>`${r.date} ${r.time}: ${r.title.slice(0,70)}`).join('; ')}.${agendaItems.length>3?' Diğer kayıtlar ajanda bölümünde.':''}`:`Efendim, ${label} kayıt yok.`};
  }
  const snapshot=await expenseRows(env.MEMORY_DB,period(now),parsed.category);
  return {status:200,dailyOpen:'expense',...snapshot,text:`Efendim, bu ay${parsed.category?' '+parsed.category:''} ${snapshot.expenseTotals.length?'toplamınız '+snapshot.expenseTotals.map(r=>money(r.amount_minor,r.currency)).join('; ')+'. Para birimleri ayrı gösterilir. Arşivlenen harcamalar toplama dahildir.':'onaylanmış harcamanız yok.'}`};
 }catch(error){reportError({stage:'daily.request',requestId,error});return unavailable();}
}
