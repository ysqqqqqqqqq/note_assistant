import json,os,unittest
from unittest.mock import patch,Mock
from rag_engine import Pipeline
from server import create_app

class GenerationContract(unittest.TestCase):
    def response(self,text):
        r=Mock();r.json.return_value={'choices':[{'message':{'content':text}}]};return r

    @patch.dict(os.environ,{'DASHSCOPE_API_KEY':'test-fixture-only'})
    @patch('httpx.post')
    def test_no_evidence_does_not_request_an_explanation(self,post):
        post.return_value=self.response('{"terms":["BM25"],"sentences":[]}')
        r=create_app(Pipeline(':memory:')).test_client().post('/annotate',json={'note_text':'BM25'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(post.call_count,1)
        self.assertEqual(r.json['annotations'][0]['fallback'],'no_evidence')

    @patch.dict(os.environ,{'DASHSCOPE_API_KEY':'test-fixture-only'})
    @patch('httpx.post')
    def test_citations_and_exact_excerpts_survive_api(self,post):
        p=Pipeline(':memory:');p.put('notes','BM25 ranks by term frequency.')
        post.side_effect=[self.response('{"terms":["BM25"],"sentences":[]}'),self.response('词项检索 [S1]')]
        r=create_app(p).test_client().post('/annotate',json={'note_text':'BM25'})
        ann=r.json['annotations'][0]
        self.assertTrue(ann['citation_check']['valid'])
        self.assertEqual(ann['sources'][0]['spans'][0]['text'],'BM25 ranks by term frequency.')

    @patch.dict(os.environ,{'DASHSCOPE_API_KEY':'test-fixture-only'})
    @patch('httpx.post')
    def test_provider_failure_does_not_expose_credentials(self,post):
        post.side_effect=RuntimeError('test-fixture-only')
        r=create_app(Pipeline(':memory:')).test_client().post('/annotate',json={'note_text':'BM25'})
        self.assertEqual(r.status_code,502)
        self.assertNotIn('test-fixture-only',r.get_data(as_text=True))
