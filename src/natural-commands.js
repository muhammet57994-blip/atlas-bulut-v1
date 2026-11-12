import {listTasks,runTaskCommand} from './tasks.js';
import {signContext,readContext} from './command-context.js';
const ordinals={ilk:1,birinci:1,ikinci:2,'üçüncü':3,'dördüncü':4,'beşinci':5};
const normalize=s=>s.trim().replace(/[.!?]+$/u,'').toLocaleLowerCase('tr-TR');
export function naturalCommand(input){
 if(typeof input!=='string'||input.length>250)return null;const t=normalize(input);
 if(/^(işlerimi (oku|göster)|ne yapmam gerekiyor)$/u.test(t))return {action:'list'};
 const selection=t.match(/^(ilk|birinci|ikinci|üçüncü|dördüncü|beşinci)(?:si)?$/u);
 if(selection)return {action:'select',index:ordinals[selection[1]]};
 const m=t.match(/^(şunu|bunu|(?:ilk|birinci|ikinci|üçüncü|dördüncü|beşinci) (?:işi|görevi)|.+? (?:işini|görevini)) (yarına bırak|yarına (?:taşı|ertele)|bugüne (?:al|taşı)|tamamladım|bitirdim)$/u);
 if(!m)return null;
 const first=m[1].split(' ')[0],title=m[1].replace(/ (işini|görevini)$/u,'');
 return {action:m[2]==='tamamladım'||m[2]==='bitirdim'?'complete':'move',when:m[2].startsWith('bugüne')?'bugüne':'yarına',index:ordinals[first],title:/^(şunu|bunu)$/u.test(m[1])||ordinals[first]?null:title};
}
export async function taskReferences(result,env,now=new Date()){
 if(!result.items)return result;
 const rows=result.items.filter(t=>!t.done).slice().sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')||a.id-b.id).slice(0,5);
 if(!rows.length)return result;
 return {...result,text:'Efendim, listedeki ilk '+rows.length+' açık iş:\n'+rows.map((t,i)=>`${i+1}. Görev ${t.id}: ${t.title}${t.due_date?' · '+t.due_date:' · tarihsiz'}`).join('\n')+'\n“İkinci işi tamamladım” veya “İlk işi yarına bırak” diyebilirsiniz.',taskContext:await signContext({rows},env,now)};
}
export async function runNatural(parsed,token,env,now=new Date()){
 if(!env.MEMORY_DB)return {status:503,error:'Ortak görev deposu hazır değil.'};
 if(parsed.action==='list')return taskReferences({status:200,items:await listTasks(env.MEMORY_DB),text:'Efendim, açık işiniz yok.'},env,now);
 const context=await readContext(token,env,now),all=(await listTasks(env.MEMORY_DB)).filter(t=>!t.done);
 let action=parsed.action==='select'?context?.pending:parsed;
 if(!action)return {status:200,text:'Efendim, hangi işlemi yapmak istediğinizi de söyleyin. Önce “İşlerimi oku” diyebilirsiniz.'};
 let target;
 if(parsed.title){const matches=all.filter(t=>normalize(t.title)===parsed.title);if(matches.length===1)target=matches[0];}
 else if(parsed.index)target=context?.rows?.[parsed.index-1];
 else if(context?.rows?.length===1)target=context.rows[0];
 if(!target){
  const rows=all.slice(0,5);if(!rows.length)return {status:200,text:'Efendim, açık göreviniz yok. İşlem yapmadım.'};
  return {status:200,text:'Efendim, hangi işi kastediyorsunuz? Hiçbir görevi değiştirmedim.\n'+rows.map((t,i)=>`${i+1}. Görev ${t.id}: ${t.title}`).join('\n')+'\n“Birinci”, “ikinci” gibi listedeki sırayı söyleyin. Diğer işler için görev numarasını kullanın.',taskContext:await signContext({rows,pending:action},env,now)};
 }
 const current=all.find(t=>t.id===target.id);
 if(!current||['title','due_date','done','recurrence','completed_at'].some(k=>current[k]!==target[k]))return {status:409,error:'Bu görev diğer cihazda değişmiş olabilir. “İşlerimi oku” deyip yeniden seçin; işlem yapmadım.'};
 return runTaskCommand(env.MEMORY_DB,`Görev ${target.id} ${action.action==='complete'?'tamamlandı':action.when+' taşı'}`,now,target);
}
