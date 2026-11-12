import {signDraft,verifyDraft} from './daily-signing.js';
import {reportError} from './log.js';
import {taskCommand,dayInIstanbul} from './tasks.js';
import {prepareDailyCreation} from './daily-records.js';
const CONFIRM='Seçtiğim işlemleri onaylıyorum';
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const lastText=body=>{const last=Array.isArray(body?.messages)?body.messages.at(-1):null;return last?.role==='user'&&typeof last.text==='string'?last.text:'';};
const fail=(text,status=400,extra={})=>({status,error:text,text,multiOpen:true,...extra});
const unavailable=()=>fail('Efendim, ortak işlem deposu şu an hazır değil. Hiçbir kayıt uygulanmadı.',503);
const prefix=/^(?:birlikte yap|toplu işlem|çoklu işlem|şunları birlikte yap)\s*:\s*/iu;
const safeText=(s,max,multi=false)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!(multi?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(s);
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(s);
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)))),b=>b.toString(16).padStart(2,'0')).join('');
const dateValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(s)&&s>='2000-01-01'&&s<='2100-12-31'&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const unquote=s=>s.replace(/^["“]([\s\S]*)["”]$/u,'$1').trim();
function looksCreation(s){return /^(?:not al\s*:|görev ekle\s*:|listeye\s|ajandaya ekle\s*:|randevu ekle\s*:|harcama ekle\s*:)|\s(?:görev yap|not al|hatırlat|ajandaya ekle|harcadım|toplantı ekle)$/iu.test(s.trim());}
const endsCreation=s=>/\s(?:ekle|görev yap|not al|hatırlat|harcadım)$/iu.test(s.trim());
function clauses(input){
 let source=input.trim().replace(prefix,'');
 // Quoted text is opaque. Commas in amounts or ordinary note prose stay intact.
 const parts=[];let start=0,quote=null;
 for(let i=0;i<source.length;i++){
  const ch=source[i];if(quote){if(ch===quote)quote=null;continue;}
  if(ch==='"'||ch==='“'){quote=ch==='“'?'”':'"';continue;}
  const connector=source.slice(i).match(/^\s+(?:ve ardından|ardından|ayrıca|ve)\s+/iu);
  if(connector){
   const left=source.slice(start,i).trim(),right=source.slice(i+connector[0].length).trim();
   if(looksCreation(left)&&right&&(endsCreation(left)||looksCreation(right))){parts.push(left);start=i+connector[0].length;i=start-1;continue;}
  }
  if(ch===';'||ch==='\n'){parts.push(source.slice(start,i).trim());start=i+1;continue;}
  if(ch===','&&!(/\d/u.test(source[i-1]||'')&&/\d/u.test(source[i+1]||''))){
   const left=source.slice(start,i).trim(),right=source.slice(i+1).split(/[;\n,]/u)[0].trim();
   if(looksCreation(left)&&right&&(looksCreation(right)||endsCreation(left))){parts.push(left);start=i+1;}
  }
 }
 if(quote)return null;parts.push(source.slice(start).trim());
 return parts;
}
export function multiCommand(input){
 if(typeof input!=='string'||input.length>6000)return null;
 const normalized=normalize(input);
 if(normalized===normalize(CONFIRM))return {action:'confirm'};
 if(/^(?:çoklu işlemleri|toplu işlemleri|birlikte yap bölümünü) (?:aç|göster)$/u.test(normalized))return {action:'open'};
 if(prefix.test(input))return {action:'draft',text:input};
 // A note's content is data, not nested commands. Multi-note input needs a prefix.
 if(/^not al\s*:/iu.test(input))return null;
 const split=clauses(input);if(split?.length>1&&split.some(looksCreation)||split===null&&/[;\n,]/u.test(input)&&looksCreation(input))return {action:'draft',text:input};
 return null;
}
function taskInput(clause,now){
 let c=taskCommand(clause),title,when;
 if(c?.action==='add'){if(c.recurrence)return {error:'Tekrarlanan görevler bu toplu kayıt akışında desteklenmiyor.'};title=c.title;when=c.when;}
 else{const m=clause.match(/^(.+?)\s+(?:görev yap|görev olarak ekle)$/iu);if(!m)return null;title=m[1].trim();when='';}
 let due='';
 const date=title.match(/^(bugün|yarın|\d{4}-\d{2}-\d{2})\s+(.+)$/iu);
 if(date){if(when)return {error:'Görevde birden fazla gün var.'};when=date[1].toLocaleLowerCase('tr-TR');title=date[2].trim();}
 if(when)due=when==='bugün'?dayInIstanbul(now):when==='yarın'?dayInIstanbul(now,1):when;
 if(due&&!dateValid(due)||!safeText(title,200)||/^(?:bugün|yarın|dün|haftaya|gelecek|öbür|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)(?=\s|$)/iu.test(title)||/^\d{4}[-/.]\d/u.test(title))return {error:'Görev için bugün, yarın veya YYYY-AA-GG tarihi ve 1–200 karakterlik açık bir başlık kullanın.'};
 return {kind:'task',title:unquote(title),due_date:due};
}
function parseCreation(clause,now){
 const text=clause.trim().replace(/[.!?]+$/u,'').trim();
 let m=text.match(/^not al\s*:\s*([\s\S]+)$/iu)||text.match(/^([\s\S]+?)\s+(?:diye\s+)?not al$/iu);
 if(m){const content=unquote(m[1]);return safeText(content,1000,true)?{kind:'note',title:'Yeni not',content}:{error:'Not metni 1–1000 karakter olmalı.'};}
 const task=taskInput(text,now);if(task)return task;
 let daily=text.replace(/\bsaat\s+(\d{1,2})(?:['’]?(?:e|a|de|da|te|ta))?(?=\s)/iu,(_all,h)=>'saat '+h+'.00');
 if(/^(?:bugün|yarın|\d{4}-\d{2}-\d{2})\s+saat\s+\d/iu.test(daily)&&/\s+ekle$/iu.test(daily)&&!/ajandaya ekle$/iu.test(daily))daily=daily.replace(/\s+ekle$/iu,' ajandaya ekle');
 const parsed=prepareDailyCreation(daily,now);if(parsed)return parsed.error?{error:parsed.error}:parsed;
 return {error:'Bu bölüm yeni not, görev, ajanda veya harcama kaydı hazırlar. Her işlemi noktalı virgülle ayırın; diğer komutları ayrı kullanın.'};
}
function description(item){
 if(item.kind==='note')return 'Not: '+item.content;
 if(item.kind==='task')return 'Görev: '+item.title+' · '+(item.due_date||'Tarihsiz')+' · Tekrar yok';
 if(item.kind==='expense')return 'Harcama: '+item.title+' · '+item.date+' · '+(item.amount_minor/100).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+item.currency+' · '+item.category;
 return 'Ajanda: '+item.title+' · '+item.date+' '+item.time+' (Türkiye saati) · '+item.durationMinutes+' dakika'+(item.conflicts?.length?'\nMevcut kayıtlarla çakışma: '+item.conflicts.map(c=>c.title+' ('+c.date+' '+c.time+')').join('; ')+'. Mevcut kayıtlar korunur.':'');
}
function validItem(i,now,checkTime=true){
 if(!i||typeof i!=='object'||Array.isArray(i)||typeof i.id!=='string'||!/^i[1-5]$/u.test(i.id)||!safeText(i.title,200))return false;
 const fields={note:['id','kind','title','content'],task:['id','kind','title','due_date'],expense:['id','kind','title','date','amount_minor','currency','category'],agenda:['id','kind','title','date','time','durationMinutes','starts_at','ends_at','conflicts']}[i.kind];
 if(!fields||Object.keys(i).some(k=>!fields.includes(k)))return false;
 if(i.kind==='note')return safeText(i.content,1000,true);
 if(i.kind==='task')return i.due_date===''||dateValid(i.due_date);
 if(i.kind==='expense')return dateValid(i.date)&&(!checkTime||i.date<=dayInIstanbul(now))&&Number.isSafeInteger(i.amount_minor)&&i.amount_minor>0&&i.amount_minor<=99999999999&&['TRY','USD','EUR'].includes(i.currency)&&['market','ulaşım','yemek','fatura','diğer'].includes(i.category);
 return i.kind==='agenda'&&dateValid(i.date)&&typeof i.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(i.time)&&Number.isInteger(i.durationMinutes)&&i.durationMinutes>=1&&i.durationMinutes<=1440&&i.starts_at===Date.parse(i.date+'T'+i.time+':00+03:00')&&i.ends_at===i.starts_at+i.durationMinutes*60000&&(!checkTime||i.starts_at>now.getTime())&&(i.conflicts===undefined||Array.isArray(i.conflicts)&&i.conflicts.length<=200&&i.conflicts.every(c=>c&&Object.keys(c).length===3&&safeText(c.title,200)&&dateValid(c.date)&&typeof c.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(c.time)));
}
async function prepare(body,env,now){
 const input=body.multiDraftRequest;
 if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='text')))return fail('Toplu taslakta yalnızca konuşma metni bulunabilir.');
 const source=input?input.text:lastText(body);if(!safeText(source,6000,true))return fail('Efendim, en fazla 6000 karakterlik bir konuşma metni gönderin.');
 const split=clauses(source);if(!split||split.length<2||split.length>5||split.some(s=>!s))return fail('Efendim, 2–5 açık işlem söyleyin. Örnek: “Birlikte yap: yarın sunumu görev yap; not al: demo bağlantısı hazır.” Tırnakları kapatın; boş işlem bırakmayın.');
 const items=[],issues=[];
 for(let n=0;n<split.length;n++){const d=parseCreation(split[n],now);if(d.error)issues.push({index:n+1,text:d.error});else items.push({...d,id:'i'+(n+1)});}
 if(issues.length)return fail('Efendim, bazı işlemleri kesin ayıramadım. Hiçbir kayıt hazırlanmadı; aşağıdaki ifadeleri düzeltin.',400,{multiIssues:issues});
 if(items.some(i=>!validItem(i,now)))return fail('Taslak bilgileri doğrulanamadı. Hiçbir kayıt hazırlanmadı.');
 const fingerprints=items.map(({id,...i})=>JSON.stringify(i));if(new Set(fingerprints).size!==items.length)return fail('Aynı işlem iki kez söylendi. Tekrarı çıkarıp yeniden hazırlayın.');
 const db=env.MEMORY_DB,before=await db.prepare('SELECT epoch FROM atlas_replan_state WHERE id=1').first();if(!before)throw Error('missing state');
 for(const item of items){
  if(item.kind==='note'&&await db.prepare('SELECT id FROM atlas_notes WHERE text=?').bind(item.content).first())issues.push({index:Number(item.id.slice(1)),text:'Bu not zaten mevcut (arşiv dahil).'});
  if(item.kind==='task'&&await db.prepare('SELECT id FROM atlas_tasks WHERE title=? AND due_date=? AND done=0').bind(item.title,item.due_date).first())issues.push({index:Number(item.id.slice(1)),text:'Bu açık görev zaten mevcut.'});
  if(item.kind==='agenda'){
   const rows=(await db.prepare('SELECT title,starts_at FROM atlas_agenda WHERE archived_at IS NULL AND starts_at<? AND ends_at>? ORDER BY id').bind(item.ends_at,item.starts_at).all()).results;
   item.conflicts=rows.map(r=>({title:r.title,date:dayInIstanbul(new Date(r.starts_at)),time:new Date(r.starts_at+10800000).toISOString().slice(11,16)}));
  }
 }
 for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++)if(items[a].kind==='agenda'&&items[b].kind==='agenda'&&items[a].starts_at<items[b].ends_at&&items[b].starts_at<items[a].ends_at)issues.push({index:b+1,text:'İki yeni ajanda işlemi birbiriyle çakışıyor. Saatleri ayrı söyleyin.'});
 if(issues.length)return fail('Efendim, çakışan veya zaten var olan işlemleri düzeltip yeniden hazırlayın. Hiçbir kayıt değişmedi.',409,{multiIssues:issues});
 const after=await db.prepare('SELECT epoch FROM atlas_replan_state WHERE id=1').first();if(after?.epoch!==before.epoch)return fail('Ajanda veya işler bu sırada değişti. Yeniden taslak hazırlayın.',409);
 if((await db.prepare('SELECT COUNT(*) AS n FROM atlas_multi_receipts').first()).n>=2000)return fail('Toplu işlem geçmişi 2000 kayıt sınırında; yeni işlem uygulanamaz.',409);
 const data={id:crypto.randomUUID(),items,epoch:before.epoch};
 const token=await signDraft(env,'multi',data,now),text='Efendim, '+items.length+' ayrı işlem hazırladım. Henüz kaydedilmedi. Uygulanacakları tek tek seçip “'+CONFIRM+'” diyerek onaylayın.';
 return {status:200,text,multiOpen:true,multiDraft:{kind:'multi',token,title:'Bir konuşma, ayrı seçimler',text,items:items.map(i=>({id:i.id,kind:i.kind,title:i.title,text:description(i)}))}};
}
async function confirm(body,env,now){
 const c=body.multiConfirmation;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['token','confirmed','selected'].includes(k))||c.confirmed!==true||normalize(lastText(body))!==normalize(CONFIRM)||!Array.isArray(c.selected)||c.selected.length<1||c.selected.length>5||c.selected.some(i=>typeof i!=='string')||new Set(c.selected).size!==c.selected.length)return fail('Efendim, açık taslaktan en az bir işlem seçip tam onay cümlesiyle onaylayın.');
 let data;try{data=await verifyDraft(env,c.token,'multi',now);}catch{return fail('Taslağın imzası veya süresi geçerli değil. Yeniden hazırlayın.',409);}
 if(Object.keys(data).length!==3||!uuid(data.id)||!Array.isArray(data.items)||data.items.length<2||data.items.length>5||data.items.some(i=>!validItem(i,now,false))||!Number.isSafeInteger(data.epoch)||data.epoch<0||new Set(data.items.map(i=>i.id)).size!==data.items.length||c.selected.some(id=>!data.items.some(i=>i.id===id)))return fail('Seçimler taslakla uyuşmuyor.',409);
 const selected=data.items.filter(i=>c.selected.includes(i.id)),selectionHash=await hash(selected),db=env.MEMORY_DB;
 const prior=()=>db.prepare('SELECT selection_hash FROM atlas_multi_receipts WHERE id=?').bind(data.id).first();
 const result=replay=>({status:200,multiOpen:true,multiSaved:{draftId:data.id,selectedIds:selected.map(i=>i.id),count:selected.length,skipped:data.items.length-selected.length},text:replay?'Efendim, bu seçiminiz daha önce uygulanmış. İkinci kez kaydetmedim.':'Efendim, seçtiğiniz '+selected.length+' işlem birlikte kaydedildi.'+(selected.length<data.items.length?' Seçmediğiniz '+(data.items.length-selected.length)+' işlem kaydedilmedi.':'')});
 const existing=await prior();if(existing)return existing.selection_hash===selectionHash?result(true):fail('Bu taslak daha önce farklı seçimle uygulanmış. Kalan işlemler için yeni taslak hazırlayın.',409);
 if(selected.some(i=>!validItem(i,now)))return fail('Seçilen kayıt veya ajanda saati artık geçerli değil. Yeniden hazırlayın; hiçbir işlem uygulanmadı.',409);
 try{await db.prepare('INSERT INTO atlas_multi_receipts(id,selection_hash,items_json,expected_epoch,created_at) VALUES(?,?,?,?,?)').bind(data.id,selectionHash,JSON.stringify(selected),selected.some(i=>i.kind==='agenda')?data.epoch:null,now.toISOString()).run();}
 catch{const saved=await prior();if(saved?.selection_hash===selectionHash)return result(true);return fail('Bir kayıt değişmiş, aynı kayıt eklenmiş veya kapasite dolmuş. Seçtiğiniz işlemlerin hiçbiri uygulanmadı; yeniden önizleyin.',409);}
 return result(false);
}
export async function multiRequest(body,env,now=new Date(),requestId=''){
 if(!env?.MEMORY_DB)return unavailable();
 if(!Number.isFinite(now.getTime()))return fail('İşlem tarihi doğrulanamadı.',503);
 if(body?.multiDraftRequest!==undefined&&body?.multiConfirmation!==undefined)return fail('Taslak hazırlama ve onay ayrı adımlardır.');
 try{
  if(body?.multiConfirmation!==undefined)return await confirm(body,env,now);
  const parsed=multiCommand(lastText(body));
  if(body?.multiDraftRequest!==undefined||parsed?.action==='draft')return await prepare(body,env,now);
  if(parsed?.action==='confirm')return fail('Önce taslak hazırlayıp uygulanacak işlemleri seçin.');
  if(parsed?.action==='open')return {status:200,multiOpen:true,text:'Efendim, çoklu işlem bölümünü açtım. İki ila beş yeni kaydı noktalı virgülle ayırarak söyleyin; uygulamadan önce tek tek seçersiniz.'};
  return null;
 }catch(error){reportError({stage:'multi.request',requestId,error,meta:{table:'atlas_multi_receipts'}});return unavailable();}
}
