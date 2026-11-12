import {replanCommand} from './replan.js';
import {billsCommand} from './bills.js';
import {offlineCommand} from './offline.js';
import {budgetsCommand} from './budgets.js';
import {waitingCommand} from './waiting.js';
import {multiCommand} from './multi-actions.js';
import {sharedSearch,searchCommand} from './shared-search.js';
import {listTasks,taskCommand} from './tasks.js';
import {runPlanning,planningCommand} from './planning.js';
import {calendarCommand} from './calendar.js';
import {memoryCommand} from './memory.js';
import {noteCommand} from './notes.js';
import {naturalCommand} from './natural-commands.js';
import {centerCommand} from './center.js';
import {dailyCommand} from './daily-records.js';
import {focusCommand} from './focus.js';
import {managementCommand} from './record-management.js';
import {listsCommand} from './named-lists.js';
import {organizeCommand} from './organize.js';
import {backupCommand} from './backup.js';
const normalize=s=>s.normalize('NFC').trim().toLocaleLowerCase('tr-TR');
const command=s=>normalize(s).replace(/[.!?]+$/u,'').trim();
function reserved(s){return [multiCommand,budgetsCommand,waitingCommand,replanCommand,billsCommand,offlineCommand,managementCommand,listsCommand,organizeCommand,backupCommand,dailyCommand,focusCommand,centerCommand,planningCommand,taskCommand,calendarCommand,memoryCommand,noteCommand,searchCommand,naturalCommand].some(fn=>fn(s))||/^(?:hey atlas|atlas|vazgeç|iptal|evet|hayır|tamam|onaylıyorum|şuna birlikte bakalım|görsele bakalım|rutini onaylıyorum|rutinlerimi göster|nerede kalmıştık)(?:$|\s*:)|^(?:bu komutu öğren|[iı]nstagram|görsel|görünüm|ekran|panel|notlarım(?:ı)?|hafızam(?:ı)?|planlarım(?:ı)?|takvimim(?:i)?|görev|not|plan|hafıza)(?:\s|$)| projesine devam edelim$/u.test(command(s));}
const labels={records:'Konuya ait kayıtları oku',calendar:'Konuya ait içerik takvimini oku',day:'Gün planı taslağı hazırla',content:'Konunun ilk bekleyen içeriği için paket taslağı hazırla',review:'Haftalık değerlendirme taslağı hazırla'};
const enc=new TextEncoder(),b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(env){if(typeof env.SESSION_SECRET!=='string'||env.SESSION_SECRET.length<32)throw Error('config');return crypto.subtle.importKey('raw',enc.encode('atlas-routine-v1:'+env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function valid(d){return d&&typeof d.trigger==='string'&&d.trigger.trim().length>=2&&d.trigger.length<=120&&typeof d.topic==='string'&&d.topic.trim().length>=2&&d.topic.length<=100&&Array.isArray(d.steps)&&d.steps.length>0&&d.steps.length<=3&&new Set(d.steps).size===d.steps.length&&d.steps.every(s=>typeof s==='string'&&Object.hasOwn(labels,s))&&d.steps.filter(s=>['day','content','review'].includes(s)).length<=1;}
const fail=(text,status=400)=>({status,error:text,text});
function bounded(text,max=5900){if(text.length<=max)return text;const notice='\n… Gösterim kısaltıldı; ayrıntılar ekrandaki kaynaklarda veya taslakta.';return text.slice(0,max-notice.length)+notice;}
async function rows(db){return (await db.prepare('SELECT id,trigger,topic,steps,created_at FROM atlas_routines ORDER BY id DESC LIMIT 30').all()).results.map(r=>({...r,steps:JSON.parse(r.steps)}));}
async function calendar(db,topic){return (await db.prepare('SELECT id,title,due_date,format,published FROM atlas_content_calendar ORDER BY due_date,id LIMIT 100').all()).results.filter(r=>normalize(r.title).includes(normalize(topic)));}
async function resume(topic,env,now){
 if(typeof topic!=='string'||topic.trim().length<2||topic.length>100)return {status:200,resumeBuilder:true,topicSuggestions:[],text:'Efendim, hangi projeye devam edelim? Konuyu seçin veya “Nerede kalmıştık: AI Studio” gibi yazın.'};
 topic=topic.trim();const found=await sharedSearch({query:topic},env,now);if(found.status!==200)return found;
 const tasks=(await listTasks(env.MEMORY_DB)).filter(t=>normalize(t.title).includes(normalize(topic))).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id);
 const results=[...found.searchResults,...tasks.slice(0,8).map(t=>({source:'görev',id:t.id,date:t.due_date||'',created_at:t.created_at,excerpt:t.title+' — '+(t.done?'tamamlandı işaretli':'açık')+(t.due_date?' · '+t.due_date:''),done:t.done}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)||String(b.id).localeCompare(String(a.id)));
 const open=tasks.find(t=>!t.done),nextStep=open?`Önerim: açık Görev ${open.id} için “${open.title}” işini ele alalım. Bu yalnızca öneridir; görev değişmedi.`:results.length?'Önerim: aşağıdaki en güncel kaydı birlikte kontrol edip bir sonraki işi belirleyelim. Kayıtlarda doğrulanmış açık bir görev bulamadım.':'Önerim: son tamamladığınız işi ve sıradaki adımı kısa bir not olarak belirtin; kayıt olmadan ilerleme tahmin etmeyeyim.';
 return {status:200,resumeTopic:topic,searchResults:results,nextStep,text:bounded(`Efendim, “${topic}” için: ${nextStep}\nNotlar ve planlar kayıt anındaki bilgidir; bugünkü tamamlanma durumunu kanıtlamaz.\n\n`+(results.length?'En yeni eşleşmeler; gösterim en fazla 8 kayıt ve 8 görevle sınırlıdır. Kayıt tarihine göre yeniden eskiye:\n'+results.map(r=>`${r.source} ${r.id} · ${r.date||'tarih yok'}: ${r.excerpt}`).join('\n'):'Eşleşen kayıt bulunamadı.'))};
}
export async function companionRequest(body,env,upstream=fetch,now=new Date(),requestId=''){
 const last=body?.messages?.filter(m=>m.role==='user').at(-1),text=typeof last?.text==='string'?last.text:'',cmd=command(text);
 const teach=text.trim().replace(/[.!?]+$/u,'').match(/^bu komutu öğren(?:\s*:\s*|\s+)(.*)$/iu);
 const res=text.trim().replace(/[.!?]+$/u,'').match(/^nerede kalmıştık(?:\s*:\s*|\s+)(.*)$/iu)||text.trim().replace(/[.!?]+$/u,'').match(/^(.+?) projesine devam edelim$/iu);
 const intent=body?.routineConfirmation||body?.routineDraftRequest||teach||res||['rutinlerimi göster','rutini onaylıyorum','nerede kalmıştık','bu komutu öğren'].includes(cmd);
 if(!env.MEMORY_DB)return intent?fail('Efendim, ortak kayıt deposu hazır değil.',503):null;
 if(body?.routineConfirmation){
  const c=body.routineConfirmation;if(cmd!=='rutini onaylıyorum'||c.confirmed!==true||typeof c.token!=='string'||c.token.length>4000)return fail('Efendim, açık rutin taslağını “Rutini onaylıyorum” diyerek onaylayın.');
  let d;try{const p=c.token.split('.');if(p.length!==2||!await crypto.subtle.verify('HMAC',await key(env),unb64(p[1]),enc.encode(p[0])))throw Error();d=JSON.parse(new TextDecoder().decode(unb64(p[0])));if(!valid(d)||typeof d.id!=='string'||!Number.isFinite(d.expires))throw Error();}catch{return fail('Efendim, rutin taslağı doğrulanamadı; kaydedilmedi.');}
  if(d.expires<=now.getTime()||d.expires>now.getTime()+1800000)return fail('Efendim, rutin taslağının süresi doldu. Yeniden hazırlayın.',409);
  await env.MEMORY_DB.prepare('INSERT OR IGNORE INTO atlas_routines(draft_id,trigger,trigger_key,topic,steps,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_routines)<30').bind(d.id,d.trigger,command(d.trigger),d.topic,JSON.stringify(d.steps),now.toISOString()).run();
  const item=await env.MEMORY_DB.prepare('SELECT id,trigger FROM atlas_routines WHERE draft_id=?').bind(d.id).first();
  return item?{status:200,item,routineItems:await rows(env.MEMORY_DB),text:`Efendim, “${item.trigger}” rutininiz kaydedildi. Bu ifadeyi tek başına söylediğinizde çalışır. Plan taslakları ayrıca onay ister.`}:fail('Efendim, bu komut zaten kayıtlı veya 30 rutin sınırına ulaşıldı. Mevcut rutinler korunuyor.',409);
 }
 if(body?.routineDraftRequest){
  const input=body.routineDraftRequest;if(!valid(input))return fail('Efendim, komut 2–120, konu 2–100 karakter olmalı. Listeden en fazla üç farklı adım ve en fazla bir taslak hazırlama adımı seçin.');
  if(reserved(input.trigger))return fail('Efendim, bu ifade zaten bir uygulama komutu. Rutininiz için “İçerik modunu aç” gibi farklı bir komut seçin.');
  const d={id:crypto.randomUUID(),trigger:input.trigger.trim(),topic:input.topic.trim(),steps:input.steps,expires:now.getTime()+1800000};
  const payload=b64(enc.encode(JSON.stringify(d))),token=payload+'.'+b64(await crypto.subtle.sign('HMAC',await key(env),enc.encode(payload)));
  const description=`Efendim, “${d.trigger}” komutu için konu: ${d.topic}.\n${d.steps.map((s,i)=>(i+1)+'. '+labels[s]).join('\n')}\nGün planı ve haftalık değerlendirme tüm kayıtları kapsar; kayıt ve içerik adımları seçilen konuyu kullanır. Henüz kaydedilmedi. Kaydetmek için “Rutini onaylıyorum” deyin. Çalıştırmak görevleri değiştirmez veya paylaşım yapmaz; oluşan plan taslakları ayrıca onay ister.`;
  return {status:200,text:description,routineDraft:{token,trigger:d.trigger,topic:d.topic,steps:d.steps,text:description}};
 }
 if(teach||cmd==='bu komutu öğren')return {status:200,routineBuilder:true,suggestedTrigger:(teach?.[1]||'').trim().slice(0,120),text:'Efendim, bu komutun konusunu ve yapacağı adımları seçin. Taslağı gösterdikten sonra ayrı onayınızla kaydedeceğim.'};
 if(cmd==='rutini onaylıyorum')return fail('Efendim, onaylanacak açık rutin taslağı yok. Önce “Bu komutu öğren: İçerik modunu aç” deyin.');
 if(cmd==='rutinlerimi göster'){const routineItems=await rows(env.MEMORY_DB);return {status:200,routineItems,text:bounded(routineItems.length?'Efendim, kayıtlı rutinleriniz:\n'+routineItems.map(r=>`“${r.trigger}” · ${r.topic}`).join('\n'):'Efendim, henüz onaylanmış rutininiz yok.')};}
 if(res||cmd==='nerede kalmıştık')return resume(res?.[1],env,now);
 if(command(text).length>120)return null;
 const saved=await env.MEMORY_DB.prepare('SELECT id,trigger,topic,steps FROM atlas_routines WHERE trigger_key=?').bind(command(text)).first();
 if(!saved)return null;
 const routine={...saved,steps:JSON.parse(saved.steps)};if(!valid(routine))return fail('Efendim, bu rutin okunamadı; hiçbir adım çalıştırılmadı.');
 const pieces=[],out={status:200,routineRun:{id:routine.id,trigger:routine.trigger}};
 for(const step of routine.steps){
  if(step==='records'){const r=await resume(routine.topic,env,now);pieces.push(r.text);out.searchResults=r.searchResults;out.nextStep=r.nextStep;continue;}
  if(step==='calendar'){const items=await calendar(env.MEMORY_DB,routine.topic);out.calendarItems=items;pieces.push(items.length?items.map(r=>`İçerik ${r.id}: ${r.title} · ${r.due_date} · ${r.published?'paylaşıldı işaretli':'bekliyor'}`).join('\n'):'Bu konu için içerik takviminde kayıt yok.');continue;}
  let action={day:'Günümü planla',review:'Haftalık gelişimimi değerlendir'}[step];
  if(step==='content'){const item=(await calendar(env.MEMORY_DB,routine.topic)).find(r=>!r.published);if(!item){pieces.push('Bu konuda hazırlanacak bekleyen içerik yok; başka konudan içerik seçmedim.');continue;}action=`İçerik ${item.id} için paket hazırla`;}
  const r=await runPlanning(action,env,upstream,now,requestId);pieces.push(r.text||r.error);if(r.planDraft)out.planDraft=r.planDraft;if(r.status!==200){out.status=r.status;out.error=r.error;}
 }
 return {...out,text:bounded(`Efendim, “${routine.trigger}” rutini: ${out.nextStep||''}\n\n${pieces.map(p=>bounded(p,1600)).join('\n\n')}\n\nRutin yalnızca kayıtları okudu veya taslak hazırladı. Yeni plan kaydedilmedi.`)};
}
