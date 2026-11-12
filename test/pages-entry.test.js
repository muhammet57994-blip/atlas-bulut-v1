import {test} from 'node:test';
import assert from 'node:assert/strict';
import entry from '../pages-entry/public/_worker.js';

test('Pages entry preserves request origin, cookie and protected response',async()=>{
 const request=new Request('https://atlas-pasam-v1.pages.dev/api/chat',{method:'POST',headers:{Origin:'https://atlas-pasam-v1.pages.dev',Cookie:'__Host-atlas=test'},body:'{}'});
 const response=new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store','Set-Cookie':'__Host-atlas=; Secure; HttpOnly'}});
 let calls=0;
 const actual=await entry.fetch(request,{ATLAS:{fetch:async incoming=>{calls++;assert.equal(incoming,request);return response;}}});
 assert.equal(actual,response);assert.equal(calls,1);assert.equal(actual.status,401);
});
test('Pages entry fails closed and does not expose internal errors',async()=>{
 for(const env of [{},{ATLAS:{fetch:async()=>{throw new Error('private-detail');}}}]){
  const response=await entry.fetch(new Request('https://atlas-pasam-v1.pages.dev/'),env);
  assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(!(await response.text()).includes('private-detail'));
 }
});
