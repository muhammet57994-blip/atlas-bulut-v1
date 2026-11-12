(()=>{
 const el=id=>document.getElementById(id);let images=[],version=0,controller=null,result='';
 function clear(){version++;controller?.abort();controller=null;images=[];result='';el('instagramFiles').value='';el('instagramGoal').value='';el('instagramConsent').checked=false;el('instagramPreviews').replaceChildren();el('instagramResult').textContent='';el('instagramResult').hidden=true;el('instagramListen').hidden=true;el('instagramStatus').textContent='';el('instagramAnalyze').disabled=false;el('instagramFiles').disabled=false;}
 function clearToken(){el('igAccountConsent').checked=false;}
 function close(){clear();clearToken();endConversation();el('instagramDialog').close();}
 function open(){if(busy){notice('Önce mevcut yanıtın bitmesini bekleyin.');return;}endConversation();if(!loggedIn){showLogin();return;}el('instagramDialog').showModal();}
 el('voiceInstagram').addEventListener('click',open);el('textInstagram').addEventListener('click',open);
 el('instagramClose').addEventListener('click',close);el('instagramDialog').addEventListener('cancel',event=>{event.preventDefault();close();});window.addEventListener('pagehide',clear);
 async function prepare(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('JPG, PNG veya WebP seçin. Her dosya en fazla 10 MB olabilir.');
  const bitmap=await createImageBitmap(file);
  try{
   if(bitmap.width*bitmap.height>24000000||!bitmap.width||!bitmap.height)throw Error('Görsel çok büyük. Ekran görüntüsünü kırpıp yeniden seçin.');
   const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
   const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   let url=canvas.toDataURL('image/jpeg',.88);if(url.length>1398000)url=canvas.toDataURL('image/jpeg',.65);
   if(url.length>1398000)throw Error('Görsel hazırlanamadı. Daha küçük bir bölümünü kırpıp deneyin.');
   return {mimeType:'image/jpeg',data:url.split(',')[1]};
  }finally{bitmap.close();}
 }
 el('instagramFiles').addEventListener('change',async()=>{
  const current=++version;images=[];result='';el('instagramResult').textContent='';el('instagramResult').hidden=true;el('instagramListen').hidden=true;el('instagramPreviews').replaceChildren();el('instagramConsent').checked=false;el('instagramAnalyze').disabled=true;
  const files=[...el('instagramFiles').files];
  try{if(!files.length||files.length>3)throw Error('Bir ile üç arasında ekran görüntüsü seçin.');el('instagramStatus').textContent='Görseller bu cihazda hazırlanıyor; henüz gönderilmedi.';
   const prepared=[];for(const file of files){prepared.push(await prepare(file));if(current!==version)return;}
   images=prepared;images.forEach((image,index)=>{const figure=document.createElement('figure'),preview=document.createElement('img'),caption=document.createElement('figcaption');preview.src='data:image/jpeg;base64,'+image.data;preview.alt='Seçilen ekran görüntüsü '+(index+1);caption.textContent='Görsel '+(index+1);figure.append(preview,caption);el('instagramPreviews').append(figure);});el('instagramStatus').textContent='Hazır. Görselleri kontrol edin, hedefinizi yazın ve gönderimi onaylayın.';
  }catch(error){if(current===version)el('instagramStatus').textContent=error.message;}finally{if(current===version)el('instagramAnalyze').disabled=false;}
 });
 el('instagramForm').addEventListener('submit',async event=>{
  event.preventDefault();if(controller)return;if(!images.length||!el('instagramConsent').checked){el('instagramStatus').textContent='Görsel seçin ve gönderimi onaylayın.';return;}
  const current=version;controller=new AbortController();const active=controller;const timer=setTimeout(()=>active.abort(),50000);el('instagramAnalyze').disabled=true;el('instagramFiles').disabled=true;el('instagramResult').hidden=true;el('instagramListen').hidden=true;result='';el('instagramStatus').textContent='Profil ve istatistikler inceleniyor…';
  try{const response=await fetch('/api/instagram/analyze',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,goal:el('instagramGoal').value,confirmed:true}),signal:active.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Analiz tamamlanamadı.');if(current!==version)return;
   result=data.text;el('instagramResult').textContent=result;el('instagramResult').hidden=false;el('instagramListen').hidden=false;el('instagramStatus').textContent=data.incomplete?'Yanıt sınırına ulaşıldı. Görselleri azaltıp daha dar bir hedefle tekrar deneyebilirsiniz.':'Analiz hazır, Efendim. Bulgular yalnızca seçtiğiniz ekranlara dayanıyor.';
  }catch(error){if(current===version)el('instagramStatus').textContent=error.name==='AbortError'?'Analiz zamanında alınamadı. Yeniden deneyebilirsiniz.':error.message;}finally{clearTimeout(timer);if(current===version){controller=null;el('instagramAnalyze').disabled=false;el('instagramFiles').disabled=false;}}
 });
 el('instagramListen').addEventListener('click',()=>{if(result)speak(result);});
 window.addEventListener('pagehide',clearToken);
 async function account(action,body={}){
  if(controller)return;const current=version;controller=new AbortController();const active=controller;const timer=setTimeout(()=>active.abort(),50000);
  if(action==='report'){result='';el('instagramResult').textContent='';el('instagramResult').hidden=true;el('instagramListen').hidden=true;}
  const buttons=['igAccountConnect','igAccountRefresh','igAccountReport'];buttons.forEach(id=>el(id).disabled=true);el('igAccountStatus').textContent='Kontrol ediliyor…';
  try{const response=await fetch('/api/instagram/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:active.signal});const data=await response.json();if(current!==version)return;if(!response.ok)throw Error(data.error||'Bağlantı kontrol edilemedi.');
   el('igAccountStatus').textContent=data.connected?'celik38__ bağlantısı kayıtlı. Güncel erişim rapor alınırken doğrulanır.':'Hesap bağlantısı henüz tamamlanmadı.';
   if(action==='connect')el('igAccountStatus').textContent=data.text;
   if(action==='report'){result=data.text;el('instagramResult').textContent=(data.period?'Dönem: '+data.period+'\n\n':'')+result;el('instagramResult').hidden=false;el('instagramListen').hidden=false;}
  }catch(error){if(current===version)el('igAccountStatus').textContent=error.name==='AbortError'?'İstek zamanında tamamlanmadı. Yeniden deneyebilirsiniz.':error.message;}
  finally{clearTimeout(timer);buttons.forEach(id=>el(id).disabled=false);if(controller===active)controller=null;}
 }
 el('igContentPlan').addEventListener('click',async()=>{
  if(controller)return;const current=version;const active=new AbortController();controller=active;el('igContentPlan').disabled=true;el('igAccountStatus').textContent='İstatistiklere göre 7 günlük taslak hazırlanıyor…';const timer=setTimeout(()=>active.abort(),50000);
  result='';el('instagramResult').hidden=true;el('instagramListen').hidden=true;
  try{const r=await fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:'Instagram içerik planımı hazırla'}]}),signal:active.signal});const d=await r.json();if(current!==version)return;if(!r.ok)throw Error(d.error||'Plan hazırlanamadı.');result=d.text;el('instagramResult').textContent=result;el('instagramResult').hidden=false;el('instagramListen').hidden=false;el('igAccountStatus').textContent=d.incomplete?'Plan kısmi olabilir; yanıt sınırına ulaşıldı.':'Taslak hazır. Paylaşım veya kayıt yapılmadı.';
  }catch(e){if(current===version)el('igAccountStatus').textContent=e.name==='AbortError'?'Plan zamanında alınamadı. Yeniden deneyebilirsiniz.':e.message;}finally{clearTimeout(timer);el('igContentPlan').disabled=false;if(controller===active)controller=null;}
 });
 async function organizer(command,calendar=false){
  if(controller)return;const current=version,active=new AbortController();controller=active;const timer=setTimeout(()=>active.abort(),50000);
  const status=el(calendar?'calendarStatus':'igAccountStatus');status.textContent='Hazırlanıyor…';
  try{const r=await fetch('/api/chat',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',text:command}]}),signal:active.signal}),d=await r.json();if(current!==version)return;if(!r.ok)throw Error(d.error||'İşlem tamamlanamadı.');status.textContent=d.text;
   if(calendar){el('calendarItems').replaceChildren();for(const item of d.items||[]){const row=document.createElement('p');row.textContent='#'+item.id+' · '+item.due_date+' · '+item.format+' · '+item.title+' · '+(item.published?'Paylaşıldı (sizin bildiriminiz)':'Planlandı');el('calendarItems').append(row);}el('calendarInput').value='';}
   else{result=d.text;el('instagramResult').textContent=result;el('instagramResult').hidden=false;el('instagramListen').hidden=false;}
  }catch(e){if(current===version)status.textContent=e.name==='AbortError'?'İstek zamanında tamamlanmadı; yeniden kontrol edin.':e.message;}finally{clearTimeout(timer);if(controller===active)controller=null;}
 }
 el('calendarForm').addEventListener('submit',event=>{event.preventDefault();organizer(el('calendarInput').value,true);});
 el('calendarRefresh').addEventListener('click',()=>organizer('İçerik takvimimi göster',true));
 el('igCompare').addEventListener('click',()=>organizer('Instagram paylaşımlarımı karşılaştır'));
 el('igSaveMeasurement').addEventListener('click',()=>organizer('Instagram ölçümünü kaydet'));
 el('igAccountRefresh').addEventListener('click',()=>account('status'));
 el('igAccountReport').addEventListener('click',()=>account('report'));
 el('igAccountForm').addEventListener('submit',async event=>{event.preventDefault();if(controller||!el('igAccountConsent').checked)return;if(location.origin!=='https://atlas-pasam-v1.pages.dev'){location.assign('https://atlas-pasam-v1.pages.dev/?instagram=setup');return;}el('igAccountConnect').disabled=true;try{const r=await fetch('/api/instagram/oauth/start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});const d=await r.json();if(!r.ok)throw Error(d.error||'Bağlantı başlatılamadı.');const u=new URL(d.url);if(u.origin!=='https://www.instagram.com'||u.pathname!=='/oauth/authorize')throw Error('Giriş adresi doğrulanamadı.');location.assign(u.href);}catch(error){el('igAccountStatus').textContent=error.message;el('igAccountConnect').disabled=false;}});
 const state=new URLSearchParams(location.search).get('instagram');if(state){const messages={connected:'Instagram hesabınız bağlandı. Instagram analizi düğmesinden raporu açabilirsiniz.',setup:'Giriş yaptıktan sonra Instagram analizi → Instagram ile güvenli bağlan düğmesini kullanın.',permissions:'İstenen iki okuma izni doğrulanamadı. Bağlantı kaydedilmedi.',account:'Hesap celik38__ ile eşleşmedi. Bağlantı kaydedilmedi.',state:'Güvenli giriş oturumu sona erdi. Instagram bağlantısını yeniden başlatın.',cancelled:'Instagram bağlantısı iptal edildi.',exchange:'Instagram yetkilendirmesi tamamlanamadı. Uygulama ayarları kontrol edilmeli.',validation:'Instagram hesap doğrulaması tamamlanamadı.',code:'Instagram yetkilendirme kodu alınamadı.'};el('igAccountStatus').textContent=messages[state]||'Instagram bağlantısını kontrol edin.';notice(messages[state]||'Instagram bağlantısını kontrol edin.');history.replaceState(null,'','/');}
})();
