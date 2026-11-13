import {parseMetaJSON} from './meta-json.js';
import {reportError} from './log.js';
import {modelChain,modelRequest} from './models.js';
const USER='celik38__', ID='17841407597588263';
const SCOPES=['instagram_business_basic','instagram_business_manage_insights'];
const enc=new TextEncoder();
const failure=(error,status=502)=>({status,error});
async function encryptionKey(secret){
 if(typeof secret!=='string'||secret.length<32)throw Error('configuration');
 return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('atlas:instagram:v1:'+secret)), 'AES-GCM',false,['encrypt','decrypt']);
}
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function seal(token,secret){const iv=crypto.getRandomValues(new Uint8Array(12));return 'v1.'+encode(iv)+'.'+encode(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(USER)},await encryptionKey(secret),enc.encode(token)));}
export async function unseal(value,secret){const [version,iv,data]=value.split('.');if(version!=='v1')throw Error('version');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:enc.encode(USER)},await encryptionKey(secret),decode(data)));}
async function graph(path,params,token,upstream){
 const url=new URL('https://graph.instagram.com/v24.0/'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const r=await upstream(url.href,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(8000)});
 const reader=r.body.getReader();let n=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>1000000){await reader.cancel();throw Error('size');}chunks.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=parseMetaJSON(new TextDecoder().decode(bytes));
 if(!r.ok){const error=Error(r.status===429?'limit':'graph');error.stage=path==='me/permissions'?'izin':path==='me'?'hesap':'istatistik';error.http=r.status;error.code=Number.isInteger(data.error?.code)?data.error.code:0;error.subcode=Number.isInteger(data.error?.error_subcode)?data.error.error_subcode:0;throw error;}return data;
}
export function safePermissions(result){
 if(!Array.isArray(result?.data)||result.paging?.next)return false;
 const granted=result.data.filter(p=>p.status==='granted').map(p=>p.permission);
 return SCOPES.every(s=>granted.includes(s))&&granted.every(s=>SCOPES.includes(s));
}
async function verify(token,upstream){
 const profile=await graph('me',{fields:'user_id,username'},token,upstream);
 if(String(profile.user_id)!==ID)throw Error('profile-id');
 if(profile.username!==USER)throw Error('profile-name');
 return profile;
}
export async function saveInstagramAuthorization(data,env,upstream=fetch,requestId=''){
 let stage='response';
 try{
  const wrapped=Array.isArray(data?.data)&&data.data.length===1&&!data.access_token;
  const flat=data&&typeof data==='object'&&!('data' in data)&&typeof data.access_token==='string';
  if(!wrapped&&!flat)return {status:422,reason:'response'};
  const item=wrapped?data.data[0]:data;
  const scopes=typeof item.permissions==='string'?item.permissions.split(/[ ,]+/).filter(Boolean):Array.isArray(item.permissions)&&item.permissions.every(s=>typeof s==='string')?item.permissions:[];
  if(!SCOPES.every(s=>scopes.includes(s))||!scopes.every(s=>SCOPES.includes(s)))return {status:422,reason:'permissions',permissionIssue:!scopes.length?'format':scopes.some(s=>!SCOPES.includes(s))?'extra':'missing'};
  if(typeof item.access_token!=='string'||!/^[A-Za-z0-9_-]{32,4096}$/.test(item.access_token))return {status:422,reason:'token-format'};
  if(typeof item.user_id!=='string'||!/^\d{5,32}$/.test(item.user_id))return {status:422,reason:'token-id'};
  stage='profile';const profile=await verify(item.access_token,upstream);
  // OAuth's app-scoped ID may differ from the canonical Instagram user_id.
  if(item.user_id!==String(profile.id)&&item.user_id!==String(profile.user_id))return {status:422,reason:'token-id'};
  stage='long-token';
  const url=new URL('https://graph.instagram.com/access_token');url.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:env.INSTAGRAM_APP_SECRET,access_token:item.access_token}).toString();
  const r=await upstream(url.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!r.ok)return {status:422,reason:'exchange'};
  const long=await r.json();if(typeof long.access_token!=='string'||! /^[A-Za-z0-9_-]{32,4096}$/.test(long.access_token)||!Number.isFinite(long.expires_in)||long.expires_in<1||long.expires_in>5184000)return {status:422,reason:'exchange'};
  stage='long-profile';await verify(long.access_token,upstream);
  stage='storage';
  const payload=JSON.stringify({token:long.access_token,scopes,expiresAt:Date.now()+long.expires_in*1000});
  await env.MEMORY_DB.prepare('INSERT INTO atlas_instagram_connection (id,encrypted_token,username,connected_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_token=excluded.encrypted_token,username=excluded.username,connected_at=excluded.connected_at').bind(await seal(payload,env.SESSION_SECRET),USER,new Date().toISOString()).run();
  return {status:200};
 }catch(error){reportError({stage:'instagram.authorize',requestId,error,meta:{provider:'meta'}});return {status:422,reason:['profile-id','profile-name'].includes(error.message)?error.message:stage+(Number.isInteger(error.code)?'-'+error.code:'')};}
}
function safeError(error){const diagnostic=error.message==='graph'&&['izin','hesap','istatistik'].includes(error.stage)?` (Aşama: ${error.stage}; HTTP ${error.http}; Meta ${error.code}/${error.subcode})`:'';return failure((error.message==='permissions'?'Bağlantı kaydedilmedi: yalnızca temel profil ve istatistik okuma izinleri gerekli. Mesaj, yorum veya paylaşım izni olmamalı.':error.message==='account'?'Bağlantı celik38__ hesabına ait değil; kaydedilmedi.':error.message==='limit'?'Instagram kullanım sınırına ulaşıldı. Daha sonra deneyin.':'Instagram bağlantısı doğrulanamadı. Anahtarın geçerliliğini ve iki okuma iznini kontrol edin.')+diagnostic,error.message==='limit'?429:422);}
export async function instagramAccount(action,body,env,upstream=fetch,requestId=''){
 if(!['connect','status','report','media'].includes(action))return failure('İşlem bulunamadı.',400);
 if(!env.MEMORY_DB)return failure('Ortak bağlantı deposu hazır değil.',503);
 try{
  if(action==='connect'){
   return failure('Anahtar yapıştırma kaldırıldı. Instagram ile güvenli bağlan düğmesini kullanın.',410);
  }
  const row=await env.MEMORY_DB.prepare('SELECT encrypted_token, username, connected_at FROM atlas_instagram_connection WHERE id=1').first();
  if(action==='status')return {status:200,connected:!!row,username:row?.username,connectedAt:row?.connected_at};
  if(!row)return {status:200,text:'Efendim, Instagram düğmesinden önce hesap bağlantısını tamamlayın.',connected:false};
  const stored=JSON.parse(await unseal(row.encrypted_token,env.SESSION_SECRET));
  if(!Array.isArray(stored.scopes)||!SCOPES.every(s=>stored.scopes.includes(s))||!stored.scopes.every(s=>SCOPES.includes(s)))throw Error('permissions');
  if(!Number.isFinite(stored.expiresAt)||stored.expiresAt<=Date.now())return failure('Instagram bağlantısının süresi doldu. Instagram ile güvenli bağlan düğmesiyle yenileyin.',422);
  const token=stored.token;await verify(token,upstream);
  if(action==='media'){
   const media=await graph(ID+'/media',{fields:'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',limit:6},token,upstream);
   if(!Array.isArray(media.data))return failure('Paylaşım listesi alınamadı.',422);
   const items=await Promise.all(media.data.slice(0,6).filter(m=>typeof m.id==='string'&&/^\d+$/.test(m.id)).map(async m=>{
    const metrics={};
    await Promise.all(['reach','views','saved','shares'].map(async metric=>{
     try{const data=await graph(m.id+'/insights',{metric},token,upstream),entry=data.data?.find(d=>d.name===metric),value=entry?.values?.[0]?.value??entry?.total_value?.value;metrics[metric]=Number.isFinite(value)&&value>=0?value:null;}catch{metrics[metric]=null;}
    }));
    for(const [field,name] of [['like_count','likes'],['comments_count','comments']])metrics[name]=Number.isFinite(m[field])&&m[field]>=0?m[field]:null;
    return {id:m.id,title:typeof m.caption==='string'?m.caption.slice(0,120):'Başlıksız içerik',format:m.media_product_type==='REELS'?'REELS':m.media_type==='CAROUSEL_ALBUM'?'CAROUSEL':m.media_type==='IMAGE'?'IMAGE':'OTHER',publishedAt:Number.isFinite(Date.parse(m.timestamp))?new Date(m.timestamp).toISOString():null,metrics};
   }));
   return {status:200,connected:true,items,capturedAt:new Date().toISOString()};
  }
  const until=Math.floor(Date.now()/86400000)*86400,since=until-7*86400;
  const labels={reach:'Erişim',views:'Görüntülenme',total_interactions:'Toplam etkileşim'};
  const metrics=await Promise.all(Object.entries(labels).map(async([metric,label])=>{
   try{const data=await graph(ID+'/insights',{metric,period:'day',metric_type:'total_value',since,until},token,upstream);const entry=data.data?.find(d=>d.name===metric);const value=entry?.total_value?.value;return {metric,label,value:typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null};}catch{return {metric,label,value:null};}
  }));
  const period=new Date(since*1000).toISOString().slice(0,10)+' – '+new Date(until*1000).toISOString().slice(0,10)+' (UTC, bitiş hariç)';
  const facts=metrics.map(m=>m.label+': '+(m.value===null?'veri alınamadı':m.value.toLocaleString('tr-TR'))).join('. ');
  let advice='Karşılaştırmalı dönem olmadan performansa iyi veya kötü diyemem. Bir sonraki hafta aynı ölçütlerle karşılaştıralım.';
  if(!body?.skipAdvice&&metrics.some(m=>m.value!==null)&&env.GEMINI_API_KEY&&modelChain(env).length){
   try{const call=await modelRequest(env,{systemInstruction:{parts:[{text:'Türkçe en fazla 250 karakterlik doğal öneri yaz. Yalnızca verilen sayılara dayan. Karşılaştırma yok; iyi/kötü oran, profil kusuru, büyüme garantisi veya en iyi saat uydurma. Tek ölçülebilir içerik deneyi öner. Eksik değer sıfır değildir. Araçların yok.'}]},contents:[{role:'user',parts:[{text:JSON.stringify({period,metrics})}]}],generationConfig:{maxOutputTokens:200}},{upstream,signal:AbortSignal.timeout(15000)});const r=call.response;if(r?.ok){const d=await r.json(),t=d.candidates?.[0]?.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');if(t)advice=t.slice(0,280);}}catch{}
  }
  return {status:200,connected:true,username:USER,period,metrics,text:('Efendim, son 7 tamamlanmış gün: '+facts+'. '+advice).slice(0,600)};
 }catch(error){reportError({stage:'instagram.account',requestId,error,meta:{provider:'meta'}});return safeError(error);}
}
export function instagramCommand(text){return typeof text==='string'&&text.length<160&&/^\s*(?:atlas[, ]+)?instagram\s+istatistikler(?:im(?:e|i)?|e|i)?\s*(?:bak|oku|göster|analiz et)?[.!?]*\s*$/iu.test(text);}
