const liveVoice=new window.AtlasLiveAudio();
const $=id=>document.getElementById(id);
let history=[],busy=false,loggedIn=false,recognition=null,listening=false,voiceConsent=false;
let conversation=false,speaking=false,retryTimer=null,modeTimer=null,voiceErrors=0;
let wakeMode=false,awaitingCommand=false;
let pendingMemory=null,taskContext=null;
let autoWake=false,autoWakeAttempted=false,autoWakeTimer=null;
try{autoWake=window.localStorage?.getItem('atlas-auto-wake')==='on';}catch{}
let audioContext=null,audioSource=null,speechController=null,speechVersion=0,wakeBuffer=null;
const playingSources=new Set();let lastSpokenText='';
const responseAudioCache=new Map();let responseAudioBytes=0;
function clearVoiceCache(){responseAudioCache.clear();responseAudioBytes=0;lastSpokenText='';$('retryVoice').hidden=true;}
function cacheVoice(text,buffer){const bytes=(buffer.length||0)*(buffer.numberOfChannels||1)*4;if(!bytes||bytes>8*1024*1024)return;while(responseAudioCache.size&&(responseAudioCache.size>=8||responseAudioBytes+bytes>8*1024*1024)){const key=responseAudioCache.keys().next().value;responseAudioBytes-=responseAudioCache.get(key).bytes;responseAudioCache.delete(key);}responseAudioCache.set(text,{buffer,bytes});responseAudioBytes+=bytes;}
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const notice=text=>{$('notice').textContent=text;};
async function api(path,body){
  if(window.navigator?.onLine===false)throw new Error('İnternet bağlantısı yok. Bağlandığınızda yeniden deneyin.');
  if(path==='chat'&&body)body={...body,preferences:window.atlasPreferences?.()};
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',signal:AbortSignal.timeout(55000)});
  if(response.status===401&&path==='login')await Promise.resolve(window.clearOfflineDevice?.()).catch(()=>{});if(response.status===401&&path!=='login'&&path!=='session')expireSession();let data;try{data=await response.json();}catch(error){if(response.ok)throw error;data={};}if(!response.ok){const error=new Error(data.error||'İşlem tamamlanamadı.');error.status=response.status;error.data=data;throw error;}return data;
}
function showLogin(preserveOffline=true){if(!preserveOffline)Promise.resolve(window.clearOfflineDevice?.()).catch(()=>{});taskContext=null;window.clearPlanning?.();window.clearCompanion?.();window.clearExperience?.();window.clearDaily?.();window.clearOrganize?.();window.clearDayflow?.();window.clearEveryday?.();clearVoiceCache();loggedIn=false;$('logout').hidden=true;$('connection').textContent='Giriş gerekli';if(!$('loginDialog').open)$('loginDialog').showModal();}
function expireSession(){
 endConversation('Oturum süresi doldu. Yeniden giriş yapın.');history=[];$('messages').replaceChildren();$('welcome').hidden=false;$('message').value='';
 for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='loginDialog')dialog.close();
 showLogin(false);$('loginError').textContent='Oturum süresi doldu. Devam etmek için yeniden giriş yapın.';
}
function setLoggedIn(){loggedIn=true;$('loginDialog').close();$('logout').hidden=false;$('connection').textContent='Özel oturum açık';window.startDaily?.();}
async function showMemories(){
 endConversation();if(!loggedIn){showLogin();return;}
 if(!$('memoryDialog').open)$('memoryDialog').showModal();
 $('memoryStatus').textContent='Hafıza yükleniyor…';$('memoryItems').replaceChildren();
 try{
  const data=await api('memory/list',{});
  $('memoryStatus').textContent=data.items.length?`${data.items.length} / 30 kayıt`:'Henüz kayıt yok. Sohbette “Bunu hatırla: …” diyebilirsiniz.';
  for(const item of data.items){const row=document.createElement('article');row.className='memory-item';const content=document.createElement('p');content.textContent=item.text;const remove=document.createElement('button');remove.className='quiet';remove.textContent='Bu kaydı sil';remove.addEventListener('click',async()=>{
   if(!confirm('Şu kayıt ortak hafızadan silinsin mi?\n\n'+item.text))return;
   remove.disabled=true;
   try{await api('memory/delete',{id:item.id,text:item.text,confirmed:true});await showMemories();}catch(error){$('memoryStatus').textContent=error.message;remove.disabled=false;}
  });row.append(content,remove);$('memoryItems').append(row);}
 }catch(error){$('memoryStatus').textContent=error.message;}
}
$('voiceMemory').addEventListener('click',showMemories);
$('textMemory').addEventListener('click',showMemories);
$('memoryRefresh').addEventListener('click',showMemories);
$('memoryClose').addEventListener('click',()=>$('memoryDialog').close());
function memoryDraft(draft){endConversation();pendingMemory=draft;$('memoryDraftText').textContent=draft.text;$('memorySaveStatus').textContent='';$('memorySaveDialog').showModal();}
$('memoryCancel').addEventListener('click',()=>{pendingMemory=null;$('memorySaveDialog').close();notice('Hafızaya kaydedilmedi.');});
$('memorySaveDialog').addEventListener('cancel',(event)=>{if($('memoryConfirm').disabled){event.preventDefault();return;}pendingMemory=null;notice('Hafızaya kaydedilmedi.');});
$('memoryConfirm').addEventListener('click',async()=>{
 if(!pendingMemory)return;$('memoryConfirm').disabled=true;$('memoryCancel').disabled=true;
 try{const data=await api('memory/save',{command:pendingMemory.command,confirmed:true});pendingMemory=null;$('memorySaveDialog').close();const message=data.alreadySaved?'Efendim, bu bilgi zaten hafızada.':'Efendim, onayladığınız bilgiyi ortak hafızaya kaydettim.';notice(message);voiceState('idle','Hazırım, Efendim.',message);if(history.at(-1)?.role==='model')history.at(-1).text=message;}
 catch(error){$('memorySaveStatus').textContent=error.message;}
 finally{$('memoryConfirm').disabled=false;$('memoryCancel').disabled=false;}
});
let taskBusy=false;
async function taskRequest(command){return api('tasks/command',{command});}
async function loadTasks(){
 const data=await taskRequest('Görevlerimi göster');$('taskItems').replaceChildren();
 for(const item of data.items){
  const row=document.createElement('article');row.className='memory-item';const p=document.createElement('p');
  p.textContent='#'+item.id+' · '+item.title+' — '+(item.done?'Tamamlandı':item.due_date||'Tarihsiz')+(item.recurrence==='daily'?' · Her gün':item.recurrence==='weekly'?' · Her hafta':'');
  const button=document.createElement('button');button.className='quiet';button.textContent=item.done?'Yeniden aç':'Tamamlandı olarak işaretle';
  button.addEventListener('click',async()=>{if(taskBusy)return;taskBusy=true;button.disabled=true;try{const result=await taskRequest('Görev '+item.id+(item.done?' yeniden aç':' tamamlandı'));await loadTasks();$('taskStatus').textContent=result.text;}catch(error){$('taskStatus').textContent=error.message;}finally{taskBusy=false;button.disabled=false;}});
  row.append(p,button);$('taskItems').append(row);
 }
 return data;
}
async function showTasks(){endConversation();if(!loggedIn){showLogin();return;}if(!$('tasksDialog').open)$('tasksDialog').showModal();$('taskStatus').textContent='Yükleniyor…';try{const data=await loadTasks();$('taskStatus').textContent=data.items.length?data.items.length+' / 100 kayıt':'Henüz görev yok.';}catch(error){$('taskStatus').textContent=error.message;}}
$('voiceTasks').addEventListener('click',showTasks);$('textTasks').addEventListener('click',showTasks);
$('taskClose').addEventListener('click',()=>{$('tasksDialog').close();stopAudio();});
$('tasksDialog').addEventListener('cancel',stopAudio);
$('taskRefresh').addEventListener('click',()=>{if(!taskBusy)showTasks();});
$('taskForm').addEventListener('submit',async event=>{event.preventDefault();if(taskBusy)return;taskBusy=true;$('taskSend').disabled=true;try{const data=await taskRequest($('taskInput').value);$('taskInput').value='';await loadTasks();$('taskStatus').textContent=data.text;}catch(error){$('taskStatus').textContent=error.message;}finally{taskBusy=false;$('taskSend').disabled=false;}});
$('taskSummary').addEventListener('click',async()=>{if(taskBusy)return;taskBusy=true;$('taskSummary').disabled=true;try{await unlockAudio();const data=await taskRequest('Günlük özet');$('taskStatus').textContent=data.text;await speak(data.text);}catch(error){$('taskStatus').textContent=error.message;}finally{taskBusy=false;$('taskSummary').disabled=false;}});
let pendingNote=null,noteBusy=false;
function draftNote(draft){endConversation();pendingNote=draft;$('noteDraftText').textContent=draft.text;$('noteSaveStatus').textContent='';$('noteSaveDialog').showModal();}
function renderNotes(data){$('notesStatus').textContent=data.text;$('noteItems').replaceChildren();for(const item of data.items||[]){const row=document.createElement('article');row.className='memory-item';const text=document.createElement('p');text.textContent='Not '+item.id+': '+item.text;row.append(text);$('noteItems').append(row);}}
async function showNotes(){endConversation();if(!loggedIn){showLogin();return;}if(!$('notesDialog').open)$('notesDialog').showModal();$('notesStatus').textContent='Yükleniyor…';try{renderNotes(await api('notes/command',{command:'Notlarımı göster'}));}catch(error){$('notesStatus').textContent=error.message;}}
$('textNotes').addEventListener('click',showNotes);$('voiceNotes').addEventListener('click',showNotes);
$('notesRefresh').addEventListener('click',showNotes);$('notesClose').addEventListener('click',()=>$('notesDialog').close());
$('noteForm').addEventListener('submit',async e=>{e.preventDefault();if(noteBusy)return;noteBusy=true;$('noteSend').disabled=true;try{const data=await api('notes/command',{command:$('noteInput').value});if(data.noteDraft)draftNote(data.noteDraft);else renderNotes(data);}catch(error){$('notesStatus').textContent=error.message;}finally{noteBusy=false;$('noteSend').disabled=false;}});
$('noteCancel').addEventListener('click',()=>{pendingNote=null;$('noteSaveDialog').close();notice('Not kaydedilmedi.');$('notesStatus').textContent='Not kaydedilmedi.';});
$('noteSaveDialog').addEventListener('cancel',e=>{if($('noteConfirm').disabled){e.preventDefault();return;}pendingNote=null;notice('Not kaydedilmedi.');$('notesStatus').textContent='Not kaydedilmedi.';});
$('noteConfirm').addEventListener('click',async()=>{if(!pendingNote||$('noteConfirm').disabled)return;$('noteConfirm').disabled=true;$('noteCancel').disabled=true;try{const data=await api('notes/save',{command:pendingNote.command,confirmed:true});pendingNote=null;$('noteSaveDialog').close();$('noteInput').value='';$('notesStatus').textContent=data.text;notice(data.text);voiceState('idle','Hazırım, Efendim.',data.text);if(history.at(-1)?.role==='model')history.at(-1).text=data.text;if($('notesDialog').open)renderNotes({text:data.text,items:[data.item]});}catch(error){$('noteSaveStatus').textContent=error.message;}finally{$('noteConfirm').disabled=false;$('noteCancel').disabled=false;}});
function unlockAudio(){
 const AudioContext=window.AudioContext||window.webkitAudioContext;
 if(!AudioContext)throw new Error('Bu tarayıcı ses oynatmayı desteklemiyor. Chrome’da deneyin.');
 if(!audioContext)audioContext=new AudioContext();
 if(audioContext.state==='running')return Promise.resolve();
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Tarayıcı sesi açmak için dokunmanızı istiyor. “Atlas ile uyandır” düğmesine dokunun.')),3000);audioContext.resume().then(()=>{clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);});});
}
function cancelSpeech(){speechVersion++;speechController?.abort();speechController=null;for(const source of playingSources){source.onended=null;try{source.stop();}catch{}}playingSources.clear();audioSource=null;$('interruptVoice').hidden=true;}
function stopRecognition(){const old=recognition;recognition=null;listening=false;if(old){old.onstart=null;old.onend=null;old.onresult=null;old.onerror=null;try{old.abort();}catch{}}$('mic').setAttribute('aria-pressed','false');}
function wakeCommand(text){const normalized=text.normalize('NFC').trim();const match=normalized.match(/^atlas[,.!?،؛:]?(?:\s+|$)(.*)$/iu);return match?{matched:true,command:match[1].trim()}:null;}
async function speak(text,wake=false){
 cancelSpeech();const version=speechVersion;
 speaking=true;clearTimeout(retryTimer);stopRecognition();
 $('stopVoice').hidden=false;voiceState('thinking','Ses hazırlanıyor.','Birazdan konuşacağım, Efendim.');
 const controller=new AbortController();speechController=controller;
 lastSpokenText=text;$('retryVoice').hidden=true;$('interruptVoice').hidden=!conversation;
 let streamDone=false,nextAudioTime=0,streamed=false;
 const finished=()=>{if(version!==speechVersion||!streamDone||playingSources.size)return;audioSource=null;speechController=null;speaking=false;$('stopVoice').hidden=true;$('interruptVoice').hidden=true;stopRecognition();if(conversation)scheduleListen();else voiceState('idle','Hazırım, Efendim.','Bir dokunuşla başlayalım.');};
 const play=buffer=>{
  if(version!==speechVersion||controller.signal.aborted||document.hidden)return;
  const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);audioSource=source;playingSources.add(source);
  nextAudioTime=Math.max(nextAudioTime,(audioContext.currentTime||0)+0.05);source.onended=()=>{playingSources.delete(source);finished();};source.start(nextAudioTime);nextAudioTime+=buffer.duration||buffer.length/24000;
  voiceState('speaking','Konuşuyorum, Efendim.','Mikrofon kapalı. Araya girmek için “Sözünü kes ve dinle”ye dokunun.');
  streamed=true;
 };
 const timeout=setTimeout(()=>controller.abort(),45000);
 try{
  await unlockAudio();
  const spokenText=wake?text:(window.atlasSpeechText?.(text)||(text.length>600?text.slice(0,597)+'…':text));
  let buffer=wake?wakeBuffer:responseAudioCache.get(spokenText)?.buffer;
  if(!buffer){
   if(wake){
    const response=await fetch('/voice-wake.wav',{signal:controller.signal,credentials:'same-origin'});
    if(!response.ok){let error;try{error=await response.json();}catch{}throw new Error(error?.error||'Ses hazırlanamadı.');}
    buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
   }else buffer=await liveVoice.render(spokenText,audioContext,controller.signal,play);
   if(version!==speechVersion||document.hidden)return;
   if(wake)wakeBuffer=buffer;else cacheVoice(spokenText,buffer);
  }
  if(version!==speechVersion||document.hidden)return;
  clearTimeout(timeout);
  if(!streamed)play(buffer);streamDone=true;finished();
 }catch(error){if(version===speechVersion){endConversation(error.name==='AbortError'?'Ses zamanında hazırlanamadı. Yanıtı yazılı okuyabilirsiniz.':error.message);$('retryVoice').hidden=false;}}
 finally{clearTimeout(timeout);}
}
function addMessage(role,text,metadata={}){const article=document.createElement('article');article.className='message '+role;const heading=document.createElement('h3');heading.textContent=role==='user'?'SEN':'✧ ATLAS';const content=document.createElement('div');content.className='text';if(role==='model'&&metadata.coding===true&&window.AtlasCodeAssist?.render)window.AtlasCodeAssist.render(content,text);else content.textContent=text;article.append(heading,content);if(role==='model'&&metadata.research)window.renderResearchSources?.(article,metadata.sources,metadata.citations);if(role==='model'&&(window.AudioContext||window.webkitAudioContext)){const button=document.createElement('button');button.className='tool';button.textContent='♫ Yanıtı dinle';button.addEventListener('click',()=>speak(text));article.append(button);}$('messages').append(article);$('welcome').hidden=true;article.scrollIntoView({block:'nearest',behavior:'smooth'});}
function voiceState(state,title,caption){$('voiceStage').dataset.state=state;$('voiceTitle').textContent=title;$('voiceCaption').textContent=caption;}
function showVoiceHome(show){$('voiceStage').hidden=!show;document.querySelector('main').inert=show;document.querySelector('main').hidden=show;}
function endConversation(message='Dinleme kapalı. Hazır olduğunuzda yeniden başlayın.'){
  conversation=false;speaking=false;wakeMode=false;awaitingCommand=false;clearTimeout(retryTimer);clearTimeout(modeTimer);clearTimeout(autoWakeTimer);
  stopRecognition();
  cancelSpeech();liveVoice.close();window.speechSynthesis?.cancel();$('stopVoice').hidden=true;$('mic').setAttribute('aria-pressed','false');$('homeStart').hidden=false;$('wakeStart').hidden=false;$('endVoiceMode').hidden=true;
  voiceState('idle','Hazırım, Efendim.',message);notice(message);
}
function stopAudio(){endConversation();}
function scheduleListen(){clearTimeout(retryTimer);if(conversation&&!document.hidden)retryTimer=setTimeout(()=>{if(conversation&&!busy&&!speaking&&!listening)startListening();},350);}
function interruptVoice(){if(!conversation||busy)return;cancelSpeech();speaking=false;clearTimeout(retryTimer);stopRecognition();awaitingCommand=true;$('stopVoice').hidden=true;startListening();}
$('interruptVoice').addEventListener('click',interruptVoice);
$('retryVoice').addEventListener('click',()=>{if(lastSpokenText&&!busy&&loggedIn)speak(lastSpokenText);});
function askVoiceMode(){if(busy){notice('Mevcut yanıtın bitmesini bekleyin.');return;}if(!loggedIn){showLogin();return;}if(!SpeechRecognition){voiceState('idle','Tarayıcı desteği gerekiyor.','Android Chrome veya desteklenen bir masaüstü tarayıcısı kullanın; yazılı sohbet açık.');return;}startConversation();}
$('voiceSettings').addEventListener('click',()=>{if(busy)return;endConversation();$('voiceModeConsent').showModal();});
function startConversation(automatic=false){
 $('voiceModeConsent').close();if(!loggedIn||busy||conversation||!SpeechRecognition)return;
 const audioVersion=speechVersion;
 try{unlockAudio().catch(()=>{if(audioVersion===speechVersion)endConversation('Tarayıcı sesi otomatik başlatamadı. “Atlas ile uyandır” düğmesine bir kez dokunun.');});}catch(error){endConversation(error.message);return;}
 conversation=true;wakeMode=$('wakeEnabled').checked;awaitingCommand=false;voiceErrors=0;voiceConsent=true;$('voiceStage').hidden=false;$('homeStart').hidden=true;$('wakeStart').hidden=true;$('endVoiceMode').hidden=false;$('message').value='';
 if(!wakeMode)modeTimer=setTimeout(()=>endConversation('30 dakikalık oturum tamamlandı. Yeniden başlatabilirsiniz.'),1800000);startListening();$('endVoiceMode').focus();
 if(automatic===true)autoWakeTimer=setTimeout(()=>{if(conversation&&audioVersion===speechVersion&&audioContext?.state==='suspended')endConversation('Tarayıcı ses için dokunmanızı istiyor. “Atlas ile uyandır” düğmesine bir kez dokunun.');},1200);
}
function tryAutoWake(){if(autoWakeAttempted||!autoWake||!loggedIn||document.hidden||busy)return;autoWakeAttempted=true;if(!SpeechRecognition){notice('Otomatik Atlas için desteklenen bir Chrome tarayıcısı kullanın.');return;}$('wakeEnabled').checked=true;startConversation(true);}
$('autoWakeEnabled').checked=autoWake;
$('autoWakeEnabled').addEventListener('change',()=>{autoWake=$('autoWakeEnabled').checked;try{window.localStorage?.setItem('atlas-auto-wake',autoWake?'on':'off');}catch{}if(!autoWake)endConversation();});
$('homeStart').addEventListener('click',()=>{$('wakeEnabled').checked=false;askVoiceMode();});
$('wakeStart').addEventListener('click',()=>{$('wakeEnabled').checked=true;askVoiceMode();});
$('voiceMode').addEventListener('click',()=>{endConversation();showVoiceHome(true);$('homeStart').focus();});
$('startVoiceMode').addEventListener('click',startConversation);
$('cancelVoiceMode').addEventListener('click',()=>$('voiceModeConsent').close());
$('endVoiceMode').addEventListener('click',()=>endConversation());
$('textMode').addEventListener('click',()=>{endConversation();showVoiceHome(false);$('message').focus();});
$('voiceLogout').addEventListener('click',()=>{endConversation();$('logout').click();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&conversation)endConversation();});
$('stopVoice').addEventListener('click',stopAudio);
$('loginDialog').addEventListener('cancel',e=>e.preventDefault());
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginButton').disabled=true;$('loginError').textContent='';try{await api('login',{password:$('password').value});$('password').value='';setLoggedIn();notice('Hazırım Efendim. Nereden başlayalım?');tryAutoWake();}catch(error){$('loginError').textContent=error.message;}finally{$('loginButton').disabled=false;}});
$('logout').addEventListener('click',async()=>{if(busy){notice('Yanıt tamamlanınca çıkış yapabilirsiniz.');return;}try{await api('logout',{});stopAudio();history=[];$('messages').replaceChildren();$('message').value='';$('welcome').hidden=false;showLogin(false);notice('');}catch(error){notice(error.message);}});
$('newChat').addEventListener('click',()=>{if(busy){notice('Önce mevcut yanıtın tamamlanmasını bekleyin.');return;}if(history.length&&!confirm('Bu sekmedeki konuşmayı temizleyip yeni sohbet başlatılsın mı?'))return;stopAudio();window.clearExperience?.();window.clearDaily?.();window.clearOrganize?.();window.clearDayflow?.();window.clearEveryday?.();taskContext=null;if(loggedIn)window.startDaily?.();history=[];$('messages').replaceChildren();$('welcome').hidden=false;$('message').value='';notice('Yeni bir başlangıç.');$('message').focus();});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>{$('message').value=button.dataset.prompt;$('message').focus();}));
$('chatForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;if(!loggedIn){showLogin();return;}const text=$('message').value.trim();if(!text)return;clearTimeout(retryTimer);stopRecognition();
  let context=history.slice(-12);while(context.length&&context.reduce((n,m)=>n+m.text.length,0)+text.length>18000)context=context.slice(2);
  const messages=[...context,{role:'user',text}];busy=true;$('send').disabled=true;$('mic').disabled=true;$('message').disabled=true;notice('ATLAS yanıt hazırlıyor…');if(conversation)voiceState('thinking','Düşünüyorum.','Yanıtınızı hazırlıyorum, Efendim.');
  try{const payload={messages,taskContext};if(window.atlasResearchMode?.())payload.research=true;if(window.atlasCodingMode?.())payload.coding=true;const data=await api('chat',payload);taskContext=data.taskContext||null;addMessage('user',text);addMessage('model',data.text,data);history=[...messages,{role:'model',text:data.text}];$('message').value='';notice('');$('voiceTranscript').textContent=data.text;awaitingCommand=false;if(window.handleEveryday?.(data,{speak:conversation})){}else if(window.handleOffline?.(data)){endConversation();}else if(window.handleDayflow?.(data,{speak:conversation})){}else if(window.handleOrganize?.(data)){}else if(window.handleDaily?.(data)){}else if(data.planDraft)window.showPlanDraft(data.planDraft);else if(window.handleExperience?.(data)){}else if(window.handleCompanion?.(data)){}else if(data.noteDraft)draftNote(data.noteDraft);else if(data.memoryDraft)memoryDraft(data.memoryDraft);else if(conversation)speak(data.text);}
  catch(error){taskContext=null;endConversation(error.message);if(error.status===401){history=[];$('messages').replaceChildren();$('welcome').hidden=false;showLogin();}else if(error.data){if(!window.handleEveryday?.(error.data)&&!window.handleDayflow?.(error.data)&&!window.handleOrganize?.(error.data))window.handleDaily?.(error.data);}}
  finally{busy=false;$('send').disabled=false;$('mic').disabled=!SpeechRecognition;$('message').disabled=false;}
});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();$('chatForm').requestSubmit();}});
function startListening(){
  if(!SpeechRecognition||busy||speaking||listening||document.hidden)return;
  stopRecognition();
  recognition=new SpeechRecognition();recognition.lang='tr-TR';recognition.interimResults=true;recognition.continuous=false;const activeRecognition=recognition;listening=true;let receivedSpeech=false;
  recognition.onstart=()=>{if(recognition!==activeRecognition)return;listening=true;$('mic').setAttribute('aria-pressed','true');notice('Dinliyorum. Bitirmek için Konuşarak yaz düğmesine tekrar basın.');if(conversation)voiceState(wakeMode&&!awaitingCommand?'waiting':'listening',wakeMode&&!awaitingCommand?'“Atlas” diyebilirsiniz.':'Sizi dinliyorum.',wakeMode&&!awaitingCommand?'Bekleme açık · Mikrofon kullanımda':'Konuşmanız bitince otomatik göndereceğim.');};
  recognition.onresult=event=>{if(recognition!==activeRecognition)return;let text=Array.from(event.results).filter(result=>result.isFinal!==false).map(r=>r[0].transcript).join(' ').trim();if(!text)return;voiceErrors=0;if(conversation&&/^atlas\s+dur[.!?]?$/iu.test(text)){endConversation();return;}
    if(conversation&&wakeMode&&!awaitingCommand){const wake=wakeCommand(text);if(!wake)return;awaitingCommand=true;text=wake.command;if(!text){speak('Buradayım Efendim, sizi dinliyorum.',true);return;}}
    receivedSpeech=true;
    $('message').value=(conversation?text:($('message').value+' '+text).trim()).slice(0,6000);$('voiceTranscript').textContent=text;notice('Metni kontrol edin, ardından Gönder’e basın.');if(conversation)$('chatForm').requestSubmit();};
  recognition.onerror=event=>{
    if(recognition!==activeRecognition||event.error==='aborted')return;
    const messages={
      'not-allowed':'Mikrofon izni engellendi (not-allowed). Tarayıcının adres çubuğundaki site ayarlarından mikrofon iznini açın. Windows mikrofon gizlilik ayarlarını da kontrol edin.',
      'service-not-allowed':'Bu tarayıcı ses tanıma hizmetine izin vermiyor (service-not-allowed). ATLAS’ı bilgisayarınızdaki Chrome’da açıp deneyin.',
      'audio-capture':'Mikrofondan ses alınamadı (audio-capture). Mikrofonun bağlı ve Windows ses giriş ayarlarında seçili olduğunu kontrol edin.',
      'network':'Ses tanıma hizmetine bağlanılamadı (network). İnternet bağlantınızı kontrol edin; uygulama içi tarayıcı yerine Chrome’da deneyin.',
      'no-speech':'Ses algılanamadı (no-speech). Mikrofona yaklaşarak yeniden başlatın.',
      'language-not-supported':'Bu tarayıcı Türkçe ses tanımayı desteklemiyor (language-not-supported). Chrome’da deneyin.'
    };
    const message=messages[event.error]||'Ses tanıma beklenmedik biçimde durdu. Chrome’da tekrar deneyin; yazılı sohbeti kullanabilirsiniz.';
    if(event.error==='no-speech'&&conversation&&(wakeMode&&!awaitingCommand))return;
    if(event.error==='no-speech'&&!conversation){notice(message);return;}
    voiceErrors++;if(!conversation){notice(message);return;}
    if(event.error!=='no-speech'||voiceErrors>=3)endConversation(message);
  };
  recognition.onend=()=>{if(recognition!==activeRecognition)return;listening=false;$('mic').setAttribute('aria-pressed','false');if(conversation&&!busy&&!speaking)scheduleListen();else if(!conversation&&!receivedSpeech)notice('Konuşmanız algılanmadı. Mikrofon iznini ve Türkçe tanıma desteğini kontrol edip yeniden deneyin.');};
  try{recognition.start();}catch{endConversation('Ses tanıma başlatılamadı. Yazarak devam edebilirsiniz.');}
}
$('mic').disabled=!SpeechRecognition;
if(!SpeechRecognition)$('mic').title='Bu tarayıcı konuşarak yazmayı desteklemiyor.';
$('mic').addEventListener('click',()=>{if(listening){recognition.stop();return;}if(!voiceConsent){$('voiceDialog').showModal();return;}startListening();});
$('cancelMic').addEventListener('click',()=>$('voiceDialog').close());
$('allowMic').addEventListener('click',()=>{voiceConsent=true;$('voiceDialog').close();startListening();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAudio();else tryAutoWake();});
window.addEventListener('pagehide',()=>{stopAudio();clearVoiceCache();});
showVoiceHome(true);
api('session').then(data=>{if(data.authenticated){setLoggedIn();if(!data.ready)notice('Gemini bağlantısı henüz kurulmadı.');else tryAutoWake();}else showLogin(false);}).catch(error=>{showLogin(error.status!==401);$('loginError').textContent=error.message;});


let waveMoving=!(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
try{const savedMotion=window.localStorage?.getItem('atlas-wave-motion');if(savedMotion==='full'||savedMotion==='reduced')waveMoving=savedMotion==='full';}catch{}
function applyWaveMotion(){$('voiceStage').dataset.motion=waveMoving?'full':'reduced';$('waveMotion').textContent=waveMoving?'Hareketi azalt':'Animasyonu aç';$('waveMotion').setAttribute('aria-pressed',String(waveMoving));}
$('waveMotion').addEventListener('click',()=>{waveMoving=!waveMoving;applyWaveMotion();try{window.localStorage?.setItem('atlas-wave-motion',waveMoving?'full':'reduced');}catch{}});applyWaveMotion();

$('taskTomorrow').addEventListener('click',async()=>{if(taskBusy)return;taskBusy=true;try{const data=await taskRequest('Yarın ne var?');$('taskStatus').textContent=data.text;}catch(error){$('taskStatus').textContent=error.message;}finally{taskBusy=false;}});

$('taskWeekly').addEventListener('click',async()=>{if(taskBusy)return;taskBusy=true;try{const data=await taskRequest('Haftalık özet');$('taskStatus').textContent=data.text;await speak(data.text);}catch(e){$('taskStatus').textContent=e.message;}finally{taskBusy=false;}});

// Plan drafts stay in this tab until an explicit confirmation.
(()=>{
 let pending=null,selectedInputs=[],saving=false,working=false,confirmRecognition=null,confirmTimer=null,version=0;
 function stopConfirm(){clearTimeout(confirmTimer);confirmTimer=null;const old=confirmRecognition;confirmRecognition=null;if(old){old.onresult=null;old.onend=null;old.onerror=null;old.abort();}$('planVoiceConfirm').disabled=false;}
 function clear(){version++;stopConfirm();pending=null;selectedInputs=[];$('planDraftText').textContent='';$('planChoices').replaceChildren();}
 function cancel(){if(saving)return;clear();stopAudio();$('planDraftDialog').close();$('planStatus').textContent='Taslak kaydedilmedi.';notice('Plan kaydedilmedi.');}
 window.clearPlanning=()=>{clear();$('planDraftDialog').close();$('plansDialog').close();$('planItems').replaceChildren();$('planResult').textContent='';$('sharedSearchQuery').value='';$('planEditCommand').value='';};
 window.showPlanDraft=draft=>{
  endConversation();stopConfirm();pending=draft;selectedInputs=[];version++;$('plansDialog').close();$('planDraftTitle').textContent=draft.title;$('planDraftText').textContent=draft.text;$('planDraftStatus').textContent='Henüz kaydedilmedi. Taslağı ilk oluşturduktan sonra 30 dakika içinde onaylayın.';$('planChoices').replaceChildren();
  for(const [index,choice] of (draft.choices||[]).entries()){const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');label.className='wake-option';input.type='checkbox';input.checked=true;input.value=choice.key;text.textContent=(index+1)+'. '+choice.label;label.append(input,text);$('planChoices').append(label);selectedInputs.push(input);}
  $('planEditForm').hidden=!(draft.choices?.length);$('planEditCommand').value='';if(!$('planDraftDialog').open)$('planDraftDialog').showModal();
 };
 async function save(){
  if(!pending||saving||working)return;stopConfirm();stopAudio();const selected=selectedInputs.filter(i=>i.checked).map(i=>i.value);
  if(selectedInputs.length&&!selected.length){$('planDraftStatus').textContent='En az bir öncelik seçin veya vazgeçin.';return;}
  saving=true;$('planConfirm').disabled=true;$('planCancel').disabled=true;$('planVoiceConfirm').disabled=true;
  try{const data=await api('chat',{messages:[{role:'user',text:'Planı onaylıyorum'}],planConfirmation:{token:pending.token,selected,confirmed:true}});clear();$('planDraftDialog').close();notice(data.text);$('voiceTranscript').textContent=data.text;$('planStatus').textContent=data.text;addMessage('model',data.text);await speak(data.text);}
  catch(e){$('planDraftStatus').textContent=e.message;}
  finally{saving=false;$('planConfirm').disabled=false;$('planCancel').disabled=false;$('planVoiceConfirm').disabled=false;}
 }
 async function edit(command){
  if(!pending||saving||working||!command.trim())return;stopConfirm();stopAudio();working=true;const current=version,unchecked=selectedInputs.filter(i=>!i.checked).map(i=>i.value);
  $('planConfirm').disabled=true;$('planVoiceConfirm').disabled=true;$('planEditSubmit').disabled=true;$('planDraftStatus').textContent='Taslak düzenleniyor; kaydedilmiyor…';
  try{const result=await api('chat',{messages:[{role:'user',text:command}],planEdit:{token:pending.token}});if(current!==version)return;if(!result.planDraft)throw Error('Taslak alınamadı; kaydedilmedi.');window.showPlanDraft(result.planDraft);for(const input of selectedInputs)if(unchecked.includes(input.value))input.checked=false;await speak(result.text);}
  catch(e){if(current===version)$('planDraftStatus').textContent=e.message;}
  finally{working=false;$('planConfirm').disabled=false;$('planVoiceConfirm').disabled=false;$('planEditSubmit').disabled=false;}
 }
 $('planEditForm').addEventListener('submit',e=>{e.preventDefault();edit($('planEditCommand').value);});
 $('sharedSearchForm').addEventListener('submit',e=>{e.preventDefault();const query=$('sharedSearchQuery').value.trim();if(query)request('Her yerde ara: '+query);});
 async function request(command){
  if(working||busy||saving)return;if(!loggedIn){showLogin();return;}working=true;const current=version;$('planStatus').textContent='Hazırlanıyor…';
  try{const d=await api('chat',{messages:[{role:'user',text:command}]});if(current!==version)return;if(d.planDraft){window.showPlanDraft(d.planDraft);return;}
   $('planResult').textContent=d.text;$('planStatus').textContent='Hazır.';
   if(d.planItems){$('planItems').replaceChildren();for(const item of d.planItems){const row=document.createElement('article'),title=document.createElement('p'),read=document.createElement('button');row.className='memory-item';title.textContent='#'+item.id+' · '+item.title+' · '+item.plan_day;read.className='quiet';read.textContent='Planı aç';read.addEventListener('click',()=>request('Plan '+item.id+' oku'));row.append(title,read);$('planItems').append(row);}}
  }catch(e){if(current===version)$('planStatus').textContent=e.message;}finally{working=false;}
 }
 function open(){if(busy||saving)return;endConversation();if(!loggedIn){showLogin();return;}$('plansDialog').showModal();request('Planlarımı göster');}
 $('voicePlans').addEventListener('click',open);$('textPlans').addEventListener('click',open);
 $('plansClose').addEventListener('click',()=>{version++;stopAudio();$('plansDialog').close();});
 $('plansDialog').addEventListener('cancel',()=>{version++;stopAudio();});
 $('planDay').addEventListener('click',()=>request('Günümü planla'));
 $('planReview').addEventListener('click',()=>request('Haftalık gelişimimi değerlendir'));
 $('planRefresh').addEventListener('click',()=>request('Planlarımı göster'));
 $('planContentForm').addEventListener('submit',e=>{e.preventDefault();const id=$('planContentId').value.trim();request(id?'İçerik '+id+' için paket hazırla':'İçerik paketi hazırla');});
 $('planListen').addEventListener('click',()=>{if($('planResult').textContent)speak($('planResult').textContent);});
 $('planDraftListen').addEventListener('click',()=>{if(pending&&!saving){stopConfirm();speak(pending.text);}});
 $('planConfirm').addEventListener('click',save);$('planCancel').addEventListener('click',cancel);
 $('planDraftDialog').addEventListener('cancel',e=>{e.preventDefault();cancel();});
 $('planVoiceConfirm').addEventListener('click',()=>{
  if(!pending||saving||working)return;if(!SpeechRecognition){$('planDraftStatus').textContent='Bu tarayıcı ses tanımayı desteklemiyor. Yazılı düzenleme veya kaydet düğmesini kullanın.';return;}
  stopAudio();stopConfirm();const current=version,rec=new SpeechRecognition();confirmRecognition=rec;rec.lang='tr-TR';rec.continuous=false;rec.interimResults=false;
  $('planVoiceConfirm').disabled=true;$('planDraftStatus').textContent='“İlk önceliği çıkar”, “Birinci önceliği ikinci sıraya al”, “Plana yürüyüş ekle” veya son hali için “Planı onaylıyorum” deyin. İptal: “Vazgeç”.';
  rec.onresult=e=>{if(current!==version||!pending||confirmRecognition!==rec)return;const text=Array.from(e.results).map(r=>r[0].transcript).join(' ').trim().replace(/[.!?]+$/u,'').toLocaleLowerCase('tr-TR');stopConfirm();if(/^(planı onaylıyorum|planı kaydet|planı onayla)$/u.test(text))save();else if(/^(vazgeç|iptal)$/u.test(text))cancel();else if(/^(?:\S+ önceliği .+|plana .+ ekle|bunu .+ sıraya al)$/u.test(text))edit(text);else $('planDraftStatus').textContent='Düzenleme veya açık bir onay duyamadım; kaydedilmedi. Tekrar deneyin veya düğmeyi kullanın.';};
  rec.onerror=()=>{stopConfirm();$('planDraftStatus').textContent='Sesli onay alınamadı; kaydedilmedi. Mikrofon iznini kontrol edin veya düğmeyi kullanın.';};
  rec.onend=()=>{if(confirmRecognition===rec){stopConfirm();$('planDraftStatus').textContent='Onay duyulmadı; kaydedilmedi.';}};
  confirmTimer=setTimeout(()=>{stopConfirm();$('planDraftStatus').textContent='Onay süresi bitti; kaydedilmedi.';},12000);
  try{rec.start();}catch{stopConfirm();$('planDraftStatus').textContent='Mikrofon başlatılamadı; kaydedilmedi.';}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopConfirm();});
 window.addEventListener('pagehide',clear);
})();

