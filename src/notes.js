export function noteCommand(value){
 if(typeof value!=='string')return null;
 const text=value.trim();
 const add=text.match(/^not al\s*[:,-]?\s+(.+)$/iu);
 if(add)return {action:'draft',text:add[1].trim()};
 if(/^notlarımı (göster|listele|oku)[.!?]?$/iu.test(text))return {action:'list'};
 const search=text.match(/^notlarda ara\s*[:,-]?\s+(.+?)[.!?]?$/iu)||text.match(/^(.+?)\s+ile ilgili notlarımı bul[.!?]?$/iu)||text.match(/^(.+?)\s+ilgili notlarımı bul[.!?]?$/iu);
 if(search)return {action:'search',query:search[1].trim()};
 const read=text.match(/^not\s+(\d+)\s+oku[.!?]?$/iu);
 if(read)return {action:'read',id:Number(read[1])};
 return null;
}
export async function notes(db){return (await db.prepare('SELECT * FROM atlas_notes ORDER BY id DESC LIMIT 100').all()).results.filter(n=>!n.archived_at).map(({id,text,created_at})=>({id,text,created_at}));}
export async function noteAction(db,command,confirmed=false){
 if(!db)return {status:503,error:'Ortak not defteri henüz hazır değil. Not kaydedilmedi.'};
 const parsed=noteCommand(command);if(!parsed)return {status:400,error:'“Not al: …”, “Notlarda ara: …” veya “Notlarımı göster” diyebilirsiniz.'};
 if(parsed.action==='draft'){
  if(!parsed.text||parsed.text.length>1000)return {status:400,error:'Not 1–1000 karakter olmalı.'};
  if(!confirmed)return {status:200,text:'Efendim, notu kaydetmeden önce ekrandaki metni kontrol edip onaylayın.',noteDraft:{command,text:parsed.text}};
  await db.prepare('INSERT OR IGNORE INTO atlas_notes(text,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM atlas_notes) < 100').bind(parsed.text,new Date().toISOString()).run();
  const item=await db.prepare('SELECT * FROM atlas_notes WHERE text = ?').bind(parsed.text).first();
  if(item?.archived_at)return {status:409,error:'Bu metindeki not arşivde. Kayıt yönetiminden arşivden çıkarma taslağı hazırlayıp onaylayın.'};
  return item?{status:200,text:`Efendim, onayladığınız not ${item.id} numarasıyla ortak not defterinizde.`,item}:{status:409,error:'Not defteri dolu (100 kayıt). Yeni not kaydedilmedi.'};
 }
 if(confirmed)return {status:400,error:'Kaydetme onayı yalnızca yeni not için kullanılabilir.'};
 let items=await notes(db);
 if(parsed.action==='read'){
  const item=items.find(n=>n.id===parsed.id);return item?{status:200,items:[item],text:`Efendim, not ${item.id}: ${item.text}`}:{status:404,error:'Bu numarada not bulunamadı.'};
 }
 if(parsed.action==='search'){
  if(parsed.query.length>100)return {status:400,error:'Arama en fazla 100 karakter olabilir.'};
  const normalize=s=>s.normalize('NFC').toLocaleLowerCase('tr-TR');
  items=items.filter(n=>normalize(n.text).includes(normalize(parsed.query)));
 }
 const text=items.length?`Efendim, ${items.length} not ${parsed.action==='search'?'buldum':'var'}. ${items.slice(0,3).map(n=>`Not ${n.id}: ${n.text.slice(0,90)}${n.text.length>90?'…':''}`).join('. ')}${items.length>3?' Diğerleri Notlarım bölümünde.':''}`:'Efendim, eşleşen not yok.';
 return {status:200,items,text};
}
