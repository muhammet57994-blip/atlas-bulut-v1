import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../src/worker.js';
import {validateSetup} from './setup-validation.mjs';
import {sharedApi} from './shared-api.mjs';
const PORT=8790, origin=`http://localhost:${PORT}`;
const folder=path.join(process.env.LOCALAPPDATA,'ATLAS');
const configFile=path.join(folder,'secrets.dpapi');
const deviceTokenFile=path.join(folder,'device-token.dpapi');
// Enabled only after the shared-memory release has been approved and deployed.
let sharedMemory=false;
try{sharedMemory=JSON.parse(await readFile(path.join(folder,'cloud-memory.json'),'utf8')).enabled===true;}catch{}
const setupToken=randomBytes(32).toString('hex');
function protect(input,action){return new Promise((resolve,reject)=>{
 const child=spawn(process.env.ATLAS_POWERSHELL || 'pwsh.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('protect.ps1',import.meta.url)),'-Action',action],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();child.on('error',()=>reject(new Error('Windows güvenli deposuna erişilemedi.')));child.on('close',code=>code===0?resolve(output):reject(new Error('Windows güvenli deposu açılamadı.')));child.stdin.end(input);
});}
let config=null;
try{config=JSON.parse(await protect(await readFile(configFile,'utf8'),'Unprotect'));}catch(e){if(e.code!=='ENOENT'){console.error('ATLAS yapılandırması okunamadı. Dosyalar korunuyor.');process.exit(1);}}
let deviceToken='';
try{deviceToken=(await protect(await readFile(deviceTokenFile,'utf8'),'Unprotect')).trim();}catch(e){if(e.code!=='ENOENT')console.error('Cihaz belirteci okunamadı. Bulut kayıtları bu oturumda kapalı.');}
const buckets=new Map();
function limiter(max){return {async limit({key}){const now=Math.floor(Date.now()/60000),old=buckets.get(key);const count=old?.minute===now?old.count+1:1;buckets.set(key,{minute:now,count});return {success:count<=max};}};}
const LOGIN_LIMIT=limiter(5),CHAT_LIMIT=limiter(6);
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:11434 wss://generativelanguage.googleapis.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
function send(res,status,data,extra={}){const outgoing=new Headers(security);for(const [name,value] of new Headers(extra))if(name.toLowerCase()!=='content-security-policy')outgoing.set(name,value);res.writeHead(status,Object.fromEntries(outgoing));res.end(data);}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`localhost:${PORT}`){send(res,403,'Geçersiz adres.');return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/setup'&&req.method==='GET'){
   if(config){send(res,303,'',{'Location':'/'});return;}
   if(url.searchParams.get('token')!==setupToken){send(res,403,'Kurulum için bilgisayardaki ATLAS KURULUM bağlantısını açın.');return;}
   send(res,200,await readFile(new URL('../local/setup.html',import.meta.url)),{'Content-Type':'text/html; charset=utf-8','Set-Cookie':`atlas-setup=${setupToken}; HttpOnly; SameSite=Strict; Path=/api/setup; Max-Age=1800`});return;
  }
  if(['/setup.js','/setup.css'].includes(url.pathname)&&req.method==='GET'){
   send(res,200,await readFile(new URL('../local/'+url.pathname.slice(1),import.meta.url)),{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});return;
  }
  if(url.pathname==='/api/setup'){
   if(config){send(res,409,'{"error":"Kurulum zaten tamamlandı."}',{'Content-Type':'application/json'});return;}
   if(req.method!=='POST'||req.headers.origin!==origin||!req.headers.cookie?.split(';').some(x=>x.trim()===`atlas-setup=${setupToken}`)||req.headers['content-type']!=='application/json'){send(res,403,'{"error":"Kurulum oturumu geçersiz."}',{'Content-Type':'application/json'});return;}
   let bytes=0;const parts=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){send(res,413,'{}');return;}parts.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(parts));}catch{send(res,400,'{"error":"Geçersiz veri."}',{'Content-Type':'application/json'});return;}
   const validationError=validateSetup(body);
   if(validationError){send(res,400,JSON.stringify({error:validationError}),{'Content-Type':'application/json'});return;}
   const next={GEMINI_API_KEY:body.key,ATLAS_ACCESS_PASSWORD:body.password,SESSION_SECRET:randomBytes(48).toString('base64url')};
   const encrypted=await protect(JSON.stringify(next),'Protect');await mkdir(folder,{recursive:true});await writeFile(configFile,encrypted,{flag:'wx'});config=next;
   send(res,200,'{"ok":true}',{'Content-Type':'application/json','Set-Cookie':'atlas-setup=; HttpOnly; SameSite=Strict; Path=/api/setup; Max-Age=0'});return;
  }
  if(!config&&url.pathname==='/'){send(res,503,'ATLAS henüz kurulmadı. Masaüstündeki ATLAS KURULUM bağlantısını açın.');return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(url.pathname==='/api/instagram/analyze'?4300000:url.pathname==='/api/visual/analyze'?3*1024*1024:32768)){send(res,413,'{}');return;}chunks.push(chunk);}
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const env={...config,GEMINI_MODEL:'gemini-3.5-flash-lite',LOGIN_LIMIT,CHAT_LIMIT,ASSETS:{async fetch(r){const p=new URL(r.url).pathname;try{const data=await readFile(new URL('../public/'+(p==='/'?'index.html':p.slice(1)),import.meta.url));return new Response(data,{headers:{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.wav')?'audio/wav':p.endsWith('.png')?'image/png':p.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8'}});}catch{return new Response('Not found',{status:404});}}}};
  const response=sharedMemory&&url.pathname.startsWith('/api/')?await sharedApi(request,fetch,deviceToken||process.env.ATLAS_DEVICE_TOKEN):await worker.fetch(request,env);send(res,response.status,Buffer.from(await response.arrayBuffer()),Object.fromEntries(response.headers));
 }catch{send(res,500,'{"error":"İşlem tamamlanamadı. Sırlar kayda yazılmadı."}',{'Content-Type':'application/json'});}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'ATLAS zaten çalışıyor olabilir.':'ATLAS başlatılamadı.');process.exit(1);});
server.listen(PORT,'127.0.0.1',async()=>{
 await mkdir(folder,{recursive:true});
 if(!config)await writeFile(path.join(folder,'ATLAS-KURULUM.url'),`[InternetShortcut]\r\nURL=${origin}/setup?token=${setupToken}\r\n`);
 console.log(config?`ATLAS hazır: ${origin}`:`ATLAS kurulumu: ${origin}/setup?token=${setupToken}`);
});
