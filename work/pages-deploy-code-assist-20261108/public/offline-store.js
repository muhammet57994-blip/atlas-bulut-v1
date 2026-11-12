// Device-only, explicitly selected copies. No network, credentials or signed approvals.
(()=>{
 'use strict';
 const NAME='atlas-offline-device-v1',STORE='device',MAX_BYTES=1024*1024;
 const error=message=>new Error(message||'Cihaz kopyası doğrulanamadı. Veriyi temizleyip yeniden seçin, Efendim.');
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 const allowed=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
 const positive=value=>Number.isSafeInteger(value)&&value>0;
 const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(value);
 const recordId=value=>typeof value==='string'&&/^[a-z\d-]{16,80}$/iu.test(value);
 const tag=value=>typeof value==='string'&&/^[a-f\d]{64}$/u.test(value);
 const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 const text=(value,max,empty=false)=>typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
 const singleText=(value,max,empty=false)=>text(value,max,empty)&&!/[\t\r\n]/u.test(value);
 const quantity=value=>singleText(value,40,true)&&!/^-/u.test(value.trim())&&!/^[+]?0+(?:[,.]0+)?(?:\s|$)/u.test(value.trim());
 const unique=values=>new Set(values).size===values.length;
 function snapshotValid(value){
  return exact(value,['version','capturedAt','notes','lists'])&&value.version===1&&iso(value.capturedAt)
   &&Array.isArray(value.notes)&&value.notes.length<=20&&unique(value.notes.map(row=>row?.id))
   &&value.notes.every(row=>exact(row,['id','text','revision','archived_at','etag'])&&positive(row.id)&&text(row.text,1000)&&Number.isSafeInteger(row.revision)&&row.revision>=0&&(row.archived_at===null||iso(row.archived_at))&&tag(row.etag))
   &&Array.isArray(value.lists)&&value.lists.length<=10&&unique(value.lists.map(row=>row?.id))
   &&value.lists.every(row=>exact(row,['id','title','kind','revision','archived','items','etag'])&&recordId(row.id)&&singleText(row.title,200)&&['list','project'].includes(row.kind)&&positive(row.revision)&&typeof row.archived==='boolean'&&tag(row.etag)&&Array.isArray(row.items)&&row.items.length<=100&&unique(row.items.map(item=>item?.id))&&row.items.every(item=>exact(item,['id','title','quantity','status','archived'])&&recordId(item.id)&&singleText(item.title,200)&&singleText(item.quantity,40,true)&&['todo','doing','done'].includes(item.status)&&typeof item.archived==='boolean'));
 }
 function draftValid(d){
  if(!object(d)||!uuid(d.id)||!iso(d.createdAt))return false;
  const base=['id','type','createdAt'];
  if(d.type==='note-create')return exact(d,[...base,'text'])&&text(d.text,1000);
  if(d.type==='note-edit')return exact(d,[...base,'targetId','expectedTag','text'])&&positive(d.targetId)&&tag(d.expectedTag)&&text(d.text,1000);
  if(d.type==='list-add')return allowed(d,[...base,'targetId','expectedTag','title','quantity'])&&base.every(key=>Object.hasOwn(d,key))&&recordId(d.targetId)&&tag(d.expectedTag)&&singleText(d.title,200)&&(d.quantity===undefined||quantity(d.quantity));
  if(d.type==='list-item-status')return exact(d,[...base,'targetId','expectedTag','itemId','status'])&&recordId(d.targetId)&&tag(d.expectedTag)&&recordId(d.itemId)&&['todo','doing','done'].includes(d.status);
  return false;
 }
 function compatible(d,snapshot){
  if(d.type==='note-create')return true;
  const row=(d.type==='note-edit'?snapshot.notes:snapshot.lists).find(item=>item.id===d.targetId);
  return !!row&&row.etag===d.expectedTag&&(d.type==='note-edit'?row.archived_at===null:row.archived===false)&&(d.type!=='list-item-status'||row.items.some(item=>item.id===d.itemId&&!item.archived));
 }
 function copy(value){return JSON.parse(JSON.stringify(value));}
 function bounded(value){if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_BYTES)throw error('Cihaz kopyası ve taslaklar toplamı 1 MiB sınırını aşıyor.');return value;}
 function metadata(meta){if(meta===undefined)return 0;if(!exact(meta,['generation'])||!Number.isSafeInteger(meta.generation)||meta.generation<0)throw error();return meta.generation;}
 function checked(value,generation){
  if(value===undefined)return null;
  if(!exact(value,['enabled','snapshot','drafts','generation'])||value.enabled!==true||value.generation!==generation||!snapshotValid(value.snapshot)||!Array.isArray(value.drafts)||value.drafts.length>20||!unique(value.drafts.map(d=>d?.id))||!value.drafts.every(draftValid))throw error();
  return bounded(value);
 }
 let opened;
 function database(){
  if(!window.indexedDB)return Promise.reject(error('Bu tarayıcı cihaz kopyasını güvenle saklayamıyor.'));
  if(!opened)opened=new Promise((resolve,reject)=>{
   let settled=false;const request=window.indexedDB.open(NAME,1);
   const rejectOpen=message=>{if(settled)return;settled=true;clearTimeout(timer);opened=null;reject(error(message));};
   const timer=setTimeout(()=>rejectOpen('Cihaz deposu yanıt vermedi. Sekmeyi yenileyip yeniden deneyin.'),15000);
   request.onupgradeneeded=()=>{if(settled){request.transaction?.abort();return;}if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
   request.onerror=()=>rejectOpen('Cihaz deposu açılamadı.');
   request.onblocked=()=>rejectOpen('Cihaz deposu başka bir sekmede güncelleniyor.');
   request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}settled=true;clearTimeout(timer);db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
  });
  return opened;
 }
 async function transact(mode,operation){
  const db=await database();
  return new Promise((resolve,reject)=>{
   let result,failure,finished=0,settled=false;
   const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),metaRequest=store.get('meta'),privateRequest=store.get('private');
   const finish=(problem)=>{if(settled)return;settled=true;clearTimeout(timer);problem?reject(problem):resolve(result);};
   const timer=setTimeout(()=>{failure=error('Cihaz işlemi yanıt vermedi. Sekmeyi yenileyip kaydı kontrol edin.');try{tx.abort();}catch{}finish(failure);},10000);
   const execute=()=>{if(settled||++finished!==2)return;try{const generation=metadata(metaRequest.result);result=operation(store,generation,privateRequest.result);}catch(e){failure=e;tx.abort();}};
   metaRequest.onsuccess=execute;privateRequest.onsuccess=execute;
   tx.oncomplete=()=>finish();
   tx.onerror=()=>{failure||=error('Cihaz işlemi tamamlanamadı.');};
   tx.onabort=()=>finish(failure||error('Cihaz işlemi tamamlanamadı; değişiklik kaydedilmedi.'));
  });
 }
 const broadcast=typeof window.BroadcastChannel==='function'?new window.BroadcastChannel('atlas-offline-events'):null;
 const changed=()=>window.dispatchEvent(new Event('atlas-offline-changed'));
 if(broadcast)broadcast.onmessage=event=>{if(event.data==='changed')changed();};
 const notify=()=>{changed();broadcast?.postMessage('changed');};
 window.AtlasOfflineStore=Object.freeze({
  async read(){return transact('readonly',(_store,generation,value)=>{const state=checked(value,generation);return state?copy(state):null;});},
  async generation(){return transact('readonly',(_store,generation)=>generation);},
  async enable(snapshot,expectedGeneration){
   if(!snapshotValid(snapshot)||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw error('Geçerli bir seçilmiş kopya ve işlem sırası gerekli.');
   const selected=copy(snapshot);bounded(selected);
   const result=await transact('readwrite',(store,generation,value)=>{
    if(generation!==expectedGeneration)throw error('Cihaz verisi bu sırada temizlendi. Yeniden seçim yapıp izin verin.');
    const previous=checked(value,generation),next=bounded({enabled:true,snapshot:selected,drafts:previous?.drafts||[],generation});
    store.put({generation},'meta');store.put(next,'private');return copy(next);
   });notify();return result;
  },
  async saveDraft(input){
   if(!draftValid(input))throw error('Yalnızca geçerli yazılı not veya liste taslağı saklanabilir.');
   const draft=copy(input);
   const result=await transact('readwrite',(store,generation,value)=>{
    const state=checked(value,generation);if(!state)throw error('Önce bu cihazda saklama izni verin.');
    const existing=state.drafts.find(item=>item.id===draft.id);
    if(existing){if(JSON.stringify(existing)!==JSON.stringify(draft))throw error('Bu taslak numarası zaten kullanılmış. Yeni bir taslak hazırlayın.');return copy(existing);}
    if(state.drafts.length>=20)throw error('En fazla 20 yerel taslak saklayabilirsiniz.');
    if(!compatible(draft,state.snapshot))throw error('Taslağın hedefi seçilmiş cihaz kopyasıyla uyuşmuyor. Kopyayı yenileyip yeni bir taslak hazırlayın.');
    const next=bounded({...state,drafts:[...state.drafts,draft]});store.put(next,'private');return copy(draft);
   });notify();return result;
  },
  async removeDraft(id){
   if(!uuid(id))throw error('Geçerli bir taslak numarası gerekli.');
   await transact('readwrite',(store,generation,value)=>{const state=checked(value,generation);if(state)store.put({...state,drafts:state.drafts.filter(item=>item.id!==id)},'private');});notify();
  },
  async clear(){
   const generation=await transact('readwrite',(store,current)=>{if(current===Number.MAX_SAFE_INTEGER)throw error();const next=current+1;store.delete('private');store.put({generation:next},'meta');return next;});notify();return generation;
  }
 });
})();
