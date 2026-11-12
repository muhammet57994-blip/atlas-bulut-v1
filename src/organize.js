import {readManagement,latestManagementChange,managementRequest} from './record-management.js';
import {reportError} from './log.js';
import {readLists,latestListsChange,listsRequest} from './named-lists.js';
export function organizeCommand(input){
 if(typeof input!=='string')return null;
 const t=input.normalize('NFC').trim().toLocaleLowerCase('tr-TR').replace(/[.!?]+$/u,'').trim();
 if(/^(?:son değişikliği|son yaptığım değişikliği) geri al$/u.test(t))return {action:'undo'};
 if(/^(?:düzenleme merkezini|kayıt yönetimini|kayıtlarımı) aç$|^kayıtlarımı düzenle$/u.test(t))return {action:'open'};
 return null;
}
export async function organizeSnapshot(env,now=new Date(),requestId=''){
 try{const records=await readManagement(env,now,requestId);if(records.status>=400)return records;const lists=await readLists(env,now,requestId);if(lists.status>=400)return lists;return {...records,...lists,status:200,text:'Efendim, ortak kayıtlarınız ve listeleriniz hazır.'};}
 catch(error){reportError({stage:'db.organize.read',requestId,error});return {status:503,error:'Efendim, ortak kayıtlar şu anda okunamadı. Biraz sonra yeniden deneyin.'};}
}
export async function organizeRequest(command,env,now=new Date(),requestId=''){
 if(command.action==='open'){const result=await organizeSnapshot(env,now,requestId);return {...result,managementOpen:'records'};}
 try{
  const [record,list]=await Promise.all([latestManagementChange(env),latestListsChange(env)]);
  if(!record&&!list)return {status:200,managementOpen:'records',text:'Efendim, bu bölümde geri alınabilecek bir değişiklik henüz yok.'};
  if(record&&list&&record.created_at===list.created_at)return {status:409,managementOpen:'records',error:'Efendim, aynı anda iki değişiklik yapılmış. Kayıtlar veya Listeler bölümünden geri alınacak işlemi seçin.'};
  const latest=!list||record&&record.created_at>list.created_at?record:list;
  return latest.source==='management'?managementRequest({managementDraftRequest:{action:'undo',changeId:latest.id}},env,now,requestId):listsRequest({listsDraftRequest:{action:'undo',changeId:latest.id}},env,now,requestId);
 }catch(error){reportError({stage:'db.organize.history',requestId,error});return {status:503,error:'Efendim, değişiklik geçmişi okunamadı. Kayıtlarınız değişmedi.'};}
}
