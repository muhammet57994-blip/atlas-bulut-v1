import {test} from 'node:test';import assert from 'node:assert/strict';
import {instagramPlan,instagramPlanCommand} from '../src/instagram-plan.js';
import {seal} from '../src/instagram-account.js';
test('planner recognizes explicit drafting commands, never publication',()=>{assert.ok(instagramPlanCommand('Instagram içerik planımı hazırla.'));assert.equal(instagramPlanCommand('Instagram içerik planımı yayınla'),null);assert.equal(instagramPlanCommand('Bunu hatırla: Instagram planımı hazırla'),null);assert.equal(instagramPlanCommand('Instagram planımı hazırla: seramik atölyem').goal,'seramik atölyem');});
async function setup(){const secret='s'.repeat(40),token='private-token';const sealed=await seal(JSON.stringify({token,scopes:['instagram_business_basic','instagram_business_manage_insights'],expiresAt:Date.now()+60000}),secret);return {SESSION_SECRET:secret,GEMINI_API_KEY:'private-key',MEMORY_DB:{prepare(){return {first:async()=>({encrypted_token:sealed})};}}};}
test('plan reads only account metrics, sends one bounded free-model request without token or writes',async()=>{
 const env=await setup();let models=0,reads=0;
 const result=await instagramPlan({goal:'Seramik atölyem için içerik hazırlamak.'},env,async(url,r)=>{
  assert.equal(r.redirect,'manual');if(url.includes('generativelanguage')){models++;const b=JSON.parse(r.body);assert.ok(!r.body.includes('private-token'));assert.match(url,/gemini-3.5-flash-lite/);assert.equal(b.tools,undefined);assert.equal(b.generationConfig.maxOutputTokens,2400);return Response.json({candidates:[{content:{parts:[{text:'1. gün: Gerçek demo hazırlayın.'}]}}]});}
  reads++;assert.equal(r.method,'GET');if(url.includes('/me?'))return Response.json({user_id:'17841407597588263',username:'celik38__'});
  const metric=new URL(url).searchParams.get('metric');return Response.json({data:[{name:metric,total_value:{value:metric==='reach'?51:2}}]});
 });assert.equal(result.status,200);assert.equal(models,1);assert.equal(reads,4);assert.match(result.text,/51/);assert.match(result.text,/kaydedilmedi/);
});
test('default project plan uses verified examples and live metrics without spending model quota',async()=>{
 const env=await setup();let reads=0;
 const r=await instagramPlan({},env,async(url,options)=>{
  assert.ok(!url.includes('generativelanguage'));assert.equal(options.method,'GET');reads++;
  if(url.includes('/me?'))return Response.json({user_id:'17841407597588263',username:'celik38__'});
  const metric=new URL(url).searchParams.get('metric');return Response.json({data:[{name:metric,total_value:{value:51}}]});
 });assert.equal(r.status,200);assert.equal(reads,4);assert.match(r.text,/51/);assert.match(r.text,/Notlarda ara: AI Studio/);assert.match(r.text,/7. gün/);assert.match(r.text,/Bu taslak paylaşılmadı/);assert.ok(r.text.length<6000);
});
test('missing metrics never become a fabricated data-based plan; invalid goal makes no calls',async()=>{
 const env=await setup();let calls=0;assert.equal((await instagramPlan({goal:'x'.repeat(701)},env,()=>{calls++;})).status,400);assert.equal(calls,0);
 const r=await instagramPlan({},env,async(url)=>{assert.ok(!url.includes('generativelanguage'));return Response.json(url.includes('/me?')?{user_id:'17841407597588263',username:'celik38__'}:{});});assert.equal(r.status,422);
});
