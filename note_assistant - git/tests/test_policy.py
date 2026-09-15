import unittest
from dataclasses import replace
from rag_engine import Config, Pipeline
from rag_engine.policy import rerank_decision, expand_neighbors, subtract_covered


class PolicyTests(unittest.TestCase):
    def test_adaptive_skips_model_load_and_cache_reports_no_execution(self):
        import numpy as np
        class Dense:
            def encode(self, text, **kw):
                return np.array([[1.,0.]]*len(text)) if isinstance(text,list) else np.array([1.,0.])
        p=Pipeline(':memory:',Config(dense_model='fixture',reranker_model='missing',rerank_mode='adaptive'))
        p.models['dense']=Dense()
        p.put('x','cache expires')
        r=p.search('cache',1)
        self.assertEqual(r['trace']['rerank_decision'],'skip_top_k_agreement')
        self.assertFalse(r['trace']['rerank_executed'])
        self.assertNotIn('reranker',p.failures)
        self.assertNotIn('reranker_unavailable: RRF fallback',r['trace']['warnings'])
        self.assertTrue(p.search('cache',1)['trace']['cache_hit'])

    def test_cross_boundary_answer_is_recovered(self):
        text = '背景'*16 + '缓存有效期规则：' + '其默认值是十分钟。'
        results = []
        for neighbors in (0, 1):
            p=Pipeline(':memory:',Config(chunk_size=40,overlap=0,neighbor_chunks=neighbors))
            p.put('manual',text)
            results.append(p.search('缓存有效期',1)['context'])
        self.assertNotIn('十分钟',results[0])
        self.assertIn('十分钟',results[1])

    def test_duplicate_spans_are_subtracted_exactly(self):
        spans=[dict(start=10,end=20,text='abcdefghij')]
        self.assertEqual(subtract_covered(spans,[(12,16)]),[
            dict(start=10,end=12,text='ab'),dict(start=16,end=20,text='ghij')])
        self.assertEqual(subtract_covered(spans,[(0,30)]),[])

    def test_skip_requires_full_ordered_agreement(self):
        c = Config(rerank_mode='adaptive')
        self.assertEqual(rerank_decision(c, [[1,2,3],[1,2,3]], 3, 1), 'skip_top_k_agreement')
        for ranks in ([[1,2,3],[1,3,2]], [[1],[1]], [[1,2,3]]):
            self.assertFalse(rerank_decision(c, ranks, 3, 1).startswith('skip'))
        self.assertFalse(rerank_decision(c, [[1],[1]], 1, 2).startswith('skip'))
        self.assertEqual(rerank_decision(replace(c,min_rerank_score=0), [[1],[1]], 1, 1), 'threshold_required')

    def test_threshold_still_rejects_with_adaptive(self):
        class Rerank:
            def predict(self, pairs): return [-1] * len(pairs)
        p = Pipeline(':memory:', Config(rerank_mode='adaptive',reranker_model='fixture',min_rerank_score=0,neighbor_chunks=1))
        p.models['reranker'] = Rerank()
        p.put('x', 'cache expires after ten minutes')
        r = p.search('cache')
        self.assertFalse(r['hits'])
        self.assertTrue(r['trace']['rerank_executed'])

    def test_expansion_exact_offsets_and_filter_boundary(self):
        text = '缓存配置说明。' + '甲'*35 + '缓存有效期十分钟。删除文档立即失效。' + '乙'*40
        p = Pipeline(':memory:',Config(chunk_size=40,overlap=8,neighbor_chunks=1,context_chars=120))
        p.put('allowed',text,{'scope':'public'})
        p.put('private','缓存 secret forbidden',{'scope':'private'})
        r=p.search('缓存',1,{'scope':'public'})
        h=r['hits'][0]
        self.assertGreater(len(h['chunk_ids']),1)
        for span in h['spans']:
            self.assertEqual(span['text'],text[span['start']:span['end']])
        self.assertNotIn('secret',r['context'])
        self.assertLessEqual(len(h['text']),120)

    def test_overlap_is_not_duplicated_and_gap_not_bridged(self):
        def row(id,start,text): return dict(id=id,source='x',start=start,end=start+len(text),text=text,metadata={})
        a,b,c=row('a',0,'abcdef'),row('b',4,'efghij'),row('c',20,'gap')
        h=expand_neighbors(b,[a,b,c],2)
        self.assertEqual(h['text'],'abcdefghij')
        self.assertEqual(h['end'],10)
        self.assertEqual(h['chunk_ids'],['a','b'])

    def test_invalid_configuration(self):
        for args in ({'rerank_mode':'maybe'},{'neighbor_chunks':3}):
            with self.assertRaises(ValueError): Config(**args)
