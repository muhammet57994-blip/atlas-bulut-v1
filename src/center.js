const commands=new Set(['merkezimi aç','kişisel merkezimi aç','bana durum özeti ver','bugün neye odaklanayım']);
export function centerCommand(text){return typeof text==='string'&&commands.has(text.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim());}
const dayInIstanbul=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const brief=value=>value.length>65?value.slice(0,64)+'…':value;
const dateLabel=(date,day)=>!date?'tarihsiz':date<day?'gecikmiş':date===day?'bugün':'gelecek: '+date;

// This dashboard reads saved records only; it never calls a model or modifies them.
export async function centerSnapshot(env,now=new Date()){
 if(!env?.MEMORY_DB)return {status:503,text:'Efendim, ortak kayıt deposu hazır değil.'};
 const db=env.MEMORY_DB,day=dayInIstanbul(now);
 const counts=await db.prepare(`SELECT
  (SELECT COUNT(*) FROM atlas_tasks WHERE done=0) AS openTasks,
  (SELECT COUNT(*) FROM atlas_tasks WHERE done=0 AND due_date<>'' AND due_date<?) AS overdueTasks,
  (SELECT COUNT(*) FROM atlas_notes WHERE archived_at IS NULL) AS notes,
  (SELECT COUNT(*) FROM atlas_memories) AS memories,
  (SELECT COUNT(*) FROM atlas_plans) AS plans,
  (SELECT COUNT(*) FROM atlas_routines) AS routines`).bind(day).first();
 const priorities=(await db.prepare(`SELECT id,title,due_date FROM atlas_tasks WHERE done=0
  ORDER BY CASE WHEN due_date<>'' AND due_date<? THEN 0 WHEN due_date=? THEN 1 WHEN due_date='' THEN 2 ELSE 3 END,
  due_date ASC,id ASC LIMIT 3`).bind(day,day).all()).results;
 const routines=(await db.prepare('SELECT id,trigger,topic FROM atlas_routines ORDER BY id DESC LIMIT 6').all()).results;
 const recentPlans=(await db.prepare('SELECT id,title,plan_day FROM atlas_plans ORDER BY created_at DESC,id DESC LIMIT 3').all()).results;
 const text=`Efendim, ${counts.openTasks} açık görev; ${counts.overdueTasks} gecikmiş. ${counts.notes} not, ${counts.memories} hafıza, ${counts.plans} plan ve ${counts.routines} rutin kayıtlı. `+
  (priorities.length?'Tarihe göre ilk '+priorities.length+': '+priorities.map(t=>`${brief(t.title)} (${dateLabel(t.due_date,day)})`).join('; ')+'. ':'Açık görev yok. ')+
  'Özet kayıtlarınıza dayanır; yapay zekâ modeli çağrılmadı.';
 return {status:200,text,center:{day,counts:{...counts},priorities,routines,recentPlans,source:'saved_records',modelCalled:false}};
}
