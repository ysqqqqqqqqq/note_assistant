import io
import tempfile
import unittest
from pathlib import Path
from rag_engine import Pipeline, Config
from rag_engine.text import chunks
from evaluation import evaluate
from server import create_app

class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.rag=Pipeline(':memory:')
        self.rag.put('a.md','机器学习使用样本训练模型。BM25 进行关键词检索。',{'course':'AI'})
        self.rag.put('b.md','红烧肉需要酱油和猪肉。',{'course':'food'})

    def test_recall_filter_and_top_k(self):
        self.assertEqual(self.rag.search('BM25',1)['hits'][0]['source'],'a.md')
        self.assertFalse(self.rag.search('BM25',filters={'course':'food'})['hits'])
        self.assertFalse(self.rag.search('BM25',filters={'source':'missing'})['hits'])
        self.assertEqual(self.rag.search('BM25')['trace']['warnings'][0],'dense_unavailable: BM25 fallback')
        with self.assertRaises(ValueError): self.rag.search('x',0)

    def test_replace_delete_invalidate(self):
        self.rag.search('BM25')
        self.assertTrue(self.rag.search('BM25')['trace']['cache_hit'])
        self.rag.put('a.md','changed unrelated content')
        self.assertFalse(self.rag.search('BM25')['hits'])
        self.rag.delete('a.md')
        self.assertEqual(len(self.rag.documents()),1)

    def test_multi_query_preserves_original(self):
        result=self.rag.search('BM25',queries=['红烧肉'])
        self.assertEqual({h['source'] for h in result['hits']},{'a.md'})
        self.assertEqual(result['trace']['rejected_rewrites'],1)

    def test_chunk_bounds_and_offsets(self):
        text='长句'*2000+'。\n段落结束。'
        result=list(chunks(text,100,20))
        self.assertTrue(all(len(body)<=100 and body==text[start:end] for start,end,body in result))
        self.assertEqual(result[-1][1],len(text))
        with self.assertRaises(ValueError): Config(chunk_size=100,overlap=100)

    def test_cache_isolation_and_bounds(self):
        first=self.rag.search('BM25'); first['hits'].clear()
        self.assertTrue(self.rag.search('BM25')['hits'])
        small=Pipeline(':memory:',Config(cache_size=2))
        for q in ['a','b','c']: small.search(q)
        self.assertEqual(len(small.cache),2)

    def test_persistence(self):
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'kb.db'
            first=Pipeline(db);first.put('x','BM25 persisted');first.db.close()
            second=Pipeline(db)
            self.assertTrue(second.search('BM25')['hits']);second.db.close()

    def test_dedup_and_budget(self):
        p=Pipeline(':memory:',Config(context_chars=12))
        p.put('a','BM25 keyword retrieval.');p.put('b','BM25 keyword retrieval.')
        hits=p.search('BM25')['hits']
        self.assertEqual(len(hits),1)
        self.assertLessEqual(sum(len(h['text']) for h in hits),12)

    def test_real_model_adapter_and_failure(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest('Optional model dependency numpy unavailable')
        class Dense:
            def encode(self,text,**kwargs):
                return np.array([[1.,0.] for _ in text]) if isinstance(text,list) else np.array([1.,0.])
        class Reranker:
            def predict(self,pairs): return [1.0 for _ in pairs]
        self.rag.models={'dense':Dense(),'reranker':Reranker()}
        self.rag.config=Config(dense_model='fixture',reranker_model='fixture')
        self.assertEqual(self.rag.search('semantic')['trace']['warnings'],[])
        class Broken:
            def encode(self,*a,**kw): raise RuntimeError('unavailable')
            def predict(self,*a,**kw): raise RuntimeError('unavailable')
        self.rag.models={'dense':Broken(),'reranker':Broken()}
        result=self.rag.search('BM25')
        self.assertTrue(result['hits'])
        self.assertIn('dense_inference_failed: BM25 fallback',result['trace']['warnings'])

    def test_metrics_hand_calculated(self):
        report=evaluate(self.rag,[{'query':'BM25','relevance':{'a.md':1,'missing.md':1}}],1)
        self.assertEqual(report['averages']['recall_at_k'],.5)
        self.assertEqual(report['averages']['mrr'],1)
        self.assertEqual(report['averages']['ndcg'],1)
        self.assertIsNone(report['averages']['faithfulness'])

class APITests(unittest.TestCase):
    def setUp(self): self.client=create_app(Pipeline(':memory:')).test_client()
    def test_assets_and_private_files(self):
        for url in ['/','/assets/rag.js','/assets/rag-backend.js','/rag/status']:
            with self.client.get(url) as response:
                self.assertEqual(response.status_code,200)
        for url in ['/.env','/static/server.py','/rag.sqlite3']:
            self.assertEqual(self.client.get(url).status_code,404)
    def test_lifecycle(self):
        r=self.client.post('/kb/upload',data={'file':(io.BytesIO(b'BM25 retrieval'),'notes.md')})
        self.assertEqual(r.status_code,200)
        self.assertTrue(self.client.post('/rag/search',json={'query':'BM25'}).json['hits'])
        self.assertEqual(self.client.post('/kb/delete',json={}).status_code,400)
        self.client.post('/kb/delete',json={'filename':'notes.md'})
        self.assertFalse(self.client.get('/kb/list').json['documents'])
    def test_invalid(self):
        for value in [None, [], {'query':''}, {'query':'x','top_k':-1}, {'query':'x','filters':[]}, {'query':'x','queries':[3]}]:
            self.assertIn(self.client.post('/rag/search',json=value).status_code,[400,415])
        self.assertEqual(self.client.post('/kb/upload',data={'file':(io.BytesIO(b'x'),'bad.exe')}).status_code,400)

if __name__ == '__main__': unittest.main()
