import unittest
import os
from unittest.mock import patch, Mock
from rag_engine import Config, Pipeline

class FailClosedTests(unittest.TestCase):
    def test_annotation_api_never_calls_explanation_after_verifier_failure(self):
        from server import create_app
        p=self.engine('missing')
        response=Mock();response.json.return_value={'choices':[{'message':{'content':'{"terms":["缓存"],"sentences":[]}'}}]}
        with patch.dict(os.environ,{'DASHSCOPE_API_KEY':'fixture-only'}),patch('httpx.post',return_value=response) as post:
            result=create_app(p).test_client().post('/annotate',json={'note_text':'缓存'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(post.call_count,1)
        self.assertEqual(result.json['annotations'][0]['fallback'],'verification_unavailable')
        self.assertIn('校验服务',result.json['annotations'][0]['explanation'])
    def engine(self, mode):
        p=Pipeline(':memory:',Config(reranker_model='fixture',min_rerank_score=0))
        p.put('doc','缓存十分钟后过期。')
        class Ranker:
            def predict(self,pairs):
                if mode=='raise': raise RuntimeError('provider failed')
                if mode=='nan': return [float('nan')]*len(pairs)
                if mode=='shape': return []
                return [1]*len(pairs)
        if mode=='missing': p.failures.add('reranker')
        else: p.models['reranker']=Ranker()
        return p

    def test_threshold_failure_withholds_answer_and_is_cached_safely(self):
        for mode in ('raise','nan','shape','missing'):
            with self.subTest(mode=mode):
                p=self.engine(mode)
                for repeat in range(2):
                    r=p.search('缓存')
                    self.assertEqual(r['fallback'],'verification_unavailable')
                    self.assertFalse(r['hits']);self.assertEqual(r['context'],'')
                    self.assertFalse(any('RRF fallback' in w for w in r['trace']['warnings']))
    def test_healthy_threshold_still_returns_evidence(self):
        self.assertTrue(self.engine('healthy').search('缓存')['hits'])

    def test_ordinary_mode_keeps_retrieval_fallback(self):
        p=Pipeline(':memory:',Config(reranker_model='fixture'))
        p.failures.add('reranker');p.put('x','cache expiry')
        self.assertTrue(p.search('cache')['hits'])

    def test_language_mismatch_also_withholds(self):
        p=Pipeline(':memory:',Config(reranker_model='ms-marco',min_rerank_score=0))
        p.put('doc','缓存过期规则。')
        self.assertEqual(p.search('缓存')['fallback'],'verification_unavailable')
