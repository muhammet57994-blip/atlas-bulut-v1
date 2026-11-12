(()=>{
 const $=id=>document.getElementById(id);
 const MAX_SCENES=6,MAX_FILE=10*1024*1024,MAX_TOTAL=30*1024*1024,MAX_PIXELS=36000000;
 const MIME_TYPES=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4'];
 const scenes=[];let outputUrl='',outputFile=null,recorder=null,stream=null,audioContext=null,activeRequest=null,raf=0,previewRaf=0,previewTimer=0,runId=0,working=false,needsRender=false,localAiWorking=false;
 function validateFiles(files){
  if(!files.length)return{ok:false,error:'Önce en az bir fotoğraf seçin.'};
  if(files.length>MAX_SCENES)return{ok:false,error:`Bir videoda en fazla ${MAX_SCENES} fotoğraf kullanabilirsiniz.`};
  let total=0;
  for(const file of files){
   if(!['image/jpeg','image/png','image/webp'].includes(file.type))return{ok:false,error:'Yalnızca JPG, PNG veya WebP fotoğrafları seçin.'};
   if(file.size>MAX_FILE)return{ok:false,error:'Her fotoğraf en fazla 10 MB olabilir.'};
   total+=file.size;if(total>MAX_TOTAL)return{ok:false,error:'Fotoğrafların toplam boyutu 30 MB sınırını aşıyor.'};
  }
  return{ok:true};
 }
 function chooseMimeType(MediaRecorderApi){return MIME_TYPES.find(type=>MediaRecorderApi.isTypeSupported(type))||'';}
 function extensionFor(mime){return mime.includes('mp4')?'mp4':'webm';}
 function narrationText(scene){return scene.caption.trim();}
 function makeAsmrSamples(kind,length,random=Math.random){
  const samples=new Float32Array(length),rate=48000;let position=0,low=0;
  if(kind==='rain')for(let i=0;i<length;i++){const white=random()*2-1;low+=.003*(white-low);samples[i]=low*.12+(white-low)*.035;}
  while(position<length){const gap=Math.floor(rate*(kind==='paper'?.35+random()*.55:kind==='tapping'?.24+random()*.34:.45+random()*.55));const size=Math.min(length-position,Math.floor(rate*(kind==='paper'?.18:kind==='tapping'?.11:.22)));const tone=kind==='water'?600+random()*600:kind==='tapping'?700+random()*900:1500+random()*1200;
   for(let j=0;j<size;j++){const t=j/rate,envelope=kind==='paper'?Math.sin(Math.PI*j/size)**2*Math.min(1,t*16):Math.exp(-t*(kind==='water'?15:kind==='rain'?22:32));const sound=kind==='paper'?(random()*2-1):Math.sin(2*Math.PI*(tone*t-(kind==='water'?500*t*t:0)));const value=sound*envelope*(kind==='paper'?.18:.12);const at=position+j;if(kind==='rain')samples[at]=Math.max(-.32,Math.min(.32,samples[at]+value));else samples[at]=value;}
   position+=Math.max(size+1,gap);
  }
  return samples;
 }
 function recorderTypeCandidates(withAudio,userAgent=''){
  const safari=/iPad|iPhone|iPod/u.test(userAgent)||/Safari/u.test(userAgent)&&!/(Chrome|Chromium|Edg|OPR|Android)/u.test(userAgent);
  const webm=withAudio?['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus']:['video/webm;codecs=vp8','video/webm;codecs=vp9'];
  const mp4=withAudio?['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4']:['video/mp4;codecs=avc1.42E01E','video/mp4'];
  return safari?[...mp4,...webm]:[...webm,...mp4];
 }
 window.AtlasVideoStudio={validateFiles,chooseMimeType,extensionFor,narrationText,makeAsmrSamples,recorderTypeCandidates};
 const format=$('videoFormat'),canvas=$('videoPreviewCanvas'),ctx=canvas.getContext('2d');
 function clearOutput(){if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl='';outputFile=null;const video=$('videoOutput');video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('videoDownload').hidden=true;$('videoShare').hidden=true;}
 function showOutput(){const video=$('videoOutput'),anchor=$('videoDownload');if(outputUrl){video.src=outputUrl;video.hidden=false;anchor.href=outputUrl;anchor.hidden=false;}}
 function markEdited(){needsRender=true;if(outputUrl){showOutput();$('videoDownload').textContent='Önceki videoyu indir (düzenleme öncesi)';$('videoStatus').textContent='Düzenleme önizlemede görünüyor. Önceki video korunuyor; yenisi için “Videoyu yeniden oluştur” düğmesine bas.';}updateButtons();}
 function clearScenes(){runId++;working=false;activeRequest?.abort();activeRequest=null;if(raf)cancelAnimationFrame(raf);if(previewRaf)cancelAnimationFrame(previewRaf);if(previewTimer)clearTimeout(previewTimer);raf=0;previewRaf=0;previewTimer=0;if(recorder&&recorder.state!=='inactive')try{recorder.stop();}catch{}if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;recorder=null;clearOutput();needsRender=false;scenes.splice(0);$('videoSceneList').replaceChildren();$('videoFiles').value='';$('videoTopic').value='';$('videoStatus').textContent='';drawEmpty();updateButtons();}
 function dimensions(){switch(format.value){case'square':return[720,720];case'wide':return[1280,720];default:return[720,1280];}}
 function setCanvasSize(){const[w,h]=dimensions();if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}drawPreview();}
 function drawPhoto(photo){
  const [w,h]=dimensions();ctx.fillStyle='#111b24';ctx.fillRect(0,0,w,h);
  const scale=Math.min(w/photo.width,h/photo.height),dw=photo.width*scale,dh=photo.height*scale;
  ctx.drawImage(photo,(w-dw)/2,(h-dh)/2,dw,dh);
 }
 function wrapLines(text,maxWidth,font){
  ctx.font=font;const lines=[];
  for(const paragraph of text.split('\n')){
   const words=paragraph.split(/\s+/u).filter(Boolean);let line='';
   for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}else line=next;}
   if(line)lines.push(line);else if(!words.length)lines.push('');
  }
  return lines;
 }
 function drawScene(index,progress=1){
  const scene=scenes[index];if(!scene){drawEmpty();return;}
  const[w,h]=dimensions();drawPhoto(scene.photo);const topic=$('videoTopic').value.trim();if(topic){const titleFont=`600 ${Math.max(20,Math.round(w*.035))}px "Segoe UI",Arial,sans-serif`,titleLines=wrapLines(topic,w*.78,titleFont).slice(0,2);ctx.fillStyle='rgba(8,14,20,.76)';ctx.fillRect(w*.06,h*.055,w*.88,Math.max(58,titleLines.length*Math.max(22,w*.035)*1.45+24));ctx.font=titleFont;ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';let titleY=h*.055+20+Math.max(20,w*.035)*.72;for(const line of titleLines){ctx.fillText(line,w/2,titleY,w*.8);titleY+=Math.max(22,w*.035)*1.45;}}const bandH=Math.min(h*.34,Math.max(150,h*.18));
  const gradient=ctx.createLinearGradient(0,h-bandH-30,0,h);gradient.addColorStop(0,'rgba(8,14,20,0)');gradient.addColorStop(.18,'rgba(8,14,20,.72)');gradient.addColorStop(1,'rgba(8,14,20,.92)');ctx.fillStyle=gradient;ctx.fillRect(0,h-bandH-30,w,bandH+30);
  const fontSize=Math.max(24,Math.round(w*.047)),font=`600 ${fontSize}px "Segoe UI",Arial,sans-serif`,original=scene.caption.trim(),animation=$('videoTextAnimation').value;let visible=original;
  if(animation==='word'){const words=original.split(/\s+/u);visible=words.slice(0,Math.ceil(words.length*Math.max(0,Math.min(1,progress)))).join(' ');}else if(animation==='type'){const chars=Array.from(original);visible=chars.slice(0,Math.ceil(chars.length*Math.max(0,Math.min(1,progress)))).join('');}
  const lines=wrapLines(visible,w*.82,font).slice(0,5),lineHeight=Math.round(fontSize*1.35),total=lines.length*lineHeight,oldAlpha=ctx.globalAlpha;
  if(animation==='fade')ctx.globalAlpha=Math.max(.08,Math.min(1,progress*3));
  ctx.font=font;ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';
  let y=h-Math.max(42,bandH*.44)-total/2;
  for(const line of lines){ctx.fillText(line,w/2,y,w*.86);y+=lineHeight;}
  ctx.globalAlpha=oldAlpha;
 }
 function drawEmpty(){if(!ctx)return;const[w,h]=dimensions();ctx.fillStyle='#101b22';ctx.fillRect(0,0,w,h);ctx.fillStyle='#b6c9d3';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${Math.max(18,Math.round(w*.035))}px "Segoe UI",Arial,sans-serif`;ctx.fillText('Seçtiğin fotoğraf ve yazılar burada önizlenecek',w/2,h/2,w*.8);}
 function drawPreview(){const index=Number($('videoPreviewIndex').value)||0;drawScene(Math.min(index,Math.max(0,scenes.length-1)));}
 function schedulePreview(){if(previewTimer)clearTimeout(previewTimer);previewTimer=setTimeout(()=>{previewTimer=0;drawPreview();},100);}
 function updateButtons(){
  const needsCaptions=$('videoNarrate').checked||!$('videoAsmr').checked,ready=$('videoTopic').value.trim()&&scenes.length>0&&(!needsCaptions||scenes.every(scene=>scene.caption.trim()));$('videoCreate').disabled=!ready||working||localAiWorking;$('videoSuggest').hidden=!['localhost','127.0.0.1','::1'].includes(window.location.hostname);$('videoCreate').textContent=outputUrl?'Videoyu yeniden oluştur':'Videoyu oluştur';$('videoSuggest').disabled=!scenes.length||working||localAiWorking;
  $('videoPreviewIndex').max=String(Math.max(0,scenes.length-1));$('videoPreviewIndex').disabled=scenes.length<2||working;$('videoPreviewPlay').disabled=scenes.length<1||working;
  $('videoFormat').disabled=working||localAiWorking;$('videoDuration').disabled=working||localAiWorking;$('videoTextAnimation').disabled=working||localAiWorking;$('videoFiles').disabled=scenes.length>=MAX_SCENES||working||localAiWorking;$('videoNarrate').disabled=working||localAiWorking;$('videoSpeechConsent').disabled=working||localAiWorking;$('videoAsmr').disabled=working||localAiWorking;$('videoAsmrStyle').disabled=working||localAiWorking;
  for(const control of $('videoSceneList').querySelectorAll('button,textarea'))control.disabled=working||localAiWorking;
 }
 function renderCards(){
  const list=$('videoSceneList');list.replaceChildren();
  scenes.forEach((scene,index)=>{
   const card=document.createElement('article');card.className='video-scene-card';
   const image=document.createElement('img');image.src=scene.thumb;image.alt='Seçtiğin fotoğraf: '+scene.name;
   const content=document.createElement('div');content.className='video-scene-content';
   const heading=document.createElement('strong');heading.textContent=`Sahne ${index+1} · ${scene.name}`;
   const label=document.createElement('label');label.textContent='Bu fotoğrafla birlikte gösterilecek yazı (isteğe bağlı)';
   const caption=document.createElement('textarea');caption.rows=2;caption.maxLength=120;caption.value=scene.caption;caption.placeholder='Örneğin: El yapımı ürünlerimde her ayrıntıyı özenle hazırlıyorum.';caption.setAttribute('aria-label',`Sahne ${index+1} yazısı`);
   caption.addEventListener('input',()=>{scene.caption=caption.value;scene.suggestion='';schedulePreview();markEdited();});caption.addEventListener('change',renderCards);
   const hintLabel=document.createElement('label');hintLabel.textContent='Fotoğrafta ne var? (Ollama taslağı için)';
   const hint=document.createElement('textarea');hint.rows=2;hint.maxLength=160;hint.value=scene.hint;hint.placeholder='Örneğin: Pencere kenarında kitap okuyan bir kişi';hint.setAttribute('aria-label',`Sahne ${index+1} fotoğraf açıklaması`);
   hint.addEventListener('input',()=>{scene.hint=hint.value;scene.suggestion='';markEdited();});hint.addEventListener('change',renderCards);
   const actions=document.createElement('div');actions.className='video-scene-actions';
   const up=document.createElement('button');up.type='button';up.className='quiet';up.textContent='↑ Yukarı';up.disabled=index===0;up.addEventListener('click',()=>moveScene(index,-1));
   const down=document.createElement('button');down.type='button';down.className='quiet';down.textContent='↓ Aşağı';down.disabled=index===scenes.length-1;down.addEventListener('click',()=>moveScene(index,1));
   const remove=document.createElement('button');remove.type='button';remove.className='quiet';remove.textContent='Fotoğrafı çıkar';remove.addEventListener('click',()=>{scenes.splice(index,1);renderCards();drawPreview();markEdited();});
   actions.append(up,down,remove);content.append(heading,label,caption,hintLabel,hint);
   if(scene.suggestion){const draft=document.createElement('p');draft.className='video-local-ai-note';draft.textContent=`Ollama taslağı: ${scene.suggestion}`;const useSuggestion=document.createElement('button');useSuggestion.type='button';useSuggestion.className='quiet';useSuggestion.textContent='Taslağı bu sahnede kullan';useSuggestion.addEventListener('click',()=>{scene.caption=scene.suggestion;scene.suggestion='';renderCards();drawPreview();markEdited();});const discard=document.createElement('button');discard.type='button';discard.className='quiet';discard.textContent='Taslağı sil';discard.addEventListener('click',()=>{scene.suggestion='';renderCards();});content.append(draft,useSuggestion,discard);}
   content.append(actions);card.append(image,content);list.append(card);
  });
  $('videoSceneCount').textContent=`${scenes.length} / ${MAX_SCENES} sahne`;
 }
 function moveScene(index,delta){const next=index+delta;if(next<0||next>=scenes.length)return;[scenes[index],scenes[next]]=[scenes[next],scenes[index]];$('videoPreviewIndex').value=String(next);renderCards();drawPreview();markEdited();}
 async function preparePhoto(file){
  const bitmap=await createImageBitmap(file);
  try{
   if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>24000000)throw Error('Fotoğrafın çözünürlüğü çok yüksek. Daha küçük bir kopyasını seçin.');
   const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),photo=document.createElement('canvas');photo.width=Math.max(1,Math.round(bitmap.width*scale));photo.height=Math.max(1,Math.round(bitmap.height*scale));
   const photoContext=photo.getContext('2d');if(!photoContext)throw Error('Fotoğraf hazırlanamadı.');photoContext.drawImage(bitmap,0,0,photo.width,photo.height);
   const thumb=document.createElement('canvas'),thumbScale=Math.min(1,360/Math.max(photo.width,photo.height));thumb.width=Math.max(1,Math.round(photo.width*thumbScale));thumb.height=Math.max(1,Math.round(photo.height*thumbScale));thumb.getContext('2d').drawImage(photo,0,0,thumb.width,thumb.height);
   return{photo,thumb:thumb.toDataURL('image/jpeg',.78),name:file.name.slice(0,80),caption:'',hint:'',suggestion:''};
  }finally{bitmap.close();}
 }
 $('videoFiles').addEventListener('change',async()=>{
  const files=[...$('videoFiles').files],validation=validateFiles(files);$('videoFiles').value='';if(!validation.ok){$('videoStatus').textContent=validation.error;return;}
  if(scenes.length+files.length>MAX_SCENES){$('videoStatus').textContent=`Bir videoda en fazla ${MAX_SCENES} sahne olabilir.`;return;}
  const current=++runId;$('videoStatus').textContent='Fotoğraflar bu cihazda hazırlanıyor…';
  try{
   let pixels=scenes.reduce((sum,scene)=>sum+scene.photo.width*scene.photo.height,0);const prepared=[];
   for(const file of files){const scene=await preparePhoto(file);if(current!==runId)return;pixels+=scene.photo.width*scene.photo.height;if(pixels>MAX_PIXELS)throw Error('Fotoğrafların toplam çözünürlüğü çok yüksek. Daha az veya küçük fotoğraf seçin.');prepared.push(scene);}
   scenes.push(...prepared);renderCards();drawPreview();$('videoStatus').textContent='Sahneler hazır. Her fotoğrafın altına ona uygun kendi yazını ekle.';markEdited();
  }catch(error){if(current===runId)$('videoStatus').textContent=error.message;}
  updateButtons();
 });
 $('videoSuggest').addEventListener('click',async()=>{
  if(localAiWorking||!scenes.length)return;const topic=$('videoTopic').value.trim();if(!topic){$('videoStatus').textContent='Önce videonun konusunu yazın.';return;}
  const candidates=scenes.map((scene,index)=>({index,caption:scene.caption.trim(),photoHint:scene.hint.trim()})).filter(scene=>!scene.caption);if(!candidates.length){$('videoStatus').textContent='Düzenlenecek boş sahne yazısı yok. İstersen mevcut yazıları kendin değiştirebilirsin.';return;}if(candidates.some(scene=>!scene.photoHint)){$('videoStatus').textContent='Ollama taslağı için boş sahnelerin fotoğraf açıklamasını yazın.';return;}
  localAiWorking=true;updateButtons();$('videoStatus').textContent='Ollama yanıtı bekleniyor… Fotoğraflar ve metinler bu bilgisayarda kalır.';
  try{
   if(!['localhost','127.0.0.1','::1'].includes(window.location.hostname))throw Error('Yerel Ollama önerileri yalnızca bu bilgisayardaki Atlas (localhost) üzerinden kullanılabilir.');
   let response;try{response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify({model:'qwen2.5-coder:3b',stream:false,format:'json',messages:[{role:'system',content:'Her kısa Türkçe sahne yazısı hem videonun konusuna hem o sahnenin kullanıcı tarafından yazılmış fotoğraf açıklamasına doğrudan uysun. Yalnızca verilen bilgileri kullan; kişi, nesne, eylem, duygu veya olay uydurma. Konu ile açıklama çelişirse boş caption döndür. En fazla 120 karakter. JSON: {"captions":[{"index":0,"caption":"..."}]}. Yalnızca istenen indeksleri döndür.'},{role:'user',content:JSON.stringify({topic,scenes:candidates})}],options:{temperature:0.2,num_predict:350}})});}catch(error){if(error.name==='TimeoutError')throw error;throw Error('Ollama’ya bağlanılamadı. Ollama açık değil veya tarayıcı yerel bağlantıyı engelliyor. Video yine de manuel hazırlanabilir.');}
   if(!response.ok)throw Error('Ollama çalışmıyor veya model hazır değil. Ollama uygulamasını açıp qwen2.5-coder:3b modelini indirin.');
   const data=await response.json(),parsed=JSON.parse(data.message?.content||'{}'),suggestions=new Map((Array.isArray(parsed.captions)?parsed.captions:[]).map(item=>[Number(item.index),String(item.caption||'').trim().slice(0,120)]));let added=0;
   for(const item of candidates){const suggestion=suggestions.get(item.index);if(suggestion){scenes[item.index].suggestion=suggestion;added++;}}
   if(!added)throw Error('Ollama uygun bir sahne yazısı döndürmedi. Metni kendin yazıp devam edebilirsin.');renderCards();$('videoStatus').textContent=`Ollama ${added} sahne taslağı oluşturdu. Yalnızca “Taslağı bu sahnede kullan” dersen videoya eklenir.`;
  }catch(error){$('videoStatus').textContent=error.name==='TimeoutError'?'Ollama zamanında yanıt vermedi. Taslağı kendin yazıp devam edebilirsin.':error.message;}
  finally{localAiWorking=false;updateButtons();}
 });
 $('videoTopic').addEventListener('input',()=>{if(previewRaf)cancelAnimationFrame(previewRaf);previewRaf=0;schedulePreview();markEdited();});
 $('videoTopic').addEventListener('change',()=>{if(scenes.some(scene=>scene.suggestion)){scenes.forEach(scene=>scene.suggestion='');renderCards();}});
 $('videoFormat').addEventListener('change',()=>{setCanvasSize();markEdited();});
 $('videoDuration').addEventListener('change',markEdited);
 $('videoAsmrStyle').addEventListener('change',markEdited);
 $('videoPreviewIndex').addEventListener('input',()=>{if(previewRaf)cancelAnimationFrame(previewRaf);previewRaf=0;drawPreview();});
 $('videoTextAnimation').addEventListener('change',()=>{if(previewRaf)cancelAnimationFrame(previewRaf);previewRaf=0;drawPreview();markEdited();});
 $('videoPreviewPlay').addEventListener('click',()=>{if(!scenes.length||working)return;if(previewRaf)cancelAnimationFrame(previewRaf);const index=Math.min(Number($('videoPreviewIndex').value)||0,scenes.length-1),duration=Number($('videoDuration').value)*1000,start=performance.now();const frame=now=>{const progress=Math.min(1,(now-start)/duration);drawScene(index,progress);if(progress<1)previewRaf=requestAnimationFrame(frame);else previewRaf=0;};previewRaf=requestAnimationFrame(frame);});
 function recorderMimeType(withAudio){
  if(typeof MediaRecorder==='undefined')return'';
  const types=recorderTypeCandidates(withAudio,navigator.userAgent||'');
  return types.find(type=>MediaRecorder.isTypeSupported(type))||'';
 }
 async function verifyPlayable(blob){
  const probe=document.createElement('video'),mime=blob.type||'video/webm';
  if(probe.canPlayType&&!probe.canPlayType(mime))throw Error(`Chrome bu video biçimini oynatamıyor (${mime}). Yeniden oluşturup farklı kayıt biçimini deneyin.`);
  const url=URL.createObjectURL(blob);let timer=0;
  try{
   await Promise.race([new Promise((resolve,reject)=>{probe.onloadedmetadata=resolve;probe.onerror=()=>reject(Error(`Chrome kaydedilen videoyu çözemedi (${mime}). Yeniden oluşturmayı deneyin.`));probe.src=url;probe.load();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Video doğrulaması zamanında tamamlanmadı. Yeniden deneyin.')),8000);})]);
   if(!Number.isFinite(probe.duration)||probe.duration<=0||!probe.videoWidth||!probe.videoHeight)throw Error('Kaydedilen videoda oynatılabilir görüntü bulunamadı. Yeniden deneyin.');
  }finally{clearTimeout(timer);probe.pause();probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);}
 }
 async function makeNarration(scene,signal){
  const response=await fetch('/api/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:narrationText(scene)}),signal});
  if(!response.ok){let message='Seslendirme hazırlanamadı.';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
  const bytes=await response.arrayBuffer();
  if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();
  if(audioContext.state==='suspended')await audioContext.resume();
  return audioContext.decodeAudioData(bytes.slice(0));
 }
 function makeAsmrBuffer(kind,duration){
  if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();const length=Math.ceil(audioContext.sampleRate*duration),mono=makeAsmrSamples(kind,length,Math.random),buffer=audioContext.createBuffer(2,length,audioContext.sampleRate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);
  for(let i=0;i<length;i++){left[i]=mono[i];right[i]=mono[Math.max(0,i-Math.floor(audioContext.sampleRate*.006))]*.92;}return buffer;
 }
 async function recordVideo(audioBuffers,asmrBuffers,run){
  const withAudio=audioBuffers.some(Boolean)||asmrBuffers.some(Boolean),mime=recorderMimeType(withAudio);if(!mime)throw Error('Bu tarayıcıda video dosyası oluşturma desteklenmiyor. Güncel Safari veya Chrome ile deneyin; iPhone’da indirme için videoda Paylaş > Videoyu Kaydet seçeneğini kullanın.');
  const canvasStream=canvas.captureStream(24);let audioDestination=null;
  if(withAudio){if(audioContext.state==='suspended')await audioContext.resume();audioDestination=audioContext.createMediaStreamDestination();for(const track of audioDestination.stream.getAudioTracks())canvasStream.addTrack(track);}
   stream=canvasStream;const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2200000});updateButtons();
  const stopped=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onerror=()=>reject(Error('Video kaydı sırasında sorun oluştu. Yeniden deneyin.'));recorder.onstop=resolve;});
  recorder.start(250);const silentDuration=Number($('videoDuration').value)*1000;
  try{
   for(let i=0;i<scenes.length;i++){
    if(run!==runId)throw Error('İşlem iptal edildi.');drawScene(i,0);let duration=silentDuration;const voice=audioBuffers[i],asmr=asmrBuffers[i];
    if(voice)duration=Math.max(1200,voice.duration*1000+450);
    for(const buffer of [asmr,voice])if(buffer){const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioDestination);source.start();}
    $('videoStatus').textContent=`Video hazırlanıyor · Sahne ${i+1}/${scenes.length}`;
    await new Promise(resolve=>{const start=performance.now();const frame=now=>{if(run!==runId||!recorder||recorder.state==='inactive'){resolve();return;}const progress=Math.min(1,(now-start)/duration);drawScene(i,progress);if(progress>=1){resolve();return;}raf=requestAnimationFrame(frame);};raf=requestAnimationFrame(frame);});
   }
  }finally{if(recorder&&recorder.state!=='inactive')recorder.stop();}
  await stopped;if(run!==runId)throw Error('İşlem iptal edildi.');
  const blob=new Blob(chunks,{type:recorder.mimeType||mime});if(!blob.size)throw Error('Video boş kaldı. Tekrar deneyin.');await verifyPlayable(blob);
  clearOutput();needsRender=false;outputUrl=URL.createObjectURL(blob);const video=$('videoOutput');video.src=outputUrl;video.hidden=false;
  const extension=extensionFor(blob.type||mime),filename=`atlas-video-${new Date().toISOString().slice(0,10)}.${extension}`,anchor=$('videoDownload');anchor.href=outputUrl;anchor.download=filename;anchor.textContent=`Videoyu indir (${extension.toUpperCase()})`;anchor.hidden=false;outputFile=new File([blob],filename,{type:blob.type||mime});$('videoShare').hidden=!(navigator.share&&navigator.canShare&&navigator.canShare({files:[outputFile]}));
  $('videoStatus').textContent=`Video hazır · ${extension.toUpperCase()} · ${(blob.size/1024/1024).toFixed(1)} MB. İndirmek için düğmeye dokun.`;
 }
 $('videoCreate').addEventListener('click',async()=>{
  if(!loggedIn){showLogin();return;}if(!$('videoTopic').value.trim()||!scenes.length){$('videoStatus').textContent='Konu başlığı ve en az bir fotoğraf ekleyin.';return;}
  const narrate=$('videoNarrate').checked,addAsmr=$('videoAsmr').checked;if((narrate||!addAsmr)&&!scenes.every(scene=>scene.caption.trim())){$('videoStatus').textContent='Seslendirme veya normal video için her fotoğrafa ona uygun bir yazı ekleyin.';return;}
  if(narrate&&!$('videoSpeechConsent').checked){$('videoStatus').textContent='Seslendirme için bilgi paylaşımı onayını işaretleyin veya seslendirmeyi kapatın.';return;}
  const run=++runId;working=true;showOutput();updateButtons();$('videoStatus').textContent=narrate?'Sahne yazıları sırayla seslendiriliyor; yalnızca yazılar Google Gemini’ye gönderiliyor…':'Video bu cihazda hazırlanıyor…';
  try{
   let audioBuffers=[],asmrBuffers=[];
   if(narrate){const controller=new AbortController();activeRequest=controller;const timer=setTimeout(()=>controller.abort(),45000);try{for(const scene of scenes){if(run!==runId)throw Error('İşlem iptal edildi.');audioBuffers.push(await makeNarration(scene,controller.signal));}}finally{clearTimeout(timer);if(activeRequest===controller)activeRequest=null;}}
   const silentDuration=Number($('videoDuration').value);if(addAsmr)asmrBuffers=scenes.map((scene,index)=>makeAsmrBuffer($('videoAsmrStyle').value,(narrate?audioBuffers[index].duration+0.45:silentDuration)));
   await recordVideo(audioBuffers,asmrBuffers,run);
  }catch(error){if(run===runId)$('videoStatus').textContent=error.name==='AbortError'?'Seslendirme zamanında yanıt vermedi. Ücretsiz kota veya bağlantıyı kontrol edin; ücretli modele geçilmedi.':error.message;}
  finally{if(run===runId){working=false;recorder=null;if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}updateButtons();}}
 });
 $('videoNarrate').addEventListener('change',()=>{$('videoSpeechConsentRow').hidden=!$('videoNarrate').checked;markEdited();});
 $('videoShare').addEventListener('click',async()=>{if(!outputFile||!navigator.share||!navigator.canShare)return;try{await navigator.share({files:[outputFile],title:'ATLAS videosu'});}catch(error){if(error.name!=='AbortError')$('videoStatus').textContent='Paylaşım tamamlanamadı. “Videoyu indir” seçeneğini deneyin.';}});
 $('videoAsmr').addEventListener('change',markEdited);
 $('videoClose').addEventListener('click',()=>{clearScenes();$('videoStudioDialog').close();});
 $('videoStudioDialog').addEventListener('cancel',event=>{if(recorder&&recorder.state!=='inactive'){event.preventDefault();clearScenes();$('videoStudioDialog').close();}else clearScenes();});
 $('videoStudioDialog').addEventListener('close',clearScenes);
  $('voiceVideoStudio').addEventListener('click',()=>{if(busy)return;endConversation();$('toolsDialog').close();if(!loggedIn){showLogin();return;}clearScenes();$('videoStudioDialog').showModal();});
 $('videoSpeechConsentRow').hidden=!$('videoNarrate').checked;window.addEventListener('pagehide',clearScenes);drawEmpty();updateButtons();
})();
