// Public shell only. Never cache API responses, the authenticated app, or queries.
const CACHE='atlas-offline-public-v1',PREFIX='atlas-offline-public-';
const TYPES=new Map([
 ['/offline.html','text/html'],['/offline.js','application/javascript'],['/offline.css','text/css'],
 ['/offline-store.js','application/javascript'],['/offline-entry.js','application/javascript'],['/icon.svg','image/svg+xml']
]);
function report(text){
 // Public installation progress only; never send cache bodies or request data.
 if(typeof self.clients.matchAll!=='function')return Promise.resolve();
 return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:'atlas-shell-status',text});}).catch(()=>{});
}
function bounded(promise){let timer;return Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('public shell timeout')),10000);})]).finally(()=>clearTimeout(timer));}
function publicResponse(response,path){
 if(!response||response.status!==200||!['basic','default'].includes(response.type)||response.redirected)return false;
 if(response.url){const url=new URL(response.url);if(url.origin!==self.location.origin||url.pathname!==path||url.search||url.hash)return false;}
 const type=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
 const expected=TYPES.get(path),matches=type===expected||expected==='application/javascript'&&type==='text/javascript';
 return matches&&!response.headers.has('Set-Cookie')&&!response.headers.has('WWW-Authenticate')&&!/\bprivate\b/iu.test(response.headers.get('Cache-Control')||'')&&!/\b(cookie|authorization)\b/iu.test(response.headers.get('Vary')||'');
}
async function publicFetch(path,consume=false){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch(new Request(self.location.origin+path,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal}));
  if(!consume)return response;
  if(!publicResponse(response,path))throw Error('invalid public shell');
  // Drain a clone to release the connection, preserving the original response's
  // URL/type/encoding metadata for CacheStorage and eventual browser rendering.
  await response.clone().arrayBuffer();return response;
 }finally{clearTimeout(timer);}
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 let failureReported=false;
 try{
  report('Çevrimdışı kurulum: herkese açık dosyalar alınıyor…');
  const responses=[];
  for(const path of TYPES.keys()){
   report('Çevrimdışı kurulum: '+path.slice(1)+' alınıyor…');
   try{responses.push([path,await publicFetch(path,true)]);report('Çevrimdışı kurulum: '+path.slice(1)+' alındı.');}
   catch(error){failureReported=true;await bounded(report('Çevrimdışı kurulum durdu: '+path.slice(1)+(error.message==='invalid public shell'?' yanıtı doğrulanamadı.':' alınamadı (ağ veya süre sınırı).')));throw error;}
  }
  report('Çevrimdışı kurulum: tarayıcı dosya deposu açılıyor…');
  const cache=await bounded(caches.open(CACHE));
  report('Çevrimdışı kurulum: dosyalar cihazda saklanıyor…');
  await bounded(Promise.all(responses.map(([path,response])=>cache.put(self.location.origin+path,response))));
  report('Çevrimdışı kurulum: sayfa etkinleştiriliyor…');
  await bounded(self.skipWaiting());
 }catch(error){if(!failureReported)await bounded(report('Çevrimdışı kurulum durdu: ortak dosyalar cihazda hazırlanamadı.'));throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 report('Çevrimdışı kurulum: önceki ortak dosyalar kontrol ediliyor…');
 for(const name of await bounded(caches.keys()))if(name.startsWith(PREFIX)&&name!==CACHE)await bounded(caches.delete(name));
 report('Çevrimdışı kurulum: tarayıcı bağlantısı açılıyor…');
 await bounded(self.clients.claim());
 report('Çevrimdışı kurulum: ortak sayfa dosyaları hazır.');
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.search||url.hash||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'&&['/','/index.html','/offline.html'].includes(url.pathname)){
  event.respondWith((async()=>{
   try{return await fetch(request);}catch{const cached=await (await caches.open(CACHE)).match(self.location.origin+'/offline.html');if(cached)return cached;throw Error('offline shell unavailable');}
  })());return;
 }
 if(!TYPES.has(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await publicFetch(url.pathname);if(publicResponse(response,url.pathname))await cache.put(self.location.origin+url.pathname,response.clone());return response;}
  catch{const cached=await cache.match(self.location.origin+url.pathname);if(cached)return cached;throw Error('offline asset unavailable');}
 })());
});
