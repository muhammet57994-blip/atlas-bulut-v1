import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codeRequest,normalizeResearchResults,researchRequest,webSearchTool} from '../src/research.js';

test('research is opt-in and coding help is recognized',()=>{
 assert.equal(researchRequest('Bu konuyu araştır'),true);
 assert.equal(researchRequest('Merhaba'),false);
 assert.equal(codeRequest('JavaScript fonksiyon yaz'),true);
 assert.deepEqual(webSearchTool('güncel bilgi'),{googleSearch:{}});
});

test('grounding sources are safe, unique, bounded and mapped to citations',()=>{
 const result=normalizeResearchResults({
  groundingChunks:[
   {web:{uri:'https://example.com/a',title:'Kaynak A'}},
   {web:{uri:'https://example.com/a',title:'Tekrar'}},
   {web:{uri:'http://unsafe.example',title:'HTTP'}},
   {web:{uri:'javascript:alert(1)',title:'Script'}},
   {web:{uri:'https://example.com/'+ 'x'.repeat(2048),title:'Çok uzun'}},
   {web:{uri:'https://example.com/b',title:'Kaynak B'}}
  ],
  groundingSupports:[
   {segment:{startIndex:0,endIndex:10},groundingChunkIndices:[0,1]},
   {segment:{startIndex:-1,endIndex:2},groundingChunkIndices:[0]},
   {segment:{startIndex:10,endIndex:15},groundingChunkIndices:[99]},
   {segment:{startIndex:15,endIndex:20},groundingChunkIndices:[5,2,3]}
  ]
 });
 assert.deepEqual(result.sources,[
  {title:'Kaynak A',url:'https://example.com/a'},
  {title:'Kaynak B',url:'https://example.com/b'}
 ]);
 assert.deepEqual(result.citations,[
  {startIndex:0,endIndex:10,sourceIndices:[0]},
  {startIndex:15,endIndex:20,sourceIndices:[1]}
 ]);
});

test('citations keep original chunk indices across rejected, duplicate and capped sources',()=>{
 const result=normalizeResearchResults({
  groundingChunks:[
   {web:{uri:'http://unsafe.example',title:'HTTP'}},
   {web:{uri:'https://example.com/a',title:'A'}},
   {web:{uri:'https://example.com/a',title:'A duplicate'}},
   ...Array.from({length:5},(_,index)=>({web:{uri:`https://example.com/${index}`,title:`Source ${index}`}}))
  ],
  groundingSupports:[
   {segment:{startIndex:0,endIndex:1},groundingChunkIndices:[0,1,2]},
   {segment:{startIndex:1,endIndex:2},groundingChunkIndices:[6]}
  ]
 });
 assert.equal(result.sources.length,5);
 assert.deepEqual(result.citations,[
  {startIndex:0,endIndex:1,sourceIndices:[0]},
  {startIndex:1,endIndex:2,sourceIndices:[4]}
 ]);
});
