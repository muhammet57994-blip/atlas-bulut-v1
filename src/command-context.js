// Short-lived, signed references are kept in the current tab, never in the database.
const enc=new TextEncoder();
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(env){return crypto.subtle.importKey('raw',enc.encode('atlas-command-v1:'+env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signContext(data,env,now){const payload=encode(enc.encode(JSON.stringify({...data,expires:now.getTime()+600000})));return payload+'.'+encode(await crypto.subtle.sign('HMAC',await key(env),enc.encode(payload)));}
export async function readContext(token,env,now){try{if(typeof token!=='string'||token.length>12000)return null;const p=token.split('.');if(p.length!==2||!await crypto.subtle.verify('HMAC',await key(env),decode(p[1]),enc.encode(p[0])))return null;const d=JSON.parse(new TextDecoder().decode(decode(p[0])));return d.expires>now.getTime()&&d.expires<=now.getTime()+600000?d:null;}catch{return null;}}
