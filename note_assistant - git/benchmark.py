import json
import os
import sys
import time
from pathlib import Path
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--dense-model',required=True)
parser.add_argument('--reranker-model',required=True)
parser.add_argument('--output',default='eval/results')
args=parser.parse_args()
from rag_engine import Pipeline,Config
dense=args.dense_model
rerank=args.reranker_model
docs={
 'rag.md':'RAG 检索增强生成先从知识库检索证据，再交给语言模型生成带来源的答案。Retrieval augmented generation grounds answers in retrieved documents.',
 'bm25.md':'BM25 基于词频、逆文档频率及文档长度进行关键词检索，不需要训练词向量。BM25 ranks documents by term frequency and inverse document frequency.',
 'dense.md':'Dense retrieval encodes a query and documents into embedding vectors and compares their semantic similarity. 向量检索能够匹配语义相近但用词不同的文本。',
 'rerank.md':'Cross encoder jointly reads a query and each candidate passage, then reranks candidates using relevance scores. BGE reranker 是交叉编码器重排模型。',
 'chunk.md':'分块 chunking 应考虑段落、句子边界、最大长度和重叠窗口，保留文档来源及字符偏移，方便引用。',
 'cache.md':'缓存 cache 减少重复查询耗时；文档替换或删除后应使检索缓存失效，避免旧答案。',
 'metrics.md':'Recall@K 衡量相关文档召回比例，MRR 衡量首个相关结果排名，nDCG 考虑相关性等级和排序位置。',
 'food.md':'红烧肉使用猪肉、酱油和糖慢炖。Braised pork is cooked with soy sauce and sugar.',
 'physics.md':'Quantum mechanics studies atoms and subatomic particles. 量子力学研究原子与亚原子粒子。',
 'filter.md':'Metadata filtering limits retrieval to matching file names, tags or courses before ranking. 元数据过滤在候选召回前限定搜索范围。'}
cases=[
 ('BM25', 'bm25.md',None),('词频和逆文档频率','bm25.md',None),
 ('semantic similarity vectors','dense.md',None),('不同用词但意思接近','dense.md',None),
 ('jointly reads query and passage','rerank.md',None),('BGE reranker','rerank.md',None),
 ('句子边界和重叠窗口','chunk.md',None),('删除文档后避免旧结果','cache.md',None),
 ('first relevant result ranking MRR','metrics.md',None),('酱油猪肉','food.md',None),
 ('atoms subatomic particles','physics.md',None),('限制文件名搜索范围','filter.md',None),
 ('answers grounded in documents','rag.md',None),('BM25','bm25.md',{'source':'bm25.md'}),
 ('BM25',None,{'source':'food.md'}),('火星殖民地现任市长姓名',None,None)]
reports=[]
for mode,cfg in [('BM25',Config()),('Hybrid + CrossEncoder',Config(dense_model=dense,reranker_model=rerank))]:
    p=Pipeline(':memory:',cfg)
    for name,text in docs.items(): p.put(name,text)
    rows=[]
    for query,expected,filters in cases:
        start=time.perf_counter();r=p.search(query,3,filters);ms=round((time.perf_counter()-start)*1000,2)
        sources=[h['source'] for h in r['hits']]
        rank=sources.index(expected)+1 if expected in sources else None
        rows.append(dict(query=query,expected=expected,filters=filters,top3=sources,rank=rank,
                         recall_at_3=int(rank is not None) if expected else None,
                         mrr=1/rank if rank else 0 if expected else None,
                         ndcg=1/__import__('math').log2(rank+1) if rank else 0 if expected else None,
                         correct_abstention=not sources if expected is None else None,elapsed_ms=ms,warnings=r['trace']['warnings']))
    start=time.perf_counter();p.search(cases[0][0],3);cache_ms=round((time.perf_counter()-start)*1000,3)
    positive=[r for r in rows if r['expected']]
    reports.append(dict(mode=mode,models=p.status()['models'],rows=rows,cache_hit_ms=cache_ms,
                        summary={key:sum(r[key] for r in positive)/len(positive) for key in ['recall_at_3','mrr','ndcg']},
                        faithfulness=None,answer_relevance=None))
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
(output/'rag-test-results.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# RAG 实测结果','', '10 篇合成文档，16 条测试查询（14 条有答案、2 条无答案/过滤测试）。top-k=3。无外部 LLM 调用。', '',
       '真实模型：'+dense+' + '+rerank, '',
       '| 模式 | Recall@3 | MRR@3 | nDCG@3 | 重复查询耗时 ms |','|---|---:|---:|---:|---:|']
for report in reports:
    m=report['summary'];lines.append(f"| {report['mode']} | {m['recall_at_3']:.3f} | {m['mrr']:.3f} | {m['ndcg']:.3f} | {report['cache_hit_ms']} |")
for report in reports:
    lines += ['', '## '+report['mode'],'','| 查询 | 预期文档 | 实际 Top 3 | 相关文档排名 | 耗时 ms |','|---|---|---|---:|---:|']
    for r in report['rows']:
        lines.append(f"| {r['query']} {'（文件过滤）' if r['filters'] else ''} | {r['expected'] or '应无证据'} | {', '.join(r['top3']) or '无结果'} | {r['rank'] or '—'} | {r['elapsed_ms']} |")
lines += ['', '## 解释与限制','',
          '- 首次检索耗时包含模型加载；后续耗时为小语料单机测试，不能当作生产性能。',
          '- 中文字符/bigram BM25 可能因少量共有字召回无关文档；dense 正相似度也不保证足够相关。当前无答案检测依赖空候选，未做业务阈值校准，因此无答案题可能返回候选。',
          '- 这是固定合成回归集，未在真实笔记上标注或做独立测试，不能据此宣称质量普遍提升。',
          '- Faithfulness / answer relevance：未测。未配置生成 API，也没有人工回答标注；评测程序支持汇总提供的 0–1 人工/judge 标签，不伪造分数。',
          '- 真实中文场景建议配置 BGE 中文向量及重排模型后，用领域标注集复测。']
(output/'RAG测试报告.md').write_text('\n'.join(lines),encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k!='rows'} for r in reports],ensure_ascii=False,indent=2))
