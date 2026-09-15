"""Frozen split evaluation. Only dev labels select the rejection threshold."""
import argparse,hashlib,json,math,statistics,time
from pathlib import Path
from dataclasses import replace
from rag_engine import Pipeline,Config

def metrics(rows):
    positives=[r for r in rows if r['relevance']]; negatives=[r for r in rows if not r['relevance']]
    average=lambda vals:statistics.mean(vals) if vals else None
    return dict(recall_at_3=average([r['recall'] for r in positives]),mrr=average([r['mrr'] for r in positives]),
                ndcg=average([r['ndcg'] for r in positives]),complete_evidence=average([int(r['recall']==1) for r in positives]),
                correct_abstention=average([int(not r['hits']) for r in negatives]),
                median_ms=statistics.median([r['ms'] for r in rows]),count=len(rows))

def score(case,hits,ms):
    ids=list(dict.fromkeys(h['source'] for h in hits))[:3]; grades=case['relevance']
    relevant={s for s,g in grades.items() if g>0}
    dcg=lambda values:sum((2**g-1)/math.log2(i+2) for i,g in enumerate(values))
    ideal=dcg(sorted(grades.values(),reverse=True)[:3])
    return dict(id=case['id'],query=case['query'],kind=case['kind'],relevance=grades,hits=ids,ms=ms,
                recall=len(set(ids)&relevant)/len(relevant) if relevant else None,
                mrr=next((1/(i+1) for i,s in enumerate(ids) if s in relevant),0),
                ndcg=dcg([grades.get(s,0) for s in ids])/ideal if ideal else None)

def run(p,cases,threshold=None):
    rows=[]
    for c in cases:
        start=time.perf_counter();r=p.search(c['query'],3,c['filters'])
        hits=r['hits']
        if threshold is not None: hits=[h for h in hits if h['rerank_score'] is not None and h['rerank_score']>=threshold]
        rows.append(score(c,hits,round((time.perf_counter()-start)*1000,3)))
    return dict(metrics=metrics(rows),rows=rows)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',default='eval/chinese_v2')
    parser.add_argument('--dense',required=True)
    parser.add_argument('--reranker',required=True)
    parser.add_argument('--out',required=True)
    a=parser.parse_args();data=Path(a.data);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((data/'manifest.json').read_text())
    for name,digest in manifest.items():
        assert hashlib.sha256((data/name).read_bytes()).hexdigest()==digest,'Dataset changed: '+name
    docs=json.loads((data/'corpus.json').read_text(encoding='utf-8'))
    dev=json.loads((data/'dev.json').read_text(encoding='utf-8'))
    # Deliberately do not open test labels until the dev decision is persisted.
    from sentence_transformers import SentenceTransformer,CrossEncoder
    from torch.nn import Identity
    import torch
    torch.set_num_threads(4)
    started=time.perf_counter();dense=SentenceTransformer(a.dense);rerank=CrossEncoder(a.reranker,activation_fn=Identity(),max_length=512)
    load_ms=(time.perf_counter()-started)*1000
    base=Config(dense_model=a.dense,dense_language='multilingual',dense_query_prefix='为这个句子生成表示以用于检索相关文章：')
    setups={'BM25':Config(),'BGE Hybrid':base,'BGE Hybrid + Rerank':replace(base,reranker_model=a.reranker,reranker_language='multilingual')}
    engines={};dev_reports={}
    for name,cfg in setups.items():
        p=Pipeline(':memory:',cfg)
        if cfg.dense_model: p.models['dense']=dense
        if cfg.reranker_model: p.models['reranker']=rerank
        for d in docs: p.put(d['source'],d['text'],d['metadata'])
        # Warm up models before latency measurement.
        p.search('预热检索',3)
        engines[name]=p;dev_reports[name]=run(p,dev)
    p=engines['BGE Hybrid + Rerank']
    sweep=[]
    for t in [-1000000000.,-8.,-4.,0.,4.,8.]:
        report=run(p,dev,t)
        m=report['metrics'];objective=(m['recall_at_3']+m['correct_abstention'])/2
        sweep.append(dict(threshold=t,objective=objective,metrics=m))
    selected=max(sweep,key=lambda s:(s['objective'],s['metrics']['recall_at_3'],-s['threshold']))
    (out/'selection.json').write_text(json.dumps(dict(selected=selected,sweep=sweep,manifest=manifest,model_load_ms=load_ms),ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'dev-results.json').write_text(json.dumps(dev_reports,ensure_ascii=False,indent=2),encoding='utf-8')
    # Configuration frozen before test labels are read.
    test=json.loads((data/'test.json').read_text(encoding='utf-8'))
    results={name:run(p,test) for name,p in engines.items()}
    engines['BGE Hybrid + Rerank'].cache.clear()
    results['BGE Rerank calibrated']=run(engines['BGE Hybrid + Rerank'],test,selected['threshold'])
    (out/'test-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'selected':selected,'test':{n:r['metrics'] for n,r in results.items()}},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
