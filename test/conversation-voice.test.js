import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
async function setup(options={}){
 const elements=new Map(),instances=[],spoken=[],sent=[],timers=new Map(),events={};let id=0,submits=0;
 function el(name){if(!elements.has(name))elements.set(name,{id:name,value:'',dataset:{},hidden:false,checked:false,handlers:{},children:[],addEventListener(n,f){this.handlers[n]=f;},setAttribute(n,v){this[n]=v;},showModal(){this.open=true;},close(){this.open=false;},focus(){},replaceChildren(){this.children=[];},append(item){this.children.push(item);},scrollIntoView(){},requestSubmit(){submits++;},click(){this.handlers.click?.();}});return elements.get(name);}
 class Recognition{constructor(){instances.push(this);}start(){this.started=true;this.onstart?.();}stop(){this.onend?.();}abort(){this.aborted=true;this.onend?.();}}
 class Utterance{constructor(text){this.text=text;}}
 const synthesis={getVoices:()=>[{lang:'tr-TR',localService:true}],cancel(){},speak(u){spoken.push(u);}};
 const document={hidden:!!options.hidden,getElementById:el,querySelector:()=>el('main'),querySelectorAll:selector=>selector==='dialog[open]'?[...elements.values()].filter(item=>item.open):[],createElement:()=>el('created-'+(++id)),addEventListener(n,f){const previous=events[n];events[n]=(...args)=>{previous?.(...args);f(...args);};}};
 class AudioContext{constructor(){this.state=options.blockedAudio?'suspended':'running';}async resume(){if(options.blockedAudio)return new Promise(()=>{});}async decodeAudioData(){return {length:100,numberOfChannels:1};}createBufferSource(){return {connect(){},start(){spoken.push(this);},stop(){this.stopped=true;}};}}
 class AtlasLiveAudio{close(){}async render(text,context){sent.push({url:"live"});return context.decodeAudioData();}}
 const window={AtlasLiveAudio,SpeechRecognition:Recognition,AudioContext,speechSynthesis:synthesis,localStorage:{getItem:key=>key==='atlas-auto-wake'?(options.autoWake?'on':options.autoWake===false?'off':null):null,setItem(){}},addEventListener(){}};
 vm.runInNewContext(source+';window.testSpeak=speak;',{document,window,AbortController,AbortSignal,SpeechSynthesisUtterance:Utterance,speechSynthesis:synthesis,fetch:async(url,requestOptions)=>{sent.push({url,options:requestOptions});if(url==='/voice-wake.wav'&&options.voiceResponse)return options.voiceResponse;if(url==='/api/chat'&&options.chatUnauthorized)return {ok:false,status:401,arrayBuffer:async()=>new ArrayBuffer(44),json:async()=>({error:'Oturum süresi doldu.'})};return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(44),json:async()=>url==='/api/chat'&&options.chatReply?options.chatReply(JSON.parse(requestOptions.body)):({authenticated:options.authenticated!==false,ready:true,text:'Yanıt Efendim.'})};},setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:n=>timers.delete(n),confirm:()=>false});
 await new Promise(r=>setImmediate(r));
 return {el,instances,spoken,sent,events,document,timers,play:window.testSpeak,draft:window.showPlanDraft,get submits(){return submits;},start(wake=true){el('wakeEnabled').checked=wake;el('startVoiceMode').handlers.click();},result(text,isFinal=true){const item=[{transcript:text}];item.isFinal=isFinal;instances.at(-1).onresult?.({results:[item]});}};
}
test('expired authenticated request closes private dialogs, clears chat and requires sign-in',async()=>{
 const s=await setup({chatUnauthorized:true});
 s.el('messages').append({textContent:'Özel konuşma'});s.el('welcome').hidden=true;s.el('message').value='Özel soru';s.el('tasksDialog').showModal();
 s.el('chatForm').handlers.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(s.el('tasksDialog').open,false);assert.equal(s.el('loginDialog').open,true);assert.equal(s.el('messages').children.length,0);assert.equal(s.el('welcome').hidden,false);assert.equal(s.el('message').value,'');assert.match(s.el('loginError').textContent,/Oturum süresi doldu/);
});
test('wake standby ignores unrelated speech and plays cached acknowledgement without Gemini',async()=>{const s=await setup();s.start();s.result('Bugün hava güzel');assert.equal(s.submits,0);assert.equal(s.spoken.length,0);s.result('Atlas');await new Promise(r=>setImmediate(r));assert.equal(s.spoken.length,1);assert.equal(s.instances[0].aborted,true);assert.equal(s.submits,0);assert.deepEqual(s.sent.map(x=>x.url),['/api/session','/voice-wake.wav']);s.spoken[0].onended();assert.equal(s.timers.size,1);});
test('wake phrase with command submits only command',async()=>{const s=await setup();s.start();s.result('Atlas, bir plan hazırla');assert.equal(s.el('message').value,'bir plan hazırla');assert.equal(s.submits,1);});
test('wake phrase accepts punctuation and case while requiring Atlas alone',async()=>{for(const phrase of ['ATLAS: bir plan hazırla','atlas! bir plan hazırla']){const s=await setup();s.start();s.result(phrase);assert.equal(s.el('message').value,'bir plan hazırla');assert.equal(s.submits,1);}const other=await setup();other.start();other.result('Hey Atlas, bir plan hazırla');assert.equal(other.submits,0);});
test('wake standby survives silence but still stops on permission loss',async()=>{const s=await setup();s.start();const recognition=s.instances[0];for(let i=0;i<5;i++)recognition.onerror({error:'no-speech'});assert.equal(s.el('endVoiceMode').hidden,false);recognition.onerror({error:'not-allowed'});assert.equal(s.el('endVoiceMode').hidden,true);});
test('wake voice passes task and daily-summary commands to the shared chat route',async()=>{for(const command of ['Listeye bugün market alışverişi ekle','Görev 1 tamamlandı','Bugün ne kaldı?']){const s=await setup();s.start();s.result('Atlas, '+command);assert.equal(s.el('message').value,command);assert.equal(s.submits,1);}});
test('voice stop command ends session and clears restart timers',async()=>{const s=await setup();s.start();s.result('Atlas dur');assert.equal(s.el('voiceStage').dataset.state,'idle');assert.equal(s.el('endVoiceMode').hidden,true);assert.equal(s.timers.size,0);assert.equal(s.submits,0);});
test('switching to text stops microphone and preserves rendered conversation',async()=>{const s=await setup();s.start();s.el('textMode').handlers.click();assert.equal(s.instances[0].aborted,true);assert.equal(s.el('voiceStage').hidden,true);assert.equal(s.el('main').inert,false);assert.equal(s.timers.size,0);});
test('backgrounding stops listening and normal mode has a time limit',async()=>{const s=await setup();s.start(false);assert.equal(s.timers.size,1);s.document.hidden=true;s.events.visibilitychange();assert.equal(s.instances[0].aborted,true);assert.equal(s.timers.size,0);});
test('permission failure exits mode and never retries',async()=>{const s=await setup();s.start();s.instances[0].onerror({error:'not-allowed'});assert.equal(s.el('voiceStage').dataset.state,'idle');assert.equal(s.timers.size,0);});
test('voice failures explain the cause and stop retries',async()=>{for(const error of ['not-allowed','service-not-allowed','audio-capture','network','language-not-supported']){const s=await setup();s.start();s.instances[0].onerror({error});assert.ok(s.el('voiceCaption').textContent.includes(error));assert.equal(s.timers.size,0);assert.equal(s.el('endVoiceMode').hidden,true);}});
test('push-to-talk reports no speech instead of appearing to listen',async()=>{const s=await setup();s.el('mic').handlers.click();s.el('allowMic').handlers.click();assert.equal(s.instances.at(-1).interimResults,true);s.instances.at(-1).onerror({error:'no-speech'});assert.match(s.el('notice').textContent,/Ses algılanamadı/);});
test('interim recognition results are not submitted before the final transcript',async()=>{const s=await setup();s.start(false);s.result('Bugün ',false);assert.equal(s.submits,0);assert.equal(s.el('message').value,'');s.result('Bugün plan yap',true);assert.equal(s.submits,1);assert.equal(s.el('message').value,'Bugün plan yap');});
test('intentional recognition abort does not end wake conversation',async()=>{const s=await setup();s.start();s.instances[0].onerror({error:'aborted'});assert.equal(s.el('endVoiceMode').hidden,false);});
test('stop while audio loads prevents late playback',async()=>{let finish;const s=await setup({voiceResponse:new Promise(r=>finish=r)});s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));s.el('endVoiceMode').handlers.click();assert.equal(s.sent.at(-1).options.signal.aborted,true);finish({ok:true,arrayBuffer:async()=>new ArrayBuffer(44)});await new Promise(r=>setImmediate(r));assert.equal(s.spoken.length,0);assert.equal(s.timers.size,0);});
test('audio failure stops voice loop and displays useful text',async()=>{const s=await setup({voiceResponse:{ok:false,json:async()=>({error:'Ücretsiz ses kotası doldu.'})}});s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));assert.match(s.el('voiceCaption').textContent,/kotası/);assert.equal(s.el('endVoiceMode').hidden,true);assert.equal(s.timers.size,0);});
test('switching to text stops audio already playing',async()=>{const s=await setup();s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));s.el('textMode').handlers.click();assert.equal(s.spoken[0].stopped,true);assert.equal(s.spoken[0].onended,null);});


test('repeated response uses session cache and logout clears it',async()=>{const s=await setup();await s.play('Efendim, hazır.');await s.play('Efendim, hazır.');assert.equal(s.sent.filter(x=>x.url==='live').length,1);await s.el('logout').handlers.click();await s.play('Efendim, hazır.');assert.equal(s.sent.filter(x=>x.url==='live').length,2);});
test('tap interrupt stops audio, preserves session and immediately listens without resubmitting old command',async()=>{
 const s=await setup();s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));
 s.el('interruptVoice').handlers.click();assert.equal(s.spoken[0].stopped,true);assert.equal(s.el('endVoiceMode').hidden,false);assert.equal(s.submits,0);
 assert.equal(s.instances.at(-1).started,true);s.result('Haftalık özet');assert.equal(s.submits,1);assert.equal(s.el('message').value,'Haftalık özet');
});
test('no microphone opens during speech even if an obsolete interruption preference is present',async()=>{
 const s=await setup();s.el('bargeEnabled').checked=true;s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));
 assert.equal(s.instances.length,1);assert.equal(s.instances[0].aborted,true);assert.equal(s.instances[0].onresult,null);
 for(const text of ['Görev 1 tamamlandı','Atlas','Atlas dur'])s.result(text);
 s.el('mic').handlers.click();assert.equal(s.instances.length,1);assert.equal(s.submits,0);assert.notEqual(s.spoken[0].stopped,true);
});
test('audio retry does not resend chat or mutations',async()=>{
 const s=await setup();await s.play('Görev kaydedildi.');s.el('retryVoice').handlers.click();await new Promise(r=>setImmediate(r));
 assert.equal(s.submits,0);assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);assert.equal(s.sent.filter(x=>x.url==='live').length,1);
});
test('plan draft never saves on presentation, listening or cancel',async()=>{
 const s=await setup();s.draft({token:'signed',title:'Plan',text:'Taslak',choices:[]});assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);s.el('planDraftListen').handlers.click();await new Promise(r=>setImmediate(r));assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);s.el('planCancel').handlers.click();assert.equal(s.el('planDraftDialog').open,false);assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);
});
test('voice approval requires explicit phrase and sends signed draft exactly once',async()=>{
 const s=await setup();s.draft({token:'signed',title:'Plan',text:'Taslak',choices:[{key:'task-1',label:'İş'}]});s.el('planVoiceConfirm').handlers.click();s.result('güzel olmuş');assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);
 s.el('planVoiceConfirm').handlers.click();s.result('Planı onaylıyorum');await new Promise(r=>setImmediate(r));const writes=s.sent.filter(x=>x.url==='/api/chat');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].options.body).planConfirmation,{token:'signed',confirmed:true,selected:['task-1']});assert.equal(s.el('planDraftDialog').open,false);
});
test('backgrounding cancels confirmation microphone without saving draft',async()=>{
 const s=await setup();s.draft({token:'signed',title:'Plan',text:'Taslak',choices:[]});s.el('planVoiceConfirm').handlers.click();const mic=s.instances.at(-1);s.document.hidden=true;s.events.visibilitychange();assert.equal(mic.aborted,true);assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);
});
test('home and wake buttons begin immediately without an extra modal or duplicate microphone',async()=>{
 for(const id of ['homeStart','wakeStart']){const s=await setup();s.el(id).handlers.click();assert.equal(s.instances.length,1);assert.equal(s.instances[0].started,true);assert.notEqual(s.el('voiceModeConsent').open,true);s.el(id).handlers.click();assert.equal(s.instances.length,1);}
});
test('late recognition events after question submission cannot cancel response audio or send twice',async()=>{
 const s=await setup();s.start(false);const mic=s.instances[0],lateError=mic.onerror,lateEnd=mic.onend,lateResult=mic.onresult;
 s.el('message').value='Kısa cevap ver';await s.el('chatForm').handlers.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.equal(mic.aborted,true);assert.equal(mic.onerror,null);assert.equal(s.spoken.length,1);
 for(const error of ['no-speech','network','audio-capture','not-allowed'])lateError({error});lateEnd();lateResult({results:[[{transcript:'ikinci yanlış metin'}]]});
 assert.notEqual(s.spoken[0].stopped,true);assert.equal(s.el('endVoiceMode').hidden,false);assert.equal(s.submits,0);assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,1);
 s.spoken[0].onended();assert.equal(s.instances.length,1);assert.equal(s.el('endVoiceMode').hidden,false);
});
test('listening resumes only after the answer finishes',async()=>{
 const s=await setup();s.start();s.result('Atlas');await new Promise(r=>setImmediate(r));
 assert.equal(s.instances.length,1);assert.equal(s.instances[0].aborted,true);assert.equal(s.timers.size,0);
 s.spoken[0].onended();assert.equal(s.instances.length,1);assert.equal(s.timers.size,1);
 [...s.timers.values()][0]();assert.equal(s.instances.length,2);assert.equal(s.instances[1].started,true);assert.equal(s.el('endVoiceMode').hidden,false);
});

test('voice draft edit sends no confirmation and final approval uses the revised token',async()=>{
 const s=await setup({chatReply:body=>body.planEdit?{text:'Düzenlendi, kaydedilmedi.',planDraft:{token:'revised',title:'Plan',text:'Yeni sıra',choices:[{key:'task-2',label:'İkinci iş'},{key:'task-1',label:'İlk iş'}]}}:{text:'Onayınızla kaydedildi.'}});
 s.draft({token:'original',title:'Plan',text:'İlk sıra',choices:[{key:'task-1',label:'İlk iş'},{key:'task-2',label:'İkinci iş'}]});
 s.el('planVoiceConfirm').handlers.click();s.result('Birinci önceliği ikinci sıraya al');await new Promise(r=>setImmediate(r));
 const edit=JSON.parse(s.sent.find(x=>x.url==='/api/chat').options.body);assert.equal(edit.planEdit.token,'original');assert.equal(edit.planConfirmation,undefined);assert.equal(s.el('planDraftDialog').open,true);assert.equal(s.el('planDraftText').textContent,'Yeni sıra');
 s.el('planVoiceConfirm').handlers.click();s.result('Planı onaylıyorum');await new Promise(r=>setImmediate(r));
 const writes=s.sent.filter(x=>x.url==='/api/chat').map(x=>JSON.parse(x.options.body));assert.equal(writes.length,2);assert.equal(writes[1].planConfirmation.token,'revised');assert.deepEqual(writes[1].planConfirmation.selected,['task-2','task-1']);
});

test('cancelled draft ignores a late edit response and cannot save',async()=>{
 let finish;const s=await setup({chatReply:()=>new Promise(r=>finish=r)});s.draft({token:'original',title:'Plan',text:'Taslak',choices:[{key:'task-1',label:'İş'}]});
 s.el('planEditCommand').value='Plana yürüyüş ekle';s.el('planEditForm').handlers.submit({preventDefault(){}});await new Promise(r=>setImmediate(r));s.el('planCancel').handlers.click();
 finish({text:'Yeni',planDraft:{token:'new',title:'Plan',text:'Yeni',choices:[]}});await new Promise(r=>setImmediate(r));assert.equal(s.el('planDraftDialog').open,false);assert.equal(s.el('planDraftText').textContent,'');s.el('planConfirm').handlers.click();assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,1);
});

test('chat retains signed task references for one follow-up and clears them on unrelated response',async()=>{
 let n=0;const s=await setup({chatReply:()=>++n===1?{text:'Liste',taskContext:'signed-context'}:{text:'Yanıt'}});
 for(const text of ['İşlerimi oku','İkinci işi tamamladım','Merhaba']){s.el('message').value=text;await s.el('chatForm').handlers.submit({preventDefault(){}});}
 const calls=s.sent.filter(x=>x.url==='/api/chat').map(x=>JSON.parse(x.options.body));assert.equal(calls[0].taskContext,null);assert.equal(calls[1].taskContext,'signed-context');assert.equal(calls[2].taskContext,null);
});

test('opening authenticated page automatically waits for Atlas and does not submit ambient speech',async()=>{
 const s=await setup({autoWake:true});assert.equal(s.instances.length,1);assert.equal(s.el('wakeEnabled').checked,true);s.result('Arka planda konuşma');assert.equal(s.submits,0);s.result('Atlas');await new Promise(r=>setImmediate(r));assert.equal(s.spoken.length,1);assert.equal(s.instances[0].aborted,true);assert.equal(s.sent.filter(x=>x.url==='/api/chat').length,0);
});
test('auto wake respects sign-in, saved opt-out and visibility',async()=>{
 const loggedOut=await setup({autoWake:true,authenticated:false});assert.equal(loggedOut.instances.length,0);
 const off=await setup();assert.equal(off.instances.length,0);
 const hidden=await setup({autoWake:true,hidden:true});assert.equal(hidden.instances.length,0);hidden.document.hidden=false;hidden.events.visibilitychange();assert.equal(hidden.instances.length,1);hidden.el('endVoiceMode').handlers.click();hidden.events.visibilitychange();assert.equal(hidden.instances.length,1);
});
test('blocked autoplay gives a one-tap fallback without automatic restart',async()=>{
 const s=await setup({autoWake:true,blockedAudio:true});assert.equal(s.instances.length,1);for(const callback of [...s.timers.values()])callback();await new Promise(r=>setImmediate(r));assert.equal(s.instances[0].aborted,true);assert.match(s.el('voiceCaption').textContent,/dokun/);s.events.visibilitychange();assert.equal(s.instances.length,1);
});
test('automatic microphone permission failure stops and never restarts on visibility change',async()=>{
 const s=await setup({autoWake:true});s.instances[0].onerror({error:'not-allowed'});assert.equal(s.el('endVoiceMode').hidden,true);s.events.visibilitychange();assert.equal(s.instances.length,1);
});

test('microphone stays off by default and auto wake requires a saved opt-in',async()=>{
 const s=await setup();assert.equal(s.instances.length,0);assert.equal(s.el('autoWakeEnabled').checked,false);
 const optedIn=await setup({autoWake:true});assert.equal(optedIn.instances.length,1);assert.equal(optedIn.el('autoWakeEnabled').checked,true);
});
