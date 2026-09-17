const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const routing=require('../assets/question-routing.js');
const annotationCore=require('../assets/annotation-core.js');
const apiSettings=require('../assets/api-settings.js');
const question='2026年去上海出差，住宿一天最多报多少？';
function app(text,{evidence=true,manual=[],ragMultiQuery=true,ragBackend=true}={}){
  const elements={'note-input':{value:text},'generation-status':{},'stop-generation':{},'cards-container':{innerHTML:''}};
  const c=vm.createContext({console,AbortController,AbortSignal,setTimeout,clearTimeout,QuestionRouting:routing,AnnotationCore:annotationCore,ApiSettings:apiSettings,ApiSession:{create:()=>({})},localStorage:{},
    apiUserError:e=>e.message,window:{addEventListener(){}},document:{getElementById:id=>elements[id],querySelectorAll:()=>[]}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),c);
  c._manualAnnotations=manual;c.mergeAndRender=()=>{};c.updateStreamingCard=()=>{};
  c.loadSettings=()=>({ragEnabled:true,ragBackend,ragMultiQuery,topN:3});
  const queries=[],calls=[];
  c.ragRetrieveDetailed=async query=>{queries.push(query);return {context:evidence?'[S1] 2026年上海住宿上限为每人每天800元。':'',hits:evidence?[{citation:'S1',source:'fixture.txt',start:0,end:20,text:'上海住宿上限800元'}]:[],trace:{warnings:[]}};};
  c.ragCheckCitations=()=>({valid:true});
  c.callLLM=async(messages,opts)=>{
    calls.push(messages);
    if(!opts.onDelta)return '{"terms":[],"sentences":[]}';
    const answer=evidence?'800元 [S1]':'模型回答：每天800元';opts.onDelta(answer);return answer;
  };
  return {c,elements,queries,calls};
}
test('short question route keeps date/place and exact source offsets',()=>{
  assert.ok(routing.isQuestion(question));assert.ok(routing.isQuestion('住宿最多报多少'));
  assert.equal(routing.isQuestion('本章介绍如何使用 BM25 进行检索。'),false);
  assert.equal(routing.isQuestion('a'.repeat(2001)+'?'),false);
  const q=routing.questionCandidate('  '+question+'  ');assert.equal(q.start,2);assert.equal(q.content,question);
});
test('reported Shanghai question bypasses extraction and produces a cited streamed card',async()=>{
  const {c,elements,queries,calls}=app(question);await c.regenerateAnnotations();
  assert.deepEqual(queries,[question]);assert.equal(calls.length,1);
  assert.match(calls[0][1].content,/Answer the complete question/);
  assert.equal(c._autoAnnotations[0].explanation,'800元 [S1]');
  assert.match(elements['generation-status'].textContent,/1 张卡片/);
});
test('question with no local evidence shows one notice and uses uncited model answer',async()=>{
  const {c,calls}=app(question,{evidence:false});await c.regenerateAnnotations();
  assert.equal(calls.length,1);
  assert.equal(c._autoAnnotations[0].explanation,'模型回答：每天800元');
  assert.match(c._autoAnnotations[0].notice,/本地知识库未找到/);
  assert.doesNotMatch(c._autoAnnotations[0].explanation,/无知识库证据|语义检索未启用|\[S1\]/);
});
test('local miss notice also appears when query rewriting is off',async()=>{
  const {c}=app(question,{evidence:false,ragMultiQuery:false});await c.regenerateAnnotations();
  assert.match(c._autoAnnotations[0].notice,/本地知识库未找到/);
  assert.equal(c._autoAnnotations[0].explanation,'模型回答：每天800元');
});
test('browser knowledge base miss also shows the notice',async()=>{
  const {c}=app(question,{evidence:false,ragMultiQuery:false,ragBackend:false});await c.regenerateAnnotations();
  assert.match(c._autoAnnotations[0].notice,/本地知识库未找到/);
});
test('failed card can be retried alone and retry icon disappears after success',async()=>{
  const {c,elements,queries}=app(question);
  const original=c.callLLM;let attempts=0;
  c.callLLM=async(messages,opts)=>{
    if(opts.onDelta&&attempts++===0)throw Error('请求受限（429）');
    return original(messages,opts);
  };
  await c.regenerateAnnotations();
  const ann=c._autoAnnotations[0];c._positioned=[ann];c.escapeHtml=s=>String(s);
  assert.equal(ann.failed,true);
  c.renderCards([ann]);
  assert.match(elements['cards-container'].innerHTML,/card-retry-btn[^>]*onclick="retryAnnotation\(0\)"/);
  assert.doesNotMatch(elements['cards-container'].innerHTML,/card-retry-btn[^>]*hidden/);
  await c.retryAnnotation(0);
  assert.equal(attempts,2);
  assert.equal(queries.length,2);
  assert.equal(ann.failed,false);
  assert.equal(ann.explanation,'800元 [S1]');
  c.renderCards([ann]);
  assert.match(elements['cards-container'].innerHTML,/card-retry-btn[^>]*hidden/);
});
test('batch card generation is sequential',async()=>{
  const {c}=app('BM25、BGE 和 RAG。');let active=0,maxActive=0,generated=0;
  c.callLLM=async(_,opts)=>{
    if(!opts.onDelta)return JSON.stringify({terms:['BM25','BGE','RAG'],sentences:[]});
    active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;generated++;opts.onDelta('解释');return '解释';
  };
  await c.regenerateAnnotations();
  assert.equal(generated,3);
  assert.equal(maxActive,1);
});
test('429 retries twice using provider delay, then succeeds without duplicate text',async()=>{
  const {c}=app(question);const original=c.callLLM;let attempts=0;
  c.callLLM=async(messages,opts)=>{
    if(opts.onDelta&&++attempts<=2){const e=Error('limited');e.status=429;e.retryAfterMs=0;throw e;}
    return original(messages,opts);
  };
  await c.regenerateAnnotations();
  assert.equal(attempts,3);
  assert.equal(c._autoAnnotations[0].failed,false);
  assert.equal(c._autoAnnotations[0].explanation,'800元 [S1]');
});
test('429 retry wait is cancellable',async()=>{
  const {c}=app(question);const controller=new AbortController();let attempts=0;
  c.callLLM=async()=>{attempts++;const e=Error('limited');e.status=429;e.retryAfterMs=60000;throw e;};
  const pending=c.callLLMWith429Retry([],{signal:controller.signal});
  await Promise.resolve();controller.abort();
  await assert.rejects(pending,e=>e.apiCode==='cancelled');
  assert.equal(attempts,1);
});
test('429 automatic retries stop after two retries',async()=>{
  const {c}=app(question);let attempts=0;
  c.callLLM=async()=>{attempts++;const e=Error('limited');e.status=429;e.retryAfterMs=0;throw e;};
  await assert.rejects(c.callLLMWith429Retry([]),e=>e.status===429);
  assert.equal(attempts,3);
});
test('empty extraction in ordinary notes shows an actionable status',async()=>{
  const {c,elements,queries}=app('今天整理了会议记录。');await c.regenerateAnnotations();
  assert.equal(queries.length,0);assert.match(elements['generation-status'].textContent,/未识别到/);
  assert.equal(elements['note-input'].readOnly,false);
});
test('manual annotation overlap is explained instead of silently producing zero cards',async()=>{
  const {c,elements}=app(question,{manual:[{start:0,end:4}]});await c.regenerateAnnotations();
  assert.match(elements['generation-status'].textContent,/手动批注重叠/);
});
