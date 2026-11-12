// Distinct, short-lived approval tokens; drafts are never stored server-side.
const enc=new TextEncoder(),ttl=30*60*1000;
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function signingKey(env){
 if(typeof env?.SESSION_SECRET!=='string'||env.SESSION_SECRET.length<32)throw Error('Onay güvenliği hazır değil.');
 return crypto.subtle.importKey('raw',enc.encode('atlas-daily-approval-v1:'+env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signDraft(env,kind,data,now=new Date()){
 if(!['daily','focus','management','lists','replan','bills','offline','budget','waiting','multi'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data)||!Number.isFinite(now.getTime()))throw Error('Geçersiz taslak.');
 const payload=encode(enc.encode(JSON.stringify({version:1,kind,issued:now.getTime(),expires:now.getTime()+ttl,data})));
 if(payload.length>24000)throw Error('Taslak çok uzun.');
 return payload+'.'+encode(await crypto.subtle.sign('HMAC',await signingKey(env),enc.encode(payload)));
}
export async function verifyDraft(env,token,expectedKind,now=new Date()){
 if(!['daily','focus','management','lists','replan','bills','offline','budget','waiting','multi'].includes(expectedKind)||typeof token!=='string'||token.length>24100||!Number.isFinite(now.getTime()))throw Error('Taslak doğrulanamadı.');
 const parts=token.split('.');
 if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/u.test(p)))throw Error('Taslak doğrulanamadı.');
 try{
  if(!await crypto.subtle.verify('HMAC',await signingKey(env),decode(parts[1]),enc.encode(parts[0])))throw Error();
  const value=JSON.parse(new TextDecoder().decode(decode(parts[0]))),at=now.getTime();
  if(value.version!==1||value.kind!==expectedKind||!Number.isInteger(value.issued)||!Number.isInteger(value.expires)||value.issued>at||value.expires-value.issued!==ttl||value.expires<=at||!value.data||typeof value.data!=='object'||Array.isArray(value.data))throw Error();
  return value.data;
 }catch{throw Error('Taslak doğrulanamadı veya onay süresi doldu. Yeniden hazırlayın.');}
}
