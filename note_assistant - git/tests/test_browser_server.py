import unittest
from server import app


class BrowserOnlyServerTest(unittest.TestCase):
    def test_default_server_serves_page_without_opening_local_knowledge_base(self):
        client = app.test_client()
        page = client.get('/')
        asset = client.get('/assets/rag-browser-ui.js')
        self.assertEqual(page.status_code, 200)
        self.assertEqual(asset.status_code, 200)
        page.close()
        asset.close()
        self.assertEqual(client.get('/rag/status').status_code, 404)
        self.assertEqual(client.get('/kb/list').status_code, 404)
        self.assertNotIn('rag', app.extensions)


if __name__ == '__main__':
    unittest.main()
