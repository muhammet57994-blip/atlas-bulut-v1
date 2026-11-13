import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../src/worker.js';
const origin='https://atlas.example';
const allow={limit:async()=>({success:true})};
const env=(overrides={})=>({ATLAS_ACCESS_PASSWORD:'test-access-password-long-2026',SESSION_SECRET:'test-session-secret-at-least-32-characters',GEMINI_API_KEY:'FAKE_TEST_KEY',GEMINI_MODEL:'gemini-3.5-flash-lite',LOGIN_LIMIT:allow,CHAT_LIMIT:allow,...overrides});

test('rate limits are scoped per client instead of one shared key',async()=>{
 const keys=[];
 const guard={limit:async({key})=>{keys.push(key);return {success:!key.endsWith('@1.2.3.4')};}};
 const worker=createWorker();
 const call=ip=>worker.fetch(new Request(origin+'/api/health',{headers:ip?{'CF-Connecting-IP':ip}:{}}),env({CHAT_LIMIT:guard}));
 assert.equal((await call('1.2.3.4')).status,429,'the blocked device is refused');
 assert.equal((await call('5.6.7.8')).status,503,'a second device keeps its own budget');
 assert.equal((await call()).status,503,'traffic without the header is not collateral');
 assert.deepEqual(keys,['atlas-health@1.2.3.4','atlas-health@5.6.7.8','atlas-health@shared']);
 assert.equal((await call('203.0.113.7:8080')).status,503);
 assert.equal(keys.at(-1),'atlas-health@shared','an unusable header value falls back to the shared key');
});
