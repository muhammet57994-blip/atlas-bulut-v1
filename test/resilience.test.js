import {test} from 'node:test';import assert from 'node:assert/strict';
import {retry,isTransientNetworkError,isTransientD1Error,CircuitBreaker,resilientDb,breaker,sleep} from '../src/resilience.js';
import {modelRequest} from '../src/models.js';

test('retry returns at once on success and never delays a healthy call',async()=>{
 let calls=0;
 assert.equal(await retry(async()=>{calls++;return 'ok';},{baseDelay:1}),'ok');
 assert.equal(calls,1);
});

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

test('circuit breaker opens after the threshold and resets after the window',async()=>{
 const cb=new CircuitBreaker({name:'test-open',threshold:2,resetMs:20});
 cb.recordFailure();assert.equal(cb.isOpen,false);
 cb.recordFailure();assert.equal(cb.isOpen,true);
 await sleep(30);
 assert.equal(cb.isOpen,false);
 cb.recordFailure();assert.equal(cb.isOpen,false,'the counter restarted after the reset');
 cb.recordSuccess();assert.equal(cb.isOpen,false);
});

test('resilientDb retries a transient statement failure once',async()=>{
 let calls=0;
 const db={prepare:()=>{const stmt={bind:()=>stmt,first:async()=>{calls++;if(calls===1)throw Object.assign(new Error('D1_ERROR: network connection lost'));return {n:1};}};return stmt;}};
 const wrapped=resilientDb(db,{name:'test-db-retry',baseDelay:1});
 assert.deepEqual(await wrapped.prepare('SELECT 1').bind(1).first(),{n:1});
 assert.equal(calls,2);
});

test('resilientDb keeps bind arguments and passes list reads through',async()=>{
 let seen;
 const db={prepare:sql=>({bind:(...args)=>({all:async()=>{seen={sql,args};return [{v:1}];},first:async()=>({sql})})})};
 const wrapped=resilientDb(db,{name:'test-db-args',baseDelay:1});
 assert.deepEqual(await wrapped.prepare('SELECT ?').bind(7).all(),[{v:1}]);
 assert.deepEqual(seen,{sql:'SELECT ?',args:[7]});
});

test('resilientDb does not retry schema errors or trip the breaker',async()=>{
 let calls=0;
 const db={prepare:()=>({run:async()=>{calls++;throw new Error('D1_ERROR: no such table: atlas_notes');}})};
 const wrapped=resilientDb(db,{name:'test-db-schema',baseDelay:1});
 for(let i=0;i<10;i++)await assert.rejects(()=>wrapped.prepare('INSERT').run(),/no such table/u);
 assert.equal(calls,10,'a schema error is final on the first attempt');
 assert.equal(breaker('test-db-schema').isOpen,false,'schema errors never open the breaker');
});

test('resilientDb fails fast once its breaker is open',async()=>{
 let calls=0;
 const db={prepare:()=>({first:async()=>{calls++;throw new Error('D1_ERROR: network connection lost');}})};
 const wrapped=resilientDb(db,{name:'test-db-open',baseDelay:1});
 for(let i=0;i<8;i++)await assert.rejects(()=>wrapped.prepare('SELECT 1').first(),/network connection lost/u);
 const before=calls;
 await assert.rejects(()=>wrapped.prepare('SELECT 1').first(),/circuit open: test-db-open/u);
 assert.equal(calls,before,'an open breaker stops touching the database');
 breaker('test-db-open').recordSuccess();
 assert.equal(await wrapped.prepare('SELECT 1').first().catch(()=> 'still failing'),'still failing');
});

test('resilientDb unwraps statements for batch and retries the whole group',async()=>{
 let calls=0,seen;
 const db={prepare:sql=>({bind:(...args)=>({sql,args}),sql}),batch:async list=>{calls++;if(calls===1)throw new Error('D1_ERROR: network connection lost');seen=list;return list.map(()=>({results:[{n:1}]}));}};
 const wrapped=resilientDb(db,{name:'test-db-batch',baseDelay:1});
 const out=await wrapped.batch([wrapped.prepare('SELECT 1').bind(1),wrapped.prepare('SELECT 2')]);
 assert.equal(calls,2,'the batch is retried once as a group');
 assert.equal(seen.length,2);
 assert.equal(seen[0].sql,'SELECT 1');assert.deepEqual(seen[0].args,[1]);
 assert.equal(seen[1].sql,'SELECT 2');assert.equal(seen[1].args,undefined);
 assert.deepEqual(out,[{results:[{n:1}]},{results:[{n:1}]}]);
});

test('resilientDb only exposes batch when the database supports it',()=>{
 assert.equal('batch' in resilientDb({prepare:()=>({})},{name:'test-db-nobatch'}),false);
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

test('modelRequest fails fast when the provider breaker is open',async()=>{
 const cb=breaker('gemini',{threshold:5,resetMs:30000});
 for(let i=0;i<5;i++)cb.recordFailure();
 const upstream=async()=>{throw new Error('must not be called');};
 const result=await modelRequest({GEMINI_API_KEY:'k'},{},{upstream});
 assert.equal(result.circuitOpen,true);
 assert.equal(result.response,null);
 cb.recordSuccess();
});

test('a timeout does not count towards opening the provider breaker',async()=>{
 const cb=breaker('gemini',{threshold:5,resetMs:30000});cb.recordSuccess();
 for(let i=0;i<5;i++)await assert.rejects(()=>modelRequest({GEMINI_API_KEY:'k'},{},{upstream:async()=>{throw new Error('timeout');}}),/timeout/u);
 assert.equal(cb.isOpen,false,'a timeout is a slow reply, not an outage');
 assert.equal((await modelRequest({GEMINI_API_KEY:'k'},{},{upstream:async()=>Response.json({ok:1})})).response.status,200);
});