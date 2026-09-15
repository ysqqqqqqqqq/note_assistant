import re

def validate_citations(answer, hits):
    available = {h['citation'] for h in hits}
    used = set(re.findall(r'\[(S\d+)\]',answer))
    invalid = sorted(used-available)
    return dict(valid=not invalid and bool(used), invalid=invalid,
                cited=sorted(used & available),
                warning='unverified_citation' if invalid else 'missing_citation' if not used else None)
