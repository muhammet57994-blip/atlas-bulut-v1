import {saveInstagramAuthorization} from './instagram-account.js';
import {reportError} from './log.js';
import {parseMetaJSON} from './meta-json.js';
const ORIGIN='https://atlas-pasam-v1.pages.dev',CALLBACK=ORIGIN+'/api/instagram/callback',APP='1162087043047938';
const SCOPES='instagram_business_basic,instagram_business_manage_insights';
const PROVIDER_ORIGINS=new Set(['https://www.instagram.com','https://instagram.com','https://www.facebook.com','https://facebook.com']);
const cookie=(value,age=600)=>`__Host-atlas-ig=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
function sameOriginStart(request){
 const origin=request.headers.get('Origin');
 if(origin&&origin!==ORIGIN)return false;
 const referer=request.headers.get('Referer');
 if(referer){
  let source;
  try{source=new URL(referer).origin;}catch{return false;}
  if(source!==ORIGIN&&!PROVIDER_ORIGINS.has(source))return false;
 }
 const site=request.headers.get('Sec-Fetch-Site');
 if(!site)return true;
 if(site==='same-origin'||site==='none')return true;
 // Another *.pages.dev host is same-site for the browser, and the state cookie
 // travels with Lax top-level GETs, so only Meta's own top-level redirect may
 // arrive cross-site. Scripted cross-site fetches and same-site subdomains are
 // refused before the state row is touched.
 if(site!=='cross-site')return false;
 if(origin)return false;
 return request.headers.get('Sec-Fetch-Mode')==='navigate'&&(request.headers.get('Sec-Fetch-Dest')||'document')==='document';
}
async function hash(state,env){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state+':'+env.SESSION_SECRET+':'+env.ATLAS_ACCESS_PASSWORD)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function startInstagramOAuth(request,env){
 if(new URL(request.url).origin!==ORIGIN)return json({error:'Instagram bağlantısını https://atlas-pasam-v1.pages.dev adresindeki ATLAS üzerinden başlatın.'},400);
 if(!env.INSTAGRAM_APP_SECRET||!env.MEMORY_DB)return json({error:'Instagram uygulama sırrı Cloudflare güvenli ayarlarına henüz eklenmedi. Hesap bağlantısı başlamadı.'},503);
 const state=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const now=Math.floor(Date.now()/1000);
 await env.MEMORY_DB.prepare('DELETE FROM atlas_instagram_oauth WHERE expires_at < ?').bind(now).run();
 await env.MEMORY_DB.prepare('INSERT INTO atlas_instagram_oauth (state_hash,expires_at) VALUES (?,?)').bind(await hash(state,env),now+600).run();
 const url=new URL('https://www.instagram.com/oauth/authorize');
 for(const [k,v] of Object.entries({client_id:APP,redirect_uri:CALLBACK,response_type:'code',scope:SCOPES,state,enable_fb_login:'0'}))url.searchParams.set(k,v);
 return json({url:url.href},200,{'Set-Cookie':cookie(state)});
}
export async function finishInstagramOAuth(request,env,upstream=fetch,requestId=''){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
 const saved=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-atlas-ig='))?.slice(16);
 const finish=result=>new Response(null,{status:303,headers:{Location:ORIGIN+'/?instagram='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie('',0)}});
 if(!sameOriginStart(request))return json({error:'Bu kaynaktan işlem yapılamaz.'},403);
 if(url.origin!==ORIGIN||!state||! /^[a-f0-9]{64}$/.test(state)||saved!==state||!env.MEMORY_DB||!env.INSTAGRAM_APP_SECRET)return finish('state');
 const claimed=await env.MEMORY_DB.prepare('DELETE FROM atlas_instagram_oauth WHERE state_hash=? AND expires_at>=? RETURNING state_hash').bind(await hash(state,env),Math.floor(Date.now()/1000)).first();
 if(!claimed)return finish('state');
 if(url.searchParams.has('error'))return finish('cancelled');
 if(!code||code.length>4096)return finish('code');
 try{
  const response=await upstream('https://api.instagram.com/oauth/access_token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:APP,client_secret:env.INSTAGRAM_APP_SECRET,grant_type:'authorization_code',redirect_uri:CALLBACK,code}).toString()});
  if(!response.ok)return finish('exchange');
  const reader=response.body.getReader();let length=0;const chunks=[];while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>32768){await reader.cancel();return finish('exchange');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=parseMetaJSON(new TextDecoder().decode(bytes));
  const result=await saveInstagramAuthorization(data,env,upstream,requestId);
  return finish(result.status===200?'connected':result.permissionIssue?'permissions-'+result.permissionIssue:result.reason||'validation');
 }catch(error){reportError({stage:'instagram.oauth',requestId,error,meta:{provider:'meta'}});return finish('exchange');}
}
