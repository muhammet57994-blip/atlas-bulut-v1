import {dayInIstanbul} from './tasks.js';
const lower=s=>s.normalize('NFC').toLocaleLowerCase('tr-TR');
export function searchCommand(input){
 if(typeof input!=='string'||input.length>300)return null;const t=input.trim().replace(/[.!?]+$/u,'');
 let m=t.match(/^(?:her yerde|ortak arama|kayıtlarımda) ara\s*:?\s+(.+)$/iu)||t.match(/^ortak arama\s*:\s*(.+)$/iu);
 if(m)return {query:m[1].trim()};
 m=t.match(/^(?:(geçen hafta|bu hafta|bugün) )?(.+?) hakkında (?:ne not almıştım|ne kaydetmiştim|neler var)$/iu);
 return m?{query:m[2].trim(),period:m[1]?lower(m[1]):null}:null;
}
export async function sharedSearch(command,env,now=new Date()){
 if(!env.MEMORY_DB)return {status:503,error:'Ortak kayıtlar hazır değil.'};
 const query=lower(command.query||'');if(query.length<2||query.length>120)return {status:400,error:'Arama için 2–120 karakterlik bir konu söyleyin.'};
 const db=env.MEMORY_DB,today=dayInIstanbul(now),weekday=(new Date(today+'T12:00:00Z').getUTCDay()+6)%7;
 let from=null,to=today;if(command.period==='geçen hafta'){from=dayInIstanbul(now,-weekday-7);to=dayInIstanbul(now,-weekday-1);}else if(command.period==='bu hafta')from=dayInIstanbul(now,-weekday);else if(command.period==='bugün')from=today;
 const sources=[['not','atlas_notes',100],['hafıza','atlas_memories',30],['plan','atlas_plans',50]];const matches=[];
 for(const [source,table,limit] of sources){
  // Table and bounds are internal constants. Search text is never interpolated into SQL.
  const rows=(await db.prepare(`SELECT id,text,created_at${source==='plan'?',title,plan_day':''} FROM ${table}${source==='not'?' WHERE archived_at IS NULL':''} ORDER BY created_at DESC,id DESC LIMIT ${limit}`).all()).results;
  for(const row of rows){const date=dayInIstanbul(new Date(row.created_at));if(from&&(date<from||date>to))continue;
   const full=(row.title?row.title+'\n':'')+row.text,index=lower(full).indexOf(query);if(index<0)continue;
   const start=Math.max(0,index-40),excerpt=(start?'…':'')+full.slice(start,start+220)+(full.length>start+220?'…':'');
   matches.push({source,id:row.id,date,excerpt,created_at:row.created_at});
  }
 }
 matches.sort((a,b)=>b.created_at.localeCompare(a.created_at)||String(a.id).localeCompare(String(b.id)));
 const results=matches.slice(0,8),range=from?` (${from} – ${to}, kayıt tarihi)` :'';
 return {status:200,searchResults:results,text:results.length?`Efendim, “${command.query}” için ${matches.length} kayıt buldum${range}. En yeni ${results.length} sonuç:\n`+results.map(r=>`${r.source==='not'?'Not '+r.id:r.source==='plan'?'Plan '+r.id:'Hafıza'} · ${r.date}: ${r.excerpt}`).join('\n')+'\nNot ve planın tamamı için “Not 1 oku” veya “Plan 1 oku” gibi sonuçtaki numarayı söyleyin.':`Efendim, “${command.query}” için kayıt bulamadım${range}. Daha kısa bir konu ile arayabilirsiniz.`};
}
