import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSetup} from '../scripts/setup-validation.mjs';
const body={key:'synthetic.authorization.token-for-tests-only',password:'test-password-at-least-20',freeTier:true};
test('setup accepts token formats without requiring legacy AIza prefix',()=>{
 for(const key of [body.key,'AIza'+'x'.repeat(35),'synthetic.'+'x'.repeat(300)])assert.equal(validateSetup({...body,key}),null);
});
test('setup gives separate password and billing errors',()=>{
 assert.match(validateSetup({...body,password:'short'}),/20 karakter/);
 assert.match(validateSetup({...body,freeTier:false}),/Ücretsiz katman/);
 assert.match(validateSetup({...body,password:'x'.repeat(513)}),/512 karakter/);
});
test('setup rejects empty, huge, whitespace or header-injection tokens',()=>{
 for(const key of ['', 'short', 'x'.repeat(4097),body.key+'\r\nX-Key: bad',body.key+' ', 'x'.repeat(20)+'\u0000'])assert.match(validateSetup({...body,key}),/API anahtarı/);
 assert.match(validateSetup(null),/API anahtarı/);
});
