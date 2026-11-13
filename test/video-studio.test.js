import {test} from 'node:test';


import assert from 'node:assert/strict';


import vm from 'node:vm';


import {readFile} from 'node:fs/promises';





const source=await readFile(new URL('../public/video-studio.js',import.meta.url),'utf8');


function loadStudio(){


 const elements=new Map();


 const context={fillStyle:'',font:'',textAlign:'',textBaseline:'',globalAlpha:1,fillRect(){},fillText(){},measureText:text=>({width:text.length*8}),createLinearGradient(){return{addColorStop(){}}},drawImage(){}};


 function element(id){if(!elements.has(id))elements.set(id,{id,value:id==='videoFormat'?'vertical':id==='videoDuration'?'4':'0',checked:false,disabled:false,hidden:false,files:[],handlers:{},width:0,height:0,addEventListener(name,fn){this.handlers[name]=fn;},setAttribute(){},replaceChildren(){},querySelectorAll(){return[];},getContext(){return context;},pause(){},removeAttribute(){},load(){},close(){},showModal(){},});return elements.get(id);}


 const document={getElementById:element,createElement:type=>element('created-'+type+'-'+elements.size)};


 const window={location:{hostname:'localhost'},addEventListener(){}};


 vm.runInNewContext(source,{document,window,URL:{revokeObjectURL(){}},Blob,Math,Float32Array,MediaRecorder:class{static isTypeSupported(){return false;}}});


 return window.AtlasVideoStudio;


}





test('video scenes accept only supported photo types and enforce size and scene limits',()=>{


 const studio=loadStudio(),photo=(type='image/jpeg',size=1024)=>({type,size});


 assert.equal(studio.validateFiles([photo()]).ok,true);


 assert.match(studio.validateFiles([photo('image/gif')]).error,/JPG, PNG veya WebP/);


 assert.match(studio.validateFiles([photo('image/jpeg',10*1024*1024+1)]).error,/10 MB/);


 assert.match(studio.validateFiles(Array.from({length:7},()=>photo())).error,/en fazla 6/);


 assert.match(studio.validateFiles(Array.from({length:4},()=>photo('image/jpeg',8*1024*1024))).error,/30 MB/);


});





test('narration uses the exact scene text and does not invent wording',()=>{


 const studio=loadStudio();assert.equal(studio.narrationText({caption:'  Bu fotoğrafta yağmur damlaları var.  '}),'Bu fotoğrafta yağmur damlaları var.');


});

test('the preview canvas is sized to the chosen format before the first recording',()=>{
 const studio=loadStudio();
 assert.equal(typeof studio.sceneSeconds,'function');
 assert.match(source,/window\.addEventListener\('pagehide',clearScenes\);setCanvasSize\(\);updateButtons\(\)/u);
 assert.doesNotMatch(source,/window\.addEventListener\('pagehide',clearScenes\);drawEmpty\(\)/u,'a 300x150 default canvas crops the whole composition');
});

test('scene duration falls back to four seconds instead of recording a zero-length video',()=>{
 const studio=loadStudio();
 assert.equal(studio.sceneSeconds(),4);
 assert.match(source,/const silentDuration=sceneSeconds\(\)\*1000/u);
 assert.doesNotMatch(source,/Number\(\$\('videoDuration'\)\.value\)\*1000/u);
});

test('a WebM recording without a duration header is accepted when frames decode',()=>{
 const studio=loadStudio();
 assert.equal(studio.hasPlayableFrames(720,1280),true);
 assert.equal(studio.hasPlayableFrames(0,1280),false);
 assert.equal(studio.hasPlayableFrames(NaN,1280),false);
 assert.doesNotMatch(source,/Number\.isFinite\(probe\.duration\)\|\|probe\.duration<=0/u,'a MediaRecorder Infinity duration must not reject the file');
 assert.match(source,/if\(!hasPlayableFrames\(probe\.videoWidth,probe\.videoHeight\)\)/u);
 assert.match(source,/probe\.currentTime=1e101/u,'the probe seeks once to let Chrome derive a duration');
});

test('recorder prefers widely playable VP8 WebM on Chrome and MP4 on Safari',()=>{
 const studio=loadStudio(),chrome=studio.recorderTypeCandidates(true,'Mozilla/5.0 Chrome/140.0 Safari/537.36'),safari=studio.recorderTypeCandidates(true,'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1');
 assert.match(chrome[0],/^video\/webm;codecs=vp8,opus/u);assert.match(safari[0],/^video\/mp4/u);
});





test('ASMR effects are bounded, nonempty local audio buffers',()=>{


 const studio=loadStudio();let seed=123456789;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};


 for(const kind of ['rain','water','paper','tapping']){const samples=studio.makeAsmrSamples(kind,48000,random);assert.equal(samples.length,48000);let peak=0,nonempty=false;for(const sample of samples){peak=Math.max(peak,Math.abs(sample));nonempty||=Math.abs(sample)>.001;}assert.ok(nonempty,kind);assert.ok(peak<.5,kind);}


});





test('video dialog explains strict photo and text matching, narration privacy and synthetic ASMR',async()=>{


 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const localServer=await readFile(new URL('../scripts/local.mjs',import.meta.url),'utf8');


 assert.ok(html.includes('yalnızca seçtiğin fotoğraf ve ona yazdığın metin'));


 assert.ok(html.includes('id="videoShare"'));assert.ok(html.includes('videoSpeechConsent'));assert.ok(html.includes('Fotoğraflarım gönderilmez.'));


 assert.ok(html.includes('gerçek kayıt veya yapay zekâ sesi değildir'));


 assert.match(source,/navigator\.share\(\{files:\[outputFile\]/u);assert.match(source,/navigator\.canShare\(\{files:\[outputFile\]\}\)/u);assert.match(source,/fetch\('\/api\/speech'/u);assert.doesNotMatch(source,/fetch\([^\n]*scene\.photo/u);


 assert.match(source,/http:\/\/127\.0\.0\.1:11434\/api\/chat/u);assert.match(source,/model:'qwen2\.5-coder:3b'/u);assert.match(source,/photoHint:scene\.hint\.trim\(\)/u);assert.match(source,/scenes\[item\.index\]\.suggestion=suggestion/u);assert.doesNotMatch(source,/scene\[item\.index\]\.caption=suggestion/u);assert.match(source,/Taslağı bu sahnede kullan/u);assert.match(source,/recorderTypeCandidates\(withAudio,navigator\.userAgent/u);assert.match(source,/showOutput\(\);updateButtons\(\)/u);assert.ok(source.includes("['localhost','127.0.0.1','::1'].includes(window.location.hostname)"));
 assert.match(localServer,/connect-src[^;]*http:\/\/127\.0\.0\.1:11434/u);assert.match(localServer,/name\.toLowerCase\(\)!=='content-security-policy'/u);
 assert.match(source,/setTimeout\(\(\)=>\{previewTimer=0;drawPreview\(\);\},100\)/u);assert.match(source,/caption\.addEventListener\('input',\(\)=>\{scene\.caption=caption\.value;scene\.suggestion='';schedulePreview\(\);markEdited\(\);\}\)/u);assert.doesNotMatch(source,/caption\.addEventListener\('input',\(\)=>\{[^}]*renderCards/u);assert.match(source,/await verifyPlayable\(blob\)/u);assert.ok(source.indexOf('await verifyPlayable(blob)')<source.indexOf('clearOutput();needsRender=false;outputUrl'));


 assert.match(source,/function markEdited\(\)\{needsRender=true/u);assert.match(source,/Önceki video korunuyor/u);assert.match(source,/Videoyu yeniden oluştur/u);assert.ok(source.includes('clearOutput();needsRender=false;outputUrl=URL.createObjectURL(blob)'));


});


