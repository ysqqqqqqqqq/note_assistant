import copy
import hashlib
import json
import sqlite3
import threading
import time
import math
from collections import OrderedDict
from .config import Config
from .text import chunks, evidence_spans, tokens
from .policy import rerank_decision, expand_neighbors, subtract_covered
from .query import query_variants, model_supports_query
from .sparse import BM25Index

class Pipeline:
    def __init__(self, path='rag.sqlite3', config=None):
        self.config = config or Config.from_env()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source TEXT, start INTEGER, end INTEGER, text TEXT, metadata TEXT)')
        self.lock = threading.RLock()
        self.cache, self.vector_cache = OrderedDict(), OrderedDict()
        self.models, self.failures = {}, set()
        self.query_cache = OrderedDict()
        self.sparse_cache = OrderedDict()
        self.metrics = dict(searches=0, cache_hits=0, fallback_searches=0, total_ms=0)

    def _model(self, kind):
        name = getattr(self.config, kind + '_model')
        if not name or kind in self.failures:
            return None
        if kind not in self.models:
            try:
                from sentence_transformers import SentenceTransformer, CrossEncoder
                if kind == 'dense':
                    self.models[kind] = SentenceTransformer(name)
                else:
                    from torch.nn import Identity
                    self.models[kind] = CrossEncoder(name, activation_fn=Identity(), max_length=self.config.reranker_max_length)
            except Exception:
                self.failures.add(kind)
                return None
        return self.models[kind]

    def put(self, source, text, metadata=None):
        if not source or not text.strip():
            raise ValueError('Filename and nonempty text required')
        metadata = {} if metadata is None else metadata
        if not isinstance(metadata, dict) or any(not isinstance(v, (str, int, float, bool)) for v in metadata.values()):
            raise ValueError('Metadata must contain scalar values')
        rows = [(hashlib.sha256(f'{source}:{start}:{body}'.encode()).hexdigest()[:24], source,
                 start, end, body, json.dumps(metadata, ensure_ascii=False))
                for start, end, body in chunks(text, self.config.chunk_size, self.config.overlap)]
        with self.lock, self.db:
            self.db.execute('DELETE FROM chunks WHERE source=?', (source,))
            self.db.executemany('INSERT INTO chunks VALUES (?,?,?,?,?,?)', rows)
            self.cache.clear()
            self.vector_cache.clear()
            self.sparse_cache.clear()
        return dict(filename=source, chunks=len(rows))

    def documents(self):
        with self.lock:
            return [dict(filename=r[0], chunks=r[1]) for r in self.db.execute('SELECT source, COUNT(*) FROM chunks GROUP BY source')]

    def delete(self, source=None):
        with self.lock, self.db:
            if source is None:
                self.db.execute('DELETE FROM chunks')
            else:
                self.db.execute('DELETE FROM chunks WHERE source=?', (source,))
            self.cache.clear()
            self.vector_cache.clear()
            self.sparse_cache.clear()

    def search(self, query, top_k=None, filters=None, queries=None):
        if not isinstance(query, str) or not query.strip() or len(query) > 4000:
            raise ValueError('Query must have 1–4000 characters')
        k = self.config.top_k if top_k is None else top_k
        if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= 50:
            raise ValueError('top_k must be an integer from 1 to 50')
        if filters is not None and not isinstance(filters, dict):
            raise ValueError('filters must be an object')
        if queries is not None and (not isinstance(queries, list) or any(not isinstance(q, str) for q in queries)):
            raise ValueError('queries must be a string array')
        variants = query_variants(query, queries)
        key = json.dumps([variants, k, filters], sort_keys=True)
        with self.lock:
            started = time.perf_counter()
            self.metrics['searches'] += 1
            if key in self.cache:
                self.metrics['cache_hits'] += 1
                self.cache.move_to_end(key)
                result = copy.deepcopy(self.cache[key])
                result['trace']['cache_hit'] = True
                result['trace']['rerank_executed'] = False
                result['trace']['elapsed_ms'] = round((time.perf_counter()-started)*1000, 3)
                return result
            rows = []
            for r in self.db.execute('SELECT * FROM chunks ORDER BY source, start'):
                row = dict(r)
                row['metadata'] = json.loads(row['metadata'])
                if all((row['source'] if name == 'source' else row['metadata'].get(name)) == value for name, value in (filters or {}).items()):
                    rows.append(row)
            texts = [r['text'] for r in rows]
            corpus_key = tuple(r['id'] for r in rows)
            if corpus_key not in self.sparse_cache:
                self.sparse_cache[corpus_key] = BM25Index(texts)
                if len(self.sparse_cache) > 8:
                    self.sparse_cache.popitem(last=False)
            sparse_index = self.sparse_cache[corpus_key]
            fused, warnings = {}, []
            dense_allowed = model_supports_query(self.config.dense_model, self.config.dense_language, query)
            dense = self._model('dense') if rows and dense_allowed else None
            if not dense_allowed:
                warnings.append('dense_language_mismatch: lexical retrieval used')
            if not dense:
                warnings.append('dense_unavailable: BM25 fallback')
            original_rankings = []
            for variant_index, q in enumerate(variants):
                rankings = []
                sparse = sparse_index.score(q)
                rankings.append(sorted([i for i, score in enumerate(sparse) if score > 0], key=lambda i: -sparse[i]))
                if dense:
                    try:
                        import numpy as np
                        missing = [r for r in rows if r['id'] not in self.vector_cache]
                        if missing:
                            vectors = dense.encode([r['text'] for r in missing], normalize_embeddings=True)
                            for row, vector in zip(missing,vectors):
                                self.vector_cache[row['id']] = vector
                        matrix = np.array([self.vector_cache[r['id']] for r in rows])
                        if q not in self.query_cache:
                            self.query_cache[q] = dense.encode(self.config.dense_query_prefix + q, normalize_embeddings=True)
                            if len(self.query_cache) > self.config.cache_size:
                                self.query_cache.popitem(last=False)
                        scores = matrix @ self.query_cache[q]
                        while len(self.vector_cache) > 2048:
                            self.vector_cache.popitem(last=False)
                        rankings.append(sorted([i for i, score in enumerate(scores) if np.isfinite(score) and score >= self.config.min_dense_score], key=lambda i: -float(scores[i])))
                    except Exception:
                        warnings.append('dense_inference_failed: BM25 fallback')
                if variant_index == 0:
                    original_rankings = rankings
                for ranking in rankings:
                    for rank, i in enumerate(ranking[:max(k, self.config.candidate_k)], 1):
                        weight = 1.0 if variant_index == 0 else self.config.rewrite_weight / max(1,len(variants)-1)
                        fused[i] = fused.get(i, 0) + weight / (60 + rank)
            order = sorted(fused, key=lambda i: -fused[i])[:max(k, self.config.candidate_k)]
            rerank_allowed = model_supports_query(self.config.reranker_model, self.config.reranker_language, query)
            decision = rerank_decision(self.config, original_rankings, k, len(variants))
            skip_rerank = decision.startswith('skip_')
            reranker = self._model('reranker') if order and rerank_allowed and not skip_rerank else None
            rerank_executed = False
            if not rerank_allowed:
                warnings.append('reranker_language_mismatch: fused ranking retained')
            rerank_scores = {}
            rerank_failed = False
            if reranker:
                try:
                    rerank_executed = True
                    values = reranker.predict([(query, texts[i]) for i in order])
                    if len(values) != len(order) or not all(math.isfinite(float(v)) for v in values):
                        raise ValueError('Reranker returned invalid scores')
                    rerank_scores = dict(zip(order, map(float, values)))
                    order.sort(key=lambda i: -rerank_scores[i])
                    order = [i for i in order if rerank_scores[i] >= self.config.min_rerank_score]
                except Exception:
                    warnings.append('reranker_inference_failed: RRF fallback')
                    rerank_failed = True
            elif order and not skip_rerank:
                warnings.append('reranker_unavailable: RRF fallback')
                rerank_failed = True
            threshold_required = self.config.min_rerank_score > -1000000000.0
            blocked = bool(order) and threshold_required and rerank_failed
            if blocked:
                order = []
                rerank_scores = {}
                warnings = [w.replace('RRF fallback', 'answer withheld').replace('fused ranking retained', 'answer withheld') for w in warnings]
                warnings.append('evidence_verification_unavailable: answer withheld')
            hits, seen, remaining = [], [], self.config.context_chars
            covered = {}
            for i in order:
                ts = set(tokens(texts[i]))
                if any(len(ts & other) / max(1, len(ts | other)) > .85 for other in seen):
                    continue
                if remaining <= 0 or len(hits) >= k:
                    break
                row = expand_neighbors(rows[i], rows, self.config.neighbor_chunks)
                row['spans'] = evidence_spans(row['text'], query, min(remaining, 1000),row['start'])
                row['spans'] = subtract_covered(row['spans'], covered.get(row['source'], []))
                while len(row['spans']) > 1 and sum(len(s['text']) for s in row['spans']) + 5*(len(row['spans'])-1) > remaining:
                    row['spans'].pop()
                if not row['spans']:
                    continue
                row['text'] = '\n[…]\n'.join(span['text'] for span in row['spans'])
                row.update(score=fused[i], rerank_score=rerank_scores.get(i), citation=f'S{len(hits)+1}')
                remaining -= len(row['text'])
                seen.append(ts)
                hits.append(row)
                covered.setdefault(row['source'], []).extend((s['start'], s['end']) for s in row['spans'])
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            warnings = list(dict.fromkeys(warnings))
            self.metrics['fallback_searches'] += bool(warnings)
            self.metrics['total_ms'] += elapsed
            result = dict(hits=hits, context='\n\n'.join(f"[{h['citation']}] {h['source']} ({h['start']}:{h['end']})\n{h['text']}" for h in hits),
                          trace=dict(cache_hit=False, elapsed_ms=elapsed, candidates=len(order), queries=len(variants), rejected_rewrites=len(queries or [])-len(variants)+1, warnings=warnings, rerank_decision=decision, rerank_executed=rerank_executed),
                          fallback='verification_unavailable' if blocked else 'no_evidence' if not hits else None,
                          citation_policy='Source-exact excerpts; citation membership is not factual verification')
            self.cache[key] = copy.deepcopy(result)
            if len(self.cache) > self.config.cache_size:
                self.cache.popitem(last=False)
            return result

    def status(self):
        with self.lock:
            return dict(documents=self.documents(), metrics=dict(self.metrics),
                        models={k: ('failed' if k in self.failures else 'loaded' if k in self.models else 'configured' if getattr(self.config, k+'_model') else 'disabled') for k in ('dense','reranker')})
