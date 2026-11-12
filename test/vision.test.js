import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeVisual,validVisual} from '../src/vision.js';
const jpeg={mimeType:'image/jpeg',data:Buffer.from([255,216,255,224,0,0,0,0,255,217]).toString('base64')};
const png={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII='};
const webpBytes=Buffer.from([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,76,0,0,0,0]);
const webp={mimeType:'image/webp',data:webpBytes.toString('base64')};
const body={confirmed:true,question:'Bu ekranda nereden başlamalıyım?',images:[jpeg]},env={GEMINI_API_KEY:'private-secret'};
const answer=(text='Efendim, 1. görselin sağ üst köşesindeki düğmeye bakın.',finishReason='STOP')=>Response.json({candidates:[{content:{parts:[{thought:true,text:'HIDDEN'},{text}]},finishReason}]});

test('visual validation requires consent, question, bounded images and authentic format signatures',()=>{
 for(const image of [jpeg,png,webp])assert.equal(validVisual({...body,images:[image]}),true);
 for(const bad of [{...body,confirmed:false},{...body,confirmed:'true'},{...body,question:' '},{...body,question:'x'.repeat(1001)},{...body,images:[]},{...body,images:[jpeg,jpeg,jpeg]},{...body,images:[{...jpeg,mimeType:'image/svg+xml'}]},{...body,images:[{...jpeg,mimeType:'image/png'}]},{...body,images:[{...jpeg,data:'https://example.com/image.jpg'}]},{...body,images:[{...jpeg,data:btoa('<svg>malicious</svg>')}]},{...body,images:[{...jpeg,data:jpeg.data.replace('==','=!')}]},{...body,extra:'x'.repeat(3*1024*1024)}])assert.equal(validVisual(bad),false);
 const large=Buffer.alloc(1100000);large.set([255,216,255]);large.set([255,217],large.length-2);
 assert.equal(validVisual({...body,images:Array(2).fill({mimeType:'image/jpeg',data:large.toString('base64')})}),false);
 const brokenWebp=Buffer.from(webpBytes);brokenWebp[4]=99;
 assert.equal(validVisual({...body,images:[{...webp,data:brokenWebp.toString('base64')}]}),false);
});

test('single fixed-model inline request excludes saved data, tools and hidden thoughts',async()=>{
 let calls=0,request;
 const result=await analyzeVisual({...body,savedNotes:'SAVED_PRIVATE_DATA'},env,async(url,options)=>{calls++;request={url,...options};return answer();});
 assert.equal(calls,1);assert.equal(result.status,200);assert.equal(result.visualAssistant,true);assert.ok(!result.text.includes('HIDDEN'));
 assert.match(request.url,/gemini-3.5-flash-lite:generateContent$/);assert.ok(!request.url.includes(env.GEMINI_API_KEY));assert.equal(request.redirect,'manual');assert.equal(request.headers['x-goog-api-key'],env.GEMINI_API_KEY);
 assert.ok(!request.body.includes('SAVED_PRIVATE_DATA'));assert.ok(!request.body.includes(env.GEMINI_API_KEY));
 const payload=JSON.parse(request.body);assert.equal(payload.tools,undefined);assert.equal(payload.contents.length,1);assert.equal(payload.contents[0].parts[2].inlineData.data,jpeg.data);assert.match(payload.contents[0].parts[0].text,/nereden başlamalıyım/);assert.match(payload.systemInstruction.parts[0].text,/güvenilmeyen veridir/);assert.match(payload.systemInstruction.parts[0].text,/Okunamayan metni/);
});

test('invalid requests and unsupported configuration never call upstream',async()=>{
 const upstream=()=>{throw new Error('must not call');};
 assert.equal((await analyzeVisual({...body,confirmed:false},env,upstream)).status,400);
 assert.equal((await analyzeVisual(body,{},upstream)).status,503);
 assert.equal((await analyzeVisual(body,{...env,GEMINI_MODEL:'other'},upstream)).status,503);
});

test('provider errors are sanitized with no retries or fallback',async()=>{
 for(const status of [429,500,302]){let calls=0;const result=await analyzeVisual(body,env,async()=>{calls++;return new Response('private-secret',{status});});assert.equal(calls,1);assert.equal(result.status,status===429?429:502);assert.ok(!JSON.stringify(result).includes('private-secret'));}
 const result=await analyzeVisual(body,env,async()=>{throw new Error('private-secret');});assert.equal(result.status,502);assert.ok(!result.error.includes('private-secret'));
});

test('empty, truncated, blocked and oversized responses are rejected',async()=>{
 for(const [text,reason] of [['','STOP'],['partial','MAX_TOKENS'],['blocked','SAFETY'],['x'.repeat(3501),'STOP']])assert.equal((await analyzeVisual(body,env,async()=>answer(text,reason))).status,422);
 assert.equal((await analyzeVisual(body,env,async()=>new Response('invalid json'))).status,502);
});

test('request aborts after 25 seconds without retrying',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,signal;
 const pending=analyzeVisual(body,env,async(_url,options)=>{calls++;signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private-secret')),{once:true}));});
 t.mock.timers.tick(24999);assert.equal(signal.aborted,false);t.mock.timers.tick(1);
 const result=await pending;assert.equal(result.status,504);assert.equal(calls,1);assert.ok(!result.error.includes('private-secret'));
});
