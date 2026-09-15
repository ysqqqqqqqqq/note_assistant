"""Regression comparison; existing test split is NOT a fresh blind evaluation."""
import argparse, hashlib, json, time
from pathlib import Path
from dataclasses import replace
from chinese_benchmark import score, metrics
from rag_engine import Config, Pipeline


def main():
    cli=argparse.ArgumentParser()
    cli.add_argument('--dense',required=True)
    cli.add_argument('--reranker',required=True)
    cli.add_argument('--out',required=True)
    a=cli.parse_args()
    import torch
    from sentence_transformers import SentenceTransformer,CrossEncoder
    torch.set_num_threads(4)
    dense=SentenceTransformer(a.dense)
    reranker=CrossEncoder(a.reranker,activation_fn=torch.nn.Identity(),max_length=512)
    data=Path(__file__).parent/'eval/chinese_v2'
    manifest=json.loads((data/'manifest.json').read_text())
    for name,digest in manifest.items():
        assert hashlib.sha256((data/name).read_bytes()).hexdigest()==digest
    docs=json.loads((data/'corpus.json').read_text(encoding='utf-8'))
    base=Config(dense_model=a.dense,reranker_model=a.reranker,dense_language='multilingual',reranker_language='multilingual',dense_query_prefix='为这个句子生成表示以用于检索相关文章：')
    configs={'hybrid':replace(base,reranker_model=''),'always':base,'adaptive':replace(base,rerank_mode='adaptive')}
    engines={}
    for name,c in configs.items():
        p=Pipeline(':memory:',c)
        p.models['dense']=dense
        if c.reranker_model:p.models['reranker']=reranker
        for d in docs:p.put(d['source'],d['text'],d['metadata'])
        p.search('预热检索')
        engines[name]=p
    output={'manifest':manifest,'note':'Previously seen synthetic splits; regression only. Query embeddings warm, result caches disabled. Three alternating-order repetitions.'}
    for split in ('dev','test'):
        cases=json.loads((data/f'{split}.json').read_text(encoding='utf-8'))
        # Equal query embedding warm-up for each setup, outside measurement.
        for p in engines.values():
            for case in cases:
                q=case['query']
                p.query_cache[q]=dense.encode(base.dense_query_prefix+q,normalize_embeddings=True)
        results={name:[] for name in engines}
        for repeat in range(3):
            for c in cases:
                names=list(engines)
                if repeat%2:names.reverse()
                for name in names:
                    p=engines[name];p.cache.clear()
                    start=time.perf_counter();r=p.search(c['query'],3,c['filters'])
                    row=score(c,r['hits'],(time.perf_counter()-start)*1000)
                    row.update(rerank_executed=r['trace']['rerank_executed'],decision=r['trace']['rerank_decision'],repeat=repeat)
                    results[name].append(row)
        output[split]={name:dict(metrics=metrics(rows),rerank_calls=sum(r['rerank_executed'] for r in rows),rows=rows) for name,rows in results.items()}
    Path(a.out).parent.mkdir(parents=True,exist_ok=True)
    Path(a.out).write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({s:{n:{'metrics':r['metrics'],'rerank_calls':r['rerank_calls']} for n,r in output[s].items()} for s in ('dev','test')},indent=2))
    for p in engines.values():p.db.close()

if __name__=='__main__':main()
