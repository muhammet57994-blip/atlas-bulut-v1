import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example',password='test-access-password-long-2026',allow={limit:async()=>({success:true})};
const env=()=>({ATLAS_ACCESS_PASSWORD:password,SESSION_SECRET:'test-session-secret-at-least-32-characters',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,ASSETS:{fetch:async()=>new Response('<h1>ATLAS</h1>')}});
const report=body=>new Request(origin+'/api/csp-report',{method:'POST',headers:{'Content-Type':'application/csp-report'},body});

test('the page advertises the report endpoint',async()=>{
 const response=await createWorker().fetch(new Request(origin+'/'),env());
 assert.match(response.headers.get('Content-Security-Policy')||'',/report-uri \/api\/csp-report/u);
});

test('a browser violation report is accepted, logged and carries a request id',async t=>{
 const logged=[];t.mock.method(console,'error',(...args)=>logged.push(args.join(' ')));
 const response=await createWorker().fetch(report(JSON.stringify({'csp-report':{'document-uri':origin+'/','violated-directive':'script-src'}})),env());
 assert.equal(response.status,204);
 const id=response.headers.get('X-ATLAS-Request-Id');
 assert.match(id||'',/^[0-9a-f]{8}-/u);
 const entry=logged.map(line=>JSON.parse(line)).find(item=>item.stage==='csp.report');
 assert.ok(entry,'the violation reaches the structured log');
 assert.equal(entry.requestId,id);
 const text=logged.join(' ');
 assert.ok(!text.includes('document-uri'),'report bodies are never logged verbatim');
});

test('unsupported report types and oversized bodies are refused',async()=>{
 const worker=createWorker();
 const plain=new Request(origin+'/api/csp-report',{method:'POST',headers:{'Content-Type':'text/plain'},body:'x'});
 assert.equal((await worker.fetch(plain,env())).status,415);
 assert.equal((await worker.fetch(report('x'.repeat(9000)),env())).status,413);
});
