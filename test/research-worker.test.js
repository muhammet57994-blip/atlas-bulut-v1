import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';

const origin='https://atlas.example';
const password='test-access-password-long-2026';
const allow={limit:async()=>({success:true})};
const environment=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')}});
const request=(body,cookie='')=>new Request(origin+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});

async function signedIn(worker,env){
 const response=await worker.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})}),env);
 return response.headers.get('Set-Cookie').split(';')[0];
}

test('research mode enables Google Search and returns grounded safe sources',async()=>{
 let sent;
 const worker=createWorker(async(url,options)=>{
  sent={url,options};
  return Response.json({candidates:[{content:{parts:[{text:'Güncel yanıt'}]},groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)',title:'Güvensiz'}},{web:{uri:'https://docs.example/page',title:'Resmî kaynak'}},{web:{uri:'https://docs.example/page',title:'Yinelenen kaynak'}}],groundingSupports:[{segment:{startIndex:0,endIndex:12},groundingChunkIndices:[1,2]}]}}]});
 });
 const env=environment(),cookie=await signedIn(worker,env);
 const response=await worker.fetch(request({research:true,messages:[{role:'user',text:'Güncel bilgiyi araştır'}]},cookie),env);
 const result=await response.json();
 const body=JSON.parse(sent.options.body);
 assert.equal(body.tools[0].googleSearch!==undefined,true);
 assert.equal(body.tools[0].googleSearchQueries,undefined);
 assert.equal(result.research,true);
 assert.deepEqual(result.sources,[{title:'Resmî kaynak',url:'https://docs.example/page'}]);
 assert.deepEqual(result.citations,[{startIndex:0,endIndex:12,sourceIndices:[0]}]);
});

test('ordinary chat and coding help do not enable web search',async()=>{
 let sent;
 const worker=createWorker(async(url,options)=>{sent=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:'Yanıt'}]}}]});});
 const env=environment(),cookie=await signedIn(worker,env);
 const result=await (await worker.fetch(request({messages:[{role:'user',text:'JavaScript fonksiyon yaz'}]},cookie),env)).json();
 assert.equal(sent.tools,undefined);
 assert.equal(result.coding,true);
 assert.equal(result.research,undefined);
 assert.match(sent.systemInstruction.parts[0].text,/paylaşılan gerçek dosya içeriğine dayanan fenced diff/);
 assert.match(sent.systemInstruction.parts[0].text,/geri alma adımları/);
});
