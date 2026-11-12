import {dayInIstanbul} from './tasks.js';
export function calendarCommand(input){
 if(typeof input!=='string'||input.length>300)return null;
 const text=input.trim().replace(/[.!?]+$/u,'').trim();
 if(/^([iİ]çerik takvimim|[iİ]çerik takvimimi (oku|göster))$/iu.test(text))return {action:'list'};
 const add=text.match(/^takvime (bugün|yarın|\d{4}-\d{2}-\d{2}) (reels|hikâye|hikaye|carousel)\s*:?\s+(.+)$/iu);
 if(add)return {action:'add',day:add[1],format:add[2].toLocaleLowerCase('tr-TR').replace('hikaye','hikâye'),title:add[3].trim()};
 const status=text.match(/^[iİ]çerik (\d+) (paylaşıldı|yeniden planla)$/iu);
 return status?{action:'status',id:Number(status[1]),published:status[2].toLocaleLowerCase('tr-TR')==='paylaşıldı'?1:0}:null;
}
export async function runCalendar(db,input,now=new Date()){
 const c=calendarCommand(input);if(!c)return {status:400,error:'Örnek: Takvime yarın reels: ATLAS görev demosu'};
 if(!db)return {status:503,error:'Ortak takvim hazır değil.'};
 if(c.action==='add'){
  const day=/^bugün$/iu.test(c.day)?dayInIstanbul(now):/^yarın$/iu.test(c.day)?dayInIstanbul(now,1):c.day;
  const date=new Date(day+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day||day<dayInIstanbul(now)||day>dayInIstanbul(now,366)||!c.title||c.title.length>200)return {status:400,error:'Bugünden itibaren bir yıl içinde geçerli bir tarih ve 1–200 karakterlik başlık yazın.'};
  const result=await db.prepare('INSERT OR IGNORE INTO atlas_content_calendar(title,due_date,format,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_content_calendar) < 100').bind(c.title,day,c.format,now.toISOString()).run();
  if(!result.meta.changes){const same=await db.prepare('SELECT id FROM atlas_content_calendar WHERE title=? AND due_date=? AND format=?').bind(c.title,day,c.format).first();return same?{status:200,text:`Efendim, içerik ${same.id} zaten takvimde.`}:{status:409,error:'Takvim 100 kayıt sınırına ulaştı.'};}
  return {status:200,text:`Efendim, ${day} için ${c.format}: ${c.title} takvime kaydedildi. Otomatik paylaşım yapılmaz.`};
 }
 if(c.action==='status'){
  const row=await db.prepare('SELECT id FROM atlas_content_calendar WHERE id=?').bind(c.id).first();if(!row)return {status:404,error:'Bu içerik bulunamadı.'};
  await db.prepare('UPDATE atlas_content_calendar SET published=? WHERE id=?').bind(c.published,c.id).run();
  return {status:200,text:`Efendim, içerik ${c.id} sizin bildiriminizle ${c.published?'paylaşıldı':'planlandı'} olarak işaretlendi. Instagram’da işlem yapılmadı.`};
 }
 const items=(await db.prepare('SELECT id,title,due_date,format,published FROM atlas_content_calendar ORDER BY published ASC,due_date ASC,id ASC LIMIT 100').all()).results;
 const open=items.filter(i=>!i.published);
 return {status:200,items,text:open.length?`Efendim, takvimde ${open.length} planlı içerik var. ${open.slice(0,3).map(i=>`İçerik ${i.id}: ${i.due_date}, ${i.format}, ${i.title.slice(0,65)}`).join('. ')}.${open.length>3?' Diğerlerini içerik takviminde görebilirsiniz.':''}`:'Efendim, takvimde bekleyen içerik yok.'};
}
