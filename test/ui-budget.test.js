import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,statSync,readdirSync} from 'node:fs';
const read=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const bytes=name=>statSync(new URL('../public/'+name,import.meta.url)).size;

test('the shell keeps its language, viewport and reduced-motion support',()=>{
 const html=read('index.html');
 assert.match(html,/^<!doctype html><html lang="tr">/u);
 assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1">/u);
 assert.match(html,/aria-live="polite"/u);
 assert.match(read('style.css'),/@media\(prefers-reduced-motion:\s*reduce\)/u);
 for(const tag of html.matchAll(/<img\b[^>]*>/gu))assert.match(tag[0],/\balt="/u,'every image has an alt attribute');
});

test('the shipped client stays inside the size budget',()=>{
 assert.ok(bytes('app.js')<60_000,`app.js ${bytes('app.js')}`);
 assert.ok(bytes('style.css')<60_000,`style.css ${bytes('style.css')}`);
 assert.ok(bytes('index.html')<110_000,`index.html ${bytes('index.html')}`);
 const total=readdirSync(new URL('../public/',import.meta.url)).filter(name=>name.endsWith('.js')).reduce((sum,name)=>sum+bytes(name),0);
 assert.ok(total<300_000,`all client scripts ${total}`);
});
