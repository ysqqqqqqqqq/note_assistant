/* ═══════════════════════════════════════════════════════
 * Note Annotation Tool - Main Application
 * Open Source - MIT License
 *
 * 功能：文本降噪、AI 批注生成、手动批注、历史记录、导出
 * 所有 API 配置由用户在设置面板自行填写
 * ═══════════════════════════════════════════════════════ */

/* ── 可配置常量（集中在头部，方便二次开发） ── */
var DEFAULT_API_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
var DEFAULT_MODEL = 'qwen-plus';
var DEFAULT_TOP_N = 3;
var STORAGE_KEY = 'note_tool_settings';

/* ── 设置管理 ─────────────────────────── */
function loadSettings() {
  try { var raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch(e) {}
  return { apiKey: '', apiBase: DEFAULT_API_BASE, model: DEFAULT_MODEL, ragEnabled: false, topN: DEFAULT_TOP_N };
}
function saveSettings(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch(e) {} }
function getSettingsAndApply() {
  var s = loadSettings();
  var elBase = document.getElementById('setting-api-base');
  var elKey = document.getElementById('setting-api-key');
  var elModel = document.getElementById('setting-model');
  var elRag = document.getElementById('setting-rag-enabled');
  var elTopN = document.getElementById('setting-top-n');
  if (elBase) elBase.value = s.apiBase === DEFAULT_API_BASE ? '' : (s.apiBase || '');
  if (elKey) elKey.value = s.apiKey || '';
  if (elModel) elModel.value = s.model === DEFAULT_MODEL ? '' : (s.model || '');
  if (elRag) elRag.checked = !!s.ragEnabled;
  if (elTopN) elTopN.value = s.topN || DEFAULT_TOP_N;
}
function onSettingsSave() {
  var s = loadSettings();
  var elBase = document.getElementById('setting-api-base');
  var elKey = document.getElementById('setting-api-key');
  var elModel = document.getElementById('setting-model');
  var elRag = document.getElementById('setting-rag-enabled');
  var elTopN = document.getElementById('setting-top-n');
  if (elBase) s.apiBase = elBase.value.trim() || DEFAULT_API_BASE;
  if (elKey) s.apiKey = elKey.value.trim();
  if (elModel) s.model = elModel.value.trim() || DEFAULT_MODEL;
  if (elRag) s.ragEnabled = elRag.checked;
  if (elTopN) s.topN = parseInt(elTopN.value) || DEFAULT_TOP_N;
  saveSettings(s);
}

/* ── LLM API 统一调用 ────────────────── */
async function callLLM(messages, options) {
  options = options || {};
  var s = loadSettings();
  if (!s.apiKey) throw new Error(I18N[_lang].apiNotConfigured || 'API not configured');
  var resp = await fetch(s.apiBase + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
    body: JSON.stringify({ model: s.model, messages: messages, temperature: options.temperature || 0 })
  });
  if (!resp.ok) throw new Error('API error: ' + resp.status);
  var data = await resp.json();
  if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
  throw new Error('API response format error');
}

/* ── Prompt 模板 ──────────────────────── */
var PROMPT_EXTRACT = 'Scan the full note, extract all technical terms and key sentences.\n\nRules:\n1. terms: all technical nouns (CS, AI, robotics, finance, embedded, signal processing etc.), prefer more\n2. sentences: complete sentences with definitions, principles, conclusions\n3. Exclude common colloquial words\n4. Each term as separate string\n5. Output JSON only\n\nFormat: {"terms":["term1","term2"],"sentences":["sentence1"]}\n\nNote:\n';
var PROMPT_EXPLAIN_NO_CTX = 'Explain this ';
var PROMPT_EXPLAIN_WITH_CTX = 'Explain this ';
var DENOISE_PROMPT = 'Clean up speech-to-text noise.\nRules:\n1. Remove filler words, meaningless transitions\n2. Never modify technical knowledge, terms, definitions\n3. Output clean text only\nOriginal:\n';

/* ── i18n 字典 ────────────────────────── */
var I18N = {
  zh: {
    title:'笔记智能批注工具', editorLabel:'编辑笔记文本',
    btnGenerate:'生成批注', btnPaste:'从剪贴板粘贴', btnManual:'添加', btnClear:'清除文本', btnSaveNote:'保存笔记', btnExport:'导出', btnDenoise:'文本降噪', emptyNote:'请先输入笔记文本', noAnnotations:'暂无批注数据', generating:'生成中...', apiError:'API 错误', apiFail:'请求失败', pasteFail:'无法读取剪贴板', pasteNotSupported:'浏览器不支持剪贴板 API', noExplanation:'笔记内暂无相关说明',
    previewTitle:'笔记预览', cardsTitle:'批注卡片',
    settingsTitle:'设置', themeLabel:'主题色', langLabel:'语言',
    emptyPreview:'请在上方输入笔记文本，然后点击「生成批注」',
    emptyCards:'暂无批注数据', denoising:'正在降噪…', denoiseDone:'降噪完成',
    denoiseFail:'降噪失败', typeTerm:'术语', typeSentence:'句子',
    manualTitle:'手动添加批注', manualTypeLabel:'批注类型', manualExplanationLabel:'释义说明',
    btnCancel:'取消', btnConfirm:'确认', noSelection:'请先在笔记预览区域选中目标文字',
    historyTitle:'历史记录', historySearchPlaceholder:'搜索标题或内容…', btnClearAllHistory:'清空全部', btnClose:'关闭',
    saveSuccess:'笔记已保存', saveEmpty:'笔记内容为空，无法保存', saveDbNotReady:'数据库尚未就绪，请稍后再试',
    historyEmpty:'暂无历史记录', loadConfirm:'加载此条笔记将覆盖当前内容，是否继续？',
    exportTitle:'导出', exportPNG:'PNG 图片', exportWord:'Word 文档 (.docx)', exportCancel:'取消', exportConfirm:'确认导出',
    unnamedNote:'未命名笔记', editTitle:'编辑标题', savingTitle:'正在生成标题…', saveFailed:'保存失败',
    btnEditTitle:'编辑', btnDelete:'删除', historyItemDel:'删除',
    kbTitle:'知识库管理', kbUploadHint:'点击上传文档（TXT / MD / CSV）', kbEmpty:'知识库为空，请上传文档',
    kbUploading:'正在上传…', kbUploadSuccess:'上传成功', kbUploadFail:'上传失败', kbDeleteConfirm:'确认删除此文档？',
    btnKB:'知识库', kbRagHint:'批注时将自动从知识库检索相关上下文增强释义',
    apiConfigLabel:'API 配置', apiBaseLabel:'API 地址', apiBaseHint:'留空使用默认地址',
    apiKeyLabel:'API 密钥', modelNameLabel:'模型名称',
    ragConfigLabel:'RAG 知识库', ragEnabledLabel:'优先使用本地 RAG 知识库', topNLabel:'检索召回数量 (top-n)',
    storageTip:'提示：笔记数据保存在浏览器本地 IndexedDB 中。清除浏览器站点数据将清空本地数据库与知识库。',
    btnClearKB:'清空知识库', kbClearConfirm:'确认清空全部知识库数据？此操作不可恢复。', kbCleared:'知识库已清空',
    apiNotConfigured:'API 未配置，请在设置面板填写 API 密钥', kbEmbedLoading:'正在加载嵌入模型…',
    kbEmbedReady:'嵌入模型就绪', kbEmbedFailed:'嵌入模型加载失败，已降级为无 RAG 模式'
  },
  en: {
    title:'Note Annotation Tool', editorLabel:'Edit Note Text',
    btnGenerate:'Generate Annotations', btnPaste:'Paste from Clipboard', btnManual:'Add', btnClear:'Clear Text', btnSaveNote:'Save Note', btnExport:'Export', btnDenoise:'Text Denoise', emptyNote:'Please enter note text first', noAnnotations:'No annotations found', generating:'Generating...', apiError:'API Error', apiFail:'Request failed', pasteFail:'Cannot read clipboard', pasteNotSupported:'Browser does not support clipboard API', noExplanation:'No explanation available in notes',
    previewTitle:'Note Preview', cardsTitle:'Annotation Cards',
    settingsTitle:'Settings', themeLabel:'Theme Color', langLabel:'Language',
    emptyPreview:'Enter note text above, then click "Generate Annotations"',
    emptyCards:'No annotation data', denoising:'Denoising…', denoiseDone:'Denoise complete',
    denoiseFail:'Denoise failed', typeTerm:'Term', typeSentence:'Sentence',
    manualTitle:'Add Annotation', manualTypeLabel:'Annotation Type', manualExplanationLabel:'Explanation',
    btnCancel:'Cancel', btnConfirm:'Confirm', noSelection:'Please select text in the note preview first',
    historyTitle:'History', historySearchPlaceholder:'Search title or content…', btnClearAllHistory:'Clear All', btnClose:'Close',
    saveSuccess:'Note saved', saveEmpty:'Note is empty, cannot save', saveDbNotReady:'Database not ready, please try again later',
    historyEmpty:'No history records', loadConfirm:'Loading this note will overwrite current content. Continue?',
    exportTitle:'Export', exportPNG:'PNG Image', exportWord:'Word Document (.docx)', exportCancel:'Cancel', exportConfirm:'Confirm Export',
    unnamedNote:'Untitled Note', editTitle:'Edit Title', savingTitle:'Generating title…', saveFailed:'Save failed',
    btnEditTitle:'Edit', btnDelete:'Delete', historyItemDel:'Delete',
    kbTitle:'Knowledge Base', kbUploadHint:'Upload documents (TXT / MD / CSV)', kbEmpty:'Knowledge base is empty, please upload documents',
    kbUploading:'Uploading…', kbUploadSuccess:'Upload successful', kbUploadFail:'Upload failed', kbDeleteConfirm:'Delete this document?',
    btnKB:'Knowledge Base', kbRagHint:'Relevant context will be retrieved from KB when generating annotations',
    apiConfigLabel:'API Config', apiBaseLabel:'API Base URL', apiBaseHint:'Leave empty to use default',
    apiKeyLabel:'API Key', modelNameLabel:'Model Name',
    ragConfigLabel:'RAG Knowledge Base', ragEnabledLabel:'Prioritize local RAG knowledge base', topNLabel:'Retrieval count (top-n)',
    storageTip:'Note: All data is stored locally in browser IndexedDB. Clearing site data will erase local database and knowledge base.',
    btnClearKB:'Clear KB', kbClearConfirm:'Clear all knowledge base data? This cannot be undone.', kbCleared:'Knowledge base cleared',
    apiNotConfigured:'API not configured. Please set API key in Settings.', kbEmbedLoading:'Loading embedding model…',
    kbEmbedReady:'Embedding model ready', kbEmbedFailed:'Embedding model failed, falling back to non-RAG mode'
  }
};
var _lang = 'zh';

function applyI18n() {
  var dict = I18N[_lang];
  document.querySelectorAll('[data-i18n]').forEach(function(el) { var k = el.getAttribute('data-i18n'); if (dict[k]) el.textContent = dict[k]; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) { var k = el.getAttribute('data-i18n-placeholder'); if (dict[k]) el.placeholder = dict[k]; });
  document.querySelectorAll('[data-i18n-title]').forEach(function(el) { var k = el.getAttribute('data-i18n-title'); if (dict[k]) el.title = dict[k]; });
}
function switchLang(lang) {
  _lang = lang;
  document.querySelectorAll('.lang-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.lang === lang); });
  applyI18n();
  if (_positioned.length) renderCards(_positioned);
}

/* ── 主题色 ───────────────────────────── */
var THEMES = {
  blue:  { tc:'#3b82f6', dark:'#2563eb', bg:'rgba(59,130,246,0.04)', hover:'rgba(59,130,246,0.10)', light:'rgba(59,130,246,0.06)', tag:'rgba(59,130,246,0.06)' },
  green: { tc:'#10b981', dark:'#059669', bg:'rgba(16,185,129,0.04)', hover:'rgba(16,185,129,0.10)', light:'rgba(16,185,129,0.06)', tag:'rgba(16,185,129,0.06)' },
  pink:  { tc:'#ec4899', dark:'#db2777', bg:'rgba(236,72,153,0.04)', hover:'rgba(236,72,153,0.10)', light:'rgba(236,72,153,0.06)', tag:'rgba(236,72,153,0.06)' },
  black: { tc:'#1e293b', dark:'#0f172a', bg:'rgba(30,41,59,0.04)',  hover:'rgba(30,41,59,0.10)',  light:'rgba(30,41,59,0.06)',   tag:'rgba(30,41,59,0.06)' },
  red:   { tc:'#e74c3c', dark:'#c0392b', bg:'rgba(231,76,60,0.04)', hover:'rgba(231,76,60,0.10)', light:'rgba(231,76,60,0.06)',  tag:'rgba(231,76,60,0.06)' }
};
function switchTheme(el) {
  var c = THEMES[el.dataset.color], s = document.documentElement.style;
  s.setProperty('--tc', c.tc); s.setProperty('--tc-dark', c.dark);
  s.setProperty('--tc-bg', c.bg); s.setProperty('--tc-hover', c.hover);
  s.setProperty('--tc-light', c.light); s.setProperty('--tc-tag-bg', c.tag);
  document.querySelectorAll('.theme-dot').forEach(function(d) { d.classList.remove('active'); });
  el.classList.add('active');
  try { localStorage.setItem('note_annotate_theme', el.dataset.color); } catch(e) {}
}
function _restoreTheme() {
  try {
    var saved = localStorage.getItem('note_annotate_theme');
    if (saved && THEMES[saved]) { var dot = document.querySelector('.theme-dot[data-color="' + saved + '"]'); if (dot) switchTheme(dot); }
  } catch(e) {}
}

/* ── 批注渲染核心 ─────────────────────── */
var _positioned = [], _manualAnnotations = [], _autoAnnotations = [];

function pasteFromClipboard() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function(t) {
      document.getElementById('note-input').value = t;
      _autoAnnotations = []; _manualAnnotations = []; mergeAndRender();
    }).catch(function() { alert(I18N[_lang].pasteFail || '无法读取剪贴板'); });
  } else { alert(I18N[_lang].pasteNotSupported || '浏览器不支持剪贴板 API'); }
}

/** 从 LLM 返回文本中提取 JSON */
function extractJSONFromText(text) {
  text = (text || '').trim().replace(/```(?:json)?\s*/g, '');
  try { var r = JSON.parse(text); if (r && typeof r === 'object') return r; } catch(e) {}
  var m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch(e) {} }
  return null;
}

/** 生成批注（前端直接调 LLM，可选 RAG 增强） */
async function regenerateAnnotations() {
  var noteText = document.getElementById('note-input').value;
  if (!noteText.trim()) { alert(I18N[_lang].emptyNote); return; }
  var btn = document.querySelector('[data-i18n="btnGenerate"]');
  var origText = btn.textContent; btn.textContent = I18N[_lang].generating; btn.disabled = true;
  _manualAnnotations = [];
  try {
    var rawResult = await callLLM([
      { role:'system', content:'你是专业术语提取工具，仅输出合法JSON。' },
      { role:'user', content: PROMPT_EXTRACT + noteText }
    ]);
    var extracted = extractJSONFromText(rawResult);
    if (!extracted) throw new Error('LLM returned unparseable JSON');
    var allItems = [], seen = {};
    (extracted.terms||[]).forEach(function(t) { if (!seen[t]) { seen[t]=1; allItems.push({type:'term',content:t}); } });
    (extracted.sentences||[]).forEach(function(s) { if (!seen[s]) { seen[s]=1; allItems.push({type:'sentence',content:s}); } });
    var settings = loadSettings(), ragAvailable = false;
    if (settings.ragEnabled) { try { ragAvailable = (await ragGetTotalChunks()) > 0; } catch(e) {} }
    var annotations = [], queue = allItems.slice(), CONCURRENCY = 3, workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, queue.length || 1); w++) {
      workers.push((async function() {
        while (queue.length > 0) {
          var item = queue.shift(), explanation = I18N[_lang].noExplanation || '笔记内暂无相关说明';
          try {
            var context = '';
            if (ragAvailable) { try { context = await ragRetrieve(item.content, settings.topN||DEFAULT_TOP_N); } catch(e) {} }
            var prompt = PROMPT_EXPLAIN_NO_CTX + (item.type==='term'?'term':'sentence') + '. Target: ' + item.content + '.\nRequirements: Chinese, within 80 chars, beginner-friendly, output explanation only.';
            if (context) prompt += '\n\nReference (from KB):\n' + context + '\n\nPlease combine the above reference material, ';
            prompt += '\nExplanation:';
            explanation = (await callLLM([
              { role:'system', content:'你是技术文档助手，直接输出释义。' },
              { role:'user', content: prompt }
            ])).trim().substring(0, 120);
          } catch(e) { console.warn('[Explain]', item.content, e.message); }
          var start = noteText.indexOf(item.content);
          if (start === -1) continue;
          annotations.push({ type:item.type, content:item.content, explanation:explanation||(I18N[_lang].noExplanation||'笔记内暂无相关说明'), start:start, end:start+item.content.length });
        }
      })());
    }
    await Promise.all(workers);
    annotations.sort(function(a,b){ return a.start-b.start; });
    var finalAnns = [], usedRanges = [];
    for (var i = 0; i < annotations.length; i++) {
      var ann = annotations[i], overlap = false;
      for (var u = 0; u < usedRanges.length; u++) { if (ann.start < usedRanges[u].end && ann.end > usedRanges[u].start) { overlap=true; break; } }
      if (!overlap) { usedRanges.push({start:ann.start,end:ann.end}); finalAnns.push(ann); }
    }
    _autoAnnotations = finalAnns; mergeAndRender();
  } catch(err) { console.error('[Generate]', err); alert((I18N[_lang].apiError||'Error')+': '+err.message); }
  finally { btn.textContent = origText; btn.disabled = false; }
}

function mergeAndRender() {
  var noteText = document.getElementById('note-input').value;
  var all = _autoAnnotations.concat(_manualAnnotations);
  all.sort(function(a,b){ return a.start-b.start; });
  _positioned = all; renderPreview(noteText, _positioned); renderCards(_positioned);
}
function renderPreview(text, annotations) {
  var container = document.getElementById('preview-content');
  if (!text) { container.innerHTML = '<div class="empty-tip"><span>📝</span>'+I18N[_lang].emptyPreview+'</div>'; return; }
  if (!annotations.length) { container.textContent = text; return; }
  var html = '', cursor = 0, termIdx = 0;
  for (var i = 0; i < annotations.length; i++) {
    var ann = annotations[i];
    if (ann.start > cursor) html += escapeHtml(text.substring(cursor, ann.start));
    var cls = ann.type==='term'?'mark-term':'mark-sentence', badgeHtml = '';
    if (ann.type==='term') { termIdx++; badgeHtml = '<span class="mark-badge badge-term">'+termIdx+'</span>'; }
    html += '<span class="'+cls+'" data-ann-idx="'+i+'" onclick="scrollToCard('+i+')">'+escapeHtml(text.substring(ann.start,ann.end))+badgeHtml+'</span>';
    cursor = ann.end;
  }
  if (cursor < text.length) html += escapeHtml(text.substring(cursor));
  container.innerHTML = html;
}
function renderCards(annotations) {
  var container = document.getElementById('cards-container');
  if (!annotations.length) { container.innerHTML = '<div class="empty-tip"><span>📋</span>'+I18N[_lang].emptyCards+'</div>'; return; }
  var html = '', termIdx = 0, sentIdx = 0;
  var tT = I18N[_lang].typeTerm, tS = I18N[_lang].typeSentence;
  for (var i = 0; i < annotations.length; i++) {
    var ann = annotations[i], tC = ann.type==='term'?'type-term':'type-sentence', tX = ann.type==='term'?tT:tS, label, nC;
    if (ann.type==='term') { termIdx++; label=termIdx; nC='card-num'; } else { label=String.fromCharCode(97+sentIdx); sentIdx++; nC='card-num card-num-sentence'; }
    html += '<div class="annotation-card" data-card-idx="'+i+'"><button class="card-close-btn" onclick="deleteAnnotation('+i+')">&times;</button><div class="card-head"><span class="'+nC+'">'+label+'</span><span class="card-type '+tC+'">'+tX+'</span></div><div class="card-content">'+escapeHtml(ann.content)+'</div><div class="card-explanation">'+escapeHtml(ann.explanation)+'</div></div>';
  }
  container.innerHTML = html;
}
function deleteAnnotation(idx) {
  if (idx<0||idx>=_positioned.length) return;
  var removed=_positioned[idx], found=false;
  for (var m=0;m<_manualAnnotations.length;m++) { if (_manualAnnotations[m].start===removed.start&&_manualAnnotations[m].content===removed.content) { _manualAnnotations.splice(m,1); found=true; break; } }
  if (!found) { for (var a=0;a<_autoAnnotations.length;a++) { if (_autoAnnotations[a].start===removed.start&&_autoAnnotations[a].content===removed.content) { _autoAnnotations.splice(a,1); break; } } }
  mergeAndRender();
}
function scrollToCard(idx) {
  var card = document.querySelector('.annotation-card[data-card-idx="'+idx+'"]');
  if (!card) return; card.scrollIntoView({behavior:'smooth',block:'center'});
  card.classList.remove('card-highlight'); void card.offsetWidth; card.classList.add('card-highlight');
  setTimeout(function(){card.classList.remove('card-highlight');},2000);
}

/* ── 文本降噪 ─────────────────────────── */
async function textDenoise() {
  var text = document.getElementById('note-input').value.trim(); if (!text) return;
  var btn = document.querySelector('[data-i18n="btnDenoise"]'), orig = btn.textContent;
  btn.textContent = I18N[_lang].denoising; btn.disabled = true;
  try {
    var cleaned = await callLLM([{role:'system',content:'口语文本清洗工具，只输出纯净文本。'},{role:'user',content:DENOISE_PROMPT+text}]);
    if (cleaned&&cleaned.trim()) { document.getElementById('note-input').value=cleaned.trim(); btn.textContent=I18N[_lang].denoiseDone; setTimeout(function(){btn.textContent=orig;btn.disabled=false;},1500); }
    else throw new Error('Empty response');
  } catch(err) { alert((I18N[_lang].denoiseFail||'')+': '+err.message); btn.textContent=orig; btn.disabled=false; }
}

/* ── 保存笔记 + AI 标题 ──────────────── */
async function saveNote() {
  var text = document.getElementById('note-input').value.trim();
  if (!text) { alert(I18N[_lang].saveEmpty); return; }
  if (!_dbReady||!_db) { alert(I18N[_lang].saveDbNotReady); return; }
  var btn = document.querySelector('[data-i18n="btnSaveNote"]'), orig = btn.textContent;
  btn.textContent = I18N[_lang].savingTitle||'…'; btn.disabled = true;
  var title;
  try { title = (await callLLM([{role:'system',content:'笔记标题生成助手。生成10-25字标题，只输出标题。'},{role:'user',content:text}],{temperature:0.3})).trim().substring(0,25); if(title.length<10) title+='…'; } catch(e) { title=I18N[_lang].unnamedNote||''; }
  try {
    var now=new Date(), ts=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    _db.run('INSERT INTO notes (title,content,created_at) VALUES (?,?,?)',[title,text,ts]); _saveDb();
    var pt=document.querySelector('.page-title'); if(pt) pt.textContent=title;
    alert(I18N[_lang].saveSuccess);
  } catch(e) { alert((I18N[_lang].saveFailed||'')+': '+e.message); }
  btn.textContent=orig; btn.disabled=false;
}

/* ── 手动批注 ─────────────────────────── */
var _pendingSelection = null;
function getSelectedTextFromPreview() {
  var sel=window.getSelection(); if(!sel||sel.isCollapsed||sel.rangeCount===0) return null;
  var range=sel.getRangeAt(0), preview=document.getElementById('preview-content');
  if(!preview.contains(range.commonAncestorContainer)) return null;
  return sel.toString().trim()||null;
}
function findTextPosition(text) { var idx=document.getElementById('note-input').value.indexOf(text); return idx===-1?null:{start:idx,end:idx+text.length}; }
function openManualAnnotation() {
  var text=getSelectedTextFromPreview(); if(!text){alert(I18N[_lang].noSelection);return;}
  var pos=findTextPosition(text); if(!pos){alert(I18N[_lang].noSelection);return;}
  _pendingSelection={text:text,start:pos.start,end:pos.end};
  document.getElementById('manual-selected-text').textContent=text;
  document.getElementById('manual-explanation').value='';
  selectAnnType('term'); document.getElementById('manualModal').classList.add('open');
}
function selectAnnType(type) {
  document.getElementById('label-term').classList.toggle('checked',type==='term');
  document.getElementById('label-sentence').classList.toggle('checked',type==='sentence');
  var r=document.querySelector('input[name="ann-type"][value="'+type+'"]'); if(r) r.checked=true;
}
function closeManualModal() { document.getElementById('manualModal').classList.remove('open'); _pendingSelection=null; }
function closeManualOutside(e) { if(e.target===document.getElementById('manualModal')) closeManualModal(); }
function confirmManualAnnotation() {
  if(!_pendingSelection) return;
  var type=document.querySelector('input[name="ann-type"]:checked').value;
  var expl=document.getElementById('manual-explanation').value.trim()||(I18N[_lang].noExplanation||'笔记内暂无相关说明');
  var ma={type:type,content:_pendingSelection.text,explanation:expl,start:_pendingSelection.start,end:_pendingSelection.end};
  for(var i=0;i<_positioned.length;i++){if(ma.start<_positioned[i].end&&ma.end>_positioned[i].start){alert(_lang==='zh'?'该位置已有批注':'Overlap');return;}}
  _manualAnnotations.push(ma); mergeAndRender(); closeManualModal();
}
function clearText() {
  document.getElementById('note-input').value='';
  _autoAnnotations=[];_manualAnnotations=[];_positioned=[];
  document.getElementById('preview-content').innerHTML='<div class="empty-tip"><span>📝</span>'+I18N[_lang].emptyPreview+'</div>';
  document.getElementById('cards-container').innerHTML='<div class="empty-tip"><span>📋</span>'+I18N[_lang].emptyCards+'</div>';
}

/* ── 工具函数 ─────────────────────────── */
function escapeHtml(s) { var d=document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }

/* ── 导出 PNG ─────────────────────────── */
function exportPNG() {
  var node=document.getElementById('main-content');
  if(typeof htmlToImage==='undefined'){alert('html-to-image 库未加载');return;}
  var pp=document.querySelector('.preview-panel'),cp=document.querySelector('.cards-panel');
  var oPP=pp.style.maxHeight,oCP=cp.style.maxHeight;
  pp.style.maxHeight='none';cp.style.maxHeight='none';document.body.classList.add('exporting-png');
  htmlToImage.toPng(node,{backgroundColor:'#ffffff',pixelRatio:2})
    .then(function(d){var a=document.createElement('a');a.download='note.png';a.href=d;document.body.appendChild(a);a.click();document.body.removeChild(a);})
    .catch(function(e){console.error(e);alert('导出失败');})
    .finally(function(){pp.style.maxHeight=oPP;cp.style.maxHeight=oCP;document.body.classList.remove('exporting-png');});
}
var _exportFormat='png';
function toggleExportModal(){document.getElementById('exportModal').classList.toggle('open');}
function closeExportOutside(e){if(e.target===document.getElementById('exportModal'))toggleExportModal();}
function selectExportFormat(f){_exportFormat=f;document.getElementById('opt-png').classList.toggle('selected',f==='png');document.getElementById('opt-word').classList.toggle('selected',f==='word');}
function confirmExport(){toggleExportModal();if(_exportFormat==='png')exportPNG();else exportWord();}

/* ── 导出 Word ────────────────────────── */
function exportWord() {
  if(typeof docx==='undefined'){alert('docx 库未加载');return;}
  var noteText=document.getElementById('note-input').value.trim();
  if(!noteText){alert(I18N[_lang].saveEmpty);return;}
  var D=docx.Document,P=docx.Paragraph,T=docx.TextRun,A=docx.AlignmentType;
  var pt=document.querySelector('.page-title'),now=new Date();
  var ts=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')+' '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  var docTitle=(pt?pt.textContent:(I18N[_lang].unnamedNote||''))+' | '+ts;
  var sorted=_positioned.slice().sort(function(a,b){return a.start-b.start;});
  var ch=[new P({alignment:A.CENTER,children:[new T({text:docTitle,bold:true,size:32})]}),new P({text:''}),new P({children:[new T({text:noteText,size:24})]}),new P({text:''}),new P({children:[new T({text:'────────────────────',size:20,color:'CCCCCC'})]}),new P({text:''})];
  var tT=I18N[_lang].typeTerm||'术语',tS=I18N[_lang].typeSentence||'句子';
  for(var i=0;i<sorted.length;i++){var ann=sorted[i],tl=ann.type==='term'?tT:tS;ch.push(new P({children:[new T({text:'【'+tl+'】 ',bold:true,size:22}),new T({text:ann.content,size:22})]}));ch.push(new P({children:[new T({text:ann.explanation,size:20,color:'555555'})],indent:{left:400}}));ch.push(new P({text:''}));}
  var doc=new D({sections:[{properties:{},children:ch}]});
  docx.Packer.toBlob(doc).then(function(blob){
    var fts=now.getFullYear()+String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0')+'_'+String(now.getHours()).padStart(2,'0')+String(now.getMinutes()).padStart(2,'0')+String(now.getSeconds()).padStart(2,'0');
    var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='笔记_'+fts+'.docx';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }).catch(function(e){alert('Word 导出失败: '+e.message);});
}

/* ── SQLite 历史记录 ──────────────────── */
var _db=null,_dbReady=false,_allHistory=[];
function _idbGet(){return new Promise(function(res,rej){var r=indexedDB.open('note_annotate_db',1);r.onupgradeneeded=function(){r.result.createObjectStore('kv');};r.onsuccess=function(){var tx=r.result.transaction('kv','readonly');var q=tx.objectStore('kv').get('sqljs_db');q.onsuccess=function(){res(q.result||null);};q.onerror=function(){rej(q.error);};};r.onerror=function(){rej(r.error);};});}
function _idbSet(data){return new Promise(function(res,rej){var r=indexedDB.open('note_annotate_db',1);r.onupgradeneeded=function(){r.result.createObjectStore('kv');};r.onsuccess=function(){var tx=r.result.transaction('kv','readwrite');var q=tx.objectStore('kv').put(data,'sqljs_db');q.onsuccess=function(){res();};q.onerror=function(){rej(q.error);};};r.onerror=function(){rej(r.error);};});}
function initDatabase() {
  if(typeof initSqlJs==='undefined'){console.warn('[DB] sql.js not loaded');return;}
  initSqlJs({locateFile:function(f){return './assets/'+f;}}).then(function(SQL){
    return _idbGet().then(function(data){
      _db=data?new SQL.Database(new Uint8Array(data)):new SQL.Database();
      if(!data) _db.run('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)');
      try{_db.exec('SELECT title FROM notes LIMIT 1');}catch(e){_db.run('ALTER TABLE notes ADD COLUMN title TEXT DEFAULT "未命名笔记"');}
      try{_db.exec('SELECT content FROM notes LIMIT 1');}catch(e){try{_db.exec('SELECT text FROM notes LIMIT 1');_db.run('ALTER TABLE notes RENAME COLUMN text TO content');}catch(e2){_db.run('ALTER TABLE notes ADD COLUMN content TEXT DEFAULT ""');}}
      _dbReady=true;console.log('[DB] Ready');return _idbSet(_db.export());
    });
  }).catch(function(e){console.error('[DB] Init failed:',e);});
}
function _saveDb(){if(_db)_idbSet(_db.export());}
function toggleHistory(){var m=document.getElementById('historyModal');if(m.classList.contains('open')){m.classList.remove('open');}else{document.getElementById('history-search').value='';_loadAllHistory();renderHistoryList(_allHistory);m.classList.add('open');}}
function closeHistoryOutside(e){if(e.target===document.getElementById('historyModal'))toggleHistory();}
function _loadAllHistory(){if(!_dbReady||!_db){_allHistory=[];return;}try{var r=_db.exec('SELECT id,title,content,created_at FROM notes ORDER BY id DESC');if(r.length>0){var c=r[0].columns;_allHistory=r[0].values.map(function(v){var o={};for(var i=0;i<c.length;i++)o[c[i]]=v[i];return o;});}else _allHistory=[];}catch(e){_allHistory=[];}}
function renderHistoryList(items){var ct=document.getElementById('history-list');if(!items.length){ct.innerHTML='<div class="history-empty"><span class="empty-icon">📋</span>'+(I18N[_lang].historyEmpty||'')+'</div>';return;}var h='';for(var i=0;i<items.length;i++){var it=items[i],tm=it.created_at?it.created_at.substring(0,16):'';h+='<div class="history-item" data-id="'+it.id+'"><div class="history-item-text" onclick="loadHistoryNote('+it.id+')" style="flex:2"><div style="font-weight:600;font-size:13px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escapeHtml(it.title||I18N[_lang].unnamedNote)+'</div><div style="font-size:11px;color:#999;margin-top:2px;">'+escapeHtml(tm)+'</div></div><button class="btn btn-tertiary" style="padding:2px 8px;font-size:11px;" onclick="editHistoryTitle(event,'+it.id+')" data-i18n="btnEditTitle">编辑</button><button class="history-item-del" onclick="deleteHistoryItem('+it.id+')">&times;</button></div>';}ct.innerHTML=h;}
function filterHistory(){var kw=document.getElementById('history-search').value.toLowerCase();if(!kw){renderHistoryList(_allHistory);return;}renderHistoryList(_allHistory.filter(function(it){return(it.title||'').toLowerCase().indexOf(kw)!==-1||(it.content||'').toLowerCase().indexOf(kw)!==-1;}));}
function loadHistoryNote(id){if(!_dbReady||!_db)return;var r=_db.exec('SELECT title,content FROM notes WHERE id='+id);if(!r.length||!r[0].values.length)return;if(document.getElementById('note-input').value.trim()&&!confirm(I18N[_lang].loadConfirm))return;document.getElementById('note-input').value=r[0].values[0][1];var pt=document.querySelector('.page-title');if(pt)pt.textContent=r[0].values[0][0]||I18N[_lang].unnamedNote;_autoAnnotations=[];_manualAnnotations=[];_positioned=[];mergeAndRender();toggleHistory();}
function deleteHistoryItem(id){if(!_dbReady||!_db)return;_db.run('DELETE FROM notes WHERE id='+id);_saveDb();_loadAllHistory();var kw=document.getElementById('history-search').value.toLowerCase();if(kw)filterHistory();else renderHistoryList(_allHistory);}
function editHistoryTitle(e,id){e.stopPropagation();if(!_dbReady||!_db)return;var it=null;for(var i=0;i<_allHistory.length;i++){if(_allHistory[i].id===id){it=_allHistory[i];break;}}if(!it)return;var nt=prompt(I18N[_lang].editTitle||'',it.title||'');if(nt===null)return;nt=nt.trim()||I18N[_lang].unnamedNote;_db.run('UPDATE notes SET title=? WHERE id=?',[nt,id]);_saveDb();_loadAllHistory();var kw=document.getElementById('history-search').value.toLowerCase();if(kw)filterHistory();else renderHistoryList(_allHistory);}
function clearAllHistory(){if(!_dbReady||!_db)return;if(!confirm(_lang==='zh'?'确认清空全部历史记录？':'Clear all history?'))return;_db.run('DELETE FROM notes');_saveDb();_allHistory=[];renderHistoryList([]);}

/* ── 设置弹窗 ─────────────────────────── */
function toggleSettings(){var m=document.getElementById('settingsModal');if(!m.classList.contains('open'))getSettingsAndApply();m.classList.toggle('open');}
function closeSettingsOutside(e){if(e.target===document.getElementById('settingsModal'))toggleSettings();}

/* ── 知识库管理（对接 rag.js） ────────── */
function toggleKB(){var m=document.getElementById('kbModal');if(m.classList.contains('open')){m.classList.remove('open');}else{m.classList.add('open');refreshKBList();}}
function closeKBOutside(e){if(e.target===document.getElementById('kbModal'))toggleKB();}
async function refreshKBList(){try{var docs=await ragListDocuments();renderKBList(docs);}catch(e){renderKBList([]);}}
function renderKBList(docs){var ct=document.getElementById('kb-list');if(!docs||!docs.length){ct.innerHTML='<div class="kb-empty">'+(I18N[_lang].kbEmpty||'')+'</div>';return;}var h='';for(var i=0;i<docs.length;i++){var d=docs[i];h+='<div class="kb-item"><div class="kb-item-name" title="'+escapeHtml(d.filename)+'">'+escapeHtml(d.filename)+'</div><div class="kb-item-info">'+d.chunks+' chunks</div><button class="kb-item-del" onclick="deleteKBDoc(\''+escapeHtml(d.filename).replace(/'/g,"\\'")+'\')">&times;</button></div>';}ct.innerHTML=h;}
async function uploadKBFile(input){var file=input.files[0];if(!file)return;var st=document.getElementById('kb-status');try{var r=await ragUploadFile(file,function(p){if(st)st.textContent=p.message||p.stage;});alert((I18N[_lang].kbUploadSuccess||'')+'：'+r.filename+'（'+r.chunks+' 片段）');refreshKBList();}catch(err){alert((I18N[_lang].kbUploadFail||'')+'：'+err.message);}finally{if(st)st.textContent='';input.value='';}}
async function deleteKBDoc(fn){if(!confirm(I18N[_lang].kbDeleteConfirm||''))return;try{await ragDeleteDocument(fn);refreshKBList();}catch(e){alert('删除失败：'+e.message);}}
async function clearAllKB(){if(!confirm(I18N[_lang].kbClearConfirm||''))return;try{await ragClearAll();refreshKBList();alert(I18N[_lang].kbCleared||'');}catch(e){alert('清空失败：'+e.message);}}

/* ── 页面加载 ─────────────────────────── */
window.addEventListener('DOMContentLoaded', function() {
  initDatabase(); _restoreTheme(); applyI18n();
  ['setting-api-base','setting-api-key','setting-model','setting-top-n'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('change',onSettingsSave);});
  var elR=document.getElementById('setting-rag-enabled');if(elR)elR.addEventListener('change',onSettingsSave);
});
