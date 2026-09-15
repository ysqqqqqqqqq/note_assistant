"""Conservative, deterministic retrieval policies independent of model loading."""

def rerank_decision(config, rankings, k, variants):
    if config.rerank_mode == 'always':
        return 'always'
    # Skipping a scorer must never bypass its evidence rejection threshold.
    if config.min_rerank_score > -1000000000.0:
        return 'threshold_required'
    if variants != 1:
        return 'rewrite_requires_rerank'
    if len(rankings) != 2 or any(len(r) < k for r in rankings):
        return 'insufficient_agreement'
    if rankings[0][:k] == rankings[1][:k]:
        return 'skip_top_k_agreement'
    return 'ranking_disagreement'


def expand_neighbors(anchor, rows, count):
    """Merge contiguous source-exact chunks from the already authorized row set."""
    result = dict(anchor)
    result['chunk_ids'] = [anchor['id']]
    if not count:
        return result
    siblings = [r for r in rows if r['source'] == anchor['source'] and r['metadata'] == anchor['metadata']]
    siblings.sort(key=lambda r: r['start'])
    position = next(i for i, r in enumerate(siblings) if r['id'] == anchor['id'])
    selected = [anchor]
    for direction in (-1, 1):
        edge = anchor
        for distance in range(1, count + 1):
            index = position + direction * distance
            if not 0 <= index < len(siblings):
                break
            row = siblings[index]
            if row['start'] > edge['end'] or edge['start'] > row['end']:
                break
            selected.append(row)
            edge = row
    selected.sort(key=lambda r: r['start'])
    start, end, body = selected[0]['start'], selected[0]['end'], selected[0]['text']
    for row in selected[1:]:
        overlap_end = min(end, row['end'])
        if body[row['start']-start:overlap_end-start] != row['text'][:overlap_end-row['start']]:
            return result  # Never invent a union from inconsistent offsets.
        if row['end'] > end:
            body += row['text'][end-row['start']:]
            end = row['end']
    result.update(start=start, end=end, text=body, chunk_ids=[r['id'] for r in selected])
    return result


def subtract_covered(spans, covered):
    """Remove already cited source intervals without altering surviving text."""
    result = []
    for span in spans:
        parts = [(span['start'], span['end'])]
        for left, right in covered:
            parts = [(a, b) for start, end in parts
                     for a, b in ((start, min(end, left)), (max(start, right), end)) if a < b]
        for start, end in parts:
            result.append(dict(start=start, end=end, text=span['text'][start-span['start']:end-span['start']]))
    return result
