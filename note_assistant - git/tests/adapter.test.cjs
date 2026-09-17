const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const AnnotationCore=require('../assets/annotation-core.js');
const source=fs.readFileSync(path.join(__dirname,'../assets/rag-backend.js'),'utf8');
function harness(fail=false){
  let calls=0, bodies=[];
  const ctx=vm.createContext({console,AbortSignal,Map,Set,JSON,
    loadSettings:()=>({ragBackend:true,ragMultiQuery:true,model:'test',apiBase:'fixture'}),
    callLLM:async()=>{calls++; if(fail) throw Error('fixture');return '{"queries":["BM25 keywords"]}';},
    extractJSONFromText:JSON.parse,
    fetch:async(url,opts)=>{bodies.push(JSON.parse(opts.body));return {ok:true,json:async()=>({context:'evidence',hits:[],trace:{warnings:[]}})};},
    document:{addEventListener:()=>{}}
  });
  ctx.window=ctx;
  vm.runInContext(source,ctx);
  return {ctx,bodies,calls:()=>calls};
}
test('rewrite cache shares concurrent requests, while every retrieval keeps original',async()=>{
  const h=harness();
  await Promise.all([h.ctx.ragRetrieveDetailed('BM25',3),h.ctx.ragRetrieveDetailed('BM25',3)]);
  assert.equal(h.calls(),1);assert.equal(h.bodies.length,2);
  assert.equal(h.bodies[0].query,'BM25');
});
test('rewrite failure retains original retrieval and reports degradation',async()=>{
  const h=harness(true),r=await h.ctx.ragRetrieveDetailed('BM25',3);
  assert.equal(h.bodies[0].query,'BM25');assert.equal(h.bodies[0].queries.length,0);
  assert.match(r.trace.warnings[0],/query_rewrite_failed/);
});
test('citation membership rejects unknown references',()=>{
  const ctx=vm.createContext({Set,Array});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/rag-quality.js'),'utf8'),ctx);
  assert.equal(ctx.ragCheckCitations('evidence [S1]',[{citation:'S1'}]).valid,true);
  assert.equal(ctx.ragCheckCitations('fiction [S99]',[{citation:'S1'}]).valid,false);
});
test('KB test falls back to uncited model answer after rewritten local miss',async()=>{
  const elements={'rag-test-query':{value:'BM25 是什么？'},'rag-test-result':{textContent:''}};
  let modelCalls=0;
  const ctx=vm.createContext({console,AbortSignal,Map,Set,JSON,AnnotationCore,
    loadSettings:()=>({ragBackend:true,ragMultiQuery:true,topN:3,model:'fixture',apiBase:'fixture'}),
    tr:key=>({searching:'检索中',kbMissModel:'本地知识库未找到相关内容，以下为模型回答。'})[key]||key,
    callLLM:async(_,opts)=>{modelCalls++;if(!opts.onDelta)return '{"queries":[]}';opts.onDelta('&#x42;M25 是排名函数。[S9]');return '&#x42;M25 是排名函数。[S9]';},
    extractJSONFromText:JSON.parse,apiUserError:e=>e.message,
    fetch:async()=>({ok:true,json:async()=>({context:'',hits:[],trace:{warnings:[]}})}),
    document:{addEventListener:()=>{},getElementById:id=>elements[id]}
  });ctx.window=ctx;vm.runInContext(source,ctx);
  const button={disabled:false};await ctx.runRagTest(button);
  assert.equal(modelCalls,2);assert.equal(button.disabled,false);
  assert.match(elements['rag-test-result'].textContent,/本地知识库未找到相关内容[\s\S]*BM25 是排名函数/);
  assert.doesNotMatch(elements['rag-test-result'].textContent,/\[S9\]|&#x42;|语义检索未启用/);
});
