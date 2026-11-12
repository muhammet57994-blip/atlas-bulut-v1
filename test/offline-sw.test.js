import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),entry=readFileSync(new URL('../public/offline-entry.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const origin='https://atlas.example',cacheName='atlas-offline-public-v1';
const paths=['/offline.html','/offline.js','/offline.css','/offline-store.js','/offline-entry.js','/icon.svg'];
const type=path=>path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/javascript';
const response=(path,text='public shell')=>new Response(text,{headers:{'Content-Type':type(path),'Cache-Control':'no-store'}});
function fakeCaches(){const maps=new Map();return {maps,async keys(){return [...maps.keys()];},async delete(key){return maps.delete(key);},async open(name){if(!maps.has(name))maps.set(name,new Map());const data=maps.get(name);return {async put(key,value){data.set(typeof key==='string'?key:key.url,value.clone());},async match(key){return data.get(typeof key==='string'?key:key.url)?.clone();}};}};}
function environment(){
 const handlers={},caches=fakeCaches(),calls=[],env={handlers,caches,calls,status:[],skip:0,claim:0,fetch:async request=>response(new URL(request.url).pathname)};
 const self={location:{origin},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>env.skip++,clients:{claim:async()=>env.claim++,matchAll:async()=>[{postMessage:message=>env.status.push(message)}]}};
 runInNewContext(sw,{self,caches,Request,Response,URL,AbortController,setTimeout,clearTimeout,fetch:async request=>{calls.push(request);return env.fetch(request);}});
 env.install=()=>{let result;handlers.install({waitUntil:promise=>result=promise});return result;};
 env.activate=()=>{let result;handlers.activate({waitUntil:promise=>result=promise});return result;};
 env.request=(path,props={})=>{let result;handlers.fetch({request:{url:origin+path,method:'GET',mode:'cors',...props},respondWith:promise=>result=promise});return result;};
 return env;
}

test('installation caches only public allowlist with anonymous fresh requests',async()=>{
 const env=environment();assert.equal(env.calls.length,0);await env.install();assert.equal(env.skip,1);assert.deepEqual(env.calls.map(r=>new URL(r.url).pathname).sort(),[...paths].sort());assert.ok(env.calls.every(r=>r.credentials==='omit'&&r.cache==='no-store'&&!r.headers.has('Authorization')&&!r.headers.has('Cookie')));assert.deepEqual([...env.caches.maps.get(cacheName).keys()].sort(),paths.map(p=>origin+p).sort());
});

test('installation rejects incorrect types, protected responses and redirects without activation',async()=>{
 for(const bad of [new Response('private',{headers:{'Content-Type':'application/json'}}),new Response('auth',{status:401}),new Response('private',{headers:{'Content-Type':'text/html','Cache-Control':'private'}}),new Response('private',{headers:{'Content-Type':'text/html','Vary':'Cookie'}}),new Response('private',{headers:{'Content-Type':'text/html','Set-Cookie':'session=secret'}})]){
  const env=environment();env.fetch=async request=>new URL(request.url).pathname==='/offline.html'?bad:response(new URL(request.url).pathname);await assert.rejects(env.install());assert.equal(env.skip,0);assert.equal(env.caches.maps.size,0);
 }
 const env=environment(),redirect=response('/offline.html');Object.defineProperty(redirect,'redirected',{value:true});env.fetch=async()=>redirect;await assert.rejects(env.install());
});

test('installation drains each public body before fetching the next and reports only sanitized asset failures',async()=>{
 const env=environment();let release;
 env.fetch=async request=>{const path=new URL(request.url).pathname,r=response(path);if(path==='/offline.html'){const clone=r.clone.bind(r);let first=true;r.clone=()=>{if(first){first=false;return {arrayBuffer:()=>new Promise(resolve=>release=resolve)};}return clone();};}return r;};
 const installing=env.install();await new Promise(resolve=>setImmediate(resolve));assert.equal(env.calls.length,1);assert.equal(env.caches.maps.size,0);release(new ArrayBuffer(0));await installing;assert.equal(env.calls.length,6);
 const failing=environment();failing.fetch=async request=>{const path=new URL(request.url).pathname;if(path==='/offline.js')throw Error('private-token-do-not-report');return response(path);};await assert.rejects(failing.install());assert.equal(failing.calls.length,2);assert.equal(failing.caches.maps.size,0);assert.ok(failing.status.some(s=>s.text.includes('offline.js alınamadı')));assert.ok(!JSON.stringify(failing.status).includes('private-token'));
});

test('activation cleans only this feature older public caches and claims clients',async()=>{
 const env=environment();for(const name of ['unrelated-cache','atlas-offline-public-v0',cacheName,'atlas-private'])await env.caches.open(name);await env.activate();assert.deepEqual((await env.caches.keys()).sort(),['unrelated-cache',cacheName,'atlas-private'].sort());assert.equal(env.claim,1);
});

test('API, authenticated endpoints, OAuth queries, non-GET and unrelated requests are untouched',async()=>{
 const env=environment();await env.install();env.calls.length=0;
 for(const [path,props] of [['/api/session',{}],['/api/offline/snapshot',{}],['/api/instagram/callback?code=secret',{}],['/?code=oauth-secret',{mode:'navigate'}],['/offline.js?token=secret',{}],['/app.js',{}],['/offline.html',{method:'POST'}],['/other',{mode:'navigate'}]])assert.equal(env.request(path,props),undefined,path);
 let result;env.handlers.fetch({request:{url:'https://other.example/offline.html',method:'GET',mode:'navigate'},respondWith:r=>result=r});assert.equal(result,undefined);assert.equal(env.calls.length,0);
});

test('main navigations use network first, never cache app data, and fallback only on network rejection',async()=>{
 const env=environment();await env.install();env.fetch=async()=>new Response('authenticated private app',{headers:{'Content-Type':'text/html'}});
 assert.equal(await (await env.request('/',{mode:'navigate'})).text(),'authenticated private app');assert.ok(!env.caches.maps.get(cacheName).has(origin+'/'));
 for(const status of [401,403,404,500]){env.fetch=async()=>new Response('HTTP '+status,{status});const result=await env.request('/index.html',{mode:'navigate'});assert.equal(result.status,status);assert.equal(await result.text(),'HTTP '+status);}
 env.fetch=async()=>{throw Error('network unavailable');};for(const path of ['/','/index.html','/offline.html'])assert.equal(await (await env.request(path,{mode:'navigate'})).text(),'public shell');
});

test('offline assets fetch anonymously, update only valid public content, and fail back on network loss',async()=>{
 const env=environment();await env.install();env.calls.length=0;env.fetch=async request=>response(new URL(request.url).pathname,'updated public');
 const result=await env.request('/offline.js',{headers:new Headers({Authorization:'secret',Cookie:'session=secret'})});assert.equal(await result.text(),'updated public');assert.equal(env.calls[0].credentials,'omit');assert.equal(env.calls[0].headers.get('Authorization'),null);assert.equal(await (await (await env.caches.open(cacheName)).match(origin+'/offline.js')).text(),'updated public');
 env.fetch=async()=>new Response('auth json',{headers:{'Content-Type':'application/json'}});assert.equal(await (await env.request('/offline.js')).text(),'auth json');assert.equal(await (await (await env.caches.open(cacheName)).match(origin+'/offline.js')).text(),'updated public');
 env.fetch=async()=>{throw Error('offline');};assert.equal(await (await env.request('/offline.js')).text(),'updated public');
});

function entryEnvironment({unrelated=false,missing=false,workerState='activated',busy=false,timers={setTimeout,clearTimeout}}={}){
 const calls=[],events={},caches=fakeCaches(),active={scriptURL:origin+'/sw.js',state:workerState,addEventListener(){},removeEventListener(){}},registration={scope:origin+'/',active},navigator={serviceWorker:{async register(...args){calls.push(args);return registration;},ready:Promise.resolve(unrelated?{scope:origin+'/',active:{scriptURL:origin+'/other-worker.js',state:'activated'}}:registration)}};
 const window={location:{origin,assign:path=>calls.push(path)},caches,AtlasOfflineStore:{async clear(){calls.push('cleared');}}};
 const document={getElementById:id=>({addEventListener:(_name,fn)=>events[id]=fn})};
 runInNewContext(entry,{window,document,navigator,...timers,Promise,busy,notice:text=>calls.push({notice:text})});
 const initialize=async()=>{const cache=await caches.open(cacheName);for(const path of missing?paths.slice(1):paths)await cache.put(origin+path,response(path));};
 return {window,calls,events,initialize,registration,navigator,caches};
}

test('entry never auto-registers; explicit enable requires own active worker and complete public shell',async()=>{
 const env=entryEnvironment();assert.equal(env.calls.length,0);await env.initialize();assert.equal(await env.window.AtlasOfflineShell.enable(),true);assert.equal(env.calls.length,1);assert.equal(env.calls[0][0],'/sw.js');assert.equal(env.calls[0][1].scope,'/');
 for(const options of [{unrelated:true},{missing:true}]){const e=entryEnvironment(options);await e.initialize();await assert.rejects(e.window.AtlasOfflineShell.enable());}
});

test('entry opens only explicit offline requests and clears only local store',async()=>{
 const env=entryEnvironment();assert.equal(env.window.handleOffline({}),false);assert.equal(env.calls.length,0);assert.equal(env.window.handleOffline({offlineOpen:true}),true);assert.deepEqual(env.calls,['/offline.html']);await env.window.clearOfflineDevice();assert.deepEqual(env.calls,['/offline.html','cleared']);assert.equal(typeof env.events.voiceOffline,'function');assert.equal(typeof env.events.textOffline,'function');
});

test('chat response may open offline while the originating chat is busy; unrelated buttons remain guarded',()=>{
 const env=entryEnvironment({busy:true});assert.equal(env.window.openOffline(),false);assert.equal(env.calls.length,1);assert.ok(env.calls[0].notice);assert.equal(env.events.textOffline({type:'click'}),false);assert.equal(env.calls.length,2);assert.equal(env.window.handleOffline({offlineOpen:false}),false);assert.equal(env.window.handleOffline({offlineOpen:true}),true);assert.equal(env.calls.at(-1),'/offline.html');
});

async function mainApp({session='online'}={}){
 const elements=new Map(),navigations=[],sent=[],env={cleared:0,fetch:null};let id=0;
 const el=name=>{if(!elements.has(name))elements.set(name,{value:'',dataset:{},hidden:false,checked:false,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},setAttribute(key,value){this[key]=value;},showModal(){this.open=true;},close(){this.open=false;},focus(){},replaceChildren(){},append(){},scrollIntoView(){},click(){return this.handlers.click?.();}});return elements.get(name);};
 const document={hidden:false,getElementById:el,querySelector:()=>el('main'),querySelectorAll:()=>[],createElement:()=>el('created-'+(++id)),addEventListener(){}};
 const speechSynthesis={getVoices:()=>[],cancel(){},speak(){}};
 const window={AtlasLiveAudio:class{close(){}},AtlasOfflineStore:{async clear(){env.cleared++;}},location:{origin,assign:path=>navigations.push(path)},speechSynthesis,localStorage:{getItem:()=> 'off',setItem(){}},addEventListener(){}};
 env.fetch=async(url)=>{if(url==='/api/session'){if(session==='network')throw Error('network');return Response.json({authenticated:session!=='signed-out',ready:true});}if(url==='/api/chat')return Response.json({offlineOpen:true,text:'Cihaz kopyasını açıyorum.'});return Response.json({ok:true});};
 runInNewContext(entry+'\n'+app+'\nwindow.testApi=api;window.testShowNotes=showNotes;',{window,document,navigator:{},AbortController,AbortSignal,SpeechSynthesisUtterance:class{},speechSynthesis,fetch:async(...args)=>{sent.push(args[0]);return env.fetch(...args);},setTimeout:()=>++id,clearTimeout(){},confirm:()=>false,Promise});
 await new Promise(resolve=>setImmediate(resolve));return {...env,window,el,navigations,sent,get cleared(){return env.cleared;},setFetch:fn=>env.fetch=fn};
}

test('real app retains device copies through session network failure and subsequent sign-in prompts',async()=>{
 const env=await mainApp({session:'network'});assert.equal(env.cleared,0);assert.equal(env.el('loginDialog').open,true);await env.window.testShowNotes();env.el('homeStart').click();assert.equal(env.cleared,0);assert.deepEqual(env.sent,['/api/session']);
});

test('real app clears device data for confirmed signed-out session, logout and API401 but not new chat',async()=>{
 const signedOut=await mainApp({session:'signed-out'});assert.equal(signedOut.cleared,1);
 const loggedOut=await mainApp();loggedOut.el('newChat').click();assert.equal(loggedOut.cleared,0);await loggedOut.el('logout').click();assert.equal(loggedOut.cleared,1);
 const unauthorized=await mainApp();unauthorized.setFetch(async()=>Response.json({error:'Oturum kapalı'},{status:401}));await assert.rejects(unauthorized.window.testApi('notes/command',{}));assert.equal(unauthorized.cleared,1);
 const malformed=await mainApp();malformed.setFetch(async()=>new Response('Unauthorized',{status:401}));await assert.rejects(malformed.window.testApi('notes/command',{}));assert.equal(malformed.cleared,1);
});

test('real main chat response opens the offline page before its busy state is released',async()=>{
 const env=await mainApp();env.el('message').value='Çevrimdışı kayıtlarımı aç';await env.el('chatForm').handlers.submit({preventDefault(){}});assert.deepEqual(env.navigations,['/offline.html']);assert.equal(env.cleared,0);assert.deepEqual(env.sent,['/api/session','/api/chat']);
});

function manualTimers(){const pending=new Map();let id=0;return {pending,setTimeout(fn,ms){pending.set(++id,{fn,ms});return id;},clearTimeout(key){pending.delete(key);},fire(){for(const {fn} of [...pending.values()])fn();}};}
test('every service-worker enable wait is bounded and identifies its stalled public stage',async()=>{
 for(const stage of ['register','activation','ready','cache-open','cache-match']){
  const timers=manualTimers(),env=entryEnvironment({timers}),progress=[];await env.initialize();
  if(stage==='register')env.navigator.serviceWorker.register=()=>new Promise(()=>{});
  if(stage==='activation')env.registration.active.state='installing';
  if(stage==='ready')env.navigator.serviceWorker.ready=new Promise(()=>{});
  if(stage==='cache-open')env.caches.open=()=>new Promise(()=>{});
  if(stage==='cache-match')env.caches.open=async()=>({match:()=>new Promise(()=>{})});
  const pending=env.window.AtlasOfflineShell.enable(message=>progress.push(message)),rejected=assert.rejects(pending,/zamanında tamamlanmadı/);await new Promise(resolve=>setImmediate(resolve));assert.equal(timers.pending.size,1,stage);assert.ok([...timers.pending.values()][0].ms<=15000);timers.fire();await rejected;assert.ok(progress.length>=1);assert.equal(timers.pending.size,0);
 }
});

test('installation diagnostics accept only the own worker public status while explicit enable is active',async()=>{
 const env=entryEnvironment(),progress=[];await env.initialize();let listener,removed,release;
 env.navigator.serviceWorker.addEventListener=(_type,fn)=>listener=fn;env.navigator.serviceWorker.removeEventListener=(_type,fn)=>removed=fn;
 env.navigator.serviceWorker.register=()=>new Promise(resolve=>release=resolve);
 const pending=env.window.AtlasOfflineShell.enable(message=>progress.push(message));
 const event={origin,source:{scriptURL:origin+'/sw.js'},data:{type:'atlas-shell-status',text:'Çevrimdışı kurulum: dosyalar alındı.'}};
 listener({...event,source:{scriptURL:origin+'/other.js'}});listener({...event,origin:'https://other.example'});listener({...event,data:{...event.data,token:'secret'}});assert.equal(progress.length,1);
 listener(event);assert.equal(progress.at(-1),event.data.text);release(env.registration);await pending;assert.equal(removed,listener);
});

test('specific public installation failure survives a later generic worker error',async()=>{
 const env=entryEnvironment();let listener,rejectRegistration;
 env.navigator.serviceWorker.addEventListener=(_type,fn)=>listener=fn;env.navigator.serviceWorker.removeEventListener=()=>{};env.navigator.serviceWorker.register=()=>new Promise((_resolve,reject)=>rejectRegistration=reject);
 const pending=env.window.AtlasOfflineShell.enable(),rejected=assert.rejects(pending,/offline\.js alınamadı/);
 listener({origin,source:{scriptURL:origin+'/sw.js'},data:{type:'atlas-shell-status',text:'Çevrimdışı kurulum durdu: offline.js alınamadı (ağ veya süre sınırı).'}});rejectRegistration(Error('generic'));await rejected;
});
