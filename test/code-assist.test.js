import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/code-assist.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
function setup({clipboard=true}={}){
 const copied=[];
 const node=tag=>({tagName:tag,className:'',textContent:'',children:[],handlers:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;this.textContent='';},addEventListener(name,handler){this.handlers[name]=handler;}});
 const document={createElement:node,createTextNode:text=>({tagName:'#text',textContent:text,children:[]})};
 const window={navigator:clipboard?{clipboard:{async writeText(text){copied.push(text);}}}:{}};
 vm.runInNewContext(source,{document,window});
 return {document,window,copied,node};
}

test('coding answers render fenced blocks and leave surrounding prose as text',()=>{
 const s=setup(),root=s.node('div');
 s.window.AtlasCodeAssist.render(root,'Özet.\n```js\nconst sum = (a, b) => a + b;\n```\nSonraki adım.');
 assert.equal(root.children[0].textContent,'Özet.\n');
 const block=root.children[1];
 assert.equal(block.className,'code-block');
 assert.equal(block.children[0].children[0].textContent,'js');
 assert.equal(block.children[1].children[0].textContent,'const sum = (a, b) => a + b;');
 assert.equal(root.children[2].textContent,'\nSonraki adım.');
});

test('untrusted code remains literal text and is copied only after a user click',async()=>{
 const s=setup(),root=s.node('div');
 s.window.AtlasCodeAssist.render(root,'```html\n<img src=x onerror=alert(1)>\n```');
 const block=root.children[0],code=block.children[1].children[0],copy=block.children[0].children[1];
 assert.equal(code.textContent,'<img src=x onerror=alert(1)>');
 assert.equal(root.children.some(item=>item.tagName==='img'),false);
 assert.equal(s.copied.length,0);
 await copy.handlers.click();
 assert.deepEqual(s.copied,['<img src=x onerror=alert(1)>']);
 assert.equal(copy.textContent,'Kopyalandı');
});

test('copy reports unavailable clipboard without throwing',async()=>{
 const s=setup({clipboard:false}),root=s.node('div');
 s.window.AtlasCodeAssist.render(root,'```\nhello\n```');
 const copy=root.children[0].children[0].children[1];
 await copy.handlers.click();
 assert.equal(copy.textContent,'Kopyalama başarısız');
});

test('plain answers do not gain a code toolbar',()=>{
 const s=setup(),root=s.node('div');
 s.window.AtlasCodeAssist.render(root,'Düz yanıt.');
 assert.equal(root.children.length,1);
 assert.equal(root.children[0].textContent,'Düz yanıt.');
});

test('copyable code renderer loads before chat and only handles marked coding answers',()=>{
 assert.ok(html.indexOf('/code-assist.css')>=0);
 assert.ok(html.indexOf('/code-assist.js')<html.indexOf('/app.js'));
 assert.match(appSource,/metadata\.coding===true&&window\.AtlasCodeAssist\?\.render/);
});
