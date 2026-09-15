/* Pure source membership checks; these do not assert factual entailment. */
function ragCheckCitations(answer, hits) {
  var ids = new Set((hits || []).map(function(h){return h.citation;}));
  var used = Array.from(new Set(Array.from(answer.matchAll(/\[(S\d+)\]/g),function(m){return m[1];})));
  var invalid = used.filter(function(id){return !ids.has(id);});
  return {valid:used.length > 0 && invalid.length === 0, invalid:invalid,
    warning:invalid.length ? (typeof tr === 'function' ? tr('unknownCitation') : 'Unknown citation') : !used.length ? (typeof tr === 'function' ? tr('missingCitation') : 'Missing citation') : null};
}
