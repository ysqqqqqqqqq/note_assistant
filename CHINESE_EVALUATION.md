# 中文数据集与 BGE 实测报告

## 数据与实验约束

36篇虚构中文产品笔记，72道问题。开发集36题（30有答案/6无答案），锁定测试集36题（30有答案/6无答案），按12个主题家族拆分6/6。含同义表达、否定、流程、跨版本双来源及同领域无答案。所有事实数值是人为设定，参考答案不输入检索。

初稿曾按topic限制每道题的候选范围，评分前发现过于简单，因此单独保存初稿，改用v2并重新冻结。正式评测普通题只过滤当前版本（24篇候选），跨版本题检索全库（36篇）。过滤条件是评测提供的，不评价自然语言过滤解析。

模型为真实 BAAI/bge-small-zh-v1.5 与 BAAI/bge-reranker-base。重排采用原始logit而非概率；模型冷启动耗时单列，不包括在下表中。正式测试集仅在开发集选择参数并保存selection.json后读取，结果出来后未据此继续调参。

## 锁定测试结果

| 模式 | Recall@3 | MRR | nDCG@3 | 完整证据召回率 | 无答案正确拒答 | 中位耗时ms |
|---|---:|---:|---:|---:|---:|---:|
| BM25 | 96.7% | 0.889 | 0.909 | 96.7% | 0% | 0.3 |
| BGE Hybrid | 96.7% | 0.967 | 0.967 | 96.7% | 0% | 3.6 |
| BGE Hybrid + Rerank | 96.7% | 0.978 | 0.955 | 93.3% | 0% | 63.4 |
| BGE Rerank calibrated | 83.3% | 0.867 | 0.838 | 80.0% | 100% | 61.8 |

## 如何使用结果

- 偏召回：使用 `.env.bge-recall.example`。本集混合检索排序提升、召回保持，延迟较低；但不能可靠拒答同领域无答案问题。
- 偏谨慎：使用 `.env.bge-cautious.example`。原始重排分数阈值为0，来自开发集固定网格[-∞,-8,-4,0,4,8]，目标为有答案Recall与无答案拒答率的等权平均。开发集选择并不保证在其他领域最优。
- 不默认启用重排：无阈值重排的MRR略升，但nDCG和完整证据召回低于不重排，而且耗时显著增加。它不是本集的无条件优胜者。
- 谨慎模式不是“更聪明”：它漏掉更多可回答证据，测试集完整证据召回80%，用户应根据误答与漏答成本选择。
- 本次未改变原有默认BM25，也没有修改用户生成API密钥。模型已保存在交付目录outputs/models，两份配置写入本机绝对路径。

## 开发集阈值选择

| raw logit阈值 | Recall@3 | 无答案拒答率 | 平衡目标 |
|---|---:|---:|---:|
| -1000000000.0 | 86.7% | 0% | 0.433 |
| -8.0 | 86.7% | 0% | 0.433 |
| -4.0 | 86.7% | 67% | 0.767 |
| 0.0 | 83.3% | 100% | 0.917 |
| 4.0 | 48.3% | 100% | 0.742 |
| 8.0 | 20.0% | 100% | 0.600 |

## 逐题测试结果

| 题目 | 类型 | 期望来源 | BM25 | 混合 | 重排 | 谨慎 |
|---|---|---|---|---|---|---|
| 索引规范v2：增量索引的触发间隔是多少？ | direct | index-v2.md | index-v2.md, rerank-v2.md, index-流程.md | index-v2.md, rerank-v2.md, index-流程.md | index-v2.md, embedding-v2.md, citation-v2.md | index-v2.md |
| 新内容通常隔多久会进入增量构建流程？ | paraphrase | index-v2.md | index-v2.md, export-v2.md, filter-流程.md | index-v2.md, filter-流程.md, rerank-v2.md | index-v2.md, auth-v2.md, upload-流程.md | 无结果 |
| 构建失败会替换当前可用索引吗？ | negation | index-v2.md | index-v2.md, export-流程.md, export-v2.md | index-v2.md, index-流程.md, upload-流程.md | index-v2.md, index-流程.md, upload-流程.md | index-v2.md, index-流程.md |
| 新索引在什么条件下切换，切换后广播什么？ | procedure | index-流程.md | index-流程.md, index-v2.md, upload-流程.md | index-流程.md, index-v2.md, upload-流程.md | index-流程.md, index-v2.md, backup-流程.md | index-流程.md |
| 索引的v1和v2数量或时长规定分别是什么？ | cross_version | index-v2.md, index-v1.md | index-v1.md, index-v2.md, index-流程.md | index-v1.md, index-v2.md, citation-v1.md | index-v1.md, job-v1.md, citation-v1.md | index-v1.md, job-v1.md, citation-v1.md |
| 索引服务器采购价格是多少？ | unanswerable | 无答案 | index-v2.md, rewrite-流程.md, index-流程.md | index-v2.md, index-流程.md, rewrite-流程.md | cache-流程.md, rewrite-流程.md, index-流程.md | 无结果 |
| 引用规范v2：一条答案最多展示多少个来源？ | direct | citation-v2.md | citation-v2.md, citation-流程.md, upload-v2.md | citation-v2.md, upload-v2.md, rewrite-v2.md | citation-v2.md, job-v2.md, filter-v2.md | citation-v2.md, job-v2.md, filter-v2.md |
| 回答旁边最多列出几个参考出处？ | paraphrase | citation-v2.md | citation-流程.md, upload-v2.md, citation-v2.md | citation-v2.md, citation-流程.md, upload-v2.md | citation-v2.md, rewrite-v2.md, filter-v2.md | citation-v2.md |
| 虚构来源编号可以显示已验证吗？ | negation | citation-v2.md | citation-v2.md, citation-流程.md | citation-v2.md, citation-流程.md, embedding-流程.md | citation-v2.md, citation-流程.md, index-流程.md | citation-v2.md |
| 引用检查失败后如何展示回答和问题编号？ | procedure | citation-流程.md | citation-流程.md, citation-v2.md, rewrite-v2.md | citation-流程.md, citation-v2.md, rewrite-流程.md | citation-流程.md, citation-v2.md, index-流程.md | citation-流程.md |
| 引用的v1和v2数量或时长规定分别是什么？ | cross_version | citation-v2.md, citation-v1.md | citation-v1.md, citation-v2.md, citation-流程.md | citation-v1.md, citation-v2.md, index-v1.md | citation-v1.md, index-v1.md, job-v1.md | citation-v1.md, index-v1.md, job-v1.md |
| 引用系统获得过哪些国际奖项？ | unanswerable | 无答案 | citation-v2.md, citation-流程.md | citation-v2.md, citation-流程.md, index-流程.md | citation-流程.md, export-v2.md, rerank-v2.md | 无结果 |
| 过滤规范v2：文件过滤最多选择几个文件名？ | direct | filter-v2.md | filter-v2.md, upload-v2.md, job-v2.md | filter-v2.md, upload-v2.md, filter-流程.md | filter-v2.md, citation-v2.md, job-v2.md | filter-v2.md, citation-v2.md, job-v2.md |
| 限定资料范围时一次可以勾选几份文件？ | paraphrase | filter-v2.md | index-v2.md, export-流程.md, filter-v2.md | filter-v2.md, upload-v2.md, index-v2.md | filter-v2.md, job-v2.md, rerank-v2.md | 无结果 |
| 没有过滤条件时能跳过权限检查吗？ | negation | filter-v2.md | filter-v2.md, filter-流程.md, upload-流程.md | filter-v2.md, filter-流程.md, rewrite-v2.md | filter-v2.md, filter-流程.md, rewrite-流程.md | filter-v2.md |
| 权限过滤在排序之前还是之后执行？ | procedure | filter-流程.md | filter-流程.md, filter-v2.md, upload-v2.md | filter-流程.md, filter-v2.md, rerank-流程.md | filter-流程.md, filter-v2.md, rerank-v2.md | filter-流程.md |
| 过滤的v1和v2数量或时长规定分别是什么？ | cross_version | filter-v2.md, filter-v1.md | filter-v1.md, filter-v2.md, filter-流程.md | filter-v1.md, filter-v2.md, filter-流程.md | filter-v1.md, filter-v2.md, job-v1.md | filter-v1.md, filter-v2.md, job-v1.md |
| 过滤模块的源代码有多少行？ | unanswerable | 无答案 | filter-v2.md, filter-流程.md | filter-v2.md, filter-流程.md, embedding-流程.md | filter-v2.md, citation-v2.md, embedding-v2.md | 无结果 |
| 导出规范v2：一次最多导出多少张批注卡片？ | direct | export-v2.md | export-v2.md, index-v2.md, export-流程.md | export-v2.md, upload-v2.md, index-v2.md | export-v2.md, citation-v2.md, job-v2.md | export-v2.md, citation-v2.md, job-v2.md |
| 打包导出一批注释时数量上限是多少？ | paraphrase | export-v2.md | export-v2.md, export-流程.md, rerank-v2.md | export-v2.md, rerank-v2.md, export-流程.md | export-v2.md, job-v2.md, rerank-v2.md | export-v2.md |
| 导出失败会丢失当前编辑内容吗？ | negation | export-v2.md | export-v2.md, backup-流程.md, export-流程.md | export-v2.md, export-流程.md, job-流程.md | export-v2.md, export-流程.md, backup-流程.md | export-v2.md, export-流程.md |
| 导出过程中何时替换目标文件？ | procedure | export-流程.md | export-流程.md, export-v2.md, filter-v2.md | export-流程.md, upload-流程.md, export-v2.md | export-流程.md, upload-流程.md, index-v2.md | export-流程.md |
| 导出的v1和v2数量或时长规定分别是什么？ | cross_version | export-v2.md, export-v1.md | export-v1.md, export-v2.md, export-流程.md | export-v1.md, export-v2.md, export-流程.md | export-v1.md, index-v1.md, export-v2.md | export-v1.md, index-v1.md, export-v2.md |
| 导出文件的平均压缩率是多少？ | unanswerable | 无答案 | export-流程.md, export-v2.md, filter-v2.md | export-流程.md, export-v2.md, upload-v2.md | export-v2.md, upload-v2.md, export-流程.md | 无结果 |
| 查询改写规范v2：一个问题最多生成几条改写？ | direct | rewrite-v2.md | rewrite-v2.md, rewrite-流程.md, embedding-v2.md | rewrite-v2.md, rewrite-流程.md, embedding-v2.md | rewrite-v2.md, citation-v2.md, job-v2.md | rewrite-v2.md, citation-v2.md, job-v2.md |
| 系统会为一条检索问题准备多少种额外问法？ | paraphrase | rewrite-v2.md | rewrite-流程.md, rewrite-v2.md, embedding-流程.md | rewrite-v2.md, citation-流程.md, embedding-流程.md | rewrite-流程.md, cache-流程.md, rewrite-v2.md | 无结果 |
| 改写能把不允许改成允许吗？ | negation | rewrite-v2.md | cache-v2.md, rewrite-v2.md, rewrite-流程.md | rewrite-v2.md, rewrite-流程.md, cache-v2.md | rewrite-v2.md, rewrite-流程.md, cache-v2.md | 无结果 |
| 改写服务超时后是否继续检索以及如何提示？ | procedure | rewrite-流程.md | rewrite-流程.md, rewrite-v2.md, job-流程.md | rewrite-流程.md, rewrite-v2.md, job-流程.md | rewrite-流程.md, cache-流程.md, upload-流程.md | rewrite-流程.md |
| 查询改写的v1和v2数量或时长规定分别是什么？ | cross_version | rewrite-v2.md, rewrite-v1.md | rewrite-v1.md, rewrite-v2.md, rewrite-流程.md | rewrite-v1.md, rewrite-v2.md, rewrite-流程.md | rewrite-v1.md, rewrite-v2.md, index-v1.md | rewrite-v1.md, rewrite-v2.md, index-v1.md |
| 查询改写每天消耗多少度电？ | unanswerable | 无答案 | rewrite-v2.md, rewrite-流程.md, cache-v2.md | rewrite-v2.md, rewrite-流程.md, cache-v2.md | rewrite-v2.md, rewrite-流程.md, cache-v2.md | 无结果 |
| 候选重排规范v2：最多送入多少个片段进行重排？ | direct | rerank-v2.md | rerank-v2.md, rerank-流程.md, upload-v2.md | rerank-v2.md, rerank-流程.md, export-v2.md | rerank-v2.md, job-v2.md, filter-v2.md | rerank-v2.md, job-v2.md, filter-v2.md |
| 重新排列召回结果时最多比较多少段资料？ | paraphrase | rerank-v2.md | rerank-流程.md, job-v2.md, auth-流程.md | rerank-流程.md, job-v2.md, export-v2.md | rerank-v2.md, job-v2.md, citation-v2.md | rerank-v2.md |
| 重排出错会自动发送到外部搜索吗？ | negation | rerank-v2.md | rerank-v2.md, rerank-流程.md, upload-v2.md | rerank-v2.md, rerank-流程.md, upload-v2.md | rerank-v2.md, rerank-流程.md, export-v2.md | rerank-v2.md |
| 重排器异常时使用什么排序并如何告知用户？ | procedure | rerank-流程.md | rerank-流程.md, rerank-v2.md, filter-流程.md | rerank-流程.md, rerank-v2.md, filter-流程.md | rerank-流程.md, rerank-v2.md, filter-流程.md | rerank-流程.md |
| 候选重排的v1和v2数量或时长规定分别是什么？ | cross_version | rerank-v2.md, rerank-v1.md | rerank-v1.md, rerank-v2.md, rerank-流程.md | rerank-v1.md, rerank-v2.md, rerank-流程.md | rerank-v1.md, rerank-v2.md, job-v1.md | rerank-v1.md, rerank-v2.md, job-v1.md |
| 重排服务的负责人手机号码是什么？ | unanswerable | 无答案 | index-v2.md, rerank-流程.md, rerank-v2.md | rerank-流程.md, rerank-v2.md, auth-流程.md | rerank-流程.md, rewrite-流程.md, job-流程.md | 无结果 |

## 验证与已知限制

- 数据集结构、主题分离、过滤与gold一致性、manifest哈希校验通过；28项Python和6项JavaScript测试通过。
- 为BGE增加查询前缀（不加到文档）、明确raw logit阈值及512 token截断配置；生产检索路径已接入，单元测试验证拒答阈值。
- 6道无答案题全部拒答只是小样本结果，不能当作100%可靠性承诺。数据是同一作者生成、主题结构类似，尚无真实笔记人工盲评。
- 本次评价检索，不是回答生成。否定题只验证是否找到否定证据，没有验证生成模型是否正确保留否定。Faithfulness与answer relevance没有真实生成评分。
- Query Rewrite没有调用真实生成服务，本轮所有模式都使用原始问题；不能把混合模型收益算作改写收益。
- 当前0.35 dense门槛固定，未在测试集调参；此次仅选择最终重排拒答阈值。
- 语料较短，跨版本任务考察双来源，不代表长文档多跳推理已经解决。

## 复现

在应用目录运行：
```powershell
python chinese_benchmark.py --data eval/chinese_v2 --dense "BAAI/bge-small-zh-v1.5" --reranker "BAAI/bge-reranker-base" --out eval/chinese-results
```

完整开发/测试逐题JSON及selection.json附在数据集包。源代码包不包含约1GB模型权重；可从模型发布方获取，或将命令中的模型标识替换为自己电脑上的模型目录。

补充验证：真实BGE模型在HTTP接口下完成有答案与无答案检索验证；当时使用本地权重和谨慎配置。
