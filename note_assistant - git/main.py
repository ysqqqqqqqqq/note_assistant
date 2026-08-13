"""
笔记智能批注工具 — 完整脚本（RAG + HTML 注入 + 浏览器打开）

完整流程：
  1. 将 note_text 切分后存入 Chroma 向量库（每次运行先清空）
  2. 调用通义千问 qwen-turbo，用 PromptA 提取专有名词 & 关键句子
  3. 对每个条目做向量相似度检索，用 PromptB 生成释义
  4. 在原始 note_text 上定位每个条目首次出现的字符偏移
  5. 组装 annotations 数组
  6. 将 annotations JSON 注入 index.html 模板
  7. 写入最终 HTML 并用默认浏览器打开，脚本随即退出

运行方式：
  python main.py
"""

import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import webbrowser
import pyperclip
from pathlib import Path
from typing import List, Dict, Any, Optional

# ── 解决 Windows 下 SSL 证书验证失败问题 ──
# 最底层方案：让 ssl.create_default_context 返回不验证证书的上下文
# 这样 httpx / requests / urllib3 全部自动生效
import ssl as _ssl

_orig_create_default_context = _ssl.create_default_context

def _no_verify_create_default_context(*a, **kw):
    ctx = _orig_create_default_context(*a, **kw)
    ctx.check_hostname = False
    ctx.verify_mode = _ssl.CERT_NONE
    return ctx

_ssl.create_default_context = _no_verify_create_default_context

# 同时 patch httpx Client 确保 verify=False
import httpx

_orig_httpx_init = httpx.Client.__init__

def _patched_httpx_init(self, *a, **kw):
    kw.setdefault("verify", False)
    _orig_httpx_init(self, *a, **kw)

httpx.Client.__init__ = _patched_httpx_init

_orig_async_init = httpx.AsyncClient.__init__

def _patched_async_init(self, *a, **kw):
    kw.setdefault("verify", False)
    _orig_async_init(self, *a, **kw)

httpx.AsyncClient.__init__ = _patched_async_init

# dashscope SDK 底层使用 requests/urllib3，也禁用 SSL 验证
import requests
from requests.adapters import HTTPAdapter

_orig_requests_send = HTTPAdapter.send

def _patched_requests_send(self, request, **kw):
    kw["verify"] = False
    return _orig_requests_send(self, request, **kw)

HTTPAdapter.send = _patched_requests_send

os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""

from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# ──────────────────────────────────────────────
# 加载 .env（DASHSCOPE_API_KEY 等）
# ──────────────────────────────────────────────
load_dotenv()

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
if not DASHSCOPE_API_KEY:
    raise RuntimeError(
        "未在 .env 中找到 DASHSCOPE_API_KEY，请先复制 .env.example 为 .env 并填入密钥"
    )

# ──────────────────────────────────────────────
# 常量
# ──────────────────────────────────────────────
CHROMA_PERSIST_DIR: str = "./chroma_db"
COLLECTION_NAME: str = "note_collection"
EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"
LLM_MODEL_NAME: str = "qwen-turbo"
TOP_K: int = 3          # 相似度检索返回的片段数
CHUNK_SIZE: int = 1000  # 文本切分块大小
CHUNK_OVERLAP: int = 200  # 相邻块重叠字符数

# ──────────────────────────────────────────────
# Prompt 模板（保留占位符，不写死示例笔记）
# ──────────────────────────────────────────────

PROMPT_A: str = """任务目标：逐词完整扫描笔记全文，识别提取文本内所有专业技术术语；
核心目的：筛选文中陌生专业名词，用于生成注释，辅助学习者快速定位不懂的知识点；
覆盖领域：计算机科学、嵌入式开发、人工智能、机器学习、深度学习、计算机视觉、信号处理、大数据数据分析、机器人工程、自动化控制工程、金融量化工程。

前置兜底强制规则：
1. 遇到不确定是否属于专业术语的词汇，**默认判定为术语并提取，宁多勿少**；
2. 区分普通口语词汇与专业名词；仅通用日常助词、过渡语句排除，专业领域专有名词一律纳入提取范围。

严格遵循以下30大类强制提取标准，文本中出现符合任意一条定义的名词，必须100%提取；禁止主观筛选、禁止遗漏细分名词、禁止只提取顶层大类忽略下层细分概念：
① 机器学习基础算法
示例：有监督学习、无监督学习、半监督学习、强化学习、KMeans、KNN
② 深度学习网络结构与算法
示例：CNN、RNN、LSTM、Transformer、YOLO、自注意力机制
③ 数值优化与迭代算法
示例：梯度下降、随机梯度下降、牛顿法、拟牛顿法
④ 机器人导航、运动规划算法
示例：SLAM、A*路径规划、Dijkstra、避障算法、轨迹优化算法
⑤ 自动控制理论算法
示例：PID控制、模糊控制、自适应控制、滑模控制
 量化交易策略算法
示例：均值回归策略、套利策略、趋势策略、网格交易、高频交易策略
⑦ 计算机视觉专用方法
示例：图像分割、目标检测、特征匹配、光流法
⑧ 开发框架、第三方程序库
示例：scikit-learn、TensorFlow、PyTorch、Pandas、NumPy、OpenCV
 机器人/嵌入式系统软件平台
示例：ROS机器人操作系统、RTOS实时操作系统
⑩ 大模型与AI工具平台
示例：Qwen大模型、LLM、多模态大模型、标注仿真平台
⑪ 模型回归、分类评价指标
示例：MSE均方误差、MAE、RMSE、准确率、精确率、召回率、F1值
⑫ 损失函数与模型偏差概念
示例：交叉熵损失、L1损失、L2损失、偏差、方差
⑬ 金融收益类指标
示例：年化收益率、夏普比率、盈亏比
⑭ 金融风险类指标
示例：最大回撤、波动率、风险敞口
⑮ 数据集、样本相关概念
示例：数据集、训练集、测试集、验证集、样本、时序数据、K线、行情数据
⑯ 特征工程相关概念
示例：特征、标签、特征提取、特征选择、特征降维
⑰ 数据预处理方法
示例：数据清洗、数据降噪、归一化、标准化、离散化
⑱ 深度学习训练超参数
示例：学习率、迭代次数、批次大小BatchSize、epoch、dropout率
⑲ 自动控制系统可调参数
示例：比例系数、积分系数、微分系数、采样周期、阻尼系数
⑳ 基础数学、线性代数概念
示例：向量、矩阵、梯度、导数、特征值、协方差
㉑ 概率统计理论概念
示例：正态分布、泊松分布、期望、方差、概率、置信区间
㉒ 神经网络内部结构组件
示例：神经元、卷积核、池化层、激活函数、编码器、解码器
 机器人传感器、执行硬件
示例：伺服电机、减速器、激光雷达、IMU、里程计、机械臂、驱动器
㉔ 嵌入式硬件与外设组件
示例：单片机、MCU、编码器、总线、传感器模块
㉕ 信号处理相关概念
示例：时域、频域、滤波器、采样频率、傅里叶变换
 AI建模全流程名词
示例：数据采集、模型训练、模型验证、模型评估、模型推理、模型部署、参数调优
㉗ 机器人调试运维流程名词
示例：机器人标定、零位校准、轨迹调试
㉘ 量化投资回测流程名词
示例：策略回测、滑点模拟、风险评估
㉙ 通信与总线相关概念
示例：CAN总线、串口通信、以太网通信
㉚ 仿真与建模工具概念
示例：动力学仿真、数字孪生、系统建模

全局强制约束：
1. 全文逐词、逐句、逐段完整扫描；符合30大类任意一条标准必须提取；拿捏不准的名词一律提取，执行【宁多勿少】原则；
2. 顶层概念、细分概念、子名词全部提取；禁止只抓取大类名词，忽略细分术语；
3. 普通口语、过渡句、语气词、无效过渡废话不要放入terms；
4. 一条术语单独一条字符串，禁止多个术语合并放在同一个数组元素；
5. sentences仅提取：专业定义、原理描述、流程总结、核心结论句子；单纯举例、闲聊描述不提取；
6. 仅输出纯净JSON文本；禁止任何解释、思考过程、前言后语、```json markdown代码块标记；
7. 违反任意一条规则即视为任务执行失败。

输出固定JSON格式，key名称严禁修改：
{{
  "terms": ["提取到的专业术语1","提取到的专业术语2"],
  "sentences": ["关键核心句子1"]
}}

笔记文本：
{note_text}"""

PROMPT_B: str = """根据参考笔记片段，为目标内容生成简短解释。
适用领域：计算机、人工智能、机器人、金融相关笔记。

硬性规则：
1. 仅使用【参考笔记片段】里面存在的信息，严禁使用模型自身外部知识、常识、网络资料做额外补充。
2. 如果参考片段没有相关信息，直接回复：笔记内暂无相关说明
3. 解释控制在60‑120字，贴合技术/金融笔记语境，用词专业但易懂，只输出解释文本，不要开场白、不要多余符号。

待解释目标：{target}
参考笔记片段：{context}"""


# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

def extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """
    从 LLM 返回的文本中提取 JSON 对象。
    容错处理：
      - 去掉任意位置的 ```json ... ``` 代码块标记
      - 用正则截取最外层 { ... } 内容
      - 解析失败打印原始文本 + 异常堆栈，返回 None
    """
    text = text.strip()

    # 去掉 ```json 或 ``` 包裹标记（不限首尾，任意位置匹配）
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = text.strip()

    # 若整段已是合法 JSON，直接解析
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # 截取最外层 { ... } 之间的内容
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError as e:
            print(f"[ERROR] JSON 解析失败：{e}")
            print(f"[ERROR] 截取内容前 300 字符：{match.group()[:300]}")

    print(f"[ERROR] 无法从 LLM 返回中提取 JSON，原始文本前 500 字符：\n{text[:500]}")
    return None


def clear_vector_store() -> None:
    """清空 Chroma 向量库持久化目录，防止多次运行数据堆积"""
    if os.path.exists(CHROMA_PERSIST_DIR):
        shutil.rmtree(CHROMA_PERSIST_DIR)
        print(f"[INFO] 已清空向量库目录：{CHROMA_PERSIST_DIR}")
    else:
        print(f"[INFO] 向量库目录不存在，跳过清空：{CHROMA_PERSIST_DIR}")


def init_embeddings() -> HuggingFaceEmbeddings:
    """初始化 sentence-transformers all-MiniLM-L6-v2 嵌入模型"""
    print(f"[INFO] 加载嵌入模型：{EMBEDDING_MODEL_NAME} ...")
    return HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)


def init_vector_store(embeddings: HuggingFaceEmbeddings) -> Chroma:
    """初始化 Chroma 向量数据库（持久化到本地目录）"""
    return Chroma(
        embedding_function=embeddings,
        persist_directory=CHROMA_PERSIST_DIR,
        collection_name=COLLECTION_NAME,
    )


def split_and_store(note_text: str, vector_store: Chroma) -> list:
    """将笔记文本切分并存入向量库，返回切分后的文档块列表"""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", ".", "！", "!", "？", "?", "；", ";", " ", ""],
    )
    chunks = text_splitter.split_text(note_text)
    print(f"[INFO] 笔记切分为 {len(chunks)} 个片段，正在写入向量库 ...")
    vector_store.add_texts(chunks)
    return chunks


def call_llm_extract(note_text: str) -> Dict[str, List[str]]:
    """
    调用 qwen-turbo，使用 PromptA 提取专有名词和关键句子。
    返回 {"terms": [...], "sentences": [...]}，解析失败时返回空数组。
    """
    llm = ChatOpenAI(
        model=LLM_MODEL_NAME,
        openai_api_key=DASHSCOPE_API_KEY,
        openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0,
    )
    prompt = PROMPT_A.format(note_text=note_text)
    message = HumanMessage(content=prompt)

    print("[INFO] 调用 LLM 提取术语和关键句子 ...")
    response = llm.invoke([message])
    raw_text = response.content
    print(f"[DEBUG] LLM 原始返回（PromptA）：\n{raw_text[:500]}")

    result = extract_json_from_text(raw_text)
    if result is None:
        print(f"[WARN] PromptA 返回内容无法解析为 JSON，原始返回：\n{raw_text[:800]}")
        return {"terms": [], "sentences": []}

    return {
        "terms": result.get("terms", []),
        "sentences": result.get("sentences", []),
    }


def call_llm_explain(target: str, context: str) -> str:
    """
    调用 qwen-turbo，使用 PromptB 根据检索到的上下文生成释义。
    """
    llm = ChatOpenAI(
        model=LLM_MODEL_NAME,
        openai_api_key=DASHSCOPE_API_KEY,
        openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0,
    )
    prompt = PROMPT_B.format(target=target, context=context)
    message = HumanMessage(content=prompt)

    response = llm.invoke([message])
    return response.content.strip()


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def run_rag_pipeline(note_text: str) -> Dict[str, Any]:
    """
    执行完整 RAG 批注流程，返回：
    {
        "note_text": str,
        "annotations": [
            {
                "type": "term" | "sentence",
                "content": str,
                "explanation": str,
                "start": int,
                "end": int
            },
            ...
        ]
    }
    """

    # ── Step 1：清空并初始化向量库 ──────────────────────────────
    clear_vector_store()
    embeddings = init_embeddings()
    vector_store = init_vector_store(embeddings)

    # ── Step 2：切分笔记并存入向量库 ────────────────────────────
    split_and_store(note_text, vector_store)

    # ── Step 3：调用 LLM 提取 terms & sentences ─────────────────
    extracted = call_llm_extract(note_text)
    terms: List[str] = extracted["terms"]
    sentences: List[str] = extracted["sentences"]
    print(f"[INFO] 提取到 {len(terms)} 个术语，{len(sentences)} 个关键句子")

    # ── Step 4：逐项检索上下文 + 生成释义 ────────────────────────
    annotations: List[Dict[str, Any]] = []

    # 合并所有待处理条目，附带类型标签
    all_items: List[Dict[str, str]] = (
        [{"type": "term", "content": t} for t in terms]
        + [{"type": "sentence", "content": s} for s in sentences]
    )

    # 去重：按 content 去重，保留首次出现的条目
    seen_contents: set = set()
    deduped_items: List[Dict[str, str]] = []
    for item in all_items:
        if item["content"] not in seen_contents:
            seen_contents.add(item["content"])
            deduped_items.append(item)
    all_items = deduped_items

    for idx, item in enumerate(all_items, start=1):
        item_type = item["type"]
        content = item["content"]

        print(f"[{idx}/{len(all_items)}] {item_type}：{content[:40]} ...")

        # 4-a：向量库相似度检索，获取参考上下文
        docs = vector_store.similarity_search(content, k=TOP_K)
        context = "\n".join([doc.page_content for doc in docs]) if docs else ""

        # 4-b：调用 LLM 生成释义
        if context:
            explanation = call_llm_explain(content, context)
        else:
            explanation = "笔记内暂无相关说明"

        # 4-c：在原始 note_text 中查找首次出现的字符偏移
        start = note_text.find(content)
        if start == -1:
            print(f"  [WARN] 笔记中未找到：'{content[:30]}'，跳过")
            continue

        end = start + len(content)

        annotations.append({
            "type": item_type,
            "content": content,
            "explanation": explanation,
            "start": start,
            "end": end,
        })

    # ── Step 5：输出结果 ─────────────────────────────────────────
    term_count = sum(1 for a in annotations if a["type"] == "term")
    sent_count = sum(1 for a in annotations if a["type"] == "sentence")

    result = {"note_text": note_text, "annotations": annotations}

    print("\n" + "=" * 60)
    print(f"[完成] 共生成 {len(annotations)} 条批注（术语 {term_count} 条，句子 {sent_count} 条）")
    print("=" * 60)

    for i, ann in enumerate(annotations[:5], start=1):
        print(
            f"  {i}. [{ann['type']}] {ann['content'][:30]}"
            f"  (位置 {ann['start']}-{ann['end']})"
        )
        print(f"     释义：{ann['explanation'][:60]} ...")

    if len(annotations) > 5:
        print(f"  ... 还有 {len(annotations) - 5} 条，完整数据见 result['annotations']")

    return result


# ──────────────────────────────────────────────
# HTML 注入 & 输出
# ──────────────────────────────────────────────

OUTPUT_HTML: str = "index.html"

def inject_and_open(annotations: List[Dict[str, Any]], note_text: str) -> str:
    """
    将 annotations 序列化为 JSON 注入 HTML 模板，
    写入 index.html 并用默认浏览器打开。
    返回输出文件绝对路径。
    """
    # ── 读取 HTML 模板（index.html 即模板文件） ──
    template_path = Path(__file__).parent / OUTPUT_HTML
    if not template_path.exists():
        raise FileNotFoundError(
            f"找不到 HTML 模板文件：{template_path}\n"
            f"请确保 {OUTPUT_HTML} 与本脚本在同一目录下"
        )
    html_template = template_path.read_text(encoding="utf-8")

    # ── 序列化 annotations 为 JSON（ensure_ascii 保证中文正常显示） ──
    annotations_json = json.dumps(annotations, ensure_ascii=False, indent=2)

    # ── 替换 window.annotations = ... ];（兼容首次和重复运行） ──
    # 匹配到 ];\n 确保不会在 JSON 字符串内的分号处提前截断
    html_output = re.sub(
        r'window\.annotations\s*=\s*[\s\S]*?\];\n',
        f'window.annotations = {annotations_json};\n',
        html_template,
        count=1
    )

    # ── 注入笔记文本到 textarea ──
    # 兼容两种情况：模板占位符 __NOTE_TEXT__ 或已有内容
    import html as html_lib
    note_text_escaped = html_lib.escape(note_text)
    # 先尝试替换占位符
    if '__NOTE_TEXT__' in html_output:
        html_output = html_output.replace('__NOTE_TEXT__', note_text_escaped)
    else:
        # 已注入过，用正则替换 textarea 内容
        html_output = re.sub(
            r'(<textarea[^>]*>)[\s\S]*?(</textarea>)',
            rf'\1{note_text_escaped}\2',
            html_output,
            count=1
        )

    # ── 注入 API 配置（供前端文本降噪功能使用） ──
    html_output = html_output.replace(
        "var __API_KEY__ = '';",
        f"var __API_KEY__ = '{DASHSCOPE_API_KEY}';"
    )
    html_output = html_output.replace(
        "var __API_BASE__ = '';",
        "var __API_BASE__ = 'https://dashscope.aliyuncs.com/compatible-mode/v1';"
    )

    # ── 写入最终 HTML 文件 ──
    template_path.write_text(html_output, encoding="utf-8")
    output_abs = str(template_path.resolve())
    print(f"\n[INFO] 已写入：{output_abs}")

    # ── 启动本地 HTTP 服务器（独立进程，解决 file:// 缓存问题） ──
    SERVER_PORT = 8765

    def _is_port_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) == 0

    if not _is_port_in_use(SERVER_PORT):
        # 用 subprocess.Popen 启动独立的 Python HTTP 服务器进程
        server_script = f'''
import http.server, os, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()
    def log_message(self, *a): pass
os.chdir({repr(str(template_path.parent))})
http.server.HTTPServer(("127.0.0.1", {SERVER_PORT}), H).serve_forever()
'''
        subprocess.Popen(
            [sys.executable, '-c', server_script],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        time.sleep(0.5)  # 等待服务器启动

    url = f"http://127.0.0.1:{SERVER_PORT}/{OUTPUT_HTML}"
    webbrowser.open(url)
    print(f"[INFO] 已在浏览器中打开：{url}")
    print("[INFO] 脚本执行完毕退出。")

    return output_abs


# ──────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────

if __name__ == "__main__":
    # ── 从剪贴板读取笔记文本（用户提前复制好的） ──
    print("[INFO] 正在读取剪贴板内容作为笔记文本 ...")
    note_text: str = pyperclip.paste().strip()

    if not note_text:
        print("[ERROR] 剪贴板为空！请先复制笔记内容，再运行本脚本。")
        raise SystemExit(1)

    print(f"[INFO] 剪贴板读取到 {len(note_text)} 个字符，开始处理 ...\n")

    # Step 1-5：执行 RAG 批注流程
    result = run_rag_pipeline(note_text)

    # Step 6：注入 JSON → 写 HTML → 打开浏览器 → 脚本退出
    inject_and_open(result["annotations"], note_text)
