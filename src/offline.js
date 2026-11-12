import {signDraft,verifyDraft} from './daily-signing.js';
import {reportError} from './log.js';
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(s);
const id=s=>typeof s==='string'&&/^[a-zA-Z0-9-]{16,80}$/u.test(s);
const tag=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
const text=(s,max,multiline=false)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(s);
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
const fail=(error,status=400,extra={})=>({status,error,...extra});
const unavailable=()=>fail('Efendim, ortak kayıtlar şu anda okunamadı. Cihazdaki taslağınız korunuyor.',503);
const safeNoteRow=r=>({id:r.id,text:r.text,revision:r.revision,archived_at:r.archived_at});
async function publicNote(r){return {...safeNoteRow(r),etag:await hash(safeNoteRow(r))};}
async function publicList(r){const s=JSON.parse(r.state_json);return {id:r.id,title:r.title,kind:r.kind,revision:r.revision,archived:!!r.archived,items:s.items.map(i=>({id:i.id,title:i.title,quantity:i.quantity,status:i.status,archived:i.archived})),etag:await hash({id:r.id,revision:r.revision,state:r.state_json})};}
export function offlineCommand(input){if(typeof input!=='string')return false;return /^(?:çevrimdışı kayıtlar(?:ım|ımı)?|çevrimdışı bölüm|çevrimdışı alan)(?: (?:aç|göster))?$/u.test(normalize(input));}
export function offlinePreview(){return {status:200,offlineOpen:true,text:'Efendim, çevrimdışı kayıtlar bölümünü açıyorum. Bu cihazda tutulacak kopyaları siz seçersiniz.'};}
export async function offlineSnapshot(body,env,now=new Date(),requestId=''){
 if(!env?.MEMORY_DB)return unavailable();
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['noteIds','listIds'].includes(k))||!Array.isArray(body.noteIds)||!Array.isArray(body.listIds)||body.noteIds.length>20||body.listIds.length>10||body.noteIds.some(n=>!Number.isSafeInteger(n)||n<1)||body.listIds.some(n=>!id(n))||new Set(body.noteIds).size!==body.noteIds.length||new Set(body.listIds).size!==body.listIds.length)return fail('En fazla 20 not ve 10 liste seçin; yalnızca açık kayıtlar kopyalanabilir.');
 try{
  const db=env.MEMORY_DB,notes=body.noteIds.length?await db.prepare(`SELECT id,text,revision,archived_at FROM atlas_notes WHERE archived_at IS NULL AND id IN (${body.noteIds.map(()=>'?').join(',')}) ORDER BY id`).bind(...body.noteIds).all():{results:[]};
  const lists=body.listIds.length?await db.prepare(`SELECT id,title,kind,state_json,revision,archived FROM atlas_lists WHERE archived=0 AND id IN (${body.listIds.map(()=>'?').join(',')}) ORDER BY id`).bind(...body.listIds).all():{results:[]};
  if(notes.results.length!==body.noteIds.length||lists.results.length!==body.listIds.length)return fail('Seçilen kayıtlardan biri değişmiş veya arşivlenmiş. Listeyi yenileyip yeniden seçin.',409);
  const snapshot={version:1,capturedAt:now.toISOString(),notes:await Promise.all(notes.results.map(publicNote)),lists:await Promise.all(lists.results.map(publicList))};
  if(new TextEncoder().encode(JSON.stringify(snapshot)).length>1024*1024)return fail('Seçilen kopya çok büyük; daha az kayıt seçin.',413);
  return {status:200,offlineSnapshot:snapshot};
 }catch(error){reportError({stage:'offline.request',requestId,error,meta:{table:'atlas_offline_receipts'}});return unavailable();}
}
function validateDraft(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||!uuid(d.id)||!['note-create','note-edit','list-add','list-item-status'].includes(d.type)||typeof d.createdAt!=='string'||!Number.isFinite(Date.parse(d.createdAt)))return null;
 const base=['id','type','createdAt'];let keys;
 if(d.type==='note-create')keys=[...base,'text'];
 else if(d.type==='note-edit')keys=[...base,'targetId','expectedTag','text'];
 else if(d.type==='list-add')keys=[...base,'targetId','expectedTag','title','quantity'];
 else keys=[...base,'targetId','expectedTag','itemId','status'];
 if(Object.keys(d).some(k=>!keys.includes(k)))return null;
 const clean={id:d.id,type:d.type,createdAt:d.createdAt};
 if(d.type.startsWith('note-')){if(!text(d.text,1000,true))return null;clean.text=d.text.trim();}
 if(d.type!=='note-create'){
  if(!tag(d.expectedTag)||(d.type==='note-edit'?(!Number.isSafeInteger(d.targetId)||d.targetId<1):!id(d.targetId)))return null;
  clean.targetId=d.targetId;clean.expectedTag=d.expectedTag;
 }
 if(d.type==='list-add'){
  if(!text(d.title,200)||d.quantity!==undefined&&typeof d.quantity!=='string')return null;
  const quantity=(d.quantity||'').trim();if(quantity.length>40||/[\u0000-\u001f\u007f]/u.test(quantity)||/^-/u.test(quantity)||/^[+]?0+(?:[,.]0+)?(?:\s|$)/u.test(quantity))return null;
  clean.title=d.title.trim();clean.quantity=quantity;
 }
 if(d.type==='list-item-status'){if(!id(d.itemId)||!['todo','doing','done'].includes(d.status))return null;clean.itemId=d.itemId;clean.status=d.status;}
 return clean;
}
async function existing(env,d,payloadHash){
 const r=await env.MEMORY_DB.prepare('SELECT id,type,payload_hash FROM atlas_offline_receipts WHERE id=?').bind(d.id).first();
 if(!r)return null;
 return r.payload_hash===payloadHash?{status:200,offlineSaved:{draftId:r.id,type:r.type},text:'Efendim, bu taslak daha önce kaydedilmiş. İkinci kez uygulamadım.'}:fail('Bu taslağın kimliği daha önce başka bir içerikle kullanılmış. Yeni bir taslak oluşturun.',409);
}
async function prepare(d,env){
 const db=env.MEMORY_DB;
 if((await db.prepare('SELECT COUNT(*) AS n FROM atlas_offline_receipts').first()).n>=2000)return fail('Çevrimdışı kayıt geçmişi 2.000 işlem sınırına ulaştı. Taslağınız cihazda kalır.',409);
 if(d.type==='note-create'){
  const same=await db.prepare('SELECT id,archived_at FROM atlas_notes WHERE text=?').bind(d.text).first();if(same)return fail('Bu not zaten mevcut'+(same.archived_at?' ve arşivde':'')+'. Tekrar kaydetmedim.',409);
  if((await db.prepare('SELECT COUNT(*) AS n FROM atlas_notes').first()).n>=100)return fail('Not defteri 100 kayıt sınırında. Yeni not eklenmedi.',409);
  return {targetId:null,revision:0,before:null,after:JSON.stringify({text:d.text,archived_at:null}),title:'Yeni not',description:'Yeni not: '+d.text};
 }
 if(d.type==='note-edit'){
  const row=await db.prepare('SELECT id,text,revision,archived_at FROM atlas_notes WHERE id=?').bind(d.targetId).first();
  const current=row?await publicNote(row):null;
  if(!current||current.archived_at||current.etag!==d.expectedTag)return fail('Not başka bir cihazda değişmiş veya arşivlenmiş. Güncel kopyayı alıp yeni taslak hazırlayın; eski taslak korunuyor.',409,{offlineConflict:true,current});
  if(row.text===d.text)return fail('Not mevcut içerikle aynı; değişiklik yok.',409);
  const duplicate=await db.prepare('SELECT id FROM atlas_notes WHERE text=? AND id!=?').bind(d.text,d.targetId).first();if(duplicate)return fail('Aynı metin başka bir notta zaten var. Değişiklik yapılmadı.',409);
  if((await db.prepare("SELECT COUNT(*) AS n FROM atlas_record_changes WHERE action!='undo'").first()).n>=5000)return fail('Kayıt değişikliği geçmişi dolu. Taslağınız cihazda kalır.',409);
  return {targetId:String(row.id),revision:row.revision,before:JSON.stringify({text:row.text,archived_at:null}),after:JSON.stringify({text:d.text,archived_at:null}),title:'Not '+row.id+' düzeltme',description:'Önce: '+row.text+'\nSonra: '+d.text};
 }
 const row=await db.prepare('SELECT id,title,kind,state_json,revision,archived FROM atlas_lists WHERE id=?').bind(d.targetId).first(),current=row?await publicList(row):null;
 if(!current||current.archived||current.etag!==d.expectedTag)return fail('Liste başka bir cihazda değişmiş veya arşivlenmiş. Güncel kopyayı alıp yeni taslak hazırlayın; eski taslak korunuyor.',409,{offlineConflict:true,current});
 const state=JSON.parse(row.state_json);let description;
 if(d.type==='list-add'){
  if(state.items.length>=100)return fail('Liste arşiv dahil 100 madde sınırında. Taslak cihazınızda kalır.',409);
  const itemId='offline-'+d.id;if(state.items.some(x=>x.id===itemId))return fail('Bu madde kimliği zaten mevcut. Yeni taslak hazırlayın.',409);
  state.items.push({id:itemId,title:d.title,quantity:d.quantity,status:'todo',archived:false});description=`“${row.title}” listesine ${d.quantity?d.quantity+' ':''}${d.title} eklenecek.`;
 }else{
  const item=state.items.find(i=>i.id===d.itemId&&!i.archived);if(!item)return fail('Madde bulunamadı veya arşivlenmiş. Güncel kopyayı alıp yeniden seçin.',409,{offlineConflict:true,current});
  if(item.status===d.status)return fail('Madde zaten bu durumda; değişiklik yok.',409);
  const labels={todo:'yapılacak',doing:'sürüyor',done:'tamamlandı'};description=`“${row.title}” / “${item.title}”: ${labels[item.status]} → ${labels[d.status]}.`;item.status=d.status;
 }
 if((await db.prepare("SELECT COUNT(*) AS n FROM atlas_list_changes WHERE action!='undo'").first()).n>=5000)return fail('Liste değişikliği geçmişi dolu. Taslağınız cihazda kalır.',409);
 return {targetId:row.id,revision:row.revision,before:row.state_json,after:JSON.stringify(state),title:row.title+' · çevrimdışı taslak',description};
}
export async function offlineReview(body,env,now=new Date(),requestId=''){
 if(!env?.MEMORY_DB)return unavailable();
 if(!body||Object.keys(body).some(k=>k!=='draft'))return fail('İncelemek için tek bir cihaz taslağı seçin.');
 const d=validateDraft(body.draft);if(!d)return fail('Cihaz taslağı doğrulanamadı. Kayıt yapılmadı.');
 try{
  const payloadHash=await hash(d),saved=await existing(env,d,payloadHash);if(saved)return saved;
  const p=await prepare(d,env);if(p.error)return p;
  const token=await signDraft(env,'offline',{draft:d,payloadHash},now),message=`Efendim, ${p.description}\nHenüz uygulanmadı. “Çevrimdışı taslağı onaylıyorum” onayından sonra ortak kayda uygulanır.`;
  return {status:200,offlineDraft:{kind:'offline',id:d.id,token,title:p.title,text:message},text:message};
 }catch(error){reportError({stage:'offline.request',requestId,error,meta:{table:'atlas_offline_receipts'}});return unavailable();}
}
export async function offlineConfirm(body,env,now=new Date(),requestId=''){
 if(!env?.MEMORY_DB)return unavailable();
 const c=body?.offlineConfirmation,last=Array.isArray(body?.messages)?body.messages.at(-1):null;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['token','confirmed'].includes(k))||c.confirmed!==true||typeof c.token!=='string'||last?.role!=='user'||typeof last.text!=='string'||normalize(last.text)!=='çevrimdışı taslağı onaylıyorum')return fail('Açık taslağı tam onay cümlesiyle onaylayın. Kayıt yapılmadı.');
 try{
  let data;try{data=await verifyDraft(env,c.token,'offline',now);}catch{return fail('Onay taslağı doğrulanamadı veya süresi doldu. Cihaz taslağını yeniden inceleyin.',409);}
  const d=validateDraft(data.draft);if(!d||!tag(data.payloadHash)||data.payloadHash!==await hash(d))return fail('Onay taslağı doğrulanamadı.',409);
  const saved=await existing(env,d,data.payloadHash);if(saved)return saved;
  const p=await prepare(d,env);if(p.error)return p;
  try{
   await env.MEMORY_DB.prepare('INSERT INTO atlas_offline_receipts(id,type,payload_hash,operation_id,target_id,expected_revision,before_json,after_json,title,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(d.id,d.type,data.payloadHash,'offline-'+d.id,p.targetId,p.revision,p.before,p.after,p.title,now.toISOString()).run();
  }catch{
   const replay=await existing(env,d,data.payloadHash);if(replay)return replay;
   return fail('Kayıt onay sırasında değişmiş veya kapasiteye ulaşılmış. Yeniden inceleyin; taslağınız cihazda kalır.',409,{offlineConflict:true});
  }
  return {status:200,offlineSaved:{draftId:d.id,type:d.type},text:'Efendim, onayladığınız cihaz taslağı ortak kayda uygulandı. İki cihazda güncel kaydı okuyabilirsiniz.'};
 }catch(error){reportError({stage:'offline.request',requestId,error,meta:{table:'atlas_offline_receipts'}});return unavailable();}
}
