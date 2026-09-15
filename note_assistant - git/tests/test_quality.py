import unittest
from rag_engine import Config, Pipeline
from rag_engine.query import query_variants, model_supports_query
from rag_engine.text import evidence_spans
from rag_engine.citations import validate_citations

class QualityTests(unittest.TestCase):
    def test_uncompressed_evidence_has_no_false_gap(self):
        text='First sentence. Second sentence.'
        self.assertEqual(evidence_spans(text,'sentence',100),[dict(start=0,end=len(text),text=text)])
    def test_single_character_noise_does_not_retrieve(self):
        p=Pipeline(':memory:')
        p.put('stats','排名指标及文字处理方法。')
        self.assertEqual(p.search('火星殖民地现任市长姓名')['fallback'],'no_evidence')

    def test_language_route_without_loading_model(self):
        p=Pipeline(':memory:',Config(dense_model='all-MiniLM-L6-v2',reranker_model='ms-marco-MiniLM'))
        p.put('中文','缓存失效应在删除文档后执行。')
        r=p.search('缓存失效')
        self.assertEqual(r['hits'][0]['source'],'中文')
        self.assertEqual(p.models,{})
        self.assertIn('reranker_language_mismatch: fused ranking retained',r['trace']['warnings'])
        self.assertTrue(model_supports_query('BAAI/bge-reranker-base','auto','缓存'))

    def test_rewrite_identifiers_and_budget(self):
        self.assertEqual(query_variants('HTTP 404',['HTTP 403','HTTP 404 error','HTTP 404 error']),['HTTP 404','HTTP 404 error'])
        p=Pipeline(':memory:')
        p.put('a','original keyword');p.put('b','expansion keyword')
        self.assertEqual(p.search('original',1,queries=['expansion'])['hits'][0]['source'],'a')

    def test_spans_preserve_negation_and_offsets(self):
        text='无关说明。缓存不应永久有效。删除后必须失效。更多无关介绍。'
        spans=evidence_spans(text,'缓存',12,100)
        self.assertTrue(any('不应' in s['text'] for s in spans))
        for s in spans:
            self.assertEqual(s['text'],text[s['start']-100:s['end']-100])

    def test_budget_includes_gap_markers(self):
        p=Pipeline(':memory:',Config(context_chars=20))
        p.put('x','alpha is here. middle sentence. alpha again.')
        hit=p.search('alpha')['hits'][0]
        self.assertLessEqual(len(hit['text']),20)
        self.assertTrue(hit['spans'])

    def test_citation_membership_is_checked(self):
        hits=[{'citation':'S1'}]
        self.assertTrue(validate_citations('支持 [S1]',hits)['valid'])
        self.assertFalse(validate_citations('捏造 [S9]',hits)['valid'])
        self.assertFalse(validate_citations('没引用',hits)['valid'])

    def test_metadata_rejects_list(self):
        with self.assertRaises(ValueError): Pipeline(':memory:').put('x','text',[])

    def test_dense_threshold_and_vector_cache_reuse_across_filters(self):
        try: import numpy as np
        except ImportError: self.skipTest('optional numpy')
        class Dense:
            batches=0
            def encode(self, texts, **kw):
                if isinstance(texts,list):
                    self.batches+=1
                    return np.array([[0.,1.] for _ in texts])
                return np.array([1.,0.])
        dense=Dense();p=Pipeline(':memory:',Config(dense_model='fixture'))
        p.models['dense']=dense
        p.put('a','cooking');p.put('b','physics')
        self.assertFalse(p.search('unrelated')['hits'])
        p.search('new query',filters={'source':'a'})
        self.assertEqual(dense.batches,1)

if __name__=='__main__': unittest.main()
