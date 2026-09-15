"""Offline retrieval metrics; semantic scores require supplied human/judge labels."""
import argparse
import json
import math
from pathlib import Path
from rag_engine import Pipeline

def evaluate(rag, cases, k=3):
    results = []
    for case in cases:
        result = rag.search(case['query'], k, case.get('filters'))
        # Evaluation relevance IDs may be sources or chunk IDs; duplicates count once.
        key = case.get('id_field', 'source')
        retrieved = list(dict.fromkeys(h[key] for h in result['hits']))
        grades = case['relevance']
        if not isinstance(grades,dict) or any(isinstance(g,bool) or not isinstance(g,(int,float)) or not math.isfinite(g) or g < 0 for g in grades.values()):
            raise ValueError('relevance grades must be finite nonnegative numbers')
        relevant = {name for name, grade in grades.items() if grade > 0}
        gains = [grades.get(name, 0) for name in retrieved[:k]]
        ideal = sorted(grades.values(), reverse=True)[:k]
        dcg = lambda vals: sum((2**g-1)/math.log2(i+2) for i,g in enumerate(vals))
        row = dict(query=case['query'], retrieved=retrieved, elapsed_ms=result['trace']['elapsed_ms'],
                   correct_abstention=int(not retrieved) if not relevant else None,
                   recall_at_k=len(set(retrieved[:k]) & relevant)/len(relevant) if relevant else None,
                   mrr=next((1/(i+1) for i,g in enumerate(gains) if g>0),0) if relevant else None,
                   ndcg=dcg(gains)/dcg(ideal) if dcg(ideal) else None)
        # No lexical proxy is presented as a semantic metric.
        for metric in ('faithfulness','answer_relevance'):
            value = case.get(metric)
            if value is not None and (not isinstance(value,(float,int)) or isinstance(value,bool) or not 0 <= value <= 1):
                raise ValueError(metric + ' must be a human/judge score in [0,1]')
            row[metric] = value
        results.append(row)
    names = ('recall_at_k','mrr','ndcg','correct_abstention','faithfulness','answer_relevance')
    return dict(k=k, cases=results, averages={name:sum(vals)/len(vals) if vals else None for name in names
                 for vals in [[r[name] for r in results if r[name] is not None]]},
                semantic_note='null = no human/judge labels; sample is a regression fixture, not a quality benchmark')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset',default='eval/sample.jsonl')
    parser.add_argument('--database',default='rag.sqlite3')
    parser.add_argument('--k',type=int,default=3)
    parser.add_argument('--demo',action='store_true')
    args=parser.parse_args()
    rag=Pipeline(':memory:' if args.demo else args.database)
    if args.demo:
        rag.put('rag.md','RAG 检索增强生成结合知识库检索与语言模型回答。BM25 是词项匹配检索方法。')
        rag.put('rerank.md','Cross encoder 重排模型对 query 和文档联合编码。BGE reranker 用于重新排序召回候选。')
    cases=[json.loads(line) for line in Path(args.dataset).read_text(encoding='utf-8').splitlines() if line.strip()]
    print(json.dumps(evaluate(rag,cases,args.k),ensure_ascii=False,indent=2))
