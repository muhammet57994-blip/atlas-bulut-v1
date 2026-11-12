import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/companion.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const event={preventDefault(){}};
const draft={token:'signed-routine-token',text:'Kayıtları incele, gün planını hazırla.'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup(options={}){
 const elements=new Map(),recognitions=[],spoken=[],calls=[],network=[],timers=new Map(),events={},windowEvents={};let next=0;
 function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',checked:false,disabled:false,hidden:false,open:false,files:[],children:[],handlers:{},addEventListener(name,handler){this.handlers[name]=handler;},replaceChildren(...nodes){this.children=nodes;},append(...nodes){this.children.push(...nodes);},showModal(){this.open=true;},close(){this.open=false;},focus(){},getContext(){return {fillRect(){},drawImage(){}};},toDataURL(){return 'data:image/jpeg;base64,/9j/4AAAAAAA/9k=';}});return elements.get(id);}
 class Recognition{constructor(){recognitions.push(this);}start(){this.started=true;}abort(){this.aborted=true;this.onend?.();}}
 const document={hidden:false,getElementById:el,createElement:name=>el(name+'-'+(++next)),addEventListener(name,handler){events[name]=handler;}};
 const window={addEventListener(name,handler){windowEvents[name]=handler;},showPlanDraft(){}};
 vm.runInNewContext(source,{document,window,SpeechRecognition:Recognition,AbortController,loggedIn:true,busy:false,endConversation(){},showLogin(){},notice(){},speak:async text=>{spoken.push(text);},api:async(route,body)=>{calls.push({route,body});return options.api?options.api(route,body):{text:'Rutin kaydedildi.'};},fetch:async(url,request)=>{network.push({url,...request});return options.fetch?options.fetch(url,request):{ok:true,json:async()=>({text:'Efendim, sağ üst köşeye bakın.'})};},createImageBitmap:async()=>options.bitmap?options.bitmap():{width:400,height:300,close(){}},setTimeout:handler=>{const id=++next;timers.set(id,handler);return id;},clearTimeout:id=>timers.delete(id)});
 return {el,window,document,events,windowEvents,recognitions,spoken,calls,network,timers,click:id=>el(id).handlers.click(),submit:id=>el(id).handlers.submit(event),result(text){recognitions.at(-1).onresult?.({results:[[{transcript:text}]]});},async image(){el('visualFiles').files=[{type:'image/jpeg',size:100}];await el('visualFiles').handlers.change();},open(){el('workshopVisual').handlers.click();}};
}

test('routine presentation, reading and cancelling make no write requests',async()=>{
 const s=setup();s.window.handleCompanion({routineDraft:draft});assert.equal(s.el('routineDraftDialog').open,true);assert.equal(s.el('routineDraftText').textContent,draft.text);assert.equal(s.calls.length,0);
 s.click('routineDraftListen');await flush();assert.deepEqual(s.spoken,[draft.text]);assert.equal(s.calls.length,0);
 s.click('routineCancel');assert.equal(s.el('routineDraftDialog').open,false);assert.equal(s.el('routineDraftText').textContent,'');s.click('routineSave');await flush();assert.equal(s.calls.length,0);
});

test('only explicit routine voice approval saves the signed token once',async()=>{
 const pending=deferred(),s=setup({api:()=>pending.promise});s.window.handleCompanion({routineDraft:draft});
 s.click('routineApproveVoice');s.result('evet');assert.equal(s.calls.length,0);assert.equal(s.el('routineDraftDialog').open,true);
 s.click('routineApproveVoice');const mic=s.recognitions.at(-1),lateResult=mic.onresult;s.result('Rutini onaylıyorum');s.click('routineSave');lateResult({results:[[{transcript:'Rutini onaylıyorum'}]]});
 assert.equal(s.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].body.routineConfirmation)),{token:draft.token,confirmed:true});assert.equal(s.el('routineSave').disabled,true);
 pending.resolve({text:'Kaydedildi.'});await flush();s.click('routineSave');assert.equal(s.calls.length,1);assert.equal(s.el('routineDraftDialog').open,false);assert.equal(s.timers.size,0);
});

test('visual analysis never sends images without explicit consent',async()=>{
 const s=setup();s.open();await s.image();s.el('visualQuestion').value='Nereye dokunayım?';s.submit('visualForm');await flush();assert.equal(s.network.length,0);assert.equal(s.calls.length,0);assert.match(s.el('visualStatus').textContent,/onaylayın/);
});

test('spoken visual question fills text without consent and does not send',async()=>{
 const s=setup();s.open();await s.image();s.click('visualAsk');assert.equal(s.timers.size,1);s.result('Sağ üstte hangi düğme var?');await flush();assert.equal(s.el('visualQuestion').value,'Sağ üstte hangi düğme var?');assert.equal(s.network.length,0);assert.equal(s.calls.length,0);assert.equal(s.recognitions[0].aborted,true);assert.equal(s.timers.size,0);
});

test('late speech callbacks after closing cannot refill or send a question',async()=>{
 const s=setup();s.open();await s.image();s.el('visualConsent').checked=true;s.click('visualAsk');const rec=s.recognitions.at(-1),lateResult=rec.onresult,lateError=rec.onerror,lateEnd=rec.onend;
 s.click('visualClose');assert.equal(rec.aborted,true);assert.equal(s.timers.size,0);lateResult({results:[[{transcript:'Gönder'}]]});lateError({error:'network'});lateEnd();await flush();assert.equal(s.el('visualQuestion').value,'');assert.equal(s.el('visualStatus').textContent,'');assert.equal(s.network.length,0);
});

test('closing an active visual request aborts and reopening restores controls; late response is ignored',async()=>{
 const pending=deferred(),s=setup({fetch:()=>pending.promise});s.open();await s.image();s.el('visualQuestion').value='Bu ekranı açıkla';s.el('visualConsent').checked=true;s.submit('visualForm');assert.equal(s.network.length,1);
 const sent=JSON.parse(s.network[0].body);assert.equal(sent.confirmed,true);assert.equal(sent.question,'Bu ekranı açıkla');assert.equal(sent.images.length,1);assert.equal(s.network[0].credentials,'same-origin');assert.equal(s.el('visualFiles').disabled,true);
 s.click('visualClose');assert.equal(s.network[0].signal.aborted,true);s.open();assert.equal(s.el('visualDialog').open,true);
 for(const id of ['visualAnalyze','visualFiles','visualQuestion','visualAsk'])assert.equal(s.el(id).disabled,false,id+' must reset when closed');
 pending.resolve({ok:true,json:async()=>({text:'Obsolete answer'})});await flush();assert.equal(s.el('visualResult').textContent,'');assert.equal(s.el('visualQuestion').value,'');assert.equal(s.el('visualConsent').checked,false);assert.equal(s.spoken.length,0);assert.equal(s.timers.size,0);
});

test('late image preparation after closing cannot restore previews or retain disabled controls',async()=>{
 const pending=deferred(),s=setup({bitmap:()=>pending.promise});s.open();const preparing=s.image();assert.equal(s.el('visualAnalyze').disabled,true);s.click('visualClose');s.open();assert.equal(s.el('visualAnalyze').disabled,false);
 pending.resolve({width:400,height:300,close(){}});await preparing;assert.equal(s.el('visualPreviews').children.length,0);assert.equal(s.el('visualStatus').textContent,'');assert.equal(s.network.length,0);
});

test('backgrounding stops the microphone and its timeout without saving',()=>{
 const s=setup();s.window.handleCompanion({routineDraft:draft});s.click('routineApproveVoice');s.document.hidden=true;s.events.visibilitychange();assert.equal(s.recognitions[0].aborted,true);assert.equal(s.timers.size,0);assert.equal(s.calls.length,0);
});

test('switching from project microphone to visual helper discards late speech',async()=>{
 const s=setup();s.click('resumeVoice');const rec=s.recognitions.at(-1),lateResult=rec.onresult;s.open();assert.equal(rec.aborted,true);lateResult({results:[[{transcript:'ATLAS'}]]});await flush();assert.equal(s.calls.length,0);assert.equal(s.el('visualDialog').open,true);
});
