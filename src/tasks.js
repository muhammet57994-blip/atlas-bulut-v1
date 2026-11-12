export function dayInIstanbul(now=new Date(),offset=0){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=name=>parts.find(p=>p.type===name).value;
 const day=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
 day.setUTCDate(day.getUTCDate()+offset);return day.toISOString().slice(0,10);
}
export function taskCommand(input){
 if(typeof input!=='string')return null;
 const text=input.trim().replace(/[.!?]+$/u,'').trim();
 if(/^(haftalık özet|bu haftanın özeti|haftalık özeti (oku|göster))$/iu.test(text))return {action:'weekly'};
 const recurring=text.match(/^her (gün|hafta) görev ekle\s*:?\s+(.+)$/iu);
 if(recurring)return {action:'add',title:recurring[2].trim(),when:'bugün',recurrence:recurring[1].toLocaleLowerCase('tr-TR')==='gün'?'daily':'weekly'};
 const unrepeat=text.match(/^görev\s+(\d+)\s+tekrarı durdur$/iu);
 if(unrepeat)return {action:'unrepeat',target:unrepeat[1]};
 if(/^(yarın ne (var|yapacağım)|yarınki (işlerim|görevlerim)|yarının özeti)$/iu.test(text))return {action:'tomorrow'};
 const move=text.match(/^görev\s+(\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s+(bugüne|yarına)\s+(taşı|ertele)$/iu);
 if(move)return {action:'move',target:move[1],when:move[2].toLocaleLowerCase('tr-TR')};
 if(/^(bugün ne (kaldı|yapacağım)|günlük özet|günlük özeti (oku|söyle)|bugünkü işlerim|bugün yapacaklarım)$/iu.test(text))return {action:'summary'};
 if(/^(görevlerimi|yapılacaklarımı|listemi) (oku|göster|listele)$/iu.test(text))return {action:'list'};
 const add=text.match(/^(?:listeye|görev ekle:)\s+(.+?)(?:\s+ekle)?$/iu);
 if(add){
  // "Listeye" needs the final imperative; mentioning a list is not a write.
  if(/^listeye\s/iu.test(text)&&! /\s+ekle$/iu.test(text))return null;
  let title=add[1].trim(),when='';const date=title.match(/^(bugün|yarın)\s+(.+)$/iu);
  if(date){when=date[1].toLocaleLowerCase('tr-TR');title=date[2].trim();}
  return {action:'add',title,when};
 }
 const update=text.match(/^görev\s+(.+?)\s+(tamamlandı|tamamla|bitti|yeniden aç)$/iu);
 if(update)return {action:update[2].toLocaleLowerCase('tr-TR')==='yeniden aç'?'reopen':'complete',target:update[1].trim()};
 return null;
}
export async function listTasks(db){return (await db.prepare('SELECT id,title,due_date,done,created_at,recurrence,completed_at FROM atlas_tasks ORDER BY done ASC, id ASC LIMIT 100').all()).results;}
export function taskSummary(items,today,all=false){
 const open=items.filter(t=>!t.done);
 const relevant=(all?open:open.filter(t=>!t.due_date||t.due_date<=today)).slice().sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')||a.id-b.id);
 if(!relevant.length)return all?'Efendim, açık göreviniz yok.':`Efendim, bugün için açık veya gecikmiş işiniz yok.${open.length?' İleri tarihli '+open.length+' işiniz var.':''}`;
 const describe=t=>`Görev ${t.id}: ${t.title.slice(0,70)}${t.title.length>70?'…':''}${!t.due_date?' (tarihsiz)':t.due_date<today?' (gecikmiş)':t.due_date===today?' (bugün)':' ('+t.due_date+')'}`;
 const more=relevant.length>3?` Diğer ${relevant.length-3} işi Yapılacaklar bölümünde görebilirsiniz.`:'';
 const overdue=relevant.filter(t=>t.due_date&&t.due_date<today).length;
 return `Efendim, ${relevant.length} açık işiniz var.${overdue?' '+overdue+' iş gecikmiş.':''} ${relevant.slice(0,3).map(describe).join('. ')}.${more}`;
}
export async function runTaskCommand(db,command,now=new Date(),expected=null){
 if(!db)return {status:503,error:'Ortak görev listesi henüz hazır değil. İşlem yapılmadı.'};
 const parsed=taskCommand(command);if(!parsed)return {status:400,error:'“Listeye bugün market alışverişi ekle” veya “Görev 1 tamamlandı” diyebilirsiniz.'};
 const today=dayInIstanbul(now);
 if(parsed.action==='weekly'){
  const weekday=new Date(today+'T12:00:00Z').getUTCDay(),start=dayInIstanbul(now,-((weekday+6)%7)),end=dayInIstanbul(now,6-((weekday+6)%7));
  const from=new Date(start+'T00:00:00+03:00').toISOString(),to=now.toISOString();
  const count=await db.prepare('SELECT COUNT(*) AS total FROM atlas_task_completions WHERE completed_at >= ? AND completed_at <= ?').bind(from,to).first();
  const items=await listTasks(db),open=items.filter(t=>!t.done&&t.due_date&&t.due_date<=end),overdue=open.filter(t=>t.due_date<today).length;
  return {status:200,items,text:`Efendim, ${start} – ${end} haftası. Bu hafta ${count.total} tamamlama kaydı var. Hafta sonuna kadar ${open.length} açık tarihli işiniz, ayrıca ${items.filter(t=>!t.done&&!t.due_date).length} tarihsiz işiniz var. ${overdue} iş gecikmiş. Tamamlama sayımı bu özellik eklendikten sonraki işlemleri kapsar.`};
 }
 if(parsed.action==='tomorrow'){
  const day=dayInIstanbul(now,1),items=(await listTasks(db)).filter(t=>!t.done&&t.due_date===day);
  return {status:200,items,text:items.length?`Efendim, yarın ${items.length} işiniz var. ${items.slice(0,3).map(t=>'Görev '+t.id+': '+t.title.slice(0,70)).join('. ')}.${items.length>3?' Diğerlerini Yapılacaklar bölümünde görebilirsiniz.':''}`:'Efendim, yarına tarihli açık göreviniz yok.'};
 }
 if(parsed.action==='summary'||parsed.action==='list'){
  const items=await listTasks(db);return {status:200,items,text:taskSummary(items,today,parsed.action==='list')};
 }
 if(parsed.action==='add'){
  if(!parsed.title||parsed.title.length>200)return {status:400,error:'Görev metni 1–200 karakter olmalı.'};
  const due=parsed.when?dayInIstanbul(now,parsed.when==='yarın'?1:0):'';
  const find=()=>db.prepare('SELECT id FROM atlas_tasks WHERE title = ? AND due_date = ? AND done = 0').bind(parsed.title,due).first();
  const duplicate=await find();if(duplicate)return {status:200,text:`Efendim, bu iş zaten listenizde. Görev ${duplicate.id}; tekrar ayarı değiştirilmedi.`};
  await db.prepare('INSERT OR IGNORE INTO atlas_tasks(title,due_date,created_at,recurrence) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM atlas_tasks) < 100').bind(parsed.title,due,now.toISOString(),parsed.recurrence||'').run();
  const item=await find();if(!item)return {status:409,error:'Liste 100 kayıt sınırına ulaştı. Yeni kayıt eklenmedi.'};
  return {status:200,text:`Efendim, görev ${item.id} olarak ekledim: ${parsed.title}. ${parsed.recurrence?(parsed.recurrence==='daily'?'Her gün':'Her hafta')+' tekrarlanır; tamamladığınızda sonraki tarihe geçer.':due?parsed.when==='yarın'?'Yarın için.':'Bugün için.':'Tarihsiz listenizde.'}`};
 }
 const items=await listTasks(db);const numberWords={bir:1,iki:2,'üç':3,'dört':4,'beş':5,'altı':6,yedi:7,sekiz:8,dokuz:9,on:10};
 const target=parsed.target.toLocaleLowerCase('tr-TR');const id=/^\d+$/u.test(target)?Number(target):numberWords[target];
 const matches=items.filter(t=>id?t.id===id:t.title.toLocaleLowerCase('tr-TR')===target);
 if(matches.length!==1)return {status:409,error:'Görevi kesin seçemedim. Yapılacaklar bölümündeki numarayla söyleyin: “Görev 1 tamamlandı”.'};
 if(expected&&['id','title','due_date','done','recurrence','completed_at'].some(k=>matches[0][k]!==expected[k]))return {status:409,error:'Görev değişmiş. Listeyi yeniden okuyup seçin; işlem yapılmadı.'};
 if(parsed.action==='unrepeat'){
  await db.prepare("UPDATE atlas_tasks SET recurrence = '' WHERE id = ?").bind(matches[0].id).run();
  return {status:200,text:`Efendim, görev ${matches[0].id} tekrarı durduruldu. Mevcut görev korunuyor.`};
 }
 if(parsed.action==='move'){
  const item=matches[0];if(item.done)return {status:409,error:'Tamamlanmış görevi önce yeniden açın.'};
  const due=dayInIstanbul(now,parsed.when==='yarına'?1:0);
  if(item.due_date===due)return {status:200,text:`Efendim, görev ${item.id} zaten ${parsed.when} tarihli.`};
  const result=await db.prepare('UPDATE OR IGNORE atlas_tasks SET due_date = ? WHERE id = ? AND due_date = ? AND done = 0').bind(due,item.id,item.due_date).run();
  if(!result.meta.changes)return {status:409,error:'Görev değişmiş veya o tarihte aynı iş zaten var. Listeyi yenileyin.'};
  return {status:200,text:`Efendim, görev ${item.id} ${parsed.when} taşındı: ${item.title}.`};
 }
 const done=parsed.action==='complete'?1:0;
 if(done&&matches[0].recurrence){
  const item=matches[0];if(item.due_date>today)return {status:409,error:'Bu tekrar ileri tarihli. Tarihi gelmeden yeniden tamamlanamaz.'};
  const step=item.recurrence==='daily'?1:7;
  let next=new Date(item.due_date+'T12:00:00Z');
  const elapsed=Math.floor((Date.parse(today+'T12:00:00Z')-next.getTime())/86400000);
  next.setUTCDate(next.getUTCDate()+(Math.floor(elapsed/step)+1)*step);const due=next.toISOString().slice(0,10);
  const result=await db.prepare('UPDATE OR IGNORE atlas_tasks SET due_date = ?, completed_at = ? WHERE id = ? AND due_date = ? AND done = 0 AND recurrence = ?').bind(due,now.toISOString(),item.id,item.due_date,item.recurrence).run();
  if(!result.meta.changes)return {status:409,error:'Görev değişmiş veya sonraki tarihte aynı iş var. Listeyi yenileyin.'};
  return {status:200,text:`Efendim, görev ${item.id} tamamlandı. Sonraki tekrar ${due}.`};
 }
 if(matches[0].done===done)return {status:200,text:`Efendim, görev ${matches[0].id} zaten ${done?'tamamlanmış':'açık'}.`};
 const result=await db.prepare('UPDATE OR IGNORE atlas_tasks SET done = ?, completed_at = ? WHERE id = ? AND done = ? AND due_date = ? AND recurrence = ? AND completed_at = ?').bind(done,done?now.toISOString():matches[0].completed_at,matches[0].id,matches[0].done,matches[0].due_date,matches[0].recurrence,matches[0].completed_at).run();
 if(!result.meta.changes)return {status:409,error:'Görev değişmiş veya aynı açık iş zaten var. Listeyi yenileyin.'};
 return {status:200,text:`Efendim, görev ${matches[0].id} ${done?'tamamlandı':'yeniden açıldı'}.`};
}
