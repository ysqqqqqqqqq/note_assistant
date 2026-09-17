/* One browser-owned knowledge base. Query rewriting is a second pass only. */
(function(){
  function label(key){return typeof tr==='function'?tr(key):key;}
  function variantsFrom(raw,query){
    var value=extractJSONFromText(raw),items=value&&Array.isArray(value.queries)?value.queries:[];
    var anchors=query.match(/\b(?:[A-Z][A-Z0-9_-]+|\d+(?:\.\d+)?)\b/g)||[];
    var negations=query.match(/不|未|无|禁止|不能/g)||[];
    return items.filter(function(item){
      return typeof item==='string'&&item.trim()&&item.length<=4000&&item!==query&&
        anchors.every(function(anchor){return item.toLowerCase().includes(anchor.toLowerCase());})&&
        negations.every(function(negative){return item.includes(negative);});
    }).slice(0,3);
  }
  window.ragRetrieveDetailed=async function(query,k,options){
    options=options||{};
    var original=await ragRetrieveDetailedBrowser(query,k,options),settings=loadSettings();
    if(original.hits.length||!settings.ragEnabled||!settings.ragMultiQuery)return original;
    var variants=[];
    try{
      var raw=await callLLMWith429Retry([{role:'system',content:'Return JSON {"queries":[...]}, up to 3 concise search rewrites. Preserve all identifiers, numbers, versions and negation. Do not introduce a new topic.'},
        {role:'user',content:query}],{signal:options.signal,timeoutMs:15000});
      variants=variantsFrom(raw,query);
    }catch(e){if(options.signal&&options.signal.aborted)throw e;return original;}
    if(!variants.length)return original;
    var found=new Map();
    for(var i=0;i<variants.length;i++){
      if(options.signal)options.signal.throwIfAborted();
      var result=await ragRetrieveDetailedBrowser(variants[i],k,options);
      result.hits.forEach(function(hit,rank){
        var key=hit.chunkId,score=1/(60+rank+1);
        if(!found.has(key))found.set(key,{hit:hit,score:0});
        found.get(key).score+=score;
      });
    }
    var hits=Array.from(found.values()).sort(function(a,b){return b.score-a.score;}).slice(0,k||3)
      .map(function(item,i){return Object.assign({},item.hit,{citation:'S'+(i+1)});});
    return {hits:hits,context:hits.map(function(hit){return '['+hit.citation+'] '+hit.source+' (片段 #'+hit.chunkId+')\n'+hit.text;}).join('\n\n---\n\n'),
      trace:{warnings:[],rewrites:variants.length}};
  };
  window.runRagTest=async function(button){
    var output=document.getElementById('rag-test-result'),query=document.getElementById('rag-test-query').value.trim();
    if(!query){output.textContent=label('queryPlaceholder');return;}
    button.disabled=true;output.textContent=label('searching');
    try{
      var result=await ragRetrieveDetailed(query,loadSettings().topN||3);
      output.textContent=result.hits.length?result.context:label('noEvidence');
    }catch(e){output.textContent=label('kbReadError');console.warn('[RAG] browser retrieval failed',e);}
    finally{button.disabled=false;}
  };
  document.addEventListener('DOMContentLoaded',function(){
    var anchor=document.getElementById('setting-top-n'),row=document.createElement('div');
    row.className='setting-row';
    row.innerHTML='<label class="setting-check"><input type="checkbox" id="rag-multi"><span data-i18n="rewriteLabel"></span></label><p class="setting-hint" data-i18n="rewriteHint"></p>';
    anchor.parentElement.after(row);
    document.getElementById('rag-multi').checked=!!loadSettings().ragMultiQuery;
    function visibility(){row.hidden=!document.getElementById('setting-rag-enabled').checked;}
    row.hidden=!loadSettings().ragEnabled;
    document.getElementById('setting-rag-enabled').addEventListener('change',visibility);
    row.addEventListener('change',function(){var next=loadSettings();next.ragMultiQuery=document.getElementById('rag-multi').checked;saveSettings(next);});
    var kb=document.getElementById('kb-status'),panel=document.createElement('div');
    panel.className='kb-test-panel';
    panel.innerHTML='<label for="rag-test-query" class="editor-label" data-i18n="testTitle"></label><div class="kb-test-controls"><input class="setting-input" id="rag-test-query" data-i18n-placeholder="queryPlaceholder"><button class="btn btn-primary" type="button" id="rag-test-button" data-i18n="search"></button></div><pre id="rag-test-result" role="status" aria-live="polite"></pre>';
    kb.parentElement.insertBefore(panel,kb.parentElement.querySelector('.history-actions'));
    applyI18n();document.getElementById('rag-test-button').addEventListener('click',function(){runRagTest(this);});
  });
})();
