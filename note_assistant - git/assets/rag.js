function ragMessage(zh,en) { return typeof _lang !== 'undefined' && _lang === 'en' ? en : zh; }
/* ═══════════════════════════════════════════════════════
 * RAG Knowledge Base Engine
 * - Storage: IndexedDB text chunks
 * - Retrieval: browser-side BM25
 * ═══════════════════════════════════════════════════════ */

/* ── 常量 ──────────────────────────────── */
var RAG_DB_NAME = 'note_tool_rag_db';
var RAG_DB_VERSION = 1;
var RAG_CHUNK_SIZE = 500;
var RAG_CHUNK_OVERLAP = 100;
var RAG_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
var _ragIndexCache = null;

/* ── 文本分块（段落分割 + 重叠窗口） ──── */

/**
 * 将文本按段落切分为重叠窗口片段
 * @param {string} text - 原始文本
 * @param {number} chunkSize - 每块最大字符数
 * @param {number} overlap - 重叠字符数
 * @returns {string[]} 分块数组
 */
function ragChunkText(text, chunkSize, overlap) {
  return ragChunkSpans(text, chunkSize, overlap).map(function(chunk){return chunk.text;});
}
function ragChunkSpans(text, chunkSize, overlap) {
  chunkSize = chunkSize === undefined ? RAG_CHUNK_SIZE : chunkSize;
  overlap = overlap === undefined ? RAG_CHUNK_OVERLAP : overlap;
  if (chunkSize < 1 || overlap < 0 || overlap >= chunkSize) throw new Error('Invalid chunk size / overlap');
  var chunks = [], start = 0;
  while (start < text.length) {
    var end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      var windowText = text.slice(start,end), matches = Array.from(windowText.matchAll(/[。！？.!?\n]/g));
      var good = matches.filter(function(m){return m.index+1 > Math.max(overlap,chunkSize/2);});
      if (good.length) end = start + good[good.length-1].index + 1;
    }
    if (text.slice(start,end).trim()) chunks.push({text:text.slice(start,end),start:start,end:end});
    if (end === text.length) break;
    start = end-overlap;
  }
  return chunks;
}

/* ── IndexedDB 分块存储 ──────────────── */

/**
 * 打开 RAG IndexedDB 数据库
 */
function ragOpenDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(RAG_DB_NAME, RAG_DB_VERSION);
    req.onupgradeneeded = function() {
      var db = req.result;
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'filename' });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

/**
 * 存储分块到 IndexedDB；保留旧向量字段以兼容已有浏览器数据
 * @param {string} filename - 文件名
 * @param {string[]} chunks - 文本分块
 * @param {Float32Array[]} vectors - 对应的嵌入向量
 */
async function ragStoreChunks(filename, chunks, vectors) {
  vectors=vectors||[];
  var db = await ragOpenDB();
  var tx = db.transaction(['chunks', 'documents'], 'readwrite');
  var chunkStore = tx.objectStore('chunks');
  var docStore = tx.objectStore('documents');

  var cursorRequest = chunkStore.openCursor();
  cursorRequest.onsuccess = function () {
    var cursor = cursorRequest.result;
    if (cursor) {
      if (cursor.value.sourceFile === filename) cursor.delete();
      cursor.continue();
      return;
    }
    docStore.put({filename:filename,chunks:chunks.length,uploadedAt:new Date().toISOString()});
    chunks.forEach(function(chunk,i) {
      var span=typeof chunk==='string'?{text:chunk}:chunk;
      chunkStore.add({text:span.text,embedding:vectors[i]?Array.from(vectors[i]):[],sourceFile:filename,
        start:Number.isInteger(span.start)?span.start:null,end:Number.isInteger(span.end)?span.end:null,createdAt:new Date().toISOString()});
    });
  };

  return new Promise(function(resolve, reject) {
    tx.oncomplete = function() { _ragIndexCache=null;resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error||new Error('Knowledge base write aborted')); };
  });
}

/**
 * 获取所有知识库文档列表
 * @returns {Promise<Array>} 文档列表
 */
async function ragListDocuments() {
  var db = await ragOpenDB();
  var tx = db.transaction('documents', 'readonly');
  var store = tx.objectStore('documents');
  return new Promise(function(resolve, reject) {
    var req = store.getAll();
    req.onsuccess = function() { resolve(req.result || []); };
    req.onerror = function() { reject(req.error); };
  });
}

/**
 * 删除指定文档及其所有分块向量
 * @param {string} filename - 文件名
 */
async function ragDeleteDocument(filename) {
  var db = await ragOpenDB();
  var tx = db.transaction(['chunks', 'documents'], 'readwrite');
  var chunkStore = tx.objectStore('chunks');
  var docStore = tx.objectStore('documents');

  // 删除该文档的所有分块（通过索引扫描）
  var req = chunkStore.openCursor();
  req.onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
          if (cursor.value.sourceFile === filename) cursor.delete();
          cursor.continue();
        } else docStore.delete(filename);
  };
  req.onerror = function(){/* IndexedDB aborts the transaction after a request error. */};

  return new Promise(function(resolve, reject) {
    tx.oncomplete = function() { _ragIndexCache=null;resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error||req.error||new Error('Knowledge base delete aborted')); };
  });
}

/**
 * 清空整个知识库
 */
async function ragClearAll() {
  var db = await ragOpenDB();
  var tx = db.transaction(['chunks', 'documents'], 'readwrite');
  tx.objectStore('chunks').clear();
  tx.objectStore('documents').clear();
  return new Promise(function(resolve, reject) {
    tx.oncomplete = function() { _ragIndexCache=null;resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error||new Error('Knowledge base clear aborted')); };
  });
}

/**
 * 获取知识库总分块数
 */
async function ragGetTotalChunks() {
  var db = await ragOpenDB();
  var tx = db.transaction('chunks', 'readonly');
  var store = tx.objectStore('chunks');
  return new Promise(function(resolve, reject) {
    var req = store.count();
    req.onsuccess = function() { resolve(req.result || 0); };
    req.onerror = function() { reject(req.error); };
  });
}

/* ── BM25 检索 ──────────────────────── */

/**
 * 从知识库检索与查询最相关的文本片段
 * @param {string} query - 查询文本
 * @param {number} topN - 返回条数
 * @returns {Promise<string>} 拼接后的参考上下文
 */
async function ragRetrieve(query, topN) {
  return (await ragRetrieveDetailedBrowser(query,topN)).context;
}
async function ragExportBackup() {
  var documents=await ragListDocuments(),index=await ragBrowserIndex();
  return {format:'note-assistant-browser-kb',version:1,exportedAt:new Date().toISOString(),
    documents:documents.map(function(doc){return {filename:doc.filename,chunks:index.docs
      .filter(function(item){return item.chunk.sourceFile===doc.filename;})
      .map(function(item){var c=item.chunk;return {text:c.text,start:c.start,end:c.end};})};})};
}
async function ragImportBackup(backup) {
  if(!backup||backup.format!=='note-assistant-browser-kb'||backup.version!==1||!Array.isArray(backup.documents))
    throw new Error(ragMessage('备份格式不正确','Invalid backup format'));
  var names=new Set(),total=0;
  backup.documents.forEach(function(doc){
    if(!doc||typeof doc.filename!=='string'||!doc.filename||doc.filename.length>255||names.has(doc.filename)||!Array.isArray(doc.chunks)||!doc.chunks.length)
      throw new Error(ragMessage('备份文档无效','Invalid backup document'));
    names.add(doc.filename);
    doc.chunks.forEach(function(c){
      if(!c||typeof c.text!=='string'||!c.text.trim()||c.text.length>10000)throw new Error(ragMessage('备份片段无效','Invalid backup chunk'));
      if((c.start!=null||c.end!=null)&&(!Number.isInteger(c.start)||c.start<0||!Number.isInteger(c.end)||c.end-c.start!==c.text.length))
        throw new Error(ragMessage('备份片段位置无效','Invalid backup chunk position'));
      total+=c.text.length;
    });
  });
  if(total>50*1024*1024)throw new Error(ragMessage('备份过大','Backup is too large'));
  var db=await ragOpenDB(),tx=db.transaction(['chunks','documents'],'readwrite');
  var chunks=tx.objectStore('chunks'),documents=tx.objectStore('documents'),cursor=chunks.openCursor();
  cursor.onsuccess=function(){
    var row=cursor.result;
    if(row){if(names.has(row.value.sourceFile))row.delete();row.continue();return;}
    backup.documents.forEach(function(doc){
      documents.put({filename:doc.filename,chunks:doc.chunks.length,uploadedAt:new Date().toISOString()});
      doc.chunks.forEach(function(c){chunks.add({text:c.text,sourceFile:doc.filename,embedding:[],
        start:Number.isInteger(c.start)?c.start:null,end:Number.isInteger(c.end)?c.end:null,createdAt:new Date().toISOString()});});
    });
  };
  return new Promise(function(resolve,reject){
    tx.oncomplete=function(){_ragIndexCache=null;resolve(backup.documents.length);};
    tx.onerror=function(){reject(tx.error);};
    tx.onabort=function(){reject(tx.error||new Error('Backup import aborted'));};
  });
}
function ragTokens(value) {
  var text=String(value||'').toLowerCase(),out=[];
  var stop=new Set(['a','an','the','is','are','and','or','of','to','in','for','with','what','how','does','do','it','by','on']);
  (text.match(/[a-z0-9_]+/g)||[]).forEach(function(word){if(!stop.has(word))out.push(word);});
  (text.match(/[\u3400-\u9fff]+/g)||[]).forEach(function(run){
    if(run.length===1)out.push(run);
    else for(var i=0;i<run.length-1;i++)out.push(run.slice(i,i+2));
  });
  return out;
}
function ragQueryTokens(query) {
  var stop=new Set(['什么','多少','如何','怎么','是否','请问','哪些','哪里','介绍','说明','一下','一个','关于','相关','内容','问题','可以','能够','的是']);
  return Array.from(new Set(ragTokens(query).filter(function(token){return !stop.has(token);}))).slice(0,80);
}
async function ragBrowserIndex() {
  if(_ragIndexCache)return _ragIndexCache;
  var db=await ragOpenDB(),tx=db.transaction('chunks','readonly');
  var chunks=await new Promise(function(resolve,reject){
    var req=tx.objectStore('chunks').getAll();
    req.onsuccess=function(){resolve(req.result||[]);};
    req.onerror=function(){reject(req.error);};
  });
  var docs=chunks.map(function(chunk){
    var counts=new Map();ragTokens(chunk.text).forEach(function(token){counts.set(token,(counts.get(token)||0)+1);});
    return {chunk:chunk,counts:counts,length:Array.from(counts.values()).reduce(function(a,b){return a+b;},0)};
  });
  var df=new Map();docs.forEach(function(doc){doc.counts.forEach(function(_,token){df.set(token,(df.get(token)||0)+1);});});
  _ragIndexCache={docs:docs,df:df,avgLength:docs.reduce(function(sum,doc){return sum+doc.length;},0)/Math.max(1,docs.length)||1};
  return _ragIndexCache;
}
async function ragRetrieveDetailedBrowser(query, topN, options) {
  options=options||{};if(options.signal)options.signal.throwIfAborted();
  topN=Math.max(1,Math.min(50,Number(topN)||3));
  var index=await ragBrowserIndex(),terms=ragQueryTokens(query),n=index.docs.length;
  if(options.signal)options.signal.throwIfAborted();
  if(!n||!terms.length)return {context:'',hits:[],trace:{warnings:[],candidates:0}};
  var scored=index.docs.map(function(doc){
    var score=0,matched=0;
    terms.forEach(function(token){
      var tf=doc.counts.get(token)||0;if(!tf)return;
      matched++;
      var df=index.df.get(token)||0,idf=Math.log(1+(n-df+0.5)/(df+0.5));
      score+=idf*tf*2.5/(tf+1.5*(0.25+0.75*doc.length/index.avgLength));
    });
    return {chunk:doc.chunk,score:score,matched:matched,coverage:matched/terms.length};
  }).filter(function(item){
    var exactIdentifier=terms.some(function(token){return /^[a-z0-9_]+$/.test(token)&&item.chunk.text.toLowerCase().includes(token);});
    return item.matched>0&&((item.coverage>=0.25&&(terms.length===1||item.matched>=2))||exactIdentifier);
  });
  scored.sort(function(a,b){return b.score-a.score||b.coverage-a.coverage;});
  var hits=scored.slice(0,topN).map(function(item,i){
    var chunk=item.chunk;
    return {text:chunk.text,source:chunk.sourceFile,score:item.score,coverage:item.coverage,chunkId:chunk.id,
      start:Number.isInteger(chunk.start)?chunk.start:null,end:Number.isInteger(chunk.end)?chunk.end:null,citation:'S'+(i+1)};
  });
  return {context:hits.map(function(hit){return '['+hit.citation+'] '+hit.source+' (片段 #'+hit.chunkId+')\n'+hit.text;}).join('\n\n---\n\n'),
    hits:hits,trace:{warnings:[],candidates:scored.length}};
}

/* ── 知识库文件上传处理 ─────────────── */

/**
 * 读取文件文本内容（自动处理编码）
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 文件文本内容
 */
function ragReadFileText(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function() { reject(new Error('文件读取失败')); };
    // 先尝试 UTF-8
    reader.readAsText(file, 'UTF-8');
  }).then(function(text) {
    // 检测是否包含乱码（简单启发式：大量替换字符）
    if (text.indexOf('\uFFFD') > -1) {
      // 尝试 GBK 重新读取
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = function() { reject(new Error('GBK 编码读取也失败')); };
        reader.readAsText(file, 'GBK');
      });
    }
    return text;
  });
}

/**
 * 处理文件上传：读取 → 分块 → 存储
 * @param {File} file - 用户上传的文件
 * @param {Function} onProgress - 进度回调 function({ stage, progress, message })
 * @returns {Promise<{filename: string, chunks: number}>}
 */
async function ragUploadFile(file, onProgress) {
  // 文件大小检查
  if (file.size > RAG_MAX_FILE_SIZE) {
    throw new Error(ragMessage('文件过大，建议不超过 5MB','File is too large; maximum recommended size is 5MB'));
  }

  // 1. 读取文件
  if (onProgress) onProgress({ stage: 'reading', message: ragMessage('正在读取文件…','Reading file…') });
  var text = await ragReadFileText(file);
  if (!text || !text.trim()) throw new Error(ragMessage('文件内容为空','File is empty'));

  // 2. 分块
  if (onProgress) onProgress({ stage: 'chunking', message: ragMessage('正在分块…','Splitting into chunks…') });
  var chunks = ragChunkSpans(text);
  if (!chunks.length) throw new Error(ragMessage('文件分块结果为空','No text chunks found'));
  // BM25 indexes stored text on demand; uploading never depends on a model download.
  if (onProgress) onProgress({ stage: 'storing', message: ragMessage('正在保存到本地数据库…','Saving to local database…') });
  await ragStoreChunks(file.name, chunks);

  return { filename: file.name, chunks: chunks.length };
}
