import re

def validate_citations(answer, hits):
    available = {h['citation'] for h in hits}
    used = set(re.findall(r'\[(S\d+)\]',answer))
    invalid = sorted(used-available)
    return dict(valid=not invalid and bool(used), invalid=invalid,
                cited=sorted(used & available),
                warning='unverified_citation' if invalid else 'missing_citation' if not used else None)

def strip_invalid_citations(answer, hits):
    """Remove generated source IDs that are absent from the retrieval result."""
    available = {h['citation'] for h in hits}
    return re.sub(r'\[(S\d+)\]', lambda m: m.group(0) if m.group(1) in available else '', answer)
