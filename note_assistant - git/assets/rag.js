/* ═══════════════════════════════════════════════════════
 * RAG Knowledge Base Engine
 * - Embedding: @xenova/transformers (all-MiniLM-L6-v2)
 * - Storage: IndexedDB (vectors + chunks)
 * - Retrieval: Cosine similarity
 * ═══════════════════════════════════════════════════════ */

/* ── 常量 ──────────────────────────────── */
var RAG_DB_NAME = 'note_tool_rag_db';
var RAG_DB_VERSION = 1;
var RAG_CHUNK_SIZE = 500;
var RAG_CHUNK_OVERLAP = 100;
var RAG_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/* ── 嵌入模型（惰性加载） ─────────────── */
var _embedder = null;
var _embedModelId = 'Xenova/all-MiniLM-L6-v2';

/**
 * 初始化嵌入模型（懒加载，首次调用时从 HuggingFace 下载并缓存）
 * @param {Function} onProgress - 进度回调 function({ status, progress })
 * @returns {Promise<object>} 嵌入模型实例
 */
async function ragInitEmbedder(onProgress) {
  if (_embedder) return _embedder;
  try {
    if (typeof window._transformersPipeline === 'undefined') {
      // 动态加载 @xenova/transformers（公开 CDN）
      var module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      window._transformersPipeline = module.pipeline;
    }
    if (onProgress) onProgress({ status: 'loading', progress: 0 });
    _embedder = await window._transformersPipeline('feature-extraction', _embedModelId, {
      config: {
        model: {
          url: './assets/models/' + _embedModelId + '/'
        }
      },
      progress_callback: function(data) {
        if (data.status === 'progress' && onProgress) {
          onProgress({ status: 'downloading', progress: Math.round(data.progress || 0) });
        }
      }
    });
    if (onProgress) onProgress({ status: 'ready' });
    return _embedder;
  } catch (err) {
    console.error('[RAG] 嵌入模型加载失败:', err);
    if (onProgress) onProgress({ status: 'failed', error: err.message });
    throw err;
  }
}

/**
 * 计算文本的嵌入向量
 * @param {string} text - 输入文本
 * @returns {Promise<Float32Array>} 嵌入向量
 */
async function ragEmbedText(text) {
  if (!_embedder) throw new Error('嵌入模型未初始化');
  var output = await _embedder(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * 批量计算嵌入向量
 * @param {string[]} texts - 文本数组
 * @returns {Promise<Float32Array[]>} 嵌入向量数组
 */
async function ragEmbedBatch(texts) {
  if (!_embedder) throw new Error('嵌入模型未初始化');
  var results = [];
  for (var i = 0; i < texts.length; i++) {
    var vec = await ragEmbedText(texts[i]);
    results.push(vec);
    // 每 10 个让出主线程，避免 UI 卡顿
    if (i % 10 === 9) await new Promise(function(r) { setTimeout(r, 0); });
  }
  return results;
}

/* ── 文本分块（段落分割 + 重叠窗口） ──── */

/**
 * 将文本按段落切分为重叠窗口片段
 * @param {string} text - 原始文本
 * @param {number} chunkSize - 每块最大字符数
 * @param {number} overlap - 重叠字符数
 * @returns {string[]} 分块数组
 */
function ragChunkText(text, chunkSize, overlap) {
  chunkSize = chunkSize || RAG_CHUNK_SIZE;
  overlap = overlap || RAG_CHUNK_OVERLAP;
  if (!text || !text.trim()) return [];

  // 先按段落分割
  var paragraphs = text.split(/\n\s*\n/).filter(function(p) { return p.trim(); });
  var chunks = [];
  var currentChunk = '';

  for (var i = 0; i < paragraphs.length; i++) {
    var para = paragraphs[i].trim();
    if (!para) continue;

    // 如果单段落超过 chunkSize，强制按句号/句号分割
    if (para.length > chunkSize) {
      if (currentChunk) { chunks.push(currentChunk.trim()); currentChunk = ''; }
      var sentences = para.split(/(?<=[。！？.!?\n])/);
      var sentChunk = '';
      for (var j = 0; j < sentences.length; j++) {
        if ((sentChunk + sentences[j]).length > chunkSize) {
          if (sentChunk) chunks.push(sentChunk.trim());
          sentChunk = sentences[j];
        } else {
          sentChunk += sentences[j];
        }
      }
      if (sentChunk.trim()) currentChunk = sentChunk.trim();
      continue;
    }

    // 累加段落，超过 chunkSize 则切块
    if ((currentChunk + '\n' + para).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      // 重叠窗口：保留上一块尾部内容
      if (overlap > 0 && currentChunk.length > overlap) {
        currentChunk = currentChunk.slice(-overlap) + '\n' + para;
      } else {
        currentChunk = para;
      }
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + para : para;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

/* ── IndexedDB 向量存储 ──────────────── */

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
 * 存储分块和向量到 IndexedDB
 * @param {string} filename - 文件名
 * @param {string[]} chunks - 文本分块
 * @param {Float32Array[]} vectors - 对应的嵌入向量
 */
async function ragStoreChunks(filename, chunks, vectors) {
  var db = await ragOpenDB();
  var tx = db.transaction(['chunks', 'documents'], 'readwrite');
  var chunkStore = tx.objectStore('chunks');
  var docStore = tx.objectStore('documents');

  // 存储文档元信息
  docStore.put({
    filename: filename,
    chunks: chunks.length,
    uploadedAt: new Date().toISOString()
  });

  // 存储每个分块及其向量
  for (var i = 0; i < chunks.length; i++) {
    chunkStore.add({
      text: chunks[i],
      embedding: Array.from(vectors[i]),
      sourceFile: filename,
      createdAt: new Date().toISOString()
    });
  }

  return new Promise(function(resolve, reject) {
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
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
  await new Promise(function(resolve) {
    req.onsuccess = function(event) {
      var cursor = event.target.result;
      if (cursor) {
        if (cursor.value.sourceFile === filename) cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });

  // 删除文档元信息
  docStore.delete(filename);

  return new Promise(function(resolve, reject) {
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
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
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
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

/* ── 余弦相似度检索 ─────────────────── */

/**
 * 从知识库检索与查询最相关的文本片段
 * @param {string} query - 查询文本
 * @param {number} topN - 返回条数
 * @returns {Promise<string>} 拼接后的参考上下文
 */
async function ragRetrieve(query, topN) {
  topN = topN || 3;
  var totalChunks = await ragGetTotalChunks();
  if (totalChunks === 0) return '';

  // 计算查询向量
  var queryVec = await ragEmbedText(query);

  // 读取所有分块
  var db = await ragOpenDB();
  var tx = db.transaction('chunks', 'readonly');
  var store = tx.objectStore('chunks');
  var allChunks = await new Promise(function(resolve, reject) {
    var req = store.getAll();
    req.onsuccess = function() { resolve(req.result || []); };
    req.onerror = function() { reject(req.error); };
  });

  if (!allChunks.length) return '';

  // 计算余弦相似度并排序
  var scored = allChunks.map(function(chunk) {
    var vec = new Float32Array(chunk.embedding);
    var sim = cosineSimilarity(queryVec, vec);
    return { text: chunk.text, score: sim };
  });
  scored.sort(function(a, b) { return b.score - a.score; });

  // 取 top-N 拼接
  var topChunks = scored.slice(0, topN);
  return topChunks.map(function(c) { return c.text; }).join('\n\n---\n\n');
}

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a, b) {
  var dot = 0, normA = 0, normB = 0;
  for (var i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  var denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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
 * 处理文件上传：读取 → 分块 → 嵌入 → 存储
 * @param {File} file - 用户上传的文件
 * @param {Function} onProgress - 进度回调 function({ stage, progress, message })
 * @returns {Promise<{filename: string, chunks: number}>}
 */
async function ragUploadFile(file, onProgress) {
  // 文件大小检查
  if (file.size > RAG_MAX_FILE_SIZE) {
    throw new Error('文件过大（' + (file.size / 1024 / 1024).toFixed(1) + 'MB），建议不超过 5MB');
  }

  // 1. 读取文件
  if (onProgress) onProgress({ stage: 'reading', message: '正在读取文件…' });
  var text = await ragReadFileText(file);
  if (!text || !text.trim()) throw new Error('文件内容为空');

  // 2. 分块
  if (onProgress) onProgress({ stage: 'chunking', message: '正在分块…' });
  var chunks = ragChunkText(text);
  if (!chunks.length) throw new Error('文件分块结果为空');

  // 3. 加载嵌入模型
  if (onProgress) onProgress({ stage: 'embedding', progress: 0, message: '正在计算嵌入向量…' });
  await ragInitEmbedder(function(p) {
    if (onProgress && p.status === 'downloading') {
      onProgress({ stage: 'embedding', progress: p.progress, message: '嵌入模型下载中 ' + p.progress + '%' });
    }
  });

  // 4. 批量嵌入
  var vectors = [];
  for (var i = 0; i < chunks.length; i++) {
    var vec = await ragEmbedText(chunks[i]);
    vectors.push(vec);
    if (onProgress) {
      var pct = Math.round(((i + 1) / chunks.length) * 100);
      onProgress({ stage: 'embedding', progress: pct, message: '嵌入计算 ' + pct + '% (' + (i + 1) + '/' + chunks.length + ')' });
    }
  }

  // 5. 存储到 IndexedDB
  if (onProgress) onProgress({ stage: 'storing', message: '正在保存到本地数据库…' });
  await ragStoreChunks(file.name, chunks, vectors);

  return { filename: file.name, chunks: chunks.length };
}
