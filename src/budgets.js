import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const categories=['market','ulaşım','yemek','fatura','diğer'],currencies=['TRY','USD','EUR'],actions=['create','edit','archive','restore'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const fail=(text,status=400)=>({status,error:text,text,budgetOpen:true});
const unavailable=()=>fail('Efendim, ortak bütçe ve harcama deposu henüz hazır değil. Değişiklik yapılmadı.',503);
const stale=()=>fail('Efendim, bu bütçe başka bir işlemle değişti. Güncel durumdan yeni bir taslak hazırlayın; değişiklik yapılmadı.',409);
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{16,80}$/u.test(s);
const validMonth=s=>typeof s==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(s)&&s>='2000-01'&&s<='2100-12';
const minorValid=n=>Number.isSafeInteger(n)&&n>0&&n<=99999999999;
const money=(n,c)=>`${(n/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${c}`;
const stateKeys=['month','category','amount_minor','currency','archived'];
const state=r=>Object.fromEntries(stateKeys.map(k=>[k,r[k]]));
const sameState=(a,b)=>JSON.stringify(state(a))===JSON.stringify(state(b));
const validState=s=>s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).every(k=>stateKeys.includes(k))&&validMonth(s.month)&&categories.includes(s.category)&&minorValid(s.amount_minor)&&currencies.includes(s.currency)&&[0,1].includes(s.archived);
const period=month=>({from:month+'-01',to:month+'-'+new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()});
const title=s=>`${s.month} · ${s.category} · ${s.currency}`;
const bucket=s=>`${s.month}|${s.category}|${s.currency}`;
function amount(input){
 if(Object.hasOwn(input,'amount')&&Object.hasOwn(input,'amount_minor'))return null;
 if(Object.hasOwn(input,'amount_minor'))return minorValid(input.amount_minor)?input.amount_minor:null;
 if(typeof input.amount!=='string'||!/^\d{1,9}(?:[,.]\d{1,2})?$/u.test(input.amount.trim()))return null;
 const [whole,fraction='']=input.amount.trim().split(/[,.]/u),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return minorValid(n)?n:null;
}
async function rows(db){
 const records=(await db.prepare('SELECT * FROM atlas_budgets ORDER BY month DESC,category,currency,id LIMIT 101').all()).results;
 if(records.length>100||records.some(r=>!validState(state(r))||!Number.isSafeInteger(r.revision)||r.revision<1))throw Error('invalid budget store');
 return records;
}
// Read the live expense ledger on every request. Expense archives merely hide
// rows; they remain expenditure, matching the ledger's period-total policy.
export async function readBudgets(env,now=new Date(),month,requestId=''){
 const empty={budgetOpen:true,budgetItems:[],archivedBudgetItems:[],budgetAllItems:[],budgetMonths:[],budgetSummary:[],budgetUnbudgetedItems:[]};
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return {...unavailable(),...empty};
 month=month??dayInIstanbul(now).slice(0,7);if(!validMonth(month))return {...fail('Efendim, ayı YYYY-AA biçiminde ve 2000–2100 aralığında seçin.'),...empty};
 try{
  const all=await rows(env.MEMORY_DB),budgetPeriod=period(month);
  const expenseRows=(await env.MEMORY_DB.prepare('SELECT substr(spent_day,1,7) AS month,category,currency,SUM(amount_minor) AS spent_minor,COUNT(*) AS count FROM atlas_expenses GROUP BY substr(spent_day,1,7),category,currency').all()).results;
  if(expenseRows.reduce((n,r)=>n+r.count,0)>500||expenseRows.some(r=>!validMonth(r.month)||!categories.includes(r.category)||!currencies.includes(r.currency)||!Number.isSafeInteger(r.spent_minor)||r.spent_minor<=0))throw Error('invalid expense store');
  const spending=new Map(expenseRows.map(r=>[bucket(r),r.spent_minor]));
  const budgetAllItems=all.map(r=>{const spent_minor=spending.get(bucket(r))||0;return {id:r.id,...state(r),title:title(r),revision:r.revision,created_at:r.created_at,updated_at:r.updated_at,spent_minor,remaining_minor:Math.max(0,r.amount_minor-spent_minor),overrun_minor:Math.max(0,spent_minor-r.amount_minor),progress_percent:Math.round(spent_minor/r.amount_minor*10000)/100};});
  const budgetItems=budgetAllItems.filter(r=>r.month===month&&!r.archived),archivedBudgetItems=budgetAllItems.filter(r=>r.month===month&&r.archived),active=new Set(budgetItems.map(bucket));
  const selected=expenseRows.filter(r=>r.month===month),budgetUnbudgetedItems=selected.filter(r=>!active.has(bucket(r))).map(({month,category,currency,spent_minor})=>({month,category,currency,spent_minor}));
  const summary=new Map(),get=c=>{if(!summary.has(c))summary.set(c,{currency:c,limit_minor:0,spent_minor:0,budgeted_spent_minor:0,unbudgeted_spent_minor:0,remaining_minor:0,overrun_minor:0});return summary.get(c);};
  for(const item of budgetItems){const total=get(item.currency);total.limit_minor+=item.amount_minor;total.budgeted_spent_minor+=item.spent_minor;total.remaining_minor+=item.remaining_minor;total.overrun_minor+=item.overrun_minor;}
  for(const item of selected)get(item.currency).spent_minor+=item.spent_minor;
  for(const item of budgetUnbudgetedItems)get(item.currency).unbudgeted_spent_minor+=item.spent_minor;
  return {status:200,budgetOpen:true,budgetMonth:month,budgetPeriod,budgetItems,archivedBudgetItems,budgetAllItems,budgetMonths:[...new Set([month,...all.map(r=>r.month),...expenseRows.map(r=>r.month)])].sort().reverse(),budgetUnbudgetedItems,budgetSummary:[...summary.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),budgetArchivePolicy:'Arşivlenen harcamalar dönem toplamlarına dahildir; arşivleme bütçeyi geri açmaz.',budgetTotalsScope:'Tutarlar harcama defterinin güncel kategori, tarih, tutar ve para biriminden hesaplanır. Bütçesiz harcamalar ayrıca gösterilir. Kalan ve aşım her kategori için ayrı hesaplanır. Para birimleri birleştirilmez veya dönüştürülmez.',budgetMonthPolicy:'Her bütçe yalnızca yazılı ay için geçerlidir. Yeni aya kendiliğinden taşınmaz; önceki aydan limit veya bakiye devralınmaz.'};
 }catch(error){reportError({stage:'db.budgets.read',requestId,error,meta:{table:'atlas_budgets'}});return {...unavailable(),...empty};}
}
function resolveMonth(word,now){
 if(validMonth(word))return word;
 const current=dayInIstanbul(now).slice(0,7);if(word==='bu ay')return current;
 if(word==='gelecek ay'||word==='önümüzdeki ay'){const [y,m]=current.split('-').map(Number);return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;}
 return null;
}
export function budgetsCommand(input){
 if(typeof input!=='string')return null;const text=normalize(input);
 if(text==='bütçe değişikliğini onaylıyorum')return {action:'confirm'};
 const list=text.match(/^(?:(bu ay|gelecek ay|önümüzdeki ay|\d{4}-\d{2})(?: için)?\s+)?bütçelerim(?:i)?(?:\s+(?:aç|göster|oku|listele))?$/u);
 if(list)return {action:'list',month:list[1]||'bu ay'};
 const remaining=text.match(/^(?:(bu ay|gelecek ay|önümüzdeki ay|\d{4}-\d{2})(?: için)?\s+)?(market|ulaşım|yemek|fatura|diğer) bütçemden ne kadar kaldı$/u);
 if(remaining)return {action:'remaining',month:remaining[1]||'bu ay',category:remaining[2]};
 if(/bütçe|sınır koy/u.test(text))return {action:'voice',text};
 return null;
}
function voiceInput(text,now){
 const m=text.match(/^(bu ay|gelecek ay|önümüzdeki ay|\d{4}-\d{2})(?: için)?\s+(market|ulaşım|yemek|fatura|diğer)\s+için\s+([+-]?\d[\d.,]*)\s*(lira|tl|try|dolar|usd|euro|avro|eur)\s+(?:bütçe ayır|bütçe belirle|sınır koy)$/u);
 if(!m)return fail('Efendim, ay, kategori, tutar ve para birimini açıkça belirtin: “Bu ay market için 5000 lira bütçe ayır.” Düzenleme veya arşivleme için bölümden kaydı seçin.');
 const unit=m[4];return {action:'create',month:resolveMonth(m[1],now),category:m[2],amount:m[3],currency:['usd','dolar'].includes(unit)?'USD':['eur','euro','avro'].includes(unit)?'EUR':'TRY'};
}
function inputState(input,base){
 const value=k=>Object.hasOwn(input,k)?input[k]:base?.[k];
 const after={month:value('month'),category:value('category'),amount_minor:Object.hasOwn(input,'amount')||Object.hasOwn(input,'amount_minor')?amount(input):base?.amount_minor,currency:value('currency'),archived:base?.archived??0};
 if(!minorValid(after.amount_minor))return fail('Efendim, tutarı 5000 veya 5000,00 gibi, binlik ayırıcı olmadan ve en fazla iki kuruş hanesiyle yazın. “5.000” belirsiz olduğu için kabul edilmez.');
 if(!validMonth(after.month))return fail('Efendim, bütçenin ayını YYYY-AA biçiminde ve 2000–2100 aralığında açıkça seçin. Önceki aydan limit devralınmaz.');
 if(!categories.includes(after.category)||!currencies.includes(after.currency))return fail('Efendim, geçerli bir kategori ve TRY, USD veya EUR para birimini seçin.');
 return after;
}
async function duplicate(db,s,id){return db.prepare('SELECT id,archived FROM atlas_budgets WHERE month=? AND category=? AND currency=? AND id!=?').bind(s.month,s.category,s.currency,id).first();}
const conflict=()=>fail('Efendim, aynı ay, kategori ve para birimi için bir bütçe zaten var. Mevcut kaydı düzenleyin veya arşivden geri açın; ikinci bütçe oluşturulmadı.',409);
async function prepareChange(db,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!actions.includes(input.action))return fail('Efendim, oluşturma, düzenleme, arşivleme veya geri açma işlemi seçin.');
 const allowed=['archive','restore'].includes(input.action)?['action','id']:['action','id','month','category','amount','amount_minor','currency'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))return fail('Efendim, taslakta desteklenmeyen bir alan var.');
 let d;
 if(input.action==='create'){
  if(Object.hasOwn(input,'id'))return fail('Efendim, yeni kaydın numarası onay taslağında oluşturulur.');
  const after=inputState(input);if(after.error)return after;
  d={action:input.action,id:crypto.randomUUID(),expectedRevision:0,before:null,after};
 }else{
  if(!validId(input.id))return fail('Efendim, işlem için bölümden belirli bir bütçe seçin.');
  const row=await db.prepare('SELECT * FROM atlas_budgets WHERE id=?').bind(input.id).first();if(!row)return fail('Efendim, bu bütçe kaydı bulunamadı.',404);
  const before=state(row);if(!validState(before))throw Error('stored state');
  const after=input.action==='edit'?inputState(input,before):{...before,archived:input.action==='archive'?1:0};if(after.error)return after;
  if(sameState(before,after))return fail('Efendim, seçilen kayıtta bir değişiklik yok.');
  d={action:input.action,id:row.id,expectedRevision:row.revision,before,after};
 }
 if(await duplicate(db,d.after,d.id))return conflict();return d;
}
function describe(d){
 const next=`${d.after.month} ayı, ${d.after.category}, ${money(d.after.amount_minor,d.after.currency)}`;
 if(d.action==='archive')return `${next} bütçesi arşivlenecek. Bu ayın aktif sınırlarından çıkacak; harcamalar korunacak ve bütçesiz olarak gösterilecek.`;
 if(d.action==='restore')return `${next} bütçesi geri açılacak; yalnızca bu ay için geçerli olacak.`;
 return `${d.action==='edit'?`Önce: ${d.before.month} ayı, ${d.before.category}, ${money(d.before.amount_minor,d.before.currency)}. Sonra: `:''}${next} ${d.action==='create'?'için manuel bütçe oluşturulacak.':'olarak güncellenecek.'} Limit başka aya devredilmez. Harcama kayıtları değişmez.`;
}
async function preview(env,input,now){
 const d=await prepareChange(env.MEMORY_DB,input);if(d.error)return d;
 d.draftId=crypto.randomUUID();const token=await signDraft(env,'budget',d,now),text=`Efendim, ${describe(d)} Henüz kaydedilmedi. Kaydetmek için “Bütçe değişikliğini onaylıyorum” deyin.`;
 return {status:200,budgetOpen:true,text,budgetDraft:{kind:'budget',action:d.action,id:d.id,title:title(d.after),month:d.after.month,category:d.after.category,amount_minor:d.after.amount_minor,currency:d.after.currency,before:d.before,after:d.after,token,text}};
}
function validDraft(d){
 if(!d||Object.keys(d).some(k=>!['action','id','expectedRevision','before','after','draftId'].includes(k))||!actions.includes(d.action)||!validId(d.id)||!validId(d.draftId)||!Number.isSafeInteger(d.expectedRevision)||!validState(d.after))return false;
 if(d.action==='create')return d.expectedRevision===0&&d.before===null&&d.after.archived===0;
 if(d.expectedRevision<1||!validState(d.before))return false;
 if(d.action==='edit')return d.before.archived===d.after.archived&&!sameState(d.before,d.after);
 return d.before.archived===(d.action==='archive'?0:1)&&d.after.archived===(d.action==='archive'?1:0)&&sameState({...d.before,archived:d.after.archived},d.after);
}
async function savedResult(env,now,saved,month,replay=false,requestId=''){return {...await readBudgets(env,now,month,requestId),budgetSaved:{id:saved.id,budget_id:saved.budget_id,action:saved.action},text:replay?'Efendim, bu bütçe değişikliği zaten kaydedilmiş. İkinci bir işlem yapılmadı.':'Efendim, onayladığınız bütçe değişikliği kaydedildi.'};}
async function confirm(body,env,now,text,requestId=''){
 const c=body.budgetConfirmation;
 if(!c||typeof c!=='object'||Array.isArray(c)||c.confirmed!==true||typeof c.token!=='string'||c.token.length>24100||Object.keys(c).some(k=>!['token','confirmed'].includes(k))||normalize(text)!=='bütçe değişikliğini onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Bütçe değişikliğini onaylıyorum” diyerek onaylayın. Değişiklik yapılmadı.');
 let d;try{d=await verifyDraft(env,c.token,'budget',now);if(!validDraft(d))throw Error();}catch{return fail('Efendim, taslak doğrulanamadı veya süresi doldu. Yeniden hazırlayın; değişiklik yapılmadı.',409);}
 const db=env.MEMORY_DB,existing=await db.prepare('SELECT id,budget_id,action FROM atlas_budget_operations WHERE id=?').bind(d.draftId).first();
 if(existing)return savedResult(env,now,existing,d.after.month,true,requestId);
 if(d.action!=='create'){const current=await db.prepare('SELECT * FROM atlas_budgets WHERE id=?').bind(d.id).first();if(!current||current.revision!==d.expectedRevision||!sameState(current,d.before))return stale();}
 try{
  // The trigger repeats revision, complete-state and capacity checks within
  // this single write. A failed apply rolls back its journal entry as well.
  await db.prepare('INSERT INTO atlas_budget_operations(id,budget_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(d.draftId,d.id,d.action,d.expectedRevision,d.before?JSON.stringify(d.before):null,JSON.stringify(d.after),now.toISOString()).run();
 }catch{
  const replay=await db.prepare('SELECT id,budget_id,action FROM atlas_budget_operations WHERE id=?').bind(d.draftId).first();if(replay)return savedResult(env,now,replay,d.after.month,true,requestId);
  if(await duplicate(db,d.after,d.id))return conflict();
  const count=await db.prepare('SELECT (SELECT COUNT(*) FROM atlas_budgets) AS budgets,(SELECT COUNT(*) FROM atlas_budget_operations) AS operations').first();
  if(d.action==='create'&&count.budgets>=100)return fail('Efendim, arşivdekiler dahil 100 bütçe sınırına ulaşıldı. Yeni kayıt oluşturulmadı.',409);
  if(count.operations>=5000)return fail('Efendim, 5000 bütçe değişikliği sınırına ulaşıldı. Değişiklik yapılmadı.',409);
  const current=await db.prepare('SELECT * FROM atlas_budgets WHERE id=?').bind(d.id).first();if(d.action!=='create'&&(!current||current.revision!==d.expectedRevision||!sameState(current,d.before)))return stale();
  return unavailable();
 }
 return savedResult(env,now,{id:d.draftId,budget_id:d.id,action:d.action},d.after.month,false,requestId);
}
export async function budgetsRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.at(-1):null,text=latest?.role==='user'&&typeof latest.text==='string'?latest.text:'';
 const parsed=budgetsCommand(text),keys=['budgetDraftRequest','budgetConfirmation','budgetReadRequest'].filter(k=>Object.hasOwn(body||{},k));
 if(!parsed&&!keys.length)return null;
 if(keys.length>1)return fail('Efendim, okuma, taslak hazırlama ve onay ayrı işlemler olmalı. Değişiklik yapılmadı.');
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return unavailable();
 try{
  if(keys[0]==='budgetConfirmation'||parsed?.action==='confirm')return await confirm(body,env,now,text,requestId);
  if(keys[0]==='budgetDraftRequest')return await preview(env,body.budgetDraftRequest,now);
  if(parsed?.action==='voice'&&!keys.length){const input=voiceInput(parsed.text,now);return input.error?input:await preview(env,input,now);}
  let month;
  if(keys[0]==='budgetReadRequest'){
   const r=body.budgetReadRequest;if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>k!=='month')||!validMonth(r.month))return fail('Efendim, görüntülenecek ayı YYYY-AA biçiminde seçin.');month=r.month;
  }else month=resolveMonth(parsed.month,now);
  if(!validMonth(month))return fail('Efendim, geçerli bir bütçe ayını açıkça belirtin.');
  const snapshot=await readBudgets(env,now,month,requestId);if(snapshot.error)return snapshot;
  if(parsed?.action==='remaining'&&!keys.length){
   const selected=snapshot.budgetItems.filter(r=>r.category===parsed.category),unbudgeted=snapshot.budgetUnbudgetedItems.filter(r=>r.category===parsed.category);
   return {...snapshot,text:`Efendim, ${month} ${parsed.category}: ${selected.length?selected.map(r=>`${money(r.remaining_minor,r.currency)} kaldı${r.overrun_minor?`, ${money(r.overrun_minor,r.currency)} aşıldı`:''} (harcanan ${money(r.spent_minor,r.currency)}, limit ${money(r.amount_minor,r.currency)})`).join('; '):'aktif bütçe belirlenmemiş'}.${unbudgeted.length?' Bütçesiz harcama: '+unbudgeted.map(r=>money(r.spent_minor,r.currency)).join('; ')+'.':''} Para birimleri ayrı tutulur.`};
  }
  return {...snapshot,text:`Efendim, ${month} için ${snapshot.budgetItems.length} aktif bütçeniz var. ${snapshot.budgetSummary.length?snapshot.budgetSummary.map(r=>`${r.currency}: limit ${money(r.limit_minor,r.currency)}, harcanan ${money(r.spent_minor,r.currency)}, kategori bazında kalan ${money(r.remaining_minor,r.currency)}, aşım ${money(r.overrun_minor,r.currency)}, bütçesiz harcama ${money(r.unbudgeted_spent_minor,r.currency)}`).join('; '):'Bu ay için bütçe veya harcama yok.'} Önceki aylardan limit devralınmaz. Para birimleri ayrı tutulur.`};
 }catch(error){reportError({stage:'budgets.request',requestId,error});return unavailable();}
}
