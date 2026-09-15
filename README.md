# Note Assistant

面向技术笔记的检索增强批注应用。保留笔记编辑、手工批注、历史记录、PNG/Word 导出和中英切换，增加本机混合检索、来源证据与流式批注。

## 运行

需要 Python 3.10+。在仓库根目录执行：

```powershell
cd "note_assistant - git"
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python server.py
```

打开 http://127.0.0.1:5000 。页面设置中填写兼容 Chat Completions 的 API 地址、模型名和自己的 Key。曾验证智谱地址 `https://open.bigmodel.cn/api/paas/v4`、模型 `glm-4-flash-250414`；实际可用性取决于服务商。

开启“优先使用本地 RAG 知识库”和“本机增强检索”，在知识库面板上传文档；不配置生成模型也能测试检索。默认未启用向量和重排模型时使用 BM25。浏览器原有库与本机服务库独立，不会自动迁移。

## 可选中文 BGE

```powershell
.\.venv\Scripts\python -m pip install -r requirements-models.txt
```

准备 `BAAI/bge-small-zh-v1.5` 和可选的 `BAAI/bge-reranker-base` 权重，放在应用目录的 `models/` 下，或把示例配置中的路径改成自己的本地路径。权重不包含在仓库内。

选择一种配置复制为 `.env`，已有配置时先备份，修改后重启服务：

- `.env.bge-recall.example`：BGE Dense + BM25，侧重召回。
- `.env.bge-cautious.example`：加入重排和分数阈值0；阈值需要针对数据校准。
- `.env.bge-adaptive.example`：满足排序一致条件时跳过重排，未配置拒答阈值。

`.env.example` 提供基础配置。页面设置与后端 `/annotate` 配置独立；后端历史变量名为 `DASHSCOPE_API_KEY`，接口和模型由 `LLM_API_BASE`、`LLM_MODEL` 控制。评测脚本 `answer_pilot.py` 使用 `ZHIPU_API_KEY`，不要把真实值提交到 Git。

## 架构

```text
原页面 → rag-backend.js → Flask → 模块化 Pipeline
文档 → 边界切片和偏移 → SQLite
查询 → 原查询和可选改写 → 元数据过滤 → BM25 + Dense
     → RRF 融合 → 可选 Cross-encoder 重排和阈值检查
     → 去重和可选邻块 → 原文压缩 → 来源编号与 trace
     → 模型流式批注 → 引用编号检查和可展开证据
```

- 查询改写保留原问题，保护部分标识符和数字，改写总权重受限。
- 元数据过滤先于排序；它不是完整用户认证或权限系统。
- 精确保存摘录区间，同源邻块合并时检查重叠一致性，并扣除重复引用区间。
- `RAG_TOP_K`、`RAG_CANDIDATE_K`、`RAG_CONTEXT_CHARS` 等可配置。
- `RAG_NEIGHBOR_CHUNKS=0/1/2` 控制邻块补全，默认0。
- `RAG_RERANK_MODE=always/adaptive` 控制重排；有拒答阈值时不能跳过校验。
- 谨慎模式下模型缺失、推理失败、异常分数或语言不适配会停止生成，返回 `verification_unavailable`；无候选则返回 `no_evidence`。普通无阈值模式保留检索回退。
- 解释卡片支持 SSE 增量显示、取消和未完成标记。后端 `/annotate` 仍返回 JSON。

## 接口与代码

`/kb/upload`、`/kb/list`、`/kb/delete`、`/kb/clear` 管理本机库；`/rag/search` 返回检索结果；`/rag/status` 返回模型与运行状态。

`rag_engine/` 包含配置、分词、BM25、查询、策略、引用和管线；`assets/` 包含页面、后端适配器及流式解析。服务默认绑定本机回环地址，不建议直接公开暴露。

## 测试与评测

在应用目录运行：

```powershell
python -m unittest discover -s tests
node --test tests/stream.test.cjs tests/browser.test.cjs tests/adapter.test.cjs
python chinese_benchmark.py --dense ./models/bge-small-zh-v1.5 --reranker ./models/bge-reranker-base --out ./outputs/chinese
```

最近验证：41 项 Python 和10项 JavaScript测试通过；真实BGE HTTP检索检查通过。中文合成数据在 `eval/chinese_v2`，含36篇文档、开发集与测试集各36题，哈希用于检测文件变更。已反复使用的测试数据属于回归集，不是新盲测。

详细实验结论见 [docs/EVALUATION.md](docs/EVALUATION.md)。不得把小样本正确率当成真实用户总体准确率，也不得把引用编号合法当成事实支持保证。

## 局限和数据边界

当前主要适合个人小知识库：仍全量扫描候选，向量缓存不持久化，更新文档会较广泛清缓存，推理期间的锁限制并发。尚无生产规模验证。引用只检查来源编号，尚未完整核验逐句事实或组合引用。

笔记历史及页面 API 设置存于浏览器，本机知识库存在本地 SQLite。调用外部生成或改写模型会发送相应笔记片段或查询。仓库不包含真实密钥、私人笔记、数据库、日志、模型权重或个人简历。

许可证见 [LICENSE](note_assistant%20-%20git/LICENSE)。
