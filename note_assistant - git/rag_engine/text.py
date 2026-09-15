import re
from collections import Counter
from math import log

def tokens(text):
    text = text.lower()
    stop = {'a','an','the','is','are','and','or','of','to','in','for','with','what','how','does','do','it','by','on'}
    words = [w for w in re.findall(r'[a-z0-9_]+', text) if w not in stop]
    for run in re.findall(r'[\u3400-\u9fff]+', text):
        words.extend(run[i:i+2] for i in range(len(run)-1))
        if len(run) == 1:
            words.append(run)
    return words

def chunks(text, size, overlap):
    if size < 1 or not 0 <= overlap < size:
        raise ValueError('Invalid chunk limits')
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundaries = [m.end() for m in re.finditer(r'\n|[。！？.!?]', text[start:end])]
            suitable = [b for b in boundaries if b > max(overlap, size // 2)]
            if suitable:
                end = start + suitable[-1]
        if text[start:end].strip():
            yield start, end, text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - overlap)

def bm25(query, texts):
    docs = [Counter(tokens(t)) for t in texts]
    n = len(docs)
    avg = sum(sum(d.values()) for d in docs) / max(n, 1) or 1
    scores = [0.0] * n
    for token in set(tokens(query)):
        df = sum(token in d for d in docs)
        idf = log(1 + (n - df + .5) / (df + .5))
        for i, doc in enumerate(docs):
            tf = doc[token]
            scores[i] += idf * tf * 2.5 / (tf + 1.5 * (.25 + .75 * sum(doc.values()) / avg))
    return scores

def compress(text, query, limit):
    if len(text) <= limit:
        return text
    sentences = [s for s in re.split(r'(?<=[。！？.!?])|\n', text) if s.strip()]
    ranked = sorted(range(len(sentences)), key=lambda i: -len(set(tokens(sentences[i])) & set(tokens(query))))
    selected, used = [], 0
    for i in ranked:
        if used + len(sentences[i]) <= limit:
            selected.append(i)
            used += len(sentences[i])
    return ''.join(sentences[i] for i in sorted(selected)) or text[:limit]

def evidence_spans(text, query, limit, offset=0):
    """Extract source-exact sentences. Never concatenate across a gap without a separator."""
    if limit <= 0:
        return []
    if len(text) <= limit:
        return [dict(start=offset,end=offset+len(text),text=text)]
    candidates = [(m.start(), m.end()) for m in re.finditer(r'[^。！？.!?\n]+[。！？.!?\n]*', text)]
    query_tokens = set(tokens(query))
    ordered = sorted(candidates, key=lambda span: -len(query_tokens & set(tokens(text[slice(*span)]))))
    selected = []
    for start, end in ordered:
        if end-start <= limit:
            selected.append((start,end)); limit -= end-start
    if not selected:
        start,end = ordered[0] if ordered else (0,len(text))
        # An oversized sentence remains an exact excerpt, never an invented summary.
        selected = [(start,min(end,start+limit))]
    merged = []
    for a,b in sorted(selected):
        if merged and merged[-1][1] == a:
            merged[-1] = (merged[-1][0],b)
        else:
            merged.append((a,b))
    return [dict(start=offset+a,end=offset+b,text=text[a:b]) for a,b in merged]
