import json,hashlib,unittest
from pathlib import Path
from rag_engine import Pipeline,Config
from chinese_benchmark import score,metrics

class ChineseEvalTests(unittest.TestCase):
    def test_frozen_labels_are_consistent(self):
        root=Path(__file__).resolve().parents[1]/'eval/chinese_v2'
        load=lambda name:json.loads((root/name).read_text(encoding='utf-8'))
        docs=load('corpus.json');dev=load('dev.json');test=load('test.json')
        self.assertEqual(len(docs),36);self.assertEqual(len(dev),36);self.assertEqual(len(test),36)
        self.assertFalse({q['family'] for q in dev}&{q['family'] for q in test})
        self.assertEqual(len({q['id'] for q in dev+test}),72)
        sources={d['source']:d for d in docs}
        for q in dev+test:
            for s in q['relevance']:
                self.assertTrue(all(sources[s]['metadata'][k]==v for k,v in q['filters'].items()))
        for name,digest in load('manifest.json').items():
            self.assertEqual(hashlib.sha256((root/name).read_bytes()).hexdigest(),digest)

    def test_multi_source_metrics_do_not_count_partial_as_complete(self):
        case=dict(id='q',query='q',kind='cross_version',relevance={'a':2,'b':2})
        row=score(case,[{'source':'a'}],1)
        self.assertEqual(row['recall'],.5)
        self.assertLess(row['ndcg'],1)
        self.assertEqual(metrics([row])['complete_evidence'],0)

    def test_calibrated_reranker_rejects_low_scores(self):
        class Ranker:
            def predict(self,pairs): return [-4.] * len(pairs)
        p=Pipeline(':memory:',Config(reranker_model='fixture',min_rerank_score=0.))
        p.models['reranker']=Ranker();p.put('doc','BM25 keyword retrieval')
        self.assertEqual(p.search('BM25')['fallback'],'no_evidence')

    def test_query_prefix_is_only_used_for_query(self):
        try: import numpy as np
        except ImportError: self.skipTest('optional numpy')
        class Dense:
            calls=[]
            def encode(self,x,**kw):
                self.calls.append(x)
                return np.array([[1.,0.]]*len(x)) if isinstance(x,list) else np.array([1.,0.])
        model=Dense();p=Pipeline(':memory:',Config(dense_model='fixture',dense_query_prefix='prefix:'))
        p.models['dense']=model;p.put('d','document');p.search('query')
        self.assertEqual(model.calls[0],['document']);self.assertEqual(model.calls[1],'prefix:query')
