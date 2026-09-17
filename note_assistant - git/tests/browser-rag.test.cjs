const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function engine(){
  const c=vm.createContext({console,Map,Set,Math,Number,Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rag.js'),'utf8'),c);
  return c;
}
function fixtureIndex(c,chunks){
  const docs=chunks.map(chunk=>{
    const counts=new Map();for(const token of c.ragTokens(chunk.text))counts.set(token,(counts.get(token)||0)+1);
    return {chunk,counts,length:[...counts.values()].reduce((a,b)=>a+b,0)};
  });
  const df=new Map();for(const doc of docs)for(const token of doc.counts.keys())df.set(token,(df.get(token)||0)+1);
  c.ragBrowserIndex=async()=>({docs,df,avgLength:docs.reduce((s,d)=>s+d.length,0)/Math.max(1,docs.length)||1});
}
test('browser upload stores exact source spans without requiring an embedding model',async()=>{
  const c=engine();let stored;
  c.ragReadFileText=async()=> '第一段。\n第二段说明 BM25 检索。';
  c.ragStoreChunks=async(name,chunks,vectors)=>{stored={name,chunks,vectors};};
  c.ragInitEmbedder=async()=>{throw Error('must not load');};
  const result=await c.ragUploadFile({name:'说明.md',size:60});
  assert.equal(result.filename,'说明.md');
  assert.equal(stored.vectors,undefined);
  assert.equal(stored.chunks[0].text,'第一段。\n第二段说明 BM25 检索。');
  assert.equal(stored.chunks[0].start,0);
  assert.equal(stored.chunks[0].end,stored.chunks[0].text.length);
});
test('browser BM25 retrieves cited Chinese/English terms and rejects unrelated query',async()=>{
  const c=engine();
  fixtureIndex(c,[
    {id:1,sourceFile:'差旅制度.md',text:'上海出差住宿费每人每天最多报销八百元。',start:0,end:23},
    {id:2,sourceFile:'检索说明.md',text:'BM25 使用词频和逆文档频率进行关键词排序。',start:0,end:28}
  ]);
  const hit=await c.ragRetrieveDetailedBrowser('上海住宿报销上限是多少？',3);
  assert.equal(hit.hits[0].source,'差旅制度.md');
  assert.equal(hit.hits[0].citation,'S1');
  assert.match(hit.context,/\[S1\][\s\S]*上海出差住宿费/);
  assert.equal((await c.ragRetrieveDetailedBrowser('BM25 检索',3)).hits[0].source,'检索说明.md');
  assert.equal((await c.ragRetrieveDetailedBrowser('火星基地的氧气产量',3)).hits.length,0);
});
test('browser query rewriting runs only after a miss and never hides original retrieval',async()=>{
  const queries=[];let llmCalls=0;
  const c=vm.createContext({console,Map,Set,AbortSignal,loadSettings:()=>({ragEnabled:true,ragMultiQuery:true}),
    ragRetrieveDetailedBrowser:async query=>{queries.push(query);return query.includes('住宿标准')?
      {hits:[{chunkId:1,source:'制度.md',text:'住宿标准为八百元。'}],context:'',trace:{}}:{hits:[],context:'',trace:{}};},
    callLLMWith429Retry:async()=>{llmCalls++;return '{"queries":["上海住宿标准"]}';},
    extractJSONFromText:JSON.parse,document:{addEventListener(){}},tr:key=>key});
  c.window=c;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rag-browser-ui.js'),'utf8'),c);
  const result=await c.ragRetrieveDetailed('上海住宿多少钱？',3);
  assert.deepEqual(queries,['上海住宿多少钱？','上海住宿标准']);
  assert.equal(llmCalls,1);
  assert.equal(result.hits[0].citation,'S1');
  assert.match(result.context,/制度\.md/);
  queries.length=0;
  await c.ragRetrieveDetailed('上海住宿标准',3);
  assert.deepEqual(queries,['上海住宿标准']);
  assert.equal(llmCalls,1);
});
test('rewrite failure keeps a genuine no-evidence result without inventing sources',async()=>{
  const c=vm.createContext({console,Map,Set,AbortSignal,loadSettings:()=>({ragEnabled:true,ragMultiQuery:true}),
    ragRetrieveDetailedBrowser:async()=>({hits:[],context:'',trace:{}}),
    callLLMWith429Retry:async()=>{throw Error('429');},extractJSONFromText:JSON.parse,
    document:{addEventListener(){}},tr:key=>key});
  c.window=c;vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rag-browser-ui.js'),'utf8'),c);
  const result=await c.ragRetrieveDetailed('问题',3);
  assert.equal(result.hits.length,0);
  assert.equal(result.context,'');
});
test('browser backup exports text without embedding arrays and rejects malformed imports',async()=>{
  const c=engine();
  c.ragListDocuments=async()=>[{filename:'说明.md',chunks:1}];
  c.ragBrowserIndex=async()=>({docs:[{chunk:{sourceFile:'说明.md',text:'BM25 关键词检索',start:0,end:11,embedding:[1,2]}}]});
  const backup=await c.ragExportBackup();
  assert.equal(backup.format,'note-assistant-browser-kb');
  assert.equal(backup.documents[0].chunks[0].text,'BM25 关键词检索');
  assert.doesNotMatch(JSON.stringify(backup),/embedding/);
  await assert.rejects(c.ragImportBackup({format:'wrong',version:1,documents:[]}));
  await assert.rejects(c.ragImportBackup({format:'note-assistant-browser-kb',version:1,documents:[{filename:'x',chunks:[{text:''}]}]}));
});
test('Chinese evaluation reports exploratory browser BM25 retrieval quality',async()=>{
  const c=engine(),root=path.join(__dirname,'../eval/chinese_v2');
  const corpus=JSON.parse(fs.readFileSync(path.join(root,'corpus.json'),'utf8'));
  fixtureIndex(c,corpus.map((doc,i)=>({id:i+1,sourceFile:doc.source,text:doc.text,start:0,end:doc.text.length})));
  for(const split of ['dev','test']){
    const questions=JSON.parse(fs.readFileSync(path.join(root,split+'.json'),'utf8'));
    let relevant=0,found=0,noAnswer=0,falseHit=0;
    for(const q of questions){
      const result=await c.ragRetrieveDetailedBrowser(q.query,3);
      const sources=new Set(result.hits.map(hit=>hit.source));
      if(!Object.keys(q.relevance).length){noAnswer++;if(result.hits.length)falseHit++;}
      else{relevant++;if(Object.keys(q.relevance).some(source=>sources.has(source)))found++;}
    }
    console.log('Browser BM25 '+split+' recall@3:',found+'/'+relevant,'no-answer false hits:',falseHit+'/'+noAnswer);
    if(split==='dev'){assert.ok(found>=24);assert.ok(falseHit<=2);}
  }
});
