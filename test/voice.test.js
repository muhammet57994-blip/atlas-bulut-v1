import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function setup(supported=true){
 const elements=new Map(),calls=[],instances=[];
 function el(id){if(!elements.has(id))elements.set(id,{value:'',dataset:{},hidden:false,open:false,handlers:{},addEventListener(n,f){this.handlers[n]=f;},setAttribute(n,v){this[n]=v;},showModal(){this.open=true;},close(){this.open=false;},focus(){},replaceChildren(){}});return elements.get(id);}
 class Recognition{constructor(){instances.push(this);}start(){this.started=true;this.onstart();}stop(){this.onend();}abort(){this.onend?.();}}
 const synthesis={getVoices:()=>[],cancel(){},speak(){}};
 const document={getElementById:el,querySelector:()=>el('main'),querySelectorAll:()=>[],addEventListener(){}};
 const window={AtlasLiveAudio:class{close(){}},SpeechRecognition:supported?Recognition:undefined,speechSynthesis:synthesis,addEventListener(){}};
 vm.runInNewContext(source,{document,window,AbortSignal,setTimeout,clearTimeout,fetch:async(url)=>{calls.push(url);return {ok:true,json:async()=>({authenticated:true,ready:true})};},speechSynthesis:synthesis,confirm:()=>false,console});
 return {el,calls,instances};
}
test('voice requires explicit consent; transcription never sends automatically',()=>{const s=setup();s.el('mic').handlers.click();assert.equal(s.el('voiceDialog').open,true);assert.equal(s.instances.length,0);s.el('allowMic').handlers.click();assert.equal(s.instances[0].started,true);s.instances[0].onresult({results:[[{transcript:'Merhaba Efendim'}]]});assert.equal(s.el('message').value,'Merhaba Efendim');assert.ok(!s.calls.some(x=>x.includes('/chat')));});
test('voice cancellation does not activate microphone',()=>{const s=setup();s.el('mic').handlers.click();s.el('cancelMic').handlers.click();assert.equal(s.instances.length,0);assert.equal(s.el('voiceDialog').open,false);});
test('unsupported browser retains text input and disables microphone',()=>{const s=setup(false);assert.equal(s.el('mic').disabled,true);assert.notEqual(s.el('message').disabled,true);});
test('voice error gives fallback and ending resets pressed state',()=>{const s=setup();s.el('allowMic').handlers.click();s.instances[0].onerror({error:'not-allowed'});assert.match(s.el('notice').textContent,/Mikrofon izni engellendi/);s.instances[0].onend();assert.equal(s.el('mic')['aria-pressed'],'false');});


