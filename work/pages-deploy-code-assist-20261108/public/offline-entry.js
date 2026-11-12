// Loading this script never registers a service worker or stores private data.
(()=>{
 'use strict';
 const assets=['/offline.html','/offline.js','/offline.css','/offline-store.js','/offline-entry.js','/icon.svg'];
 const cacheName='atlas-offline-public-v1';
 const fail=()=>Error('Çevrimdışı sayfa kurulamadı, Efendim. Bağlantınızı kontrol edip yeniden deneyin.');
 function deadline(promise,stage,milliseconds){let timer;return Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Efendim, '+stage+' zamanında tamamlanmadı. Bağlantınızı kontrol edip yeniden deneyin.')),milliseconds);})]).finally(()=>clearTimeout(timer));}
 function activated(registration){
  const worker=registration.installing||registration.waiting||registration.active;
  if(!worker)return Promise.reject(fail());
  if(worker.state==='activated')return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const listener=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',listener);resolve();}else if(worker.state==='redundant'){worker.removeEventListener('statechange',listener);reject(fail());}};
   worker.addEventListener('statechange',listener);listener();
  });
 }
 window.AtlasOfflineShell=Object.freeze({async enable(progress){
  if(!navigator.serviceWorker||!window.caches)throw fail();
  const origin=window.location.origin,script=origin+'/sw.js',scope=origin+'/';
  const until=Date.now()+25000,wait=(promise,stage)=>deadline(promise,stage,Math.min(15000,Math.max(1,until-Date.now())));
  const report=message=>{if(typeof progress==='function')progress(message);};
  let lastFailure='';
  const installation=event=>{const data=event.data;if(event.source?.scriptURL!==script||event.origin&&event.origin!==origin||!data||Object.keys(data).length!==2||data.type!=='atlas-shell-status'||typeof data.text!=='string'||data.text.length>180||/[\r\n]/u.test(data.text))return;if(data.text.startsWith('Çevrimdışı kurulum durdu:'))lastFailure=data.text;report(data.text);};
  navigator.serviceWorker.addEventListener?.('message',installation);
  try{
  report('Çevrimdışı sayfa: tarayıcı kaydı açılıyor…');
  const registration=await wait(navigator.serviceWorker.register('/sw.js',{scope:'/'}),'çevrimdışı tarayıcı kaydı');
  if(registration.scope!==scope)throw fail();
  report('Çevrimdışı sayfa: dosyalar kuruluyor…');
  await wait(activated(registration),'çevrimdışı dosyaların kurulumu');
  report('Çevrimdışı sayfa: tarayıcı bağlantısı doğrulanıyor…');
  const ready=await wait(navigator.serviceWorker.ready,'çevrimdışı tarayıcı bağlantısı');
  if(ready.scope!==scope||ready.active?.scriptURL!==script||ready.active?.state!=='activated'||registration.active?.scriptURL!==script||registration.active?.state!=='activated')throw fail();
  report('Çevrimdışı sayfa: cihaz dosyaları doğrulanıyor…');
  const cache=await wait(window.caches.open(cacheName),'çevrimdışı dosya deposu');
  const saved=await wait(Promise.all(assets.map(path=>cache.match(origin+path))),'çevrimdışı dosyaların doğrulanması');
  if(saved.some(response=>!response||response.status!==200))throw fail();
  return true;
  }catch(error){throw lastFailure?Error(lastFailure):error;}finally{navigator.serviceWorker.removeEventListener?.('message',installation);}
 }});
 window.openOffline=(fromResponse=false)=>{
  if(typeof busy!=='undefined'&&busy&&fromResponse!==true){if(typeof notice==='function')notice('Efendim, işlem tamamlanınca cihaz kopyasını açabilirsiniz.');return false;}
  window.location.assign('/offline.html');return true;
 };
 window.handleOffline=data=>data?.offlineOpen===true?window.openOffline(true):false;
 window.clearOfflineDevice=()=>window.AtlasOfflineStore?.clear()??Promise.resolve();
 for(const id of ['voiceOffline','textOffline'])document.getElementById(id)?.addEventListener('click',window.openOffline);
})();
