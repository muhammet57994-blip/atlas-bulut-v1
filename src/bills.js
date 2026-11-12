import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const currencies=['TRY','USD','EUR'],recurrences=['monthly','yearly','once'],actions=['create','edit','archive','restore','pay'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const fail=(text,status=400)=>({status,error:text,text,billsOpen:true});
const unavailable=()=>fail('Efendim, ortak fatura ve abonelik deposu henüz hazır değil. Değişiklik yapılmadı.',503);
const stale=()=>fail('Efendim, bu ödeme planı başka bir işlemle değişti. Güncel durumu kontrol edip yeni bir taslak hazırlayın; değişiklik yapılmadı.',409);
const validTitle=s=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=200&&!/[\u0000-\u001f\u007f]/u.test(s);
const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{16,80}$/u.test(s);
const minorValid=n=>Number.isSafeInteger(n)&&n>0&&n<=99999999999;
const money=(n,c)=>`${(n/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${c}`;
function validDate(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(s)||s<'2000-01-01'||s>'2100-12-31')return false;
 const at=Date.parse(`${s}T12:00:00Z`);return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===s;
}
function amount(input,key='amount',minorKey='amount_minor'){
 if(Object.hasOwn(input,key)&&Object.hasOwn(input,minorKey))return null;
 if(Object.hasOwn(input,minorKey))return minorValid(input[minorKey])?input[minorKey]:null;
 const value=input[key];
 if(typeof value!=='string'||!/^\d{1,9}(?:[,.]\d{1,2})?$/u.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().split(/[,.]/u),n=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return minorValid(n)?n:null;
}
const endOfMonth=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const dateAt=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(Math.min(day,endOfMonth(year,month))).padStart(2,'0')}`;
const stateKeys=['title','title_key','amount_minor','currency','recurrence','start_date','anchor_day','anchor_month','archived'];
const state=row=>Object.fromEntries(stateKeys.map(k=>[k,row[k]]));
const sameState=(a,b)=>JSON.stringify(state(a))===JSON.stringify(state(b));
function validState(s){
 if(!s||!validTitle(s.title)||s.title!==s.title.trim()||s.title_key!==normalize(s.title)||!minorValid(s.amount_minor)||!currencies.includes(s.currency)||!recurrences.includes(s.recurrence)||!validDate(s.start_date)||!Number.isInteger(s.anchor_day)||s.anchor_day<1||s.anchor_day>31||!Number.isInteger(s.anchor_month)||s.anchor_month<1||s.anchor_month>12||![0,1].includes(s.archived))return false;
 const [year,month,day]=s.start_date.split('-').map(Number);
 return s.recurrence==='once'?s.anchor_day===day&&s.anchor_month===month:dateAt(year,month,s.anchor_day)===s.start_date&&(s.recurrence!=='yearly'||s.anchor_month===month);
}
// Every occurrence is derived from the original anchor. A February clamp must
// never change a January 31 / February 29 subscription's future anniversaries.
function occurrence(s,index){
 const [y,m]=s.start_date.split('-').map(Number);
 if(s.recurrence==='once')return index===0?s.start_date:null;
 const year=s.recurrence==='yearly'?y+index:y+Math.floor((m-1+index)/12);
 const month=s.recurrence==='yearly'?s.anchor_month:(m-1+index)%12+1;
 return year>2100?null:dateAt(year,month,s.anchor_day);
}
function occurrences(s,from,to){
 const dates=[];
 for(let i=0;i<=1212;i++){const d=occurrence(s,i);if(!d||d>to)break;if(d>=from)dates.push(d);}
 return dates;
}
function isOccurrence(s,date){return validDate(date)&&occurrences(s,date,date).length===1;}
function nextDue(s,today,paid,includePast=false){
 for(let i=0;i<=1212;i++){const d=occurrence(s,i);if(!d)break;if((includePast||d>=today)&&(!paid||!paid.has(d)))return d;}
 return null;
}
const monthPeriod=today=>({from:today.slice(0,7)+'-01',to:dateAt(Number(today.slice(0,4)),Number(today.slice(5,7)),31)});
const addTotal=(totals,currency,key,value)=>{const row=totals.get(currency)||{currency,expected_minor:0,unpaid_minor:0,paid_minor:0};row[key]+=value;totals.set(currency,row);};
async function billRows(db){const result=(await db.prepare('SELECT * FROM atlas_bills ORDER BY created_at,id LIMIT 101').all()).results;if(result.length>100)throw Error('bounds');return result;}
async function paymentRows(db){
 const result=(await db.prepare('SELECT p.*,e.title AS expense_title,e.amount_minor AS expense_amount_minor,e.currency AS expense_currency,e.spent_day AS expense_spent_day,e.category AS expense_category,e.archived_at AS expense_archived_at FROM atlas_bill_payments p LEFT JOIN atlas_expenses e ON e.id=p.expense_id ORDER BY p.paid_date DESC,p.created_at DESC,p.id LIMIT 2001').all()).results;
 if(result.length>2000)throw Error('bounds');
 return result.map(p=>({...p,expenseEdited:p.title!==p.expense_title||p.amount_minor!==p.expense_amount_minor||p.currency!==p.expense_currency||p.paid_date!==p.expense_spent_day||p.expense_category!=='fatura'}));
}
export async function readBills(env,now=new Date(),requestId=''){
 const empty={billsOpen:true,billItems:[],archivedBillItems:[],billUpcomingItems:[],billOverdueItems:[],billPaymentItems:[],billMonthlyTotals:[],billUpcomingTotals:[]};
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return {...unavailable(),...empty};
 try{
  const today=dayInIstanbul(now),billPeriod=monthPeriod(today),billUpcomingPeriod={from:today,to:dayInIstanbul(now,30)};
  const all=await billRows(env.MEMORY_DB),payments=await paymentRows(env.MEMORY_DB),monthly=new Map(),upcoming=new Map(),billItems=[],archivedBillItems=[],billUpcomingItems=[],billOverdueItems=[];
  for(const row of all){
   if(!validState(row))throw Error('invalid stored state');
   const paid=new Set(payments.filter(p=>p.bill_id===row.id).map(p=>p.due_date));
   const publicRow={id:row.id,...state(row),revision:row.revision,created_at:row.created_at,updated_at:row.updated_at,nextDueDate:row.archived?null:nextDue(row,today),nextUnpaidDueDate:row.archived?null:nextDue(row,today,paid,true)};
   if(row.archived){archivedBillItems.push(publicRow);continue;}billItems.push(publicRow);
   for(const due_date of occurrences(row,billPeriod.from,billPeriod.to)){
    addTotal(monthly,row.currency,'expected_minor',row.amount_minor);
    if(!paid.has(due_date))addTotal(monthly,row.currency,'unpaid_minor',row.amount_minor);
   }
   for(const due_date of occurrences(row,billUpcomingPeriod.from,billUpcomingPeriod.to))if(!paid.has(due_date)){
    billUpcomingItems.push({bill_id:row.id,title:row.title,due_date,amount_minor:row.amount_minor,currency:row.currency,overdue:false});
    addTotal(upcoming,row.currency,'unpaid_minor',row.amount_minor);
   }
   if(publicRow.nextUnpaidDueDate&&publicRow.nextUnpaidDueDate<today)billOverdueItems.push({bill_id:row.id,title:row.title,due_date:publicRow.nextUnpaidDueDate,amount_minor:row.amount_minor,currency:row.currency,overdue:true});
  }
  for(const payment of payments)if(payment.paid_date>=billPeriod.from&&payment.paid_date<=billPeriod.to)addTotal(monthly,payment.currency,'paid_minor',payment.amount_minor);
  const sort=(a,b)=>a.due_date.localeCompare(b.due_date)||a.bill_id.localeCompare(b.bill_id);
  return {status:200,billsOpen:true,billItems,archivedBillItems,billUpcomingItems:billUpcomingItems.sort(sort),billOverdueItems:billOverdueItems.sort(sort),billPaymentItems:payments,billMonthlyTotals:[...monthly.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),billUpcomingTotals:[...upcoming.values()].map(r=>({currency:r.currency,amount_minor:r.unpaid_minor})).sort((a,b)=>a.currency.localeCompare(b.currency)),billPeriod,billUpcomingPeriod,billTotalsScope:'Beklenen ve ödenmemiş toplamlar bu ay vadeli, güncel ve arşivlenmemiş planlara göredir. Ödendi toplamı bu ay tarihli ilk ödeme beyanlarıdır; sonradan düzeltilen harcamalar harcama defterinde gösterilir. Para birimleri ayrı tutulur.',billOverdueScope:'Her aktif planın en eski ödenmemiş vadesi gösterilir; tüm gecikmiş dönemlerin toplamı değildir.',billPaymentScope:'Bunlar sizin onayladığınız ödeme beyanlarıdır. Banka hesabına erişilmez ve para gönderilmez.'};
 }catch(error){reportError({stage:'db.bills.read',requestId,error,meta:{table:'atlas_bills'}});return {...unavailable(),...empty};}
}

export function billsCommand(input){
 if(typeof input!=='string')return null;const text=normalize(input);
 if(text==='ödeme kaydını onaylıyorum')return {action:'confirm'};
 if(/^(?:faturalarımı|aboneliklerimi|sabit giderlerimi)(?: (?:aç|göster|oku|listele))?$/u.test(text))return {action:'list'};
 if(/^(?:yaklaşan ödemelerim(?:i (?:aç|göster|oku))?|bu ay sabit giderlerim(?: ne)?)$/u.test(text))return {action:'list',view:text.startsWith('yaklaşan')?'upcoming':'monthly'};
 const paid=text.match(/^(.+?)\s+(?:faturasını|faturamı|aboneliğini|aboneliğimi)\s+ödedim$/u);
 if(paid)return {action:'paid-name',name:paid[1]};
 const paidId=text.match(/^(?:fatura|abonelik|ödeme)\s+([a-z0-9-]{16,80})\s+ödedim$/u);
 if(paidId)return {action:'draft',input:{action:'pay',id:paidId[1]}};
 if(/\bher ay(?:ın)?\s*\d/u.test(text)||/^(?:fatura|abonelik) (?:ekle|kaydet)(?:\s|:|$)/u.test(text))return {action:'voice-create',text:input.trim().replace(/[.!?]+$/u,'').trim()};
 return null;
}
function fromVoice(text,now){
 const m=text.match(/^(?:fatura ekle\s*:?\s*|abonelik ekle\s*:?\s*)?(.+?)\s+her ay(?:ın)?\s*(\d{1,2})(?:\s*['’]?(?:inde|ında|unda|ünde|i|ı|u|ü)\s*|\s+)([+-]?\d[\d.,]*)\s*(lira|tl|try|dolar|usd|euro|avro|eur)$/iu);
 if(!m)return fail('Efendim, aylık günü ve tutarı açıkça belirtin: “İnternet faturam her ayın 15inde 450 lira.” Yıllık ve tek seferlik kayıtları formdan hazırlayabilirsiniz.');
 const day=Number(m[2]),today=dayInIstanbul(now),[year,month]=today.split('-').map(Number);
 if(day<1||day>31||/[\d.,+-]\s*$/u.test(m[1]))return fail('Efendim, vade günü 1–31 arasında, tutar ise binlik ayırıcı olmadan açıkça yazılmalı.');
 let date=dateAt(year,month,day);if(date<today)date=dateAt(month===12?year+1:year,month===12?1:month+1,day);
 const unit=m[4].toLocaleLowerCase('tr-TR');return {action:'create',title:m[1].trim(),amount:m[3],currency:['usd','dolar'].includes(unit)?'USD':['eur','euro','avro'].includes(unit)?'EUR':'TRY',recurrence:'monthly',date,anchorDay:day};
}
function planInput(input,base){
 const title=Object.hasOwn(input,'title')?input.title:base?.title,recurrence=Object.hasOwn(input,'recurrence')?input.recurrence:base?.recurrence,date=Object.hasOwn(input,'date')?input.date:base?.start_date,currency=Object.hasOwn(input,'currency')?input.currency:base?.currency;
 const amount_minor=Object.hasOwn(input,'amount')||Object.hasOwn(input,'amount_minor')?amount(input):base?.amount_minor;
 if(!validTitle(title))return fail('Efendim, başlık 1–200 karakter olmalı.');
 if(!minorValid(amount_minor))return fail('Efendim, tutarı sıfırdan büyük, binlik ayırıcı olmadan ve en fazla iki kuruş hanesiyle yazın.');
 if(!currencies.includes(currency)||!recurrences.includes(recurrence)||!validDate(date))return fail('Efendim, geçerli para birimi, tekrar ve tarih seçin (2000–2100).');
 const [,month,day]=date.split('-').map(Number),sameSchedule=base&&date===base.start_date&&recurrence===base.recurrence;
 const s={title:title.trim(),title_key:normalize(title),amount_minor,currency,recurrence,start_date:date,anchor_day:Object.hasOwn(input,'anchorDay')?input.anchorDay:sameSchedule?base.anchor_day:day,anchor_month:Object.hasOwn(input,'anchorMonth')?input.anchorMonth:sameSchedule?base.anchor_month:month,archived:base?.archived??0};
 if(!validState(s))return fail('Efendim, vade başlangıcı ve sabit gün birbiriyle uyuşmuyor. Geçerli bir vade tarihi seçin.');
 return s;
}
async function prepareChange(db,input,now){
 if(!input||typeof input!=='object'||Array.isArray(input)||!actions.includes(input.action))return fail('Efendim, oluşturma, düzenleme, arşivleme, geri açma veya ödeme kaydı işlemi seçin.');
 const allowed=input.action==='pay'?['action','id','dueDate','paidDate','paidAmount','paidAmount_minor']:['archive','restore'].includes(input.action)?['action','id']:['action','id','title','amount','amount_minor','currency','recurrence','date','anchorDay','anchorMonth'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))return fail('Efendim, taslakta desteklenmeyen bir alan var.');
 const action=input.action;
 if(action==='create'){
  if(input.id!==undefined)return fail('Efendim, yeni kaydın numarası onay taslağında oluşturulur.');
  const after=planInput(input);if(after.error)return after;
  return {action,id:crypto.randomUUID(),before:null,expectedRevision:0,after};
 }
 if(!validId(input.id))return fail('Efendim, bölümden belirli bir kayıt seçin veya tam kayıt numarasını belirtin.');
 const row=await db.prepare('SELECT * FROM atlas_bills WHERE id=?').bind(input.id).first();
 if(!row)return fail('Efendim, bu numarada bir fatura veya abonelik bulunamadı.',404);
 if(!validState(row))throw Error('stored state');
 const common={action,id:row.id,before:state(row),expectedRevision:row.revision};
 if(action==='edit'){
  const after=planInput(input,row);if(after.error)return after;
  if(sameState(after,row))return fail('Efendim, bu alanlarda bir değişiklik yok.');
  return {...common,after};
 }
 if(action==='archive'||action==='restore'){
  const archived=action==='archive'?1:0;if(row.archived===archived)return fail(`Efendim, kayıt zaten ${archived?'arşivde':'aktif'}.`);
  return {...common,after:{...state(row),archived}};
 }
 if(row.archived)return fail('Efendim, arşivdeki kayda ödeme eklenemez. Önce geri açma taslağını onaylayın.');
 const payments=(await db.prepare('SELECT due_date FROM atlas_bill_payments WHERE bill_id=? ORDER BY due_date').bind(row.id).all()).results;
 const due_date=Object.hasOwn(input,'dueDate')?input.dueDate:nextDue(row,dayInIstanbul(now),new Set(payments.map(p=>p.due_date)),true),paid_date=Object.hasOwn(input,'paidDate')?input.paidDate:dayInIstanbul(now);
 if(!due_date||!isOccurrence(row,due_date))return fail('Efendim, bu plana ait geçerli ve ödenmemiş bir vade seçin.');
 if(payments.some(p=>p.due_date===due_date))return fail('Efendim, bu vade zaten ödendi olarak kaydedilmiş. İkinci bir harcama oluşturulmadı.',409);
 if(!validDate(paid_date)||paid_date>dayInIstanbul(now))return fail('Efendim, ödeme tarihi bugün veya geçmişteki geçerli bir gün olmalı.');
 const amount_minor=Object.hasOwn(input,'paidAmount')||Object.hasOwn(input,'paidAmount_minor')?amount(input,'paidAmount','paidAmount_minor'):row.amount_minor;
 if(!minorValid(amount_minor))return fail('Efendim, gerçekleşen tutarı binlik ayırıcı olmadan ve en fazla iki kuruş hanesiyle belirtin.');
 return {...common,after:{title:row.title,amount_minor,planned_amount_minor:row.amount_minor,currency:row.currency,due_date,paid_date}};
}
function describe(d){
 if(d.action==='pay')return `${d.before.title}: ${d.after.due_date} vadeli ödeme için ${d.after.paid_date} tarihinde ${money(d.after.amount_minor,d.after.currency)} ödediğinizi beyan edeceksiniz. Aynı tutar ve tarihle bir harcama kaydı da oluşturulacak. Bankaya erişilmez ve para gönderilmez.`;
 if(d.action==='archive')return `${d.after.title} arşivlenecek; yaklaşan ve beklenen ödeme toplamlarından çıkacak. Geçmiş ödeme beyanları ve harcamalar korunacak.`;
 if(d.action==='restore')return `${d.after.title} yeniden aktif olacak; ${d.after.start_date} başlangıçlı ödeme planı tekrar gösterilecek.`;
 const cadence=d.after.recurrence==='monthly'?`her ayın ${d.after.anchor_day}. günü (kısa aylarda son gün)`:d.after.recurrence==='yearly'?`her yıl ${d.after.anchor_month}. ayın ${d.after.anchor_day}. günü (kısa aylarda son gün)`:'tek sefer';
 return `${d.after.title}: ${money(d.after.amount_minor,d.after.currency)}, ${d.after.start_date} başlangıç, ${cadence}. ${d.action==='edit'?'Plan güncellenecek; geçmiş ödeme beyanları ve harcamalar değişmeyecek.':'Manuel ödeme planı oluşturulacak.'} Kendiliğinden ödeme, takvim kaydı veya alarm oluşturulmaz.`;
}
async function preview(env,input,now){
 const d=await prepareChange(env.MEMORY_DB,input,now);if(d.error)return d;
 d.draftId=crypto.randomUUID();
 const token=await signDraft(env,'bills',d,now),text=`Efendim, ${describe(d)} Henüz kaydedilmedi. Kaydetmek için “Ödeme kaydını onaylıyorum” deyin.`;
 const plan=d.action==='pay'?d.before:d.after;
 return {status:200,billsOpen:true,text,billsDraft:{kind:'bills',action:d.action,id:d.id,title:plan.title,amount_minor:plan.amount_minor,currency:plan.currency,recurrence:plan.recurrence,date:plan.start_date,anchorDay:plan.anchor_day,anchorMonth:plan.anchor_month,...(d.action==='pay'?{dueDate:d.after.due_date,paidDate:d.after.paid_date,paidAmount_minor:d.after.amount_minor}:{}),token,text}};
}
function validDraft(d,now){
 if(!d||!actions.includes(d.action)||!validId(d.id)||!validId(d.draftId)||!Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0)return false;
 if(d.action==='create')return d.before===null&&d.expectedRevision===0&&validState(d.after)&&d.after.archived===0;
 if(!validState(d.before)||d.expectedRevision<1)return false;
 if(d.action==='pay')return d.before.archived===0&&d.after?.title===d.before.title&&minorValid(d.after.amount_minor)&&d.after.planned_amount_minor===d.before.amount_minor&&d.after.currency===d.before.currency&&isOccurrence(d.before,d.after.due_date)&&validDate(d.after.paid_date)&&d.after.paid_date<=dayInIstanbul(now);
 if(!validState(d.after))return false;
 if(d.action==='edit')return d.after.archived===d.before.archived&&!sameState(d.before,d.after);
 return d.before.archived===(d.action==='archive'?0:1)&&d.after.archived===(d.action==='archive'?1:0)&&sameState({...d.before,archived:d.after.archived},d.after);
}
async function savedResult(env,now,saved,replay=false,requestId=''){return {status:200,...await readBills(env,now,requestId),billsOpen:true,billsSaved:{id:saved.id,bill_id:saved.bill_id,action:saved.action},text:replay?'Efendim, bu değişiklik zaten kaydedilmiş. İkinci bir kayıt oluşturulmadı.':saved.action==='pay'?'Efendim, ödeme beyanınız ve bağlı harcama kaydedildi. Bankadan para gönderilmedi.':'Efendim, onayladığınız fatura veya abonelik değişikliği kaydedildi.'};}
async function confirm(body,env,now,text,requestId=''){
 const c=body.billsConfirmation;
 if(!c||c.confirmed!==true||typeof c.token!=='string'||c.token.length>24100||Object.keys(c).some(k=>!['token','confirmed'].includes(k))||normalize(text)!=='ödeme kaydını onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Ödeme kaydını onaylıyorum” diyerek onaylayın. Tutar veya tarih değişecekse önce yeni taslak hazırlayın. Değişiklik yapılmadı.');
 let d;try{d=await verifyDraft(env,c.token,'bills',now);if(!validDraft(d,now))throw Error();}catch{return fail('Efendim, taslak doğrulanamadı veya süresi doldu. Yeniden hazırlayın; değişiklik yapılmadı.',409);}
 const db=env.MEMORY_DB,existing=await db.prepare('SELECT id,bill_id,action FROM atlas_bill_operations WHERE id=?').bind(d.draftId).first();
 if(existing)return savedResult(env,now,existing,true,requestId);
 if(d.action==='pay'){
  const already=await db.prepare('SELECT id,bill_id FROM atlas_bill_payments WHERE bill_id=? AND due_date=?').bind(d.id,d.after.due_date).first();
  if(already)return savedResult(env,now,{...already,action:'pay'},true,requestId);
 }
 if(d.action!=='create'){
  const current=await db.prepare('SELECT * FROM atlas_bills WHERE id=?').bind(d.id).first();
  if(!current||current.revision!==d.expectedRevision||!sameState(current,d.before))return stale();
 }
 try{
  // The journal's triggers validate the same state inside the write and apply
  // the expense + payment ledger + revision atomically. Never split the write.
  await db.prepare('INSERT INTO atlas_bill_operations(id,bill_id,action,expected_revision,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(d.draftId,d.id,d.action,d.expectedRevision,d.before?JSON.stringify(d.before):null,JSON.stringify(d.after),now.toISOString()).run();
 }catch{
  const raced=await db.prepare('SELECT id,bill_id,action FROM atlas_bill_operations WHERE id=?').bind(d.draftId).first();
  if(raced)return savedResult(env,now,raced,true,requestId);
  if(d.action==='pay'){
   const paid=await db.prepare('SELECT id,bill_id FROM atlas_bill_payments WHERE bill_id=? AND due_date=?').bind(d.id,d.after.due_date).first();
   if(paid)return savedResult(env,now,{...paid,action:'pay'},true,requestId);
  }
  const count=await db.prepare('SELECT (SELECT COUNT(*) FROM atlas_bills) AS bills,(SELECT COUNT(*) FROM atlas_expenses) AS expenses,(SELECT COUNT(*) FROM atlas_bill_operations) AS operations,(SELECT COUNT(*) FROM atlas_bill_payments) AS payments').first();
  if(d.action==='create'&&count.bills>=100)return fail('Efendim, 100 fatura ve abonelik sınırına ulaşıldı. Kayıt oluşturulmadı.',409);
  if(d.action==='pay'&&count.expenses>=500)return fail('Efendim, harcama defteri 500 kayıt sınırına ulaştı. Ödeme beyanı ve harcama eklenmedi.',409);
  if(count.operations>=5000||count.payments>=2000)return fail('Efendim, ödeme geçmişi sınırına ulaşıldı. Değişiklik yapılmadı.',409);
  const current=await db.prepare('SELECT * FROM atlas_bills WHERE id=?').bind(d.id).first();
  if(d.action!=='create'&&(!current||current.revision!==d.expectedRevision||!sameState(current,d.before)))return stale();
  return unavailable();
 }
 return savedResult(env,now,{id:d.draftId,bill_id:d.id,action:d.action},false,requestId);
}
// Natural names must resolve to exactly one complete title. Suffix variants
// cover Turkish possessives; substring/fuzzy matches must never select a bill.
function titleNames(title){const name=normalize(title);return new Set([name,name.replace(/\s+(?:faturası|faturam|fatura|aboneliği|aboneliğim|abonelik)$/u,'')]);}
export async function billsRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.at(-1):null,text=latest?.role==='user'&&typeof latest.text==='string'?latest.text:'';
 const parsed=billsCommand(text),hasDraft=Object.hasOwn(body||{},'billsDraftRequest'),hasConfirmation=Object.hasOwn(body||{},'billsConfirmation');
 if(!parsed&&!hasDraft&&!hasConfirmation)return null;
 if(hasDraft&&hasConfirmation)return fail('Efendim, taslak hazırlama ve onay ayrı işlemler olmalı. Değişiklik yapılmadı.');
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return unavailable();
 try{
  if(hasConfirmation||parsed?.action==='confirm')return await confirm(body,env,now,text,requestId);
  if(hasDraft)return await preview(env,body.billsDraftRequest,now);
  if(parsed.action==='voice-create'){const input=fromVoice(parsed.text,now);return input.error?input:await preview(env,input,now);}
  if(parsed.action==='draft')return await preview(env,parsed.input,now);
  if(parsed.action==='paid-name'){
   const matches=(await billRows(env.MEMORY_DB)).filter(r=>!r.archived&&titleNames(r.title).has(parsed.name));
   if(matches.length!==1)return fail(matches.length?'Efendim, bu ad birden fazla kayda uyuyor. Faturalar bölümünden tam kayıt numarasını seçin; ödeme eklenmedi.':'Efendim, bu tam adla aktif bir kayıt bulunamadı. Faturalar bölümünden kaydı seçin; ödeme eklenmedi.',matches.length?409:404);
   return await preview(env,{action:'pay',id:matches[0].id},now);
  }
  const snapshot=await readBills(env,now,requestId);if(snapshot.error)return snapshot;
  const totals=parsed.view==='upcoming'?snapshot.billUpcomingTotals.map(t=>money(t.amount_minor,t.currency)):snapshot.billMonthlyTotals.map(t=>`${t.currency}: beklenen ${money(t.expected_minor,t.currency)}, ödenmemiş ${money(t.unpaid_minor,t.currency)}`);
  return {...snapshot,billsView:parsed.view||'all',text:`Efendim, ${snapshot.billItems.length} aktif ödeme planınız var. ${parsed.view==='upcoming'?'Bugünden başlayarak 30 gün içinde ödenmemiş vadeler':'Bu ay vadeli güncel aktif planlar'}: ${totals.length?totals.join('; '):'kayıt yok'}. ${snapshot.billOverdueItems.length?`${snapshot.billOverdueItems.length} planda geçmiş ödenmemiş vade var. `:''}Para birimleri ayrı gösterilir. Bunlar manuel beyanlardır; banka işlemi yapılmaz.`};
 }catch(error){reportError({stage:'bills.request',requestId,error});return unavailable();}
}
