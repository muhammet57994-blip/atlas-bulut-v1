import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';

const CONFIRM='Gün planını onaylıyorum',MAX_BLOCKS=10,MINUTE=60000,DAY=86400000;
const defaults=now=>({targetDate:dayInIstanbul(now),startTime:'09:00',endTime:'18:00',defaultMinutes:30});
const normalize=text=>text.normalize('NFC').trim().replace(/[.!?]+$/u,'').trim().toLocaleLowerCase('tr-TR');
const latestText=body=>{const message=Array.isArray(body?.messages)?body.messages.at(-1):null;return message?.role==='user'&&typeof message.text==='string'?message.text:'';};
const fail=(text,status=400)=>({status,error:text,text,replanOpen:true});
const unavailable=()=>fail('Efendim, ortak gün planı deposu henüz hazır değil. İşlem yapılmadı.',503);
const stale=()=>fail('Efendim, işleriniz, ajandanız veya önerilen saat değişmiş. Yeni bir gün planı hazırlayıp yeniden onaylayın; hiçbir kayıt değiştirilmedi.',409);
const integer=value=>Number.isSafeInteger(value)&&value>0;
const validMinutes=value=>Number.isInteger(value)&&value>=1&&value<=480;
const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
const stamp=(date,time)=>Date.parse(`${date}T${time}:00+03:00`);
const timeOf=ms=>new Date(ms+10800000).toISOString().slice(11,16);
const dateOf=ms=>new Date(ms+10800000).toISOString().slice(0,10);
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value)||value<'2000-01-01'||value>'2100-12-31')return false;
 const parsed=Date.parse(value+'T12:00:00Z');return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
}
export function replanCommand(input){
 if(typeof input!=='string'||input.length>300)return null;
 const text=normalize(input);
 if(text===normalize(CONFIRM))return {action:'confirm'};
 if(/^(günümü toparla|kalan işlerimi düzenle|bugün bir saat geciktim,? kalan işlerimi düzenle)$/u.test(text))return {action:'draft'};
 if(/^(gün planımı aç|günümü toparla bölümünü aç)$/u.test(text))return {action:'open'};
 return null;
}

async function readState(db){
 // Equal epochs surround the reads, so the hash describes one coherent state.
 for(let attempt=0;attempt<3;attempt++){
  const before=await db.prepare('SELECT epoch FROM atlas_replan_state WHERE id=1').first();
  if(!before)throw Error('missing replan state');
  const tasks=(await db.prepare('SELECT * FROM atlas_tasks ORDER BY id').all()).results;
  const agenda=(await db.prepare('SELECT * FROM atlas_agenda ORDER BY id').all()).results;
  const after=await db.prepare('SELECT epoch FROM atlas_replan_state WHERE id=1').first();
  if(before.epoch===after?.epoch){
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({tasks,agenda})))),byte=>byte.toString(16).padStart(2,'0')).join('');
   return {epoch:before.epoch,hash,tasks,agenda};
  }
 }
 throw Error('state changing');
}
const eligible=(state,date)=>state.tasks.filter(task=>task.done===0&&(!task.due_date||task.due_date<=date)).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')||a.id-b.id);
const viewRow=row=>({...row,date:dateOf(row.starts_at),time:timeOf(row.starts_at),endDate:dateOf(row.ends_at),endTime:timeOf(row.ends_at),durationMinutes:(row.ends_at-row.starts_at)/MINUTE});
function publicState(state,now,date=dayInIstanbul(now)){
 return {replanAvailable:true,replanDate:dayInIstanbul(now),replanDefaults:{...defaults(now),targetDate:date},replanTasks:eligible(state,date),replanBlocks:state.agenda.filter(row=>row.task_id!==null&&row.archived_at===null).map(viewRow),replanLimit:MAX_BLOCKS};
}
export async function readReplan(env,now=new Date(),requestId=''){
 const empty={replanAvailable:false,replanDate:Number.isFinite(now.getTime())?dayInIstanbul(now):null,replanTasks:[],replanBlocks:[],replanLimit:MAX_BLOCKS};
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return {...unavailable(),...empty};
 try{return publicState(await readState(env.MEMORY_DB),now);}catch(error){reportError({stage:'db.replan.read',requestId,error,meta:{table:'atlas_agenda'}});return {...unavailable(),...empty};}
}
function validateRequest(input,now){
 if(!input||typeof input!=='object'||Array.isArray(input))return fail('Efendim, geçerli bir gün planı seçin.');
 const request={...defaults(now),...input};
 if(!validDate(request.targetDate)||request.targetDate<dayInIstanbul(now))return fail('Efendim, bugünü veya ileri bir tarihi açıkça seçin (2000–2100).');
 if(!validTime(request.startTime)||!validTime(request.endTime)||request.startTime===request.endTime)return fail('Efendim, farklı başlangıç ve bitiş saatleri seçin; saatler 00:00–23:59 arasında olmalı.');
 if(!validMinutes(request.defaultMinutes))return fail('Efendim, varsayılan iş süresi 1–480 arasında tam dakika olmalı.');
 if(input.taskIds!==undefined&&(!Array.isArray(input.taskIds)||input.taskIds.length<1||input.taskIds.length>MAX_BLOCKS||!input.taskIds.every(integer)||new Set(input.taskIds).size!==input.taskIds.length))return fail('Efendim, 1–10 farklı açık işi numarasıyla seçin.');
 if(input.durations!==undefined&&(!input.durations||typeof input.durations!=='object'||Array.isArray(input.durations)||Object.keys(input.durations).length>MAX_BLOCKS||Object.entries(input.durations).some(([id,minutes])=>!/^\d+$/u.test(id)||!integer(Number(id))||String(Number(id))!==id||!validMinutes(minutes))))return fail('Efendim, seçilen işlerin süreleri 1–480 arasında tam dakika olmalı.');
 const windowStart=stamp(request.targetDate,request.startTime),windowEnd=stamp(request.targetDate,request.endTime)+(request.endTime<request.startTime?DAY:0);
 if(dateOf(windowEnd)>'2100-12-31')return fail('Efendim, planın bitiş tarihi 2100 yılını aşamaz.');
 // The next whole minute gives an explicit future start. Confirmation checks it again.
 const earliest=Math.max(windowStart,Math.floor(now.getTime()/MINUTE)*MINUTE+MINUTE);
 if(earliest>=windowEnd)return fail('Efendim, seçilen çalışma aralığı bugün bitti. Yeni bir bitiş saati veya günü açıkça seçin; planı kendiliğimden yarına taşımadım.',409);
 return {...request,windowStart,windowEnd,earliest,durations:input.durations||{}};
}
function freeStart(busy,earliest,end,duration){
 let cursor=earliest;
 for(const item of busy.slice().sort((a,b)=>a.starts_at-b.starts_at||a.ends_at-b.ends_at)){
  if(item.ends_at<=cursor)continue;
  if(cursor+duration<=item.starts_at)break;
  if(item.starts_at<cursor+duration)cursor=item.ends_at;
 }
 return cursor+duration<=end?cursor:null;
}
function arrange(state,selected,request){
 const linked=new Map(state.agenda.filter(row=>row.task_id!==null&&row.archived_at===null).map(row=>[row.task_id,row]));
 const selectedIds=new Set(selected.map(task=>task.id)),locked=new Set();
 let result;
 // An unscheduled task keeps its old block. Re-run with that block fixed so it
 // cannot overlap work placed into a temporarily released slot.
 for(let iteration=0;iteration<=MAX_BLOCKS;iteration++){
  const busy=state.agenda.filter(row=>row.archived_at===null&&(!selectedIds.has(row.task_id)||locked.has(row.task_id)));
  const blocks=[],unscheduled=[];let additions=0;
  for(const task of selected){
   const existing=linked.get(task.id),durationMinutes=request.durations[task.id]??request.defaultMinutes;
   const reason=locked.has(task.id)?'Eski iş bloğu korunuyor; yeni süre için boşluk bulunamadı.':!existing&&state.agenda.length+additions>=200?'Ajandanın 200 kayıt sınırı dolu.':null;
   const starts_at=reason?null:freeStart(busy,request.earliest,request.windowEnd,durationMinutes*MINUTE);
   if(starts_at===null){unscheduled.push({taskId:task.id,title:task.title,durationMinutes,reason:reason||'Seçilen aralıkta kesintisiz boş zaman yok.'});continue;}
   const block={taskId:task.id,title:task.title,starts_at,ends_at:starts_at+durationMinutes*MINUTE,durationMinutes,agendaId:existing?.id??null,previous:existing?{starts_at:existing.starts_at,ends_at:existing.ends_at,date:dateOf(existing.starts_at),time:timeOf(existing.starts_at),endDate:dateOf(existing.ends_at),endTime:timeOf(existing.ends_at)}:null};
   blocks.push({...block,date:dateOf(block.starts_at),time:timeOf(block.starts_at),endDate:dateOf(block.ends_at),endTime:timeOf(block.ends_at)});busy.push(block);if(!existing)additions++;
  }
  result={blocks,unscheduled};
  const newlyLocked=unscheduled.filter(item=>linked.has(item.taskId)&&!locked.has(item.taskId));
  if(!newlyLocked.length)break;
  for(const item of newlyLocked)locked.add(item.taskId);
 }
 return result;
}
async function makeDraft(input,env,now){
 const request=validateRequest(input,now);if(request.error)return request;
 const state=await readState(env.MEMORY_DB),candidates=eligible(state,request.targetDate);
 const selected=request.taskIds?request.taskIds.map(id=>candidates.find(task=>task.id===id)):candidates.slice(0,MAX_BLOCKS);
 if(selected.some(task=>!task))return {...fail('Efendim, seçilen iş değişmiş, tamamlanmış veya daha ileri tarihli. Listeyi yenileyip açık işleri yeniden seçin.',409),...publicState(state,now,request.targetDate)};
 const selectedIds=new Set(selected.map(task=>task.id));
 if(Object.keys(request.durations).some(id=>!selectedIds.has(Number(id))))return fail('Efendim, özel süreleri yalnızca seçilen işler için girin.');
 const {blocks,unscheduled}=arrange(state,selected,request);
 if(!request.taskIds)for(const task of candidates.slice(MAX_BLOCKS))unscheduled.push({taskId:task.id,title:task.title,durationMinutes:request.defaultMinutes,reason:'Bir önizlemede en fazla 10 iş seçilir; bu iş seçilmedi.'});
 const shared={...publicState(state,now,request.targetDate),replanOpen:true,replanUnscheduled:unscheduled};
 if(!blocks.length)return {status:200,...shared,replanDraft:null,text:selected.length?'Efendim, seçilen işler için uygun boşluk bulunamadı. Mevcut kayıtlar korunuyor. Süreleri, çalışma aralığını veya günü açıkça değiştirip yeniden deneyin.':'Efendim, seçilen gün için açık, gecikmiş veya tarihsiz işiniz yok. Henüz bir plan kaydedilmedi.'};
 const operationId=crypto.randomUUID(),endDate=dateOf(request.windowEnd);
 const data={operationId,epoch:state.epoch,snapshotHash:state.hash,targetDate:request.targetDate,startTime:request.startTime,endTime:request.endTime,defaultMinutes:request.defaultMinutes,windowStart:request.windowStart,windowEnd:request.windowEnd,blocks};
 const token=await signDraft(env,'replan',data,now);
 const text=`Efendim, ${request.targetDate} ${request.startTime}–${endDate!==request.targetDate?endDate+' ':''}${request.endTime} (İstanbul) aralığında ${blocks.length} iş için gün planı önizlemesi hazır. Varsayılan süre ${request.defaultMinutes} dakika; iş sürelerini değiştirebilirsiniz. Mevcut randevular sabit kalır.${blocks.some(block=>block.previous)?' Seçilen eski iş bloklarının yeni saatleri aşağıda gösteriliyor.':''}${unscheduled.length?' '+unscheduled.length+' iş yerleştirilemedi; listede nedenleri yazıyor.':''} Henüz kaydedilmedi. “${CONFIRM}” diyerek onaylayın.`;
 return {status:200,...shared,text,replanDraft:{kind:'replan',token,title:'Günümü toparla',text,targetDate:request.targetDate,startTime:request.startTime,endTime:request.endTime,endDate,defaultMinutes:request.defaultMinutes,selectedTaskIds:[...selectedIds],blocks,unscheduled}};
}
function validDraft(data){
 if(!data||typeof data.operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/u.test(data.operationId)||!Number.isSafeInteger(data.epoch)||data.epoch<0||typeof data.snapshotHash!=='string'||!/^[a-f\d]{64}$/u.test(data.snapshotHash)||!validDate(data.targetDate)||!validTime(data.startTime)||!validTime(data.endTime)||data.startTime===data.endTime||!validMinutes(data.defaultMinutes)||!Array.isArray(data.blocks)||data.blocks.length<1||data.blocks.length>MAX_BLOCKS)return false;
 if(data.windowStart!==stamp(data.targetDate,data.startTime)||data.windowEnd!==stamp(data.targetDate,data.endTime)+(data.endTime<data.startTime?DAY:0)||dateOf(data.windowEnd)>'2100-12-31')return false;
 if(new Set(data.blocks.map(block=>block?.taskId)).size!==data.blocks.length)return false;
 return data.blocks.every(block=>block&&integer(block.taskId)&&typeof block.title==='string'&&block.title.trim().length>0&&block.title.length<=200&&validMinutes(block.durationMinutes)&&Number.isSafeInteger(block.starts_at)&&Number.isSafeInteger(block.ends_at)&&block.starts_at>=data.windowStart&&block.ends_at<=data.windowEnd&&block.ends_at-block.starts_at===block.durationMinutes*MINUTE&&(block.agendaId===null||integer(block.agendaId)));
}
async function confirm(body,env,now,requestId=''){
 const requestStarted=Date.now();
 const approval=body.replanConfirmation;
 if(normalize(latestText(body))!==normalize(CONFIRM)||approval?.confirmed!==true||typeof approval.token!=='string')return fail('Efendim, ekrandaki gün planını kontrol edip “Gün planını onaylıyorum” diyerek açıkça onaylayın.');
 let data;try{data=await verifyDraft(env,approval.token,'replan',now);if(!validDraft(data))throw Error();}catch{return fail('Efendim, gün planı doğrulanamadı veya onay süresi doldu. Yeni bir önizleme hazırlayın; işlem yapılmadı.',409);}
 const db=env.MEMORY_DB;
 const receipt=()=>db.prepare('SELECT id FROM atlas_replan_receipts WHERE id=?').bind(data.operationId).first();
 const replay=async()=>({status:200,replanOpen:true,replanSaved:{operationId:data.operationId,count:data.blocks.length,replayed:true},text:'Efendim, bu gün planı daha önce kaydedildi. İkinci kez uygulanmadı.',...await readReplan(env,now,requestId)});
 if(await receipt())return replay();
 if(data.blocks.some(block=>block.starts_at<=now.getTime()))return stale();
 const state=await readState(db);
 if(data.epoch!==state.epoch||data.snapshotHash!==state.hash)return {...stale(),...publicState(state,now)};
 const approvedAt=new Date(now.getTime()+Math.max(0,Date.now()-requestStarted));
 if(data.blocks.some(block=>block.starts_at<=approvedAt.getTime()))return stale();
 try{
  // The trigger rechecks the epoch and every block under the same SQLite write
  // statement as all agenda updates/inserts. No check/write race or partial plan.
  const result=await db.prepare('INSERT INTO atlas_replan_receipts(id,expected_epoch,snapshot_hash,target_date,window_start_ms,window_end_ms,approved_at_ms,blocks_json,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM atlas_replan_receipts WHERE id=?)').bind(data.operationId,data.epoch,data.snapshotHash,data.targetDate,data.windowStart,data.windowEnd,approvedAt.getTime(),JSON.stringify(data.blocks),approvedAt.toISOString(),data.operationId).run();
  if(!result.meta.changes&&await receipt())return replay();
 }catch(error){
  if(await receipt())return replay();
  if(/replan receipt limit/u.test(String(error?.message)))return fail('Efendim, gün planı onay geçmişi 5000 kayıt sınırına ulaştı. Mevcut kayıtlar korunuyor; yeni plan uygulanmadı.',409);
  // A failed approval used to look like a stale draft with no trace; keep it
  // tied to the request instead of swallowing the database error.
  reportError({stage:'db.replan.approve',requestId,error,meta:{table:'atlas_replan_receipts'}});
  return stale();
 }
 if(!await receipt())return stale();
 return {status:200,replanOpen:true,replanSaved:{operationId:data.operationId,count:data.blocks.length,replayed:false},text:`Efendim, ${data.blocks.length} iş bloğu ajandanıza kaydedildi. Görevlerinizin tamamlanma durumu ve son tarihleri korunuyor.`,...await readReplan(env,now,requestId)};
}
export async function replanRequest(body,env,now=new Date(),requestId=''){
 const parsed=replanCommand(latestText(body)),hasDraft=Object.hasOwn(body||{},'replanDraftRequest'),hasConfirmation=Object.hasOwn(body||{},'replanConfirmation');
 if(!parsed&&!hasDraft&&!hasConfirmation)return null;
 if(hasDraft&&hasConfirmation)return fail('Efendim, gün planını hazırlama ve onaylama ayrı adımlar olmalı.');
 if(!env?.MEMORY_DB||!Number.isFinite(now.getTime()))return unavailable();
 try{
  if(hasConfirmation||parsed?.action==='confirm')return await confirm(body,env,now,requestId);
  if(hasDraft)return await makeDraft(body.replanDraftRequest,env,now);
  if(parsed.action==='open')return {status:200,...await readReplan(env,now,requestId),replanOpen:true,text:'Efendim, gün planı bölümünüz açık. İşleri, süreleri ve çalışma aralığını seçip önizlemeyi hazırlayabilirsiniz.'};
  return await makeDraft({},env,now);
 }catch(error){reportError({stage:'replan.request',requestId,error});return unavailable();}
}
