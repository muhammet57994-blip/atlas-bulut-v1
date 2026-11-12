import {dayInIstanbul} from './tasks.js';
import {reportError} from './log.js';
import {signDraft,verifyDraft} from './daily-signing.js';
import {readContext} from './command-context.js';

const CONFIRM = 'Odağı onaylıyorum';
const LIMIT = 200;
const FIELDS = 'id,title,task_id,planned_seconds,elapsed_seconds,status,started_at_ms,started_day,last_started_at_ms,finished_at_ms,revision';
const unavailable = () => ({status:503,error:'Ortak odak deposu henüz hazır değil. İşlem yapılmadı.'});
const conflict = () => ({status:409,error:'Odak oturumu değişmiş. Durumu yenileyip yeni bir önizleme hazırlayın; işlem yapılmadı.'});
const integer = value => Number.isSafeInteger(value) && value > 0;
const normalize = value => value.normalize('NFC').trim().replace(/[.!?]+$/u,'').trim().toLocaleLowerCase('tr-TR');
const ordinals = {ilk:1,birinci:1,ikinci:2,'üçüncü':3,'dördüncü':4,'beşinci':5};
const latestText = body => {
 const message = Array.isArray(body?.messages) ? body.messages.at(-1) : null;
 return message?.role === 'user' && typeof message.text === 'string' ? message.text : '';
};

export function focusCommand(input) {
 if(typeof input !== 'string' || input.length > 300) return null;
 const text = normalize(input);
 if(text === 'odağı onaylıyorum') return {action:'confirm'};
 if(/^(odak durumum|odak durumumu göster|bugünkü odak sürem)$/u.test(text)) return {action:'status'};
 if(/^(odağı duraklat|odaklanmayı duraklat)$/u.test(text)) return {action:'pause'};
 if(/^odağa devam et$/u.test(text)) return {action:'resume'};
 if(/^(odağı bitir|odaklanmayı bitir)$/u.test(text)) return {action:'finish'};
 if(text === 'odak modunu aç') return {action:'open'};
 const ordinal = text.match(/^(ilk|birinci|ikinci|üçüncü|dördüncü|beşinci)\s+(?:iş|görev)\s+için\s*(\d+)\s*dakika\s+(?:odaklan|çalışmaya başlayalım|başlat)$/u);
 if(ordinal) return {action:'start',minutes:Number(ordinal[2]),index:ordinals[ordinal[1]]};
 const start = text.match(/^(?:görev\s+(\d+)\s+için\s*)?(\d+)\s*dakika\s+(?:odaklan|çalışmaya başlayalım|başlat)$/u);
 if(start) return {action:'start',minutes:Number(start[2]),...(start[1] ? {taskId:Number(start[1])} : {})};
 if(/(?:iş|görev)\s+için\s*\d+\s*dakika(?:\s+(?:odaklan|çalışmaya başlayalım|başlat))?$/u.test(text)) return {action:'chooseTask'};
 return null;
}

function sessionView(row,now) {
 if(!row) return null;
 const extra = row.status === 'running' ? Math.max(0,Math.floor((now.getTime()-row.last_started_at_ms)/1000)) : 0;
 const elapsed = Math.min(row.planned_seconds,row.elapsed_seconds+extra);
 return {...row,elapsed_seconds:elapsed,remaining_seconds:row.planned_seconds-elapsed,expired:row.status !== 'finished' && elapsed >= row.planned_seconds};
}

async function snapshot(db,now) {
 const rows = (await db.prepare(`SELECT ${FIELDS} FROM atlas_focus_sessions ORDER BY id DESC LIMIT ${LIMIT}`).all()).results;
 const focusDay = dayInIstanbul(now);
 const current = rows.find(row => row.status !== 'finished') || rows[0] || null;
 return {
  focusSession:sessionView(current,now),
  focusTodaySeconds:rows.filter(row => row.started_day === focusDay).reduce((total,row) => total+sessionView(row,now).elapsed_seconds,0),
  focusTodayLabel:'Bugün başlayan oturumlar',focusDay,focusAvailable:true
 };
}

export async function focusSnapshot(env,now=new Date(),requestId='') {
 if(!env?.MEMORY_DB) return {focusSession:null,focusTodaySeconds:0,focusTodayLabel:'Bugün başlayan oturumlar',focusDay:dayInIstanbul(now),focusAvailable:false};
 try { return await snapshot(env.MEMORY_DB,now); }
 catch(error) { reportError({stage:'db.focus.read',requestId,error,meta:{table:'atlas_focus_sessions'}}); return {focusSession:null,focusTodaySeconds:0,focusTodayLabel:'Bugün başlayan oturumlar',focusDay:dayInIstanbul(now),focusAvailable:false}; }
}

function statusText(state) {
 const session = state.focusSession;
 const total = `Bugün İstanbul tarihine göre başlayan oturumlarda ${Math.floor(state.focusTodaySeconds/60)} dakika ${state.focusTodaySeconds%60} saniye odak kaydı var.`;
 if(!session) return `Efendim, henüz odak oturumunuz yok. ${total}`;
 const status = session.status === 'finished' ? 'tamamlandı' : session.expired ? 'süresi doldu; bitirmek için onay bekliyor' : session.status === 'paused' ? 'duraklatıldı' : 'sürüyor';
 return `Efendim, “${session.title}” ${status}. ${Math.floor(session.elapsed_seconds/60)} dakika ${session.elapsed_seconds%60} saniye / ${session.planned_seconds/60} dakika. ${total}`;
}

async function makeDraft(request,env,now,expectedTask=null) {
 const db = env.MEMORY_DB;
 const action = request?.action;
 if(!['start','pause','resume','finish'].includes(action)) return {status:400,error:'Geçerli bir odak işlemi seçin.'};
 const active = await db.prepare(`SELECT ${FIELDS} FROM atlas_focus_sessions WHERE status IN ('running','paused') LIMIT 1`).first();
 const operationId = crypto.randomUUID();
 let data,text,title,safe;
 if(action === 'start') {
  if(!Number.isSafeInteger(request.minutes) || request.minutes < 5 || request.minutes > 180) return {status:400,error:'Odak süresi 5–180 arasında tam dakika olmalı.'};
  if(active) return {status:409,error:'Açık bir odak oturumu var. Önce onu bitirmek için onay verin.',...await snapshot(db,now)};
  const count = await db.prepare('SELECT COUNT(*) AS n FROM atlas_focus_sessions').first();
  if(count.n >= LIMIT) return {status:409,error:'200 odak oturumu sınırına ulaşıldı. Yeni kayıt yapılmadı; geçmişiniz korunuyor.'};
  let task = null;
  if(request.taskId !== undefined && request.taskId !== null) {
   if(!integer(request.taskId)) return {status:400,error:'Görevi Yapılacaklar bölümündeki numarasıyla seçin.'};
   task = await db.prepare('SELECT id,title,due_date,done,recurrence,completed_at FROM atlas_tasks WHERE id=? AND done=0').bind(request.taskId).first();
   if(expectedTask && (!task || ['id','title','due_date','done','recurrence','completed_at'].some(field => task[field] !== expectedTask[field]))) return {status:409,error:'Bu iş son okunan listeden sonra değişmiş. “İşlerimi oku” deyip yeniden seçin; odak başlamadı.'};
   if(!task) return {status:409,error:'Seçilen açık görev bulunamadı. Yapılacaklar bölümünden açık bir görev seçin.'};
  }
  if(request.title !== undefined && (typeof request.title !== 'string' || !request.title.trim() || request.title.trim().length > 200)) return {status:400,error:'Odak başlığı 1–200 karakter olmalı.'};
  title = task ? task.title : request.title?.trim() || 'Serbest odak';
  data = {operationId,action,minutes:request.minutes,title,task};
  safe = {action,minutes:request.minutes,taskId:task?.id ?? null};
  text = `Efendim, “${title}” için ${request.minutes} dakika odak başlatma önizlemesi. Sayaç onay verdiğiniz anda başlayacak. Henüz oturum başlamadı. “${CONFIRM}” diyerek onaylayın. Görev tamamlanmış sayılmaz.`;
 } else {
  if(!active) return {status:409,error:'Açık odak oturumu yok. Önce bir odak başlatma önizlemesi hazırlayın.'};
  if(request.id !== undefined && (!integer(request.id) || request.id !== active.id)) return conflict();
  if(request.revision !== undefined && (!integer(request.revision) || request.revision !== active.revision)) return conflict();
  // Structured controls always carry their observed version; spoken commands resolve the current row here.
  if(request.structured && (!integer(request.id) || !integer(request.revision))) return {status:400,error:'Odak durumunu yenileyip işlemi tekrar seçin.'};
  if(action === 'pause' && active.status !== 'running' || action === 'resume' && active.status !== 'paused') return conflict();
  if(action === 'resume' && sessionView(active,now).expired) return {status:409,error:'Odak süresi doldu. “Odağı bitir” diyerek bitirme önizlemesini onaylayın.'};
  title = active.title;
  data = {operationId,action,expected:active};
  safe = {action,id:active.id,revision:active.revision,minutes:active.planned_seconds/60,taskId:active.task_id};
  const verb = {pause:'duraklatma',resume:'devam etme',finish:'bitirme'}[action];
  text = `Efendim, “${title}” odak oturumu için ${verb} önizlemesi. ${action === 'resume' ? 'Sayaç onay anında devam edecek.' : 'Toplam odak süresi onay anına kadar, planlanan süreyi aşmadan hesaplanacak.'} Henüz değiştirilmedi. “${CONFIRM}” diyerek onaylayın. Görev tamamlanmış sayılmaz.`;
 }
 const token = await signDraft(env,'focus',data,now);
 return {status:200,text,focusDraft:{kind:'focus',title,text,token,...safe},...await snapshot(db,now)};
}

async function confirm(body,env,now) {
 const confirmation = body.focusConfirmation;
 if(normalize(latestText(body)) !== normalize(CONFIRM) || confirmation?.confirmed !== true || typeof confirmation.token !== 'string') return {status:400,error:'Ekrandaki odak önizlemesini açıp “Odağı onaylıyorum” diyerek açıkça onaylayın.'};
 let data;
 try { data = await verifyDraft(env,confirmation.token,'focus',now); }
 catch(error) { return {status:error?.status === 409 || error?.code === 'expired' ? 409 : 400,error:'Odak önizlemesi doğrulanamadı veya süresi doldu. Yeniden hazırlayın; işlem yapılmadı.'}; }
 if(!data || typeof data.operationId !== 'string' || !['start','pause','resume','finish'].includes(data.action)) return {status:400,error:'Odak önizlemesi geçersiz; işlem yapılmadı.'};
 const db = env.MEMORY_DB;
 const previous = await db.prepare('SELECT id FROM atlas_focus_sessions WHERE draft_id=? OR last_operation_id=? LIMIT 1').bind(data.operationId,data.operationId).first();
 if(previous) return {status:200,text:'Efendim, bu onay daha önce uygulandı. Odak oturumu yeniden değiştirilmedi.',...await snapshot(db,now)};
 let result;
 if(data.action === 'start') {
  if(!Number.isSafeInteger(data.minutes) || data.minutes < 5 || data.minutes > 180 || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200) return {status:400,error:'Odak önizlemesi geçersiz; işlem yapılmadı.'};
  const task = data.task;
  const taskGuard = task ? ' AND EXISTS (SELECT 1 FROM atlas_tasks WHERE id=? AND title=? AND due_date=? AND done=0 AND recurrence=? AND completed_at=?)' : '';
  const args = [data.operationId,data.title,task?.id ?? null,data.minutes*60,now.getTime(),dayInIstanbul(now),now.getTime(),data.operationId];
  if(task) args.push(task.id,task.title,task.due_date,task.recurrence,task.completed_at);
  result = await db.prepare(`INSERT OR IGNORE INTO atlas_focus_sessions(draft_id,title,task_id,planned_seconds,status,started_at_ms,started_day,last_started_at_ms,last_operation_id) SELECT ?,?,?,?,'running',?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_focus_sessions) < ${LIMIT} AND NOT EXISTS (SELECT 1 FROM atlas_focus_sessions WHERE status IN ('running','paused'))${taskGuard}`).bind(...args).run();
 } else {
  const expected = data.expected;
  if(!expected || !integer(expected.id) || !integer(expected.revision) || !['running','paused'].includes(expected.status)) return {status:400,error:'Odak önizlemesi geçersiz; işlem yapılmadı.'};
  if(data.action === 'pause' && expected.status !== 'running' || data.action === 'resume' && expected.status !== 'paused') return conflict();
  const view = sessionView(expected,now);
  if(data.action === 'resume' && view.expired) return {status:409,error:'Odak süresi doldu. “Odağı bitir” diyerek bitirme önizlemesini onaylayın.'};
  const status = {pause:'paused',resume:'running',finish:'finished'}[data.action];
  result = await db.prepare(`UPDATE atlas_focus_sessions SET status=?,elapsed_seconds=?,last_started_at_ms=?,finished_at_ms=?,revision=revision+1,last_operation_id=? WHERE id=? AND revision=? AND status=? AND task_id IS ? AND title=? AND planned_seconds=? AND elapsed_seconds=? AND started_at_ms=? AND started_day=? AND last_started_at_ms IS ? AND finished_at_ms IS ?`).bind(status,view.elapsed_seconds,status === 'running' ? now.getTime() : null,status === 'finished' ? now.getTime() : null,data.operationId,expected.id,expected.revision,expected.status,expected.task_id,expected.title,expected.planned_seconds,expected.elapsed_seconds,expected.started_at_ms,expected.started_day,expected.last_started_at_ms,expected.finished_at_ms).run();
 }
 if(!result.meta.changes) {
  const replay = await db.prepare('SELECT id FROM atlas_focus_sessions WHERE draft_id=? OR last_operation_id=? LIMIT 1').bind(data.operationId,data.operationId).first();
  if(replay) return {status:200,text:'Efendim, bu onay daha önce uygulandı. Odak oturumu yeniden değiştirilmedi.',...await snapshot(db,now)};
  return {...conflict(),...await snapshot(db,now)};
 }
 const verb = {start:'başladı',pause:'duraklatıldı',resume:'devam ediyor',finish:'bitirildi'}[data.action];
 return {status:200,text:`Efendim, odak oturumunuz ${verb}. Görev durumu değiştirilmedi.`,...await snapshot(db,now)};
}

export async function focusRequest(body,env,now=new Date(),requestId='') {
 const text = latestText(body);
 const parsed = focusCommand(text);
 const hasDraft = Object.hasOwn(body || {},'focusDraftRequest');
 const hasConfirmation = Object.hasOwn(body || {},'focusConfirmation');
 if(!hasDraft && !hasConfirmation && !parsed) return null;
 if(!env?.MEMORY_DB) return unavailable();
 if(hasDraft && hasConfirmation) return {status:400,error:'Önce tek bir odak işlemini önizleyin, sonra ayrı bir adımda onaylayın.'};
 try {
  if(hasConfirmation) return await confirm(body,env,now);
  if(hasDraft) {
   const request = body.focusDraftRequest;
   if(!request || typeof request !== 'object' || Array.isArray(request)) return {status:400,error:'Geçerli bir odak işlemi seçin.'};
   return await makeDraft({...request,structured:true},env,now);
  }
  if(parsed.action === 'confirm') return {status:400,error:'Onaylanacak odak önizlemesi yok. Önce bir odak işlemi seçin.'};
  if(parsed.action === 'chooseTask') return {status:400,error:'Önce “İşlerimi oku” deyin, ardından listedeki işi ve odak süresini söyleyin. Yapılacaklar bölümünden de seçebilirsiniz.'};
  if(parsed.action === 'open') { const state = await snapshot(env.MEMORY_DB,now); return {status:200,...state,focusOpen:true,text:statusText(state)}; }
  if(parsed.action === 'status') { const state = await snapshot(env.MEMORY_DB,now); return {status:200,...state,text:statusText(state)}; }
  if(parsed.index) {
   const context = await readContext(body.taskContext,env,now);
   if(!context) return {status:body.taskContext ? 409 : 400,error:'İş sırasını doğrulayamadım. Önce “İşlerimi oku” deyip güncel listeden yeniden seçin; odak başlamadı.'};
   const target = Array.isArray(context.rows) ? context.rows[parsed.index-1] : null;
   if(!target || !integer(target.id) || target.done !== 0) return {status:400,error:'Son okunan listede bu sırada açık bir iş yok. “İşlerimi oku” deyip yeniden seçin; odak başlamadı.'};
   return await makeDraft({...parsed,taskId:target.id},env,now,target);
  }
  return await makeDraft(parsed,env,now);
 } catch(error) { reportError({stage:'focus.request',requestId,error}); return unavailable(); }
}
