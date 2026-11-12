import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signDraft,verifyDraft} from '../src/daily-signing.js';
const env={SESSION_SECRET:'s'.repeat(40)},now=new Date('2026-10-25T09:00:00Z');
test('daily approvals bind purpose, contents, signing key and exact 30-minute lifetime',async()=>{
 const data={id:'draft',amount_minor:12345},token=await signDraft(env,'daily',data,now);
 assert.deepEqual(await verifyDraft(env,token,'daily',now),data);
 await assert.rejects(verifyDraft(env,token,'focus',now));
 await assert.rejects(verifyDraft({SESSION_SECRET:'x'.repeat(40)},token,'daily',now));
 await assert.rejects(verifyDraft(env,token,'daily',new Date(now.getTime()-1)));
 await assert.rejects(verifyDraft(env,token,'daily',new Date(now.getTime()+1800000)));
 const parts=token.split('.'),payload=JSON.parse(Buffer.from(parts[0],'base64url').toString());payload.data.amount_minor=1;
 await assert.rejects(verifyDraft(env,Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+parts[1],'daily',now));
});
test('invalid approval tokens, oversized drafts and weak configuration fail closed',async()=>{
 for(const token of [null,42,'','a.b.c','a.@@','x'.repeat(24101),'e30.AAAA'])await assert.rejects(verifyDraft(env,token,'daily',now));
 await assert.rejects(signDraft({SESSION_SECRET:'weak'},'daily',{},now));
 await assert.rejects(signDraft(env,'other',{},now));
 await assert.rejects(signDraft(env,'daily',{text:'x'.repeat(25000)},now));
});
