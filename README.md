# Note Annotation Tool / 笔记智能批注工具

A privacy-first, browser-based note annotation tool with AI-powered term extraction and RAG-enhanced explanations. All data stays in your browser — nothing is uploaded to any server.

一款隐私优先的浏览器端笔记批注工具，支持 AI 术语提取与 RAG 知识库增强释义。所有数据保存在浏览器本地，不会上传任何内容到外部服务器。

## Features / 功能

- **AI Annotation** — Automatically extracts technical terms and key sentences, generates explanations via LLM API
- **RAG Knowledge Base** — Upload documents to build a local vector knowledge base; annotations prioritize local KB context before falling back to LLM
- **Text Denoise** — Clean up speech-to-text artifacts (filler words, transitions)
- **Manual Annotations** — Add custom term/sentence annotations with your own explanations
- **Note History** — Save notes to browser-local SQLite (sql.js + IndexedDB); search, edit titles, load previous notes
- **Export** — Export annotated notes as PNG image or Word (.docx) document
- **Bilingual UI** — Chinese / English interface switch
- **Theme Colors** — 5 built-in theme colors (blue, green, pink, black, red)
- **Privacy First** — Zero tracking, zero telemetry, all data in browser IndexedDB

## Quick Start / 快速开始

### Pure Frontend Mode / 纯前端模式

> **Important**: You must use a local HTTP server. Opening `index.html` directly via `file://` will not work due to browser security restrictions on WASM and ES modules.
>
> **重要**：必须通过本地 HTTP 服务器访问。直接双击 `index.html` 打开会因浏览器安全限制导致 WASM 和 ES 模块无法加载。

1. Clone or download this repository
2. Start a local HTTP server:
   ```bash
   python -m http.server 8080
   ```
3. Open `http://localhost:8080` in a modern browser (Chrome / Edge / Firefox recommended)
4. Click the **Settings** (⚙) button to configure your LLM API:
   - **API Base URL** — e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - **API Key** — your LLM provider's API key
   - **Model Name** — e.g. `qwen-plus`, `gpt-4o`, etc.
5. Start using!

### Backend Mode (Advanced RAG) / 后端模式

For enhanced RAG with ChromaDB vector store:

1. Copy `.env.example` to `.env` and fill in your API key
2. Install dependencies: `pip install -r requirements.txt`
3. Run: `python server.py`
4. Open `http://127.0.0.1:5000` in your browser

## Knowledge Base / 知识库

The built-in RAG knowledge base runs entirely in the browser:

1. Click the **Knowledge Base** (📚) button
2. Upload `.txt`, `.md`, or `.csv` files
3. The tool will chunk text, compute embeddings (via `@xenova/transformers`), and store vectors locally
4. When generating annotations, relevant KB context is retrieved and used to enhance explanations

### Embedding Model Setup / 嵌入模型配置

The RAG feature requires a local embedding model. Download the model files and place them in the following directory structure:

RAG 功能需要本地嵌入模型。请下载模型文件并按以下目录结构放置：

```
assets/models/Xenova/all-MiniLM-L6-v2/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
── model.json
```

Download from: https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main

> **Note**: The model is ~30MB. Once loaded, it is cached by the browser for offline use.
>
> **提示**：模型约 30MB。首次加载后浏览器会缓存，后续可离线使用。

### Clear Knowledge Base

Click the **"Clear KB"** button in the knowledge base panel to delete all local vector data.

## Project Structure / 项目结构

```
./
├── index.html              # Main application (HTML + CSS)
├── assets/
│   ├── app.js              # Core application logic
│   ├── rag.js              # RAG knowledge base engine
│   ├── html-to-image.min.js
│   ├── sql-wasm.js
│   ├── sql-wasm.wasm
│   ├── docx.umd.js
│   ── models/             # Embedding model (download separately)
│       └── Xenova/
│           └── all-MiniLM-L6-v2/
├── server.py               # (Optional) Flask backend for advanced RAG
├── main.py                 # (Optional) Standalone RAG pipeline script
├── requirements.txt        # Python dependencies (for backend mode)
├── .env.example            # Environment variable template
├── .gitignore
└── LICENSE
```

## Configuration / 配置

### Frontend Settings (in-browser)

All API configuration is done through the Settings panel in the browser UI:

| Setting | Description | Default |
|---------|-------------|---------|
| API Base URL | LLM API endpoint | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| API Key | Your API key (stored in localStorage only) | *(empty)* |
| Model Name | LLM model identifier | `qwen-plus` |
| RAG Enabled | Prioritize local KB for explanations | `false` |
| Top-N | Number of KB chunks to retrieve | `3` |

### Backend Configuration

For backend mode, copy `.env.example` to `.env`:

```
DASHSCOPE_API_KEY=your-api-key-here
```

## Privacy / 隐私说明

- **No tracking** — Zero analytics, telemetry, or user data collection
- **Local storage only** — All notes, history, and knowledge base data are stored in your browser's IndexedDB
- **No auto-upload** — Text content is only sent to the LLM API you explicitly configure
- **Clear data** — Clearing browser site data will erase all local databases
- **API keys** — Stored in browser localStorage only, never embedded in source code

## Browser Compatibility / 浏览器兼容性

- Chrome 90+ / Edge 90+ / Firefox 90+ (recommended)
- Requires IndexedDB and WebAssembly support
- **Must be served via HTTP** — `file://` protocol will not work due to browser security restrictions on WASM and ES modules

## License / 开源协议

MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Third-party Dependencies / 第三方依赖

| Library | License | Purpose |
|---------|---------|---------|
| [sql.js](https://github.com/sql-js/sql.js) | MIT | SQLite in browser |
| [html-to-image](https://github.com/bubkoo/html-to-image) | MIT | PNG export |
| [docx](https://github.com/dolanmiu/docx) | MIT | Word export |
| [@xenova/transformers](https://github.com/xenova/transformers.js) | Apache 2.0 | Browser embeddings |
