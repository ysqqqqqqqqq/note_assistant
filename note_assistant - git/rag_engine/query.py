import re

def query_variants(query, rewrites):
    """Protect identifiers/numbers and cap expansion cost. Keep original at rank zero."""
    variants = [query.strip()]
    anchors = re.findall(r'\b(?:[A-Z][A-Z0-9_-]+|\d+(?:\.\d+)?)\b',query)
    for value in (rewrites or [])[:3]:
        value = value.strip()
        if value and len(value) <= 4000 and value not in variants and all(a.lower() in value.lower() for a in anchors):
            variants.append(value)
    return variants

def model_supports_query(name, language, query):
    if language == 'auto':
        name = name.lower()
        language = 'en' if ('all-minilm' in name or 'ms-marco' in name) else 'multilingual'
    return not (language == 'en' and re.search(r'[\u3400-\u9fff]',query))
