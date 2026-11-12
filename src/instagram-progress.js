import {instagramAccount} from './instagram-account.js';
import {dayInIstanbul} from './tasks.js';
export function instagramProgressCommand(input){
 if(typeof input!=='string'||input.length>150)return null;
 const t=input.trim().replace(/[.!?]+$/u,'');
 if(/^instagram paylaşımlarımı karşılaştır$/iu.test(t))return 'compare';
 if(/^instagram ölçümünü kaydet$/iu.test(t))return 'save';
 return null;
}
const labels={reach:'erişim',views:'görüntülenme',saved:'kaydetme',shares:'paylaşma',likes:'beğeni',comments:'yorum'};
export async function instagramProgress(action,env,upstream=fetch,now=new Date(),requestId=''){
 if(!env.MEMORY_DB)return {status:503,error:'Ortak depo hazır değil.'};
 const report=await instagramAccount('media',{},env,upstream,requestId);if(report.status!==200||!report.connected)return report;
 if(!report.items.length)return {status:200,text:'Efendim, karşılaştırılacak paylaşım bulunamadı.',items:[]};
 if(action==='save'){
  if(!report.items.some(i=>Object.values(i.metrics).some(v=>v!==null)))return {status:422,error:'Ölçüm verisi alınamadı; boş ölçüm kaydedilmedi.'};
  const day=dayInIstanbul(now),db=env.MEMORY_DB;
  const r=await db.prepare('INSERT OR IGNORE INTO atlas_instagram_snapshots(day,captured_at,payload) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM atlas_instagram_snapshots) < 30').bind(day,report.capturedAt,JSON.stringify(report.items)).run();
  if(!r.meta.changes){const same=await db.prepare('SELECT day FROM atlas_instagram_snapshots WHERE day=?').bind(day).first();return same?{status:200,text:'Efendim, bugünün ilk ölçümü zaten kayıtlı. Üzerine yazılmadı.'}:{status:409,error:'30 ölçüm sınırına ulaşıldı. Eski kayıtlar silinmedi.'};}
  return {status:200,text:`Efendim, son ${report.items.length} paylaşımın ölçümü kaydedildi. Daha sonra “Instagram paylaşımlarımı karşılaştır” diyebilirsiniz.`};
 }
 const saved=await env.MEMORY_DB.prepare('SELECT captured_at,payload FROM atlas_instagram_snapshots ORDER BY day DESC LIMIT 1').first();
 const previous=saved?JSON.parse(saved.payload):[];
 const sections=report.items.map((item,index)=>{
  const prior=previous.find(i=>i.id===item.id),age=item.publishedAt?Math.max(0,Math.floor((Date.parse(report.capturedAt)-Date.parse(item.publishedAt))/3600000)):null;
  const facts=Object.entries(labels).map(([key,label])=>{
   const value=item.metrics[key],old=prior?.metrics[key];
   return label+': '+(value===null?'alınamadı':value)+(value!==null&&Number.isFinite(old)?` (${value-old>=0?'+':''}${value-old})`:'');
  }).join(' · ');
  return `${index+1}. ${item.format} · ${age===null?'yaş bilinmiyor':age+' saatlik'}\n${item.title}\n${facts}`;
 });
 const baseline=saved?'Parantezler '+new Date(saved.captured_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})+' ölçümünden beri aynı paylaşımın değişimini gösterir.':'Önceki ölçüm yok. “Instagram ölçümünü kaydet” derseniz sonraki karşılaştırma için saklarım.';
 return {status:200,items:report.items,text:('Efendim, son '+report.items.length+' paylaşımın mevcut toplamları.\n'+sections.join('\n\n')+'\n\n'+baseline+'\nBunlar yayınlandığından beri biriken değerlerdir; eşit 72 saatlik ölçümler değildir. Farklı yaş ve formattaki içerikleri doğrudan sıralamayın. Eksik veri sıfır değildir. Sonraki denemede aynı formatta yalnızca açılış cümlesini değiştirip eşit süre sonra kontrol edin.').slice(0,6000)};
}
