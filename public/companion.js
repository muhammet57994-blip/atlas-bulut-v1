// Personal workspace: transient drafts, explicit approval, no background actions.
(()=>{
 const el=id=>document.getElementById(id),stepNames={records:'İlgili kayıtları bul',calendar:'İçerik takvimine bak',day:'Gün planı taslağı',content:'İçerik paketi taslağı',review:'Gelişim değerlendirmesi'};
 let generation=0,working=false,pendingRoutine=null,mic=null,micTimer=null,visualImages=[],visualResult='',controller=null;
 const steps=()=>['records','calendar','day','content','review'].filter(s=>el('routineStep-'+s).checked);
 function stopMic(){clearTimeout(micTimer);micTimer=null;const old=mic;mic=null;if(old){old.onresult=null;old.onerror=null;old.onend=null;old.abort();}}
 function listen(status,onText){
  if(working)return;stopMic();endConversation();if(!SpeechRecognition){status.textContent='Ses tanıma için Chrome kullanın; yazılı alanlar da kullanılabilir.';return;}
  const rec=new SpeechRecognition(),current=generation;mic=rec;rec.lang='tr-TR';rec.continuous=false;rec.interimResults=false;status.textContent='Dinliyorum, Efendim.';
  rec.onresult=e=>{if(mic!==rec||current!==generation)return;const text=Array.from(e.results).map(r=>r[0].transcript).join(' ').trim();stopMic();if(text)onText(text);};
  rec.onerror=()=>{if(mic!==rec)return;stopMic();status.textContent='Mikrofon kullanılamadı. İzni kontrol edin veya yazılı alanı kullanın.';};
  rec.onend=()=>{if(mic===rec){stopMic();status.textContent='Ses alınamadı; işlem yapılmadı.';}};
  micTimer=setTimeout(()=>{stopMic();status.textContent='Dinleme süresi bitti; işlem yapılmadı.';},15000);
  try{rec.start();}catch{stopMic();status.textContent='Mikrofon başlatılamadı.';}
 }
 function clearVisual(){visualImages=[];visualResult='';el('visualFiles').value='';el('visualQuestion').value='';el('visualConsent').checked=false;el('visualPreviews').replaceChildren();el('visualResult').textContent='';el('visualListen').hidden=true;el('visualStatus').textContent='';for(const id of ['visualAnalyze','visualFiles','visualQuestion','visualAsk'])el(id).disabled=false;}
 function closePanels(){generation++;stopMic();controller?.abort();controller=null;working=false;pendingRoutine=null;clearVisual();for(const id of ['workshopDialog','routineDraftDialog','visualDialog'])el(id).close();endConversation();}
 window.clearCompanion=()=>{closePanels();el('workshopResult').textContent='';el('routineItems').replaceChildren();el('routineDraftText').textContent='';el('resumeTopic').value='';el('routineTrigger').value='';el('routineTopic').value='';};
 function openWorkshop(){if(busy||working)return;stopMic();endConversation();if(!loggedIn){showLogin();return;}el('workshopDialog').showModal();}
 function openVisual(){if(working)return;stopMic();endConversation();if(!loggedIn){showLogin();return;}el('workshopDialog').close();el('visualDialog').showModal();}
 function renderRoutineDraft(draft){
  stopMic();endConversation();pendingRoutine=draft;el('workshopDialog').close();el('routineDraftText').textContent=draft.text;el('routineDraftStatus').textContent='Henüz kaydedilmedi. Onay süresi 30 dakika.';el('routineSave').disabled=false;el('routineApproveVoice').disabled=false;if(!el('routineDraftDialog').open)el('routineDraftDialog').showModal();
 }
 function renderRoutineList(items){el('routineItems').replaceChildren();for(const item of items){const row=document.createElement('article'),title=document.createElement('h4'),description=document.createElement('p'),button=document.createElement('button');row.className='workshop-routine';title.textContent=item.trigger;description.textContent=item.topic+' · '+item.steps.map(s=>stepNames[s]).join(' → ');button.className='quiet';button.textContent='Rutini çalıştır';button.addEventListener('click',()=>request(item.trigger));row.append(title,description,button);el('routineItems').append(row);}}
 window.handleCompanion=data=>{
  if(data.visualOpen){openVisual();return true;}
  if(data.routineDraft){renderRoutineDraft(data.routineDraft);return true;}
  if(data.routineBuilder||data.resumeBuilder){endConversation();el('workshopDialog').showModal();if(data.suggestedTrigger)el('routineTrigger').value=data.suggestedTrigger;el('workshopStatus').textContent=data.text;if(data.resumeBuilder)el('resumeTopic').focus();else el('routineTrigger').focus();return true;}
  if(data.routineItems){renderRoutineList(data.routineItems);}
  return false;
 };
 async function request(command,extra={}){
  if(working||busy)return;stopMic();endConversation();working=true;const current=generation;el('workshopStatus').textContent='Kayıtlara bakıyorum…';
  try{const data=await api('chat',{messages:[{role:'user',text:command}],...extra});if(current!==generation)return;el('workshopResult').textContent=data.text;el('workshopStatus').textContent='Hazır, Efendim.';
   if(data.planDraft){el('workshopDialog').close();window.showPlanDraft(data.planDraft);return;}if(window.handleCompanion(data))return;await speak(data.text);
  }catch(e){if(current===generation)el('workshopStatus').textContent=e.message;}finally{if(current===generation)working=false;}
 }
 async function saveRoutine(){
  if(!pendingRoutine||working)return;stopMic();endConversation();working=true;const current=generation;el('routineSave').disabled=true;el('routineApproveVoice').disabled=true;el('routineDraftStatus').textContent='Onayladığınız rutin kaydediliyor…';
  try{const data=await api('chat',{messages:[{role:'user',text:'Rutini onaylıyorum'}],routineConfirmation:{token:pendingRoutine.token,confirmed:true}});if(current!==generation)return;pendingRoutine=null;el('routineDraftDialog').close();el('workshopDialog').showModal();el('workshopStatus').textContent=data.text;el('routineDraftText').textContent='';await speak(data.text);}
  catch(e){if(current===generation)el('routineDraftStatus').textContent=e.message;}finally{if(current===generation){working=false;el('routineSave').disabled=false;el('routineApproveVoice').disabled=false;}}
 }
 function cancelRoutine(){if(working)return;stopMic();pendingRoutine=null;el('routineDraftText').textContent='';el('routineDraftDialog').close();endConversation();notice('Rutin kaydedilmedi.');}
 for(const id of ['voiceCompanion','textCompanion'])el(id).addEventListener('click',openWorkshop);
 el('workshopClose').addEventListener('click',closePanels);el('workshopDialog').addEventListener('cancel',e=>{e.preventDefault();closePanels();});
 el('resumeForm').addEventListener('submit',e=>{e.preventDefault();const topic=el('resumeTopic').value.trim();if(topic)request('Nerede kalmıştık: '+topic);});
 el('resumeVoice').addEventListener('click',()=>listen(el('workshopStatus'),text=>{el('resumeTopic').value=text.slice(0,100);request('Nerede kalmıştık: '+text.slice(0,100));}));
 el('routineForm').addEventListener('submit',e=>{e.preventDefault();request('Bu komutu öğren',{routineDraftRequest:{trigger:el('routineTrigger').value.trim(),topic:el('routineTopic').value.trim(),steps:steps()}});});
 for(const [button,input] of [['routineTriggerVoice','routineTrigger'],['routineTopicVoice','routineTopic']])el(button).addEventListener('click',()=>listen(el('workshopStatus'),text=>{el(input).value=text.slice(0,input==='routineTrigger'?120:100);el('workshopStatus').textContent='Metni kontrol edin; henüz kaydedilmedi.';}));
 el('routineList').addEventListener('click',()=>request('Rutinlerimi göster'));
 el('routineSave').addEventListener('click',saveRoutine);el('routineCancel').addEventListener('click',cancelRoutine);el('routineDraftDialog').addEventListener('cancel',e=>{e.preventDefault();cancelRoutine();});
 el('routineDraftListen').addEventListener('click',()=>{if(pendingRoutine&&!working){stopMic();speak(pendingRoutine.text);}});
 el('routineApproveVoice').addEventListener('click',()=>{if(!pendingRoutine)return;listen(el('routineDraftStatus'),text=>{const t=text.trim().replace(/[.!?]+$/u,'').toLocaleLowerCase('tr-TR');if(t==='rutini onaylıyorum')saveRoutine();else if(/^(vazgeç|iptal)$/u.test(t))cancelRoutine();else el('routineDraftStatus').textContent='Kaydetmek için “Rutini onaylıyorum” deyin. Rutin kaydedilmedi.';});});
 el('workshopVisual').addEventListener('click',openVisual);
 for(const id of ['visualClose'])el(id).addEventListener('click',closePanels);el('visualDialog').addEventListener('cancel',e=>{e.preventDefault();closePanels();});
 async function prepare(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('JPG, PNG veya WebP seçin; dosya başına en fazla 10 MB.');
  const image=await createImageBitmap(file);try{if(!image.width||!image.height||image.width*image.height>24000000)throw Error('Görseli daha küçük bir alana kırpın.');const scale=Math.min(1,1280/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);let url=canvas.toDataURL('image/jpeg',.85);if(url.length>1300000)url=canvas.toDataURL('image/jpeg',.65);if(url.length>1300000)throw Error('Görsel çok büyük; daha küçük bir bölümü seçin.');return {mimeType:'image/jpeg',data:url.split(',')[1]};}finally{image.close();}
 }
 el('visualFiles').addEventListener('change',async()=>{
  stopMic();endConversation();const current=++generation;controller?.abort();controller=null;working=true;visualImages=[];visualResult='';el('visualConsent').checked=false;el('visualPreviews').replaceChildren();el('visualResult').textContent='';el('visualListen').hidden=true;el('visualAnalyze').disabled=true;el('visualStatus').textContent='Görseller bu cihazda hazırlanıyor; henüz gönderilmedi.';
  try{const files=[...el('visualFiles').files];if(files.length<1||files.length>2)throw Error('Bir veya iki görsel seçin.');const prepared=[];for(const file of files){prepared.push(await prepare(file));if(current!==generation)return;}visualImages=prepared;for(const [i,img] of prepared.entries()){const preview=document.createElement('img');preview.src='data:image/jpeg;base64,'+img.data;preview.alt='Seçilen görsel '+(i+1);el('visualPreviews').append(preview);}el('visualStatus').textContent='Görseller hazır. Sorunuzu yazın veya konuşarak söyleyin. Göndermek için onay kutusunu işaretleyin.';}
  catch(e){if(current===generation)el('visualStatus').textContent=e.message;}finally{if(current===generation){working=false;el('visualAnalyze').disabled=false;}}
 });
 async function analyze(){
  if(working)return;stopMic();endConversation();const question=el('visualQuestion').value.trim();if(!visualImages.length||!question||!el('visualConsent').checked){el('visualStatus').textContent='Görsel seçin, sorunuzu belirtin ve gönderimi onaylayın.';return;}
  const current=generation,active=new AbortController();controller=active;working=true;const timer=setTimeout(()=>active.abort(),35000);el('visualAnalyze').disabled=true;el('visualFiles').disabled=true;el('visualQuestion').disabled=true;el('visualAsk').disabled=true;el('visualResult').textContent='';el('visualListen').hidden=true;visualResult='';el('visualStatus').textContent='Seçtiğiniz görselleri inceliyorum…';
  try{const r=await fetch('/api/visual/analyze',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({images:visualImages,question,confirmed:true}),signal:active.signal}),data=await r.json();if(current!==generation)return;if(!r.ok)throw Error(data.error||'Görsel incelenemedi.');visualResult=data.text;el('visualResult').textContent=data.text;el('visualListen').hidden=false;el('visualStatus').textContent='Hazır, Efendim. Bu yorum yalnızca seçtiğiniz görsellere dayanır; kayıt oluşturulmadı.';await speak(data.text);}
  catch(e){if(current===generation)el('visualStatus').textContent=e.name==='AbortError'?'Yanıt zamanında gelmedi. İsterseniz yeniden deneyin.':e.message;}
  finally{clearTimeout(timer);if(current===generation){working=false;controller=null;el('visualAnalyze').disabled=false;el('visualFiles').disabled=false;el('visualQuestion').disabled=false;el('visualAsk').disabled=false;el('visualConsent').checked=false;}}
 }
 el('visualForm').addEventListener('submit',e=>{e.preventDefault();analyze();});
 el('visualAsk').addEventListener('click',()=>listen(el('visualStatus'),text=>{el('visualQuestion').value=text.slice(0,1000);if(el('visualConsent').checked)analyze();else el('visualStatus').textContent='Sorunuz hazır. Görsel gönderimini onaylayıp “İncele ve anlat”a dokunun.';}));
 el('visualListen').addEventListener('click',()=>{if(visualResult&&!working){stopMic();speak(visualResult);}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMic();});window.addEventListener('pagehide',closePanels);
})();
