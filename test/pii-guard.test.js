import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
await import('../public/pii-guard.js');
const guard=globalThis.atlasPiiGuard;
const types=text=>guard.findPii(text).map(item=>item.type);

test('an ID number is only flagged when its checksum is valid',()=>{
 assert.deepEqual(types('10000000146'),['tckn']);
 assert.deepEqual(types('Kimlik: 10000000146.'),['tckn']);
 assert.deepEqual(types('10000000147'),[],'a wrong checksum digit is not an ID');
 assert.deepEqual(types('00000000146'),[],'a leading zero is not an ID');
 assert.deepEqual(types('Sipariş 20261113001'),[],'an order number is not an ID');
});

test('an IBAN must pass mod-97, with or without spaces and in any case',()=>{
 assert.deepEqual(types('TR33 0006 1005 1978 6457 8413 26'),['iban']);
 assert.deepEqual(types('tr330006100519786457841326'),['iban']);
 assert.deepEqual(types('TR12 0006 1005 1978 6457 8413 26'),[],'a broken checksum is not an IBAN');
 assert.equal(guard.findPii('TR33 0006 1005 1978 6457 8413 26')[0].label,'IBAN');
});

test('a card number must pass Luhn and have 13–19 digits',()=>{
 assert.deepEqual(types('4111 1111 1111 1111'),['card']);
 assert.deepEqual(types('4111111111111111'),['card']);
 assert.deepEqual(types('4111 1111 1111 1112'),[],'a wrong Luhn digit is not a card');
 assert.deepEqual(types('4111 1111 111'),[],'a short group is not a card');
});

test('mobile numbers are caught with a prefix or separators, not as bare digits',()=>{
 assert.deepEqual(types('+90 532 123 45 67'),['phone']);
 assert.deepEqual(types('0532 123 45 67'),['phone']);
 assert.deepEqual(types('532 123 45 67'),['phone']);
 assert.deepEqual(types('5321234567'),[],'a bare number is more likely a quantity');
 assert.deepEqual(types('5000000000'),[],'a round figure is not a phone');
});

test('dates, prices and ordinary text never trigger the guard',()=>{
 for(const text of ['13.11.2026 14:30','1.250,00 TL','Saat 09:30, 3 kişi','Not 42: yarın toplantı','Tarih 2026-11-13'])assert.deepEqual(types(text),[],text);
});

test('masking replaces each identifier and keeps the rest of the sentence',()=>{
 const text='Ara: 0532 123 45 67, kart 4111 1111 1111 1111, kimlik 10000000146.';
 const masked=guard.maskPii(text);
 assert.equal(masked,'Ara: [gizlendi], kart [gizlendi], kimlik [gizlendi].');
 assert.equal(guard.summarize(guard.findPii(text)),'1 Telefon numarası · 1 Kart numarası · 1 Kimlik numarası');
 assert.equal(guard.maskPii('temiz metin'),'temiz metin');
});

test('the page loads the guard before the app and offers a clear dialog',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const guardAt=html.indexOf('/pii-guard.js'),appAt=html.indexOf('/app.js');
 assert.ok(guardAt>0&&appAt>guardAt,'the guard loads before the chat script');
 for(const id of ['piiDialog','piiSummary','piiFindings','piiCancel','piiMask','piiSend'])assert.ok(html.includes(`id="${id}"`),id);
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/window\.atlasPiiGuard\.findPii/u,'the send handler consults the guard');
 assert.match(app,/atlasPiiGuard\.maskPii/u,'the dialog can mask the message');
 assert.match(app,/piiOverride/u,'a deliberate send can bypass the prompt');
 assert.match(app,/piiConfirmed!==true/u,'programmatic chat sends hit the same backstop');
 // Voice fills the composer and submits the same form, so it passes the guard too.
 assert.match(app,/atlasPiiGuard|piiOverride/u);
 const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.match(worker,/'\/pii-guard\.js'/u,'the worker serves the guard');
});
