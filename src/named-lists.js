import {signDraft,verifyDraft} from './daily-signing.js';
import {reportError} from './log.js';

const actions=['create','rename','archive','restore','add-items','edit-item','complete-item','reopen-item','archive-item','restore-item','set-status','undo'];
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
const validText=(s,max=200,empty=false)=>typeof s==='string'&&(empty||s.trim().length>0)&&s.trim().length<=max&&!/[\u0000-\u001f\u007f]/u.test(s);
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{16,80}$/u.test(id);
const fail=(text,status=400)=>({status,error:text,text,listsOpen:true});
const unavailable=()=>fail('Efendim, ortak liste ve proje deposu henüz hazır değil. Değişiklik yapılmadı.',503);
const stale=()=>fail('Efendim, bu liste başka bir işlemle değişti. Güncel durumu kontrol edip yeni bir taslak hazırlayın; değişiklik yapılmadı.',409);
const isError=x=>Boolean(x?.error);
const stateOf=row=>JSON.parse(row.state_json);
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
function publicList(row){
 const state=stateOf(row),items=state.items.map(i=>({...i,done:i.status==='done'})),active=items.filter(i=>!i.archived),done=active.filter(i=>i.done).length;
 return {...state,revision:row.revision,items,progress:{done,total:active.length,percent:active.length?Math.round(done*100/active.length):0},created_at:row.created_at,updated_at:row.updated_at};
}
async function rows(db){return (await db.prepare('SELECT * FROM atlas_lists ORDER BY created_at,id LIMIT 30').all()).results;}
async function latestChange(db){return db.prepare("SELECT id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone,undo_of FROM atlas_list_changes WHERE action != 'undo' AND undone=0 ORDER BY created_at DESC,rowid DESC LIMIT 1").first();}
export async function latestListsChange(env){
 if(!env?.MEMORY_DB)throw Error('Liste deposu hazır değil.');
 const row=await latestChange(env.MEMORY_DB);return row?{source:'lists',id:row.id,created_at:row.created_at}:null;
}
export async function readLists(env,now=new Date(),requestId=''){
 const empty={listItems:[],archivedListItems:[],listChangeItems:[]};
 if(!env?.MEMORY_DB)return {...unavailable(),...empty};
 try{
  const all=(await rows(env.MEMORY_DB)).map(publicList);
  const changes=(await env.MEMORY_DB.prepare('SELECT id,list_id,action,title,created_at,undone,undo_of FROM atlas_list_changes ORDER BY created_at DESC,rowid DESC LIMIT 30').all()).results;
  return {listItems:all.filter(r=>!r.archived),archivedListItems:all.filter(r=>r.archived),listChangeItems:changes.map(r=>({...r,undone:Boolean(r.undone)}))};
 }catch(error){reportError({stage:'db.lists.read',requestId,error,meta:{table:'atlas_lists'}});return {...unavailable(),...empty};}
}

export function listsCommand(input){
 if(typeof input!=='string'||input.length>6000)return null;
 const text=normalize(input);
 if(text==='liste değişikliğini onaylıyorum')return {action:'confirm'};
 if(/^(?:liste değişikliğini|son liste değişikliğini|son proje değişikliğini) geri al$/u.test(text))return {action:'draft',input:{action:'undo'}};
 if(/^(?:listelerimi|listelerim|listeleri|listeler)(?: (?:göster|aç|oku|listele))?$/u.test(text))return {action:'show',kind:'list'};
 if(/^(?:projelerimi|projelerim|projeleri|projeler)(?: (?:göster|aç|oku|listele))?$/u.test(text))return {action:'show',kind:'project'};
 if(/^(?:arşivlenmiş|arşivdeki) (?:listelerimi|projelerimi) (?:göster|aç|oku)$/u.test(text))return {action:'show',archived:true,kind:text.includes('projelerimi')?'project':'list'};
 let m=text.match(/^(.+?) (listesi|projesi) oluştur$/u);
 if(m)return {action:'draft',input:{action:'create',title:m[1],kind:m[2]==='listesi'?'list':'project'}};
 m=text.match(/^(.+?) (listesini|projesini) (göster|aç|oku|arşivle|geri getir)$/u);
 if(m)return m[3]==='arşivle'||m[3]==='geri getir'?{action:'draft',input:{action:m[3]==='arşivle'?'archive':'restore',listTitle:m[1],kind:m[2]==='listesini'?'list':'project'}}:{action:'show',listTitle:m[1],kind:m[2]==='listesini'?'list':'project'};
 m=text.match(/^(.+?) (listesinin|projesinin) adını (.+?) (?:yap|değiştir)$/u);
 if(m)return {action:'draft',input:{action:'rename',listTitle:m[1],kind:m[2]==='listesinin'?'list':'project',title:m[3]}};
 m=text.match(/^(.+?) (listesine|projesine) (.+?) ekle$/u);
 if(m)return {action:'draft',input:{action:'add-items',listTitle:m[1],kind:m[2]==='listesine'?'list':'project',voiceItems:m[3]}};
 m=text.match(/^(.+?) (listesinin|projesinin) (.+?) (tamamla|yeniden aç|geri aç|arşivle|başlat|geri getir)$/u);
 if(m){
  const action={'tamamla':'complete-item','yeniden aç':'reopen-item','geri aç':'reopen-item','arşivle':'archive-item','başlat':'set-status','geri getir':'restore-item'}[m[4]];
  return {action:'draft',input:{action,listTitle:m[1],kind:m[2]==='listesinin'?'list':'project',itemTitle:m[3].replace(/\s+(?:adımını|maddesini|öğesini|ögesini)$/u,''),...(action==='set-status'?{status:'doing'}:{})}};
 }
 m=text.match(/^(.+?) (listesindeki|projesindeki) (.+?) miktarını (.+?) yap$/u);
 if(m)return {action:'draft',input:{action:'edit-item',listTitle:m[1],kind:m[2]==='listesindeki'?'list':'project',itemTitle:m[3],quantity:m[4]}};
 return null;
}
function voiceItems(text,kind){
 const numbers={bir:1,iki:2,üç:3,dört:4,beş:5,altı:6,yedi:7,sekiz:8,dokuz:9,on:10,onbir:11,oniki:12};
 // A Turkish decimal comma belongs to a quantity, not a second item.
 const parts=text.split(/(?<!\d),|,(?!\d)|\s+ve\s+/u);
 if(parts.length>20||parts.some(p=>!p.trim()))return fail('Efendim, bir taslağa en fazla 20 açık madde ekleyin.');
 return parts.map(part=>{
  let title=part.trim(),quantity='';
  if(kind==='project')title=title.replace(/\s+(?:adımı|aşaması)$/u,'');
  const match=title.match(/^(\d+(?:[,.]\d{1,3})?|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|onbir|oniki)\s+(?:(litre|mililitre|ml|kilo|kilogram|kg|gram|gr|adet|tane|paket|kutu|şişe|demet|metre)\s+)?(.+)$/u);
  if(/^[+\-\d]/u.test(title)&&!match)return {error:'Belirsiz miktar'};
  if(match){quantity=String(numbers[match[1]]??match[1])+(match[2]?' '+match[2]:'');title=match[3];}
  return {title,quantity};
 });
}
function itemInput(input,{signed=false}={}){
 if(!input||typeof input!=='object'||!validText(input.title))return fail('Efendim, madde başlığı 1–200 karakter olmalı.');
 const rawQuantity=input.quantity===undefined?'':typeof input.quantity==='number'&&Number.isFinite(input.quantity)?String(input.quantity):input.quantity;
 const quantity=typeof rawQuantity==='string'?rawQuantity.trim():rawQuantity;
 if(!validText(rawQuantity,40,true)||/^[+-]?0+(?:[,.]0+)?(?:\s|$)/u.test(quantity)||/^-/u.test(quantity))return fail('Efendim, miktarı en fazla 40 karakterle ve sıfırdan büyük olacak şekilde belirtin.');
 if(signed&&!validId(input.id))return fail('Efendim, madde taslağı doğrulanamadı.',409);
 return {id:signed?input.id:crypto.randomUUID(),title:input.title.trim(),quantity:quantity.trim(),status:'todo',archived:false};
}
function validState(s){
 return s&&validId(s.id)&&validText(s.title)&&['list','project'].includes(s.kind)&&typeof s.archived==='boolean'&&Array.isArray(s.items)&&s.items.length<=100&&new Set(s.items.map(i=>i.id)).size===s.items.length&&s.items.every(i=>validId(i.id)&&validText(i.title)&&validText(i.quantity,40,true)&&['todo','doing','done'].includes(i.status)&&typeof i.archived==='boolean');
}
async function resolveRow(db,input){
 if(input.listId!==undefined){
  if(!validId(input.listId))return fail('Efendim, geçerli bir liste seçin.');
  const row=await db.prepare('SELECT * FROM atlas_lists WHERE id = ?').bind(input.listId).first();
  return row||fail('Efendim, bu liste bulunamadı.',404);
 }
 if(!validText(input.listTitle)||!['list','project'].includes(input.kind))return fail('Efendim, bir liste veya proje seçin.');
 const matches=(await rows(db)).filter(r=>normalize(r.title)===normalize(input.listTitle)&&r.kind===input.kind&&Boolean(r.archived)===(input.action==='restore'));
 if(matches.length!==1)return fail(matches.length?'Efendim, bu adda birden fazla liste var. Bölümden tam olarak birini seçin.':'Efendim, bu adda bir liste veya proje bulunamadı.',matches.length?409:404);
 return matches[0];
}
function resolveItem(state,input){
 const includeArchived=input.action==='restore-item';
 const matches=state.items.filter(i=>input.itemId!==undefined?i.id===input.itemId:validText(input.itemTitle)&&normalize(i.title)===normalize(input.itemTitle)&&i.archived===includeArchived);
 if(matches.length!==1)return fail(matches.length?'Efendim, aynı adlı birden fazla madde var. Bölümden tam olarak birini seçin.':'Efendim, bu madde bulunamadı.',matches.length?409:404);
 return matches[0];
}
async function prepare(env,input,now,{signed=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||!actions.includes(input.action))return fail('Efendim, geçerli bir liste işlemi seçin.');
 const db=env.MEMORY_DB,action=input.action;
 if(action==='undo'){
  const change=await latestChange(db);
  if(!change)return fail('Efendim, geri alınabilecek bir liste değişikliği yok.',409);
  if(input.changeId!==undefined&&input.changeId!==change.id)return fail('Efendim, son liste değişikliği değişti. Güncel işlem için yeni bir taslak hazırlayın.',409);
  const row=await db.prepare('SELECT * FROM atlas_lists WHERE id = ?').bind(change.list_id).first();
  if(!row||row.state_json!==change.after_json)return stale();
  const state=change.before_json?JSON.parse(change.before_json):{...stateOf(row),archived:true};
  if(!validState(state))return stale();
  const current=stateOf(row),differences=[];
  if(state.title!==current.title)differences.push(`adı “${state.title}” olacak`);
  if(state.archived!==current.archived)differences.push(state.archived?'liste arşivlenecek':'liste geri getirilecek');
  for(const item of state.items){const old=current.items.find(i=>i.id===item.id);if(JSON.stringify(old)!==JSON.stringify(item))differences.push(`“${item.quantity?item.quantity+' ':''}${item.title}”: ${item.archived?'arşivde':{todo:'bekliyor',doing:'sürüyor',done:'tamamlandı'}[item.status]}`);}
  const removed=current.items.filter(i=>!state.items.some(before=>before.id===i.id));
  if(removed.length)differences.push(`son eklenen ${removed.map(i=>`“${i.quantity?i.quantity+' ':''}${i.title}”`).join(', ')} maddeleri listeden geri çekilecek; işlem geçmişi korunacak`);
  return {row,state,input:{action,changeId:change.id},change,description:`“${current.title}” için son değişiklik geri alınacak: ${differences.join('; ')}.`};
 }
 const history=await db.prepare("SELECT COUNT(*) AS total FROM atlas_list_changes WHERE action != 'undo'").first();
 if(history.total>=5000)return fail('Efendim, liste geçmişi 5.000 değişiklik sınırına ulaştı. Geçmiş korunuyor; son değişiklikleri geri alabilirsiniz.',409);
 let row=null,state;
 if(action==='create'){
  if(!['list','project'].includes(input.kind)||!validText(input.title))return fail('Efendim, türü seçin ve 1–200 karakterlik bir ad yazın.');
  if((await rows(db)).length>=30)return fail('Efendim, arşiv dahil 30 liste/proje sınırına ulaşıldı. Mevcut bir listeyi kullanabilirsiniz.',409);
  if(signed&&!validId(input.listId))return fail('Efendim, liste taslağı doğrulanamadı.',409);
  state={id:signed?input.listId:crypto.randomUUID(),title:input.title.trim(),kind:input.kind,archived:false,items:[]};
 }else{
  row=await resolveRow(db,input);if(isError(row))return row;
  if(input.revision!==undefined&&input.revision!==row.revision)return stale();
  state=stateOf(row);
  if(state.archived&&action!=='restore')return fail('Efendim, bu liste arşivde. Önce geri getirme taslağını onaylayın.',409);
  if(!state.archived&&action==='restore')return fail('Efendim, bu liste zaten açık.',409);
 }
 let clean={action,listId:state.id},description='';
 if(action==='create'||action==='add-items'){
  let inputs=input.voiceItems!==undefined?voiceItems(input.voiceItems,state.kind):(input.items??[]);if(isError(inputs))return inputs;
  if(!Array.isArray(inputs)||inputs.length>20||(action==='add-items'&&inputs.length<1))return fail('Efendim, bir taslakta 1–20 madde ekleyebilirsiniz.');
  if(state.items.length+inputs.length>100)return fail('Efendim, arşiv dahil liste başına 100 madde sınırı var.',409);
  if(inputs.some(isError))return fail('Efendim, miktarı açık yazın; örneğin “2 litre süt” veya “1,5 kilo elma”.');
  const items=inputs.map(item=>itemInput(item,{signed})),invalid=items.find(isError);if(invalid)return invalid;
  state.items.push(...items);clean={...clean,...(action==='create'?{title:state.title,kind:state.kind}:{}),items};
  description=action==='create'?`“${state.title}” adlı ${state.kind==='project'?'proje':'liste'} oluşturulacak${items.length?`; şu maddeler eklenecek: ${items.map(i=>`${i.quantity?i.quantity+' ':''}${i.title}`).join('; ')}`:''}.`:`“${state.title}” içine ${items.map(i=>`${i.quantity?i.quantity+' ':''}${i.title}`).join('; ')} eklenecek.`;
 }else if(action==='rename'){
  if(!validText(input.title))return fail('Efendim, yeni ad 1–200 karakter olmalı.');
  description=`“${state.title}” adı “${input.title.trim()}” olacak.`;state.title=input.title.trim();clean.title=state.title;
 }else if(action==='archive'||action==='restore'){
  state.archived=action==='archive';description=`“${state.title}” ${state.archived?'arşivlenecek':'geri getirilecek'}.`;
 }else{
  const item=resolveItem(state,input);if(isError(item))return item;
  if(item.archived&&action!=='restore-item')return fail('Efendim, bu madde arşivde. Önce geri getirin.',409);
  if(!item.archived&&action==='restore-item')return fail('Efendim, bu madde zaten açık.',409);
  clean.itemId=item.id;const oldTitle=item.title;
  if(action==='edit-item'){
   if(input.title===undefined&&input.quantity===undefined)return fail('Efendim, madde adı veya miktar için bir değişiklik yazın.');
   const changed=itemInput({title:input.title??item.title,quantity:input.quantity??item.quantity});if(isError(changed))return changed;
   item.title=changed.title;item.quantity=changed.quantity;clean.title=item.title;clean.quantity=item.quantity;
  }else if(action==='archive-item'||action==='restore-item')item.archived=action==='archive-item';
  else {const status=action==='complete-item'?'done':action==='reopen-item'?'todo':input.status;if(!['todo','doing','done'].includes(status))return fail('Efendim, adım için bekliyor, sürüyor veya tamamlandı durumunu seçin.');item.status=status;if(action==='set-status')clean.status=status;}
  const label={'edit-item':`“${item.quantity?item.quantity+' ':''}${item.title}” olarak düzenlenecek`,'complete-item':'tamamlandı olarak işaretlenecek','reopen-item':'yeniden açılacak','archive-item':'arşivlenecek','restore-item':'geri getirilecek','set-status':`${{todo:'bekliyor',doing:'sürüyor',done:'tamamlandı'}[item.status]} olarak işaretlenecek`}[action];
  description=`“${state.title}” içindeki “${oldTitle}” ${label}.`;
 }
 if(!validState(state))return fail('Efendim, liste içeriği doğrulanamadı.',409);
 if(row&&JSON.stringify(state)===row.state_json)return fail('Efendim, seçilen işlem mevcut durumla aynı; bir değişiklik yok.',409);
 if(!state.archived){const conflict=(await rows(db)).some(r=>r.id!==state.id&&!r.archived&&r.kind===state.kind&&normalize(r.title)===normalize(state.title));if(conflict)return fail('Efendim, bu adda açık bir liste veya proje zaten var. Farklı bir ad seçin.',409);}
 return {row,state,input:clean,description};
}
async function preview(env,input,now){
 const change=await prepare(env,input,now);if(isError(change))return change;
 const data={draftId:crypto.randomUUID(),input:change.input,listId:change.state.id,expectedRevision:change.row?.revision??0,expectedHash:change.row?await digest(change.row.state_json):null};
 const token=await signDraft(env,'lists',data,now),text=`Efendim, ${change.description} Henüz uygulanmadı. Uygulamak için “Liste değişikliğini onaylıyorum” deyin.`;
 return {status:200,listsOpen:true,listsDraft:{kind:'lists',token,title:change.state.title,text},text};
}
function validDraft(d){return d&&validId(d.draftId)&&validId(d.listId)&&Number.isInteger(d.expectedRevision)&&d.expectedRevision>=0&&(d.expectedRevision===0?d.expectedHash===null:typeof d.expectedHash==='string'&&/^[a-f0-9]{64}$/u.test(d.expectedHash))&&d.input&&actions.includes(d.input.action)&&(d.input.action==='create'?d.expectedRevision===0&&d.input.listId===d.listId:d.expectedRevision>0&&(d.input.action==='undo'||d.input.listId===d.listId));}
async function confirm(body,env,now,text,requestId=''){
 const c=body.listsConfirmation;
 if(!c||c.confirmed!==true||typeof c.token!=='string'||normalize(text)!=='liste değişikliğini onaylıyorum')return fail('Efendim, açık taslağı kontrol edip “Liste değişikliğini onaylıyorum” diyerek onaylayın. Değişiklik yapılmadı.');
 let d;try{d=await verifyDraft(env,c.token,'lists',now);if(!validDraft(d))throw Error();}catch{return fail('Efendim, liste taslağı doğrulanamadı veya süresi doldu. Yeni bir taslak hazırlayın; değişiklik yapılmadı.',409);}
 const db=env.MEMORY_DB;
 const existing=await db.prepare('SELECT id,list_id,action FROM atlas_list_changes WHERE id = ?').bind(d.draftId).first();
 if(existing)return {status:200,listsOpen:true,listsSaved:existing,text:'Efendim, bu onay daha önce uygulandı. İkinci kez değiştirmedim.',...await readLists(env,now,requestId)};
 const row=await db.prepare('SELECT * FROM atlas_lists WHERE id = ?').bind(d.listId).first();
 if(d.expectedRevision===0?Boolean(row):!row||row.revision!==d.expectedRevision||await digest(row.state_json)!==d.expectedHash)return stale();
 const change=await prepare(env,d.input,now,{signed:true});if(isError(change))return change;
 if(change.state.id!==d.listId)return stale();
 const before=row?.state_json??null,after=JSON.stringify(change.state),revision=d.expectedRevision+1,time=now.toISOString(),s=change.state;
 const nameGuard='NOT EXISTS (SELECT 1 FROM atlas_lists WHERE kind = ? AND title_key = ? AND archived=0 AND id != ?)';
 const parameters=[s.kind,normalize(s.title),s.id];
 let update;
 if(!row){
  update=db.prepare(`INSERT INTO atlas_lists(id,title,title_key,kind,state_json,revision,archived,created_at,updated_at,last_operation_id) SELECT ?,?,?,?,?,1,0,?,?,? WHERE (SELECT COUNT(*) FROM atlas_lists)<30 AND (SELECT COUNT(*) FROM atlas_list_changes WHERE action != 'undo')<5000 AND ${nameGuard} AND NOT EXISTS (SELECT 1 FROM atlas_list_changes WHERE id = ?)`).bind(s.id,s.title,normalize(s.title),s.kind,after,time,time,d.draftId,...parameters,d.draftId);
 }else{
  const undoGuard=change.change?" AND EXISTS (SELECT 1 FROM atlas_list_changes WHERE id = ? AND undone=0 AND action != 'undo' AND id = (SELECT id FROM atlas_list_changes WHERE action != 'undo' AND undone=0 ORDER BY created_at DESC,rowid DESC LIMIT 1))":'';
  const historyGuard=change.change?'':" AND (SELECT COUNT(*) FROM atlas_list_changes WHERE action != 'undo')<5000";
  update=db.prepare(`UPDATE atlas_lists SET title=?,title_key=?,state_json=?,revision=?,archived=?,updated_at=?,last_operation_id=? WHERE id=? AND revision=? AND state_json=? AND (?=1 OR ${nameGuard}) AND NOT EXISTS (SELECT 1 FROM atlas_list_changes WHERE id = ?)${undoGuard}${historyGuard}`).bind(s.title,normalize(s.title),after,revision,s.archived?1:0,time,d.draftId,s.id,d.expectedRevision,before,s.archived?1:0,...parameters,d.draftId,...(change.change?[change.change.id]:[]));
 }
 const record=db.prepare('INSERT INTO atlas_list_changes(id,list_id,action,title,before_json,after_json,before_revision,after_revision,created_at,undone,undo_of) SELECT ?,?,?,?,?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM atlas_lists WHERE id=? AND last_operation_id=? AND revision=? AND state_json=?) AND NOT EXISTS (SELECT 1 FROM atlas_list_changes WHERE id=?)').bind(d.draftId,s.id,d.input.action,change.description,before,after,d.expectedRevision,revision,time,change.change?.id??null,s.id,d.draftId,revision,after,d.draftId);
 const batch=[update,record];
 if(change.change)batch.push(db.prepare('UPDATE atlas_list_changes SET undone=1 WHERE id=? AND undone=0 AND EXISTS (SELECT 1 FROM atlas_list_changes WHERE id=? AND undo_of=?)').bind(change.change.id,d.draftId,change.change.id));
 // D1 batch executes atomically. Never fall back to sequential writes: a
 // partial mutation without its replay/undo journal must not be possible.
 if(typeof db.batch!=='function')return unavailable();
 await db.batch(batch);
 const saved=await db.prepare('SELECT id,list_id,action FROM atlas_list_changes WHERE id = ?').bind(d.draftId).first();
 if(!saved)return stale();
 return {status:200,listsOpen:true,listsSaved:saved,text:`Efendim, onayladığınız liste değişikliği uygulandı: ${s.title}.`,...await readLists(env,now,requestId)};
}
export async function listsRequest(body,env,now=new Date(),requestId=''){
 const latest=Array.isArray(body?.messages)?body.messages.filter(m=>m?.role==='user').at(-1):null,text=typeof latest?.text==='string'?latest.text:'';
 const parsed=listsCommand(text),draft=Object.hasOwn(body||{},'listsDraftRequest'),confirmation=Object.hasOwn(body||{},'listsConfirmation');
 if(!parsed&&!draft&&!confirmation)return null;
 if(draft&&confirmation)return fail('Efendim, taslak hazırlama ve onay ayrı işlemler olmalı. Değişiklik yapılmadı.');
 if(!env?.MEMORY_DB)return unavailable();
 try{
  if(confirmation||parsed?.action==='confirm')return await confirm(body,env,now,text,requestId);
  if(draft)return await preview(env,body.listsDraftRequest,now);
  if(parsed.action==='draft')return await preview(env,parsed.input,now);
  const snapshot=await readLists(env,now,requestId);if(snapshot.error)return snapshot;
  let shown=(parsed.archived?snapshot.archivedListItems:snapshot.listItems).filter(r=>r.kind===parsed.kind);
  if(parsed.listTitle){shown=shown.filter(r=>normalize(r.title)===normalize(parsed.listTitle));if(shown.length!==1)return fail(shown.length?'Efendim, aynı adlı birden fazla liste var. Bölümden birini seçin.':'Efendim, bu adda açık bir liste veya proje bulunamadı.',shown.length?409:404);}
  const summary=shown.length?shown.slice(0,5).map(r=>`${r.title}: ${r.progress.done}/${r.progress.total} tamamlandı${parsed.listTitle&&r.items.some(i=>!i.archived)?'; '+r.items.filter(i=>!i.archived).slice(0,10).map(i=>`${i.quantity?i.quantity+' ':''}${i.title}${i.done?' (tamamlandı)':''}`).join(', '):''}`).join('. '):'Henüz kayıt yok';
  return {status:200,...snapshot,listsOpen:true,listsView:parsed.kind,...(parsed.listTitle?{selectedListId:shown[0].id}:{}),text:`Efendim, ${summary}.`};
 }catch(error){reportError({stage:'lists.request',requestId,error,meta:{table:'atlas_lists'}});return unavailable();}
}
