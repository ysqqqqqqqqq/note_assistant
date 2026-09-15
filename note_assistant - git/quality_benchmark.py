"""Compare an engine checkout with fixed relevance labels; no generation API calls."""
import argparse,json,sys,time,math,statistics
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--engine',default=str(Path(__file__).parent))
    parser.add_argument('--dataset',default='eval/quality.json')
    parser.add_argument('--dense-model',default='')
    parser.add_argument('--reranker-model',default='')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    sys.path.insert(0,args.engine)
    from rag_engine import Pipeline,Config
    data=json.loads(Path(args.dataset).read_text(encoding='utf-8'))
    reports=[]
    for name,cfg in [('BM25',Config()),('Hybrid',Config(dense_model=args.dense_model,reranker_model=args.reranker_model))]:
        p=Pipeline(':memory:',cfg)
        for source,text in data['documents'].items(): p.put(source,text)
        rows=[]
        for case in data['queries']:
            started=time.perf_counter(); result=p.search(case['query'],3,case.get('filters'))
            elapsed=(time.perf_counter()-started)*1000
            sources=list(dict.fromkeys(h['source'] for h in result['hits']))
            relevance=case['relevance']; relevant={k for k,v in relevance.items() if v>0}
            rank=next((i+1 for i,s in enumerate(sources) if s in relevant),None)
            rows.append(dict(**case,top3=sources,rank=rank,elapsed_ms=round(elapsed,3),
                             recall=len(set(sources)&relevant)/len(relevant) if relevant else None,
                             mrr=(1/rank if rank else 0) if relevant else None,
                             ndcg=(1/math.log2(rank+1) if rank else 0) if relevant else None,
                             abstention=int(not sources) if not relevant else None,trace=result['trace']))
        summary={}
        for split in ['regression','new_queries']:
            group=[r for r in rows if r['split']==split]
            summary[split]={k:statistics.mean(v) if v else None for k in ['recall','mrr','ndcg','abstention'] for v in [[r[k] for r in group if r[k] is not None]]}
            # Exclude the first query (model loading) from steady latency.
            timings=[r['elapsed_ms'] for r in group if r is not rows[0]]
            summary[split]['median_ms']=statistics.median(timings)
        reports.append(dict(mode=name,summary=summary,rows=rows))
        p.db.close()
    Path(args.output).write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps([{k:v for k,v in r.items() if k!='rows'} for r in reports],ensure_ascii=False,indent=2))

if __name__=='__main__': main()
