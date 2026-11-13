import {test} from 'node:test';import assert from 'node:assert/strict';
import {retry,isTransientNetworkError,isTransientD1Error,CircuitBreaker,resilientDb,sleep} from '../src/resilience.js';
import {modelRequest} from '../src/models.js';

test('retry retries transient network errors and returns the later success',async()=>{
 let calls=0;
 const result=await retry(async()=>{calls++;if(calls<3)throw Object.assign(new Error('fetch failed'),{code:'ECONNRESET'});return 'ok';},{attempts:3,baseDelay:1});
 assert.equal(result,'ok');assert.equal(calls,3);
});

test('retry never retries a non-transient error',async()=>{
 let calls=0;
 await assert.rejects(()=>retry(async()=>{calls++;throw new Error('invalid stored state');},{attempts:3,baseDelay:1}),/invalid stored state/u);
 assert.equal(calls,1);
});

test('retry treats an aborted request as final, not transient',async()=>{
 assert.equal(isTransientNetworkError(new Error('The operation was aborted')),false);
 assert.equal(isTransientNetworkError(Object.assign(new Error('fetch failed'),{code:'ECONNRESET'})),true);
});

test('D1 transient detection separates outages from schema errors',()=>{
 assert.equal(isTransientD1Error(new Error('D1_ERROR: network connection lost')),true);
 assert.equal(isTransientD1Error(new Error('D1_ERROR: SQLITE_BUSY: database is locked')),true);
 assert.equal(isTransientD1Error(new Error('D1_ERROR: no such table: atlas_notes')),false);
 assert.equal(isTransientD1Error(new Error('UNIQUE constraint failed: atlas_notes.id')),false);
});

test('circuit breaker opens after the threshold and fails fast until it resets',async()=>{
 const cb=new CircuitBreaker({name:'test-open',threshold:2,resetMs:20});
 for(let i=0;i<2;i++)await assert.rejects(()=>cb.execute(async()=>{throw new Error('boom');}),/boom/u);
 assert.equal(cb.isOpen,true);
 await assert.rejects(()=>cb.execute(async()=>'never'),/circuit open/u);
 await sleep(30);
 assert.equal(cb.isOpen,false);
 assert.equal(await cb.execute(async()=>'ok'),'ok');
});

test('resilientDb retries a transient statement failure once',async()=>{
 let calls=0;
 const db={prepare:()=>{const stmt={bind:()=>stmt,first:async()=>{calls++;if(calls===1)throw Object.assign(new Error('D1_ERROR: network connection lost'));return {n:1};}};return stmt;}};
 const wrapped=resilientDb(db,{name:'test-db-retry',baseDelay:1});
 assert.deepEqual(await wrapped.prepare('SELECT 1').bind(1).first(),{n:1});
 assert.equal(calls,2);
});

test('resilientDb does not retry schema errors and keeps non-terminal properties',async()=>{
 let calls=0;
 const db={prepare:sql=>{const stmt={bind:()=>stmt,run:async()=>{calls++;throw new Error('D1_ERROR: no such table: atlas_notes');},first:async()=>({sql})};return stmt;}};
 const wrapped=resilientDb(db,{name:'test-db-schema',baseDelay:1});
 await assert.rejects(()=>wrapped.prepare('INSERT').run(),/no such table/u);
 assert.equal(calls,1);
 assert.deepEqual(await wrapped.prepare('SELECT 1').first(),{sql:'SELECT 1'});
});

test('modelRequest retries a network failure but never a server error',async()=>{
 let calls=0;
 const flaky=async()=>{calls++;if(calls===1)throw new Error('fetch failed');return Response.json({ok:1});};
 const ok=await modelRequest({GEMINI_API_KEY:'k'},{},{upstream:flaky});
 assert.equal(ok.response.status,200);assert.equal(calls,2);
 calls=0;
 const failing=async()=>{calls++;return new Response('boom',{status:500});};
 const failed=await modelRequest({GEMINI_API_KEY:'k'},{},{upstream:failing});
 assert.equal(failed.response.status,500);assert.equal(calls,1,'a 5xx reply is not retried; the free chain only moves on 429');
});