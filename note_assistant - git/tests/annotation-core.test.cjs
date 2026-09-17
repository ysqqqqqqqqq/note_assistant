const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/annotation-core.js');

test('denoise guard rejects translation of Chinese notes with English terms',()=>{
  const original='今天准备给 Note Assistant 加一个 reranker，先做 baseline，然后测试 retrieval evaluation。';
  assert.equal(core.languagePreserved(original,'Today I will add a reranker and test retrieval evaluation.'),false);
  assert.equal(core.languagePreserved(original,'今天准备给 Note Assistant 加一个 reranker，先做 baseline，然后测试 retrieval evaluation。'),true);
  assert.equal(core.languagePreserved(original,'今天准备给 Note Assistant 加一个 reranker，先做基线，然后测试 retrieval evaluation。'),false);
  assert.equal(core.languagePreserved('I will test the retrieval evaluation tomorrow.','明天测试检索评测。'),false);
});

test('extracted terms take precedence over containing sentences',()=>{
  const note='先做一个 baseline，然后每增加一个模块重新跑测试集。明天优先把 retrieval evaluation 跑通。';
  const result=core.selectCandidates({terms:['baseline','retrieval evaluation'],sentences:['先做一个 baseline，然后每增加一个模块重新跑测试集。','明天优先把 retrieval evaluation 跑通。']},note);
  assert.deepEqual(result.map(x=>x.content),['baseline','retrieval evaluation']);
});
test('mixed-language sentence-only extraction recovers embedded technical phrases',()=>{
  const note='先做一个 baseline，然后每增加一个模块重新跑测试集。明天优先把 retrieval evaluation 跑通。';
  const selected=core.selectCandidates({terms:[],sentences:['先做一个 baseline，然后每增加一个模块重新跑测试集。','明天优先把 retrieval evaluation 跑通。']},note);
  assert.deepEqual(selected.map(x=>x.content),['baseline','retrieval evaluation']);
});
test('sentence mistakenly classified as a term still yields its embedded term',()=>{
  const note='先做一个 baseline，然后每增加一个模块重新跑测试集。';
  assert.deepEqual(core.selectCandidates({terms:[note],sentences:[]},note).map(x=>x.content),['baseline']);
});

test('unknown source IDs are removed without inventing sources',()=>{
  assert.equal(core.validCitations('BM25 [S1][S99]',[{citation:'S1'}]),'BM25 [S1]');
  assert.equal(core.validCitations('Plain answer [S1]',[]),'Plain answer');
});
test('model answer decodes entities and renders escaped math as readable text',()=>{
  const answer='**&#x42;M25** 的公式：\\[\\text{score}(d,q)=\\frac{f_i}{1+k_1\\cdot b}\\]';
  const cleaned=core.cleanModelText(answer);
  assert.match(cleaned,/BM25 的公式/);
  assert.match(cleaned,/score\(d,q\)=\(f_i\) \/ \(1\+k_1·\s*b\)/);
  assert.doesNotMatch(cleaned,/&#x42;|\\text|\\frac|\*\*/);
  assert.equal(core.cleanModelText('Python 中 a**2 表示平方。'),'Python 中 a**2 表示平方。');
  assert.equal(core.cleanModelText('**1.&#x42;M25 是排名函数。'),'1.BM25 是排名函数。');
  assert.equal(core.renderExplanationHtml('&lt;script&gt; [S9]',[]),'&lt;script&gt;');
  assert.equal(core.renderExplanationHtml('说明 &#91;S9&#93;',[]),'说明');
});
test('only sourced claim and real citation are bold',()=>{
  const html=core.renderExplanationHtml('BM25 是一种排名函数。[S1] 另有普通说明。',[{citation:'S1'}]);
  assert.match(html,/^<strong>BM25 是一种排名函数。\[S1\]<\/strong>/);
  assert.match(html,/ 另有普通说明。$/);
});
