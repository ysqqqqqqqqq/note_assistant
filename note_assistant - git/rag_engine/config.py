import os
import math
from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
    chunk_size: int = 600
    overlap: int = 100
    top_k: int = 3
    candidate_k: int = 30
    context_chars: int = 3000
    cache_size: int = 128
    dense_model: str = ''
    reranker_model: str = ''
    dense_language: str = 'auto'
    reranker_language: str = 'auto'
    min_dense_score: float = 0.35
    rewrite_weight: float = 0.5
    dense_query_prefix: str = ''
    min_rerank_score: float = -1000000000.0
    reranker_max_length: int = 512
    rerank_mode: str = 'always'
    neighbor_chunks: int = 0

    def __post_init__(self):
        if self.rerank_mode not in ('always', 'adaptive') or not 0 <= self.neighbor_chunks <= 2:
            raise ValueError('Invalid rerank mode or neighbor count')
        if not 0 <= self.overlap < self.chunk_size or self.chunk_size < 32:
            raise ValueError('Require chunk_size >= 32 and 0 <= overlap < chunk_size')
        if min(self.top_k, self.candidate_k, self.context_chars, self.cache_size) < 1:
            raise ValueError('RAG limits must be positive')
        if not math.isfinite(self.min_rerank_score) or self.reranker_max_length < 16:
            raise ValueError('Invalid reranker threshold or token limit')
        if not -1 <= self.min_dense_score <= 1 or not 0 <= self.rewrite_weight <= 1:
            raise ValueError('Invalid dense threshold or rewrite weight')
        if any(v not in ('auto','en','multilingual') for v in (self.dense_language,self.reranker_language)):
            raise ValueError('Model language must be auto/en/multilingual')

    @classmethod
    def from_env(cls):
        return cls(**{k: type(v.default)(os.environ['RAG_' + k.upper()])
                      for k, v in cls.__dataclass_fields__.items() if 'RAG_' + k.upper() in os.environ})
