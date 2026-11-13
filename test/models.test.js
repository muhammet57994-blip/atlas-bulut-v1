import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FREE_MODELS,DEFAULT_MODEL,approvedModel,modelChain,modelRequest} from '../src/models.js';
import {healthSnapshot} from '../src/health.js';

test('the chain starts with the configured free model and lists every free model once',()=>{
 assert.deepEqual(modelChain({}),FREE_MODELS);
 assert.equal(DEFAULT_MODEL,FREE_MODELS[0]);
 assert.deepEqual(modelChain({GEMINI_MODEL:'gemini-3.6-flash'}),['gemini-3.6-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.8-flash']);
 assert.deepEqual(modelChain({GEMINI_MODEL:'paid-model'}),[],'an unapproved model still fails closed');
 assert.equal(new Set(FREE_MODELS).size,FREE_MODELS.length);
 assert.ok(FREE_MODELS.every(approvedModel));
 assert.equal(approvedModel('gemini-3.1-pro'),false);
 assert.equal(approvedModel('gemini-3.5-flash-lite '),true);
});

test('a quota reply moves to the next free model and the result names the model that answered',async()=>{
 const asked=[];
 const result=await modelRequest({GEMINI_API_KEY:'local-test-key'},{contents:[{role:'user',parts:[{text:'Merhaba'}]}]},{upstream:async(url,options)=>{
  const model=url.split('/models/')[1].split(':')[0];asked.push(model);
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers['x-goog-api-key'],'local-test-key');
  assert.ok(!url.includes('local-test-key'));
  return model===FREE_MODELS[1]?Response.json({candidates:[{content:{parts:[{text:'Efendim, merhaba.'}]}}]}):new Response('quota',{status:429,headers:{'Retry-After':'30'}});
 }});
 assert.deepEqual(asked,[FREE_MODELS[0],FREE_MODELS[1]]);
 assert.equal(result.model,FREE_MODELS[1]);
 assert.equal(result.quotaExhausted,false);
 assert.equal((await result.response.json()).candidates[0].content.parts[0].text,'Efendim, merhaba.');
});

test('a broken key or a refused request stops at the first model',async()=>{
 for(const status of [400,401,403,500]){
  let calls=0;
  const result=await modelRequest({GEMINI_API_KEY:'local-test-key'},{contents:[]},{upstream:async()=>{calls++;return new Response('private-key',{status});}});
  assert.equal(calls,1,`HTTP ${status} is not a quota reply`);
  assert.equal(result.response.status,status);
  assert.equal(result.quotaExhausted,false);
 }
});

test('an exhausted chain returns the last quota reply and never reaches a paid model',async()=>{
 const asked=[];
 const result=await modelRequest({GEMINI_API_KEY:'local-test-key'},{contents:[]},{upstream:async url=>{asked.push(url.split('/models/')[1].split(':')[0]);return new Response('quota',{status:429,headers:{'Retry-After':'45'}});}});
 assert.deepEqual(asked,FREE_MODELS);
 assert.equal(result.quotaExhausted,true);
 assert.equal(result.response.headers.get('Retry-After'),'45');
 assert.ok(asked.every(model=>FREE_MODELS.includes(model)));
});

test('an unapproved model makes no request at all',async()=>{
 let calls=0;
 const result=await modelRequest({GEMINI_API_KEY:'local-test-key',GEMINI_MODEL:'paid-model'},{},{upstream:async()=>{calls++;}});
 assert.equal(calls,0);
 assert.equal(result.response,null);
 assert.equal(result.quotaExhausted,false);
});

test('health approves every free model and still rejects a paid one',async()=>{
 const base={ATLAS_ACCESS_PASSWORD:'a'.repeat(24),SESSION_SECRET:'s'.repeat(40),GEMINI_API_KEY:'local-test-key',LOGIN_LIMIT:{limit:async()=>({success:true})},CHAT_LIMIT:{limit:async()=>({success:true})}};
 for(const model of FREE_MODELS){
  const report=await healthSnapshot({...base,GEMINI_MODEL:model});
  assert.equal(report.payload.model.approved,true,model);
 }
 const paid=await healthSnapshot({...base,GEMINI_MODEL:'paid-model'});
 assert.equal(paid.payload.model.approved,false);
 assert.equal((await healthSnapshot(base)).payload.model.approved,true,'an absent model setting keeps the free default');
});
