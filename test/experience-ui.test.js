import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/experience.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const plain=v=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const sample=()=>({text:'Efendim, özel görev özeti.',center:{day:'2026-10-25',counts:{openTasks:1,overdueTasks:0,notes:2,memories:3,plans:1,routines:1},priorities:[{id:1,title:'Özel görev',due_date:'2026-10-25'}],routines:[{id:1,trigger:'Özel mod',topic:'Özel konu'}],recentPlans:[{id:1,title:'Özel plan',plan_day:'2026-10-25'}]}});
function setup(options={}){
 const elements=new Map(),calls=[],spoken=[],messages=[],drafts=[],notices=[],saved=[],events={},windowEvents={};let next=0,time=100000;
 function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,open:false,children:[],handlers:{},attrs:{},clicks:0,addEventListener(n,h){this.handlers[n]=h;},replaceChildren(...a){this.children=a;},append(...a){this.children.push(...a);},setAttribute(n,v){this.attrs[n]=v;},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},click(){this.clicks++;return this.handlers.click?.();}});return elements.get(id);}
 const document={documentElement:{dataset:{}},getElementById:el,createElement:t=>el(t+'-'+(++next)),querySelector:()=>[...elements.values()].find(e=>e.open)||null,addEventListener(n,h){events[n]=h;}};
 const window={navigator:{onLine:true},localStorage:{getItem(){if(options.storageThrows)throw Error('unavailable');return options.stored||null;},setItem(k,v){if(options.storageThrows)throw Error('unavailable');saved.push({key:k,value:JSON.parse(v)});}},addEventListener(n,h){windowEvents[n]=h;},showPlanDraft:d=>drafts.push(d),handleCompanion:()=>false};
 const context={document,window,Date:class extends Date{static now(){return time;}},loggedIn:true,busy:false,endConversation(){},showLogin(){},notice:t=>notices.push(t),addMessage:(role,text)=>messages.push({role,text}),speak:async t=>spoken.push(t),api:async(route,body)=>{calls.push({route,body:plain(body)});return options.api?options.api(route,body):sample();},fetch(){throw Error('Unexpected fetch');}};
 vm.runInNewContext(source,context);
 return {el,window,document,calls,spoken,messages,drafts,notices,saved,context,events,windowEvents,advance:ms=>time+=ms,click:id=>el(id).click(),change(id,value){el(id).value=value;el(id).handlers.change();},action(title){return el('centerActions').children.find(b=>b.children[1].children[0].textContent===title).click();},favorite:title=>el('favoriteSettings').children.find(b=>b.textContent===title).click()};
}
test('preferences validate stored data, reject arbitrary injection and survive unavailable storage',()=>{
 for(const stored of ['{bad',JSON.stringify({palette:'url(javascript:bad)',responseStyle:'evil',focus:'<script>',speechLength:9999,density:'evil',favorites:['evil','tasks','tasks','notes','plans','voice'],voice:'change-me'})]){
  const s=setup({stored});assert.equal(s.document.documentElement.dataset.palette,'aurora');assert.deepEqual(plain(s.window.atlasPreferences()),{responseStyle:'brief',focus:'general'});assert.ok(s.el('favoriteDock').children.length<=3);assert.equal(s.calls.length,0);
 }
 const s=setup({storageThrows:true});s.change('personalPalette','amber');assert.equal(s.document.documentElement.dataset.palette,'amber');assert.match(s.el('customStatus').textContent,/sekmede/);assert.equal(s.calls.length,0);
});
test('customization is local, favorites are bounded and preference output excludes voice identity',()=>{
 const s=setup();s.click('voiceCustomize');assert.equal(s.el('customDialog').open,true);
 for(const [id,value] of [['personalPalette','violet'],['personalStyle','detailed'],['personalFocus','technical'],['personalSpeech','300'],['personalDensity','compact']])s.change(id,value);
 assert.deepEqual(plain(s.window.atlasPreferences()),{responseStyle:'detailed',focus:'technical'});assert.equal(s.document.documentElement.dataset.density,'compact');
 s.favorite('Notlarım');assert.equal(s.el('favoriteDock').children.length,3);assert.match(s.el('customStatus').textContent,/En fazla üç/);s.favorite('Yapılacaklar');s.favorite('Notlarım');assert.equal(s.el('favoriteDock').children.length,3);
 assert.equal(s.calls.length,0);assert.equal(s.spoken.length,0);assert.ok(s.saved.length);assert.equal(Object.hasOwn(s.saved.at(-1).value,'voice'),false);
});
test('speech summaries retain short text and bound long text naturally with screen continuation',()=>{
 const s=setup();assert.equal(s.window.atlasSpeechText('Efendim, tamam.'),'Efendim, tamam.');
 for(const cap of [300,600]){s.change('personalSpeech',String(cap));for(const text of [('Uzun açıklama. ').repeat(100),'kelime '.repeat(200),'x'.repeat(1000)]){const result=s.window.atlasSpeechText(text);assert.ok(result.length<=cap);assert.match(result,/Devamı ekranda\.$/);}}
 assert.equal(s.spoken.length,0);
});
test('center opening reads once, caches for 30 seconds and manual refresh forces a read',async()=>{
 const s=setup();s.click('voiceCenter');await flush();assert.equal(s.el('centerDialog').open,true);assert.deepEqual(s.calls,[{route:'center',body:{}}]);assert.equal(s.spoken.length,0);
 s.click('centerClose');s.click('textCenter');await flush();assert.equal(s.calls.length,1);assert.match(s.el('centerStatus').textContent,/30 saniye/);
 s.click('centerRefresh');await flush();assert.equal(s.calls.length,2);s.click('centerClose');s.advance(30001);s.click('voiceCenter');await flush();assert.equal(s.calls.length,3);
 s.click('centerListen');await flush();assert.deepEqual(s.spoken,[sample().text]);
});
test('closing pending center discards its response and reopening can load again',async()=>{
 const pending=deferred(),s=setup({api:()=>pending.promise});s.click('voiceCenter');s.click('centerClose');pending.resolve(sample());await flush();assert.equal(s.el('centerCounts').children.length,0);assert.equal(s.el('centerDialog').open,false);assert.equal(s.el('centerRefresh').disabled,false);s.click('voiceCenter');await flush();assert.equal(s.calls.length,2);
});
test('logout clears private dashboard fields and cache, and discards pending center response',async()=>{
 const s=setup();s.window.handleExperience(sample());s.el('centerSearch').value='Private search';s.window.clearExperience();
 for(const id of ['centerCounts','centerPriorities','centerRoutines','centerPlans'])assert.equal(s.el(id).children.length,0,id);
 for(const id of ['centerDialog','customDialog','toolsDialog'])assert.equal(s.el(id).open,false,id);
 assert.equal(s.el('centerSearch').value,'');assert.equal(s.el('centerStatus').textContent,'');assert.equal(s.el('centerDate').textContent,'Ortak kayıtların');assert.equal(s.el('centerListen').disabled,true);s.click('centerListen');assert.equal(s.spoken.length,0);s.click('voiceCenter');await flush();assert.equal(s.calls.length,1);
 const pending=deferred(),p=setup({api:()=>pending.promise});p.click('voiceCenter');p.window.clearExperience();pending.resolve(sample());await flush();assert.equal(p.el('centerPriorities').children.length,0);
});
test('action buttons request drafts without confirmation and route returned plans to approval UI',async()=>{
 const draft={token:'signed',text:'Onay bekleyen plan'},s=setup({api:()=>({text:'Taslak hazır.',planDraft:draft})});s.action('Günümü planla');await flush();assert.deepEqual(s.calls,[{route:'chat',body:{messages:[{role:'user',text:'Günümü planla'}]}}]);assert.deepEqual(s.drafts,[draft]);assert.equal(s.spoken.length,0);assert.equal(s.messages.length,2);
});
test('clearing during pending action prevents stale private text, speech or draft restoration',async()=>{
 const pending=deferred(),s=setup({api:()=>pending.promise});s.action('Günümü planla');s.context.loggedIn=false;s.window.clearExperience();pending.resolve({text:'Eski özel yanıt',planDraft:{token:'old',text:'Özel plan'}});await flush();assert.equal(s.drafts.length,0);assert.equal(s.messages.length,0);assert.equal(s.spoken.length,0);assert.equal(s.el('voiceTranscript').textContent,'');assert.ok(!s.notices.includes('Eski özel yanıt'));
});
test('command shortcut holds shared busy state and prevents overlapping actions until response completes',async()=>{
 const pending=deferred(),s=setup({api:()=>pending.promise});s.action('Günümü planla');assert.equal(s.context.busy,true);s.action('Haftalık gelişim');s.click('voiceCenter');assert.equal(s.calls.length,1);assert.equal(s.el('centerDialog').open,false);
 pending.resolve({text:'Taslak hazır.',planDraft:{token:'signed',text:'Plan'}});await flush();assert.equal(s.context.busy,false);assert.equal(s.drafts.length,1);
});
