const CLOUD='https://atlas-pasam-v1.pages.dev';
const LOCAL='http://localhost:8790';
const DEVICE_HEADER='X-ATLAS-Device-Token';
const paths=new Set(['/api/everyday','/api/dayflow','/api/offline/snapshot','/api/offline/review','/api/organize','/api/backup','/api/daily','/api/center','/api/instagram/connect','/api/instagram/status','/api/instagram/report','/api/notes/command','/api/notes/save','/api/tasks/command','/api/session','/api/login','/api/logout','/api/chat','/api/speech','/api/live/token','/api/instagram/analyze','/api/visual/analyze','/api/memory/list','/api/memory/save','/api/memory/delete']);
const refusal=(message,status)=>new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
export async function sharedApi(request,upstream=fetch,deviceToken=process.env.ATLAS_DEVICE_TOKEN){
 const url=new URL(request.url);
 if(url.origin!==LOCAL||!paths.has(url.pathname))return refusal('Geçersiz istek',403);
 if(request.method!=='GET'&&request.method!=='POST')return refusal('Geçersiz yöntem',405);
 if(request.method==='POST'&&(request.headers.get('Origin')!==LOCAL||request.headers.get('Sec-Fetch-Site')==='cross-site'))return refusal('Geçersiz kaynak',403);
 if(url.pathname==='/api/everyday'&&request.method==='GET'&&(request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==LOCAL))return refusal('Geçersiz kaynak',403);
 // The browser cookie belongs to the local origin and its session secret is not the
 // cloud's, so forwarding it only ever produced 401. The cloud is reached with a
 // dedicated device token instead, held by this process and never by the browser.
 const token=typeof deviceToken==='string'?deviceToken.trim():'';
 if(token.length<32)return refusal('Cihaz belirteci tanımlı değil. ATLAS_DEVICE_TOKEN ayarlanmadan bulut kayıtlarına erişilemez.',503);
 const headers=new Headers();
 if(request.headers.has('Content-Type'))headers.set('Content-Type',request.headers.get('Content-Type'));
 headers.set(DEVICE_HEADER,token);
 if(request.method==='POST')headers.set('Origin',CLOUD);
 const response=await upstream(CLOUD+url.pathname+(url.pathname==='/api/everyday'?url.search:''),{method:request.method,headers,body:request.method==='POST'?await request.arrayBuffer():undefined,redirect:'manual',signal:AbortSignal.timeout(55000)});
 if(response.status>=300&&response.status<400)return refusal('Bağlantı yönlendirmesi reddedildi',502);
 // Node fetch decompresses the body but retains the original transport headers.
 const outgoing=new Headers(response.headers);
 outgoing.delete('Content-Encoding');outgoing.delete('Content-Length');
 return new Response(response.body,{status:response.status,headers:outgoing});
}
