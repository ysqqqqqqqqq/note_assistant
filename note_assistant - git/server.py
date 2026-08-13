"""
笔记智能批注工具 — Flask API 服务版

运行方式：
  python server.py
  
然后在浏览器访问 http://127.0.0.1:5000
"""

import json
import os
import re
import shutil
import ssl
from pathlib import Path
from dotenv import load_dotenv
import PyPDF2
from typing import List, Dict, Any, Optional

# ── SSL 修复（同 main.py） ──
import ssl as _ssl
_orig_create_default_context = _ssl.create_default_context
def _no_verify_create_default_context(*a, **kw):
    ctx = _orig_create_default_context(*a, **kw)
    ctx.check_hostname = False
    ctx.verify_mode = _ssl.CERT_NONE
    return ctx
_ssl.create_default_context = _no_verify_create_default_context

import httpx
_orig_httpx_init = httpx.Client.__init__
def _httpx_no_verify_init(self, *a, **kw):
    kw['verify'] = False
    _orig_httpx_init(self, *a, **kw)
httpx.Client.__init__ = _httpx_no_verify_init

# ── 依赖导入 ──
from flask import Flask, request, jsonify, send_from_directory
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import HumanMessage

# ─ 配置（从 .env 文件读取，请先复制 .env.example 为 .env 并填入密钥） ──
load_dotenv()
DASHSCOPE_API_KEY: str = os.getenv("DASHSCOPE_API_KEY", "")
EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"
LLM_MODEL_NAME: str = "qwen-plus"
TOP_K: int = 3
CHUNK_SIZE: int = 1000
CHUNK_OVERLAP: int = 200
KB_PERSIST_DIR: str = "./chroma_kb"
KB_COLLECTION_NAME: str = "knowledge_base"
UPLOAD_FOLDER: str = "./kb_uploads"
_kb_vs = None  # 知识库向量存储（惰性加载）

# ── PromptA：术语提取（30大类） ──
PROMPT_A: str = """任务目标：逐词完整扫描笔记全文，识别提取文本内所有专业技术术语；
核心目的：筛选文中陌生专业名词，用于生成注释，辅助学习者快速定位不懂的知识点；
覆盖领域：计算机科学、嵌入式开发、人工智能、机器学习、深度学习、计算机视觉、信号处理、大数据数据分析、机器人工程、自动化控制工程、金融量化工程。

前置兜底强制规则：
1. 遇到不确定是否属于专业术语的词汇，**默认判定为术语并提取，宁多勿少**；
2. 区分普通口语词汇与专业名词；仅通用日常助词、过渡语句排除，专业领域专有名词一律纳入提取范围。

严格遵循以下30大类强制提取标准：

【一、基础概念类】
1. 学科/领域名称：如「机器学习」「深度学习」「计算机视觉」等；
2. 方法论/范式：如「有监督学习」「无监督学习」「半监督学习」「强化学习」「迁移学习」等；
3. 任务类型：如「分类」「回归」「聚类」「降维」「目标检测」「语义分割」「实例分割」等；
4. 评估指标：如「准确率」「精确率」「召回率」「F1分数」「mAP」「IoU」「AUC」「ROC曲线」等。

【二、数据相关类】
5. 数据形态：如「数据集」「训练集」「验证集」「测试集」「样本」「标签」「特征」「特征向量」「特征矩阵」等；
6. 数据处理：如「数据清洗」「数据标注」「数据增强」「归一化」「标准化」「独热编码」「One-Hot」「数据预处理」等；
7. 数据问题：如「过拟合」「欠拟合」「类别不平衡」「噪声数据」「缺失值」「异常值」等。

【三、模型架构类】
8. 经典网络：如「CNN」「卷积神经网络」「RNN」「循环神经网络」「LSTM」「GRU」「Transformer」「Attention机制」等；
9. 具体模型：如「ResNet」「VGG」「AlexNet」「YOLO」「SSD」「Faster R-CNN」「BERT」「GPT」「ViT」等；
10. 模块组件：如「卷积层」「池化层」「全连接层」「激活函数」「ReLU」「Sigmoid」「Softmax」「Dropout」「BatchNorm」「LayerNorm」等；
11. 编码器/解码器：如「Encoder」「Decoder」「Autoencoder」「VAE」「GAN」「生成对抗网络」等。

【四、优化与训练类】
12. 优化算法：如「梯度下降」「SGD」「Adam」「AdamW」「RMSprop」「动量法」「学习率衰减」「Warmup」等；
13. 损失函数：如「交叉熵损失」「均方误差」「Huber损失」「Contrastive Loss」「Triplet Loss」「Focal Loss」等；
14. 训练技巧：如「早停」「正则化」「L1/L2正则」「权重初始化」「预训练」「微调」「Fine-tuning」「冻结层」等；
15. 超参数：如「学习率」「批量大小」「Epoch」「迭代次数」「动量系数」「权重衰减」等。

【五、硬件与部署类】
16. 计算设备：如「GPU」「CUDA」「TPU」「CPU」「NPU」「边缘设备」「嵌入式芯片」等；
17. 推理框架：如「TensorRT」「ONNX」「TFLite」「OpenVINO」「NCNN」「MNN」等；
18. 部署方式：如「模型压缩」「剪枝」「量化」「蒸馏」「知识蒸馏」「模型加速」「端侧部署」「云侧部署」等。

【六、机器人与自动化类】
19. 传感器：如「IMU」「惯性测量单元」「激光雷达」「LiDAR」「摄像头」「深度相机」「RGB-D」「毫米波雷达」「超声波传感器」等；
20. 定位导航：如「SLAM」「同步定位与建图」「视觉SLAM」「激光SLAM」「里程计」「Odometry」「路径规划」「A*算法」「Dijkstra」「RRT」等；
21. 控制算法：如「PID控制」「比例积分微分」「状态空间」「卡尔曼滤波」「扩展卡尔曼滤波」「粒子滤波」「MPC模型预测控制」「滑模控制」等；
22. 运动学：如「正运动学」「逆运动学」「自由度」「关节角」「末端执行器」「雅可比矩阵」「奇异点」等；
23. 机器人类型：如「机械臂」「移动机器人」「无人机」「人形机器人」「协作机器人」「AGV」「AMR」等。

【七、信号处理类】
24. 信号类型：如「时域信号」「频域信号」「频谱」「傅里叶变换」「FFT」「短时傅里叶变换」「小波变换」等；
25. 滤波器：如「低通滤波」「高通滤波」「带通滤波」「卡尔曼滤波」「粒子滤波」「中值滤波」「高斯滤波」等；
26. 特征提取：如「MFCC」「梅尔频率倒谱系数」「STFT」「谱图」「时频分析」「包络检波」等。

【八、嵌入式与系统类】
27. 处理器：如「ARM」「Cortex-M」「ESP32」「STM32」「FPGA」「DSP」「MCU」「SoC」等；
28. 通信协议：如「I2C」「SPI」「UART」「CAN总线」「Modbus」「TCP/IP」「MQTT」「HTTP」「WebSocket」等；
29. 操作系统：如「RTOS」「FreeRTOS」「uC/OS」「Linux嵌入式」「Yocto」「Buildroot」等；
30. 外设接口：如「GPIO」「ADC」「DAC」「PWM」「DMA」「中断」「看门狗」「定时器」等。

输出格式要求：
- 必须返回合法的 JSON 对象，包含两个数组字段：terms（术语列表）和 sentences（关键句子列表）
- terms 数组中的每个元素是字符串，表示一个专业术语
- sentences 数组中的每个元素是字符串，表示一个包含重要知识点的完整句子
- 不要输出任何解释性文字，只输出 JSON

笔记内容：
{note_text}
"""

# ── PromptB：释义生成（不依赖检索上下文） ─
PROMPT_B: str = """你是专业的技术文档助手。请用简洁准确的语言解释以下专业术语或句子。

目标：{target}

要求：
1. 用中文回答，控制在 80 字以内
2. 语言通俗易懂，适合初学者理解
3. 直接输出释义，不要加前缀后缀

释义：
"""


def extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    """从 LLM 返回的文本中提取 JSON 对象"""
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            return None
    return None


def get_embeddings():
    """加载本地嵌入模型（从缓存读取，无需联网下载）"""
    print(f"[INFO] 加载本地嵌入模型：{EMBEDDING_MODEL_NAME}")
    return HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)


def _init_kb():
    """初始化持久化知识库（暂时禁用，等待网络问题解决）"""
    global _kb_vs
    _kb_vs = None  # 强制设为 None，禁用 RAG
    print("[INFO] RAG 功能已禁用（网络限制），使用纯 LLM 模式")


def _kb_retrieve(query: str, k: int = 3) -> str:
    """从知识库检索相关上下文（已禁用，返回空字符串）"""
    return ""


def _parse_file(filepath: str) -> str:
    """解析上传的文档，返回纯文本内容"""
    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.pdf':
        text = ""
        with open(filepath, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() or ""
        return text
    elif ext in ('.txt', '.md', '.csv'):
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    return ""


def call_llm_extract(note_text: str) -> Dict[str, List[str]]:
    """调用 LLM 提取术语和句子"""
    llm = ChatOpenAI(
        model=LLM_MODEL_NAME,
        openai_api_key=DASHSCOPE_API_KEY,
        openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0,
    )
    prompt = PROMPT_A.format(note_text=note_text)
    message = HumanMessage(content=prompt)
    
    print("[INFO] 调用 LLM 提取术语...")
    response = llm.invoke([message])
    raw_text = response.content
    
    result = extract_json_from_text(raw_text)
    if result is None:
        print(f"[WARN] LLM 返回无法解析为 JSON")
        return {"terms": [], "sentences": []}
    
    return {
        "terms": result.get("terms", []),
        "sentences": result.get("sentences", []),
    }


def call_llm_explain(target: str, context: str = None) -> str:
    """调用 LLM 生成释义（支持知识库上下文增强）"""
    llm = ChatOpenAI(
        model=LLM_MODEL_NAME,
        openai_api_key=DASHSCOPE_API_KEY,
        openai_api_base="https://dashscope.aliyuncs.com/compatible-mode/v1",
        temperature=0,
    )
    context_section = ""
    if context:
        context_section = f"\n\n参考上下文（来自知识库）：\n{context}\n\n请结合以上参考资料，"
    prompt = PROMPT_B.format(target=target) + context_section
    message = HumanMessage(content=prompt)
    
    response = llm.invoke([message])
    return response.content.strip()


def run_rag_pipeline(note_text: str) -> List[Dict[str, Any]]:
    """执行 RAG 流程（并行处理 + 无向量检索），返回 annotations 列表"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    # Step 1: 提取术语和句子
    extracted = call_llm_extract(note_text)
    all_items = []
    for term in extracted["terms"]:
        all_items.append({"type": "term", "content": term})
    for sent in extracted["sentences"]:
        all_items.append({"type": "sentence", "content": sent})
    
    print(f"[INFO] 提取到 {len(extracted['terms'])} 个术语，{len(extracted['sentences'])} 个句子")
    
    # Step 2: 去重
    seen_contents = set()
    deduped_items = []
    for item in all_items:
        if item["content"] not in seen_contents:
            seen_contents.add(item["content"])
            deduped_items.append(item)
    all_items = deduped_items
    
    # Step 3: 并行生成释义并定位
    def process_item(item: Dict[str, str]) -> Optional[Dict[str, Any]]:
        """处理单个条目（RAG：先检索知识库再生成释义）"""
        item_type = item["type"]
        content = item["content"]
        
        # 从知识库检索相关上下文
        kb_context = _kb_retrieve(content, k=TOP_K)
        if kb_context:
            print(f"  [RAG] '{content[:20]}...' 检索到 {kb_context.count('[来源')} 条参考")
        
        # 生成释义（有知识库上下文时增强）
        explanation = call_llm_explain(content, context=kb_context if kb_context else None)
        
        # 定位
        start = note_text.find(content)
        if start == -1:
            print(f"  [WARN] 未找到：'{content[:30]}'，跳过")
            return None
        
        end = start + len(content)
        return {
            "type": item_type,
            "content": content,
            "explanation": explanation,
            "start": start,
            "end": end,
        }
    
    annotations = []
    # 使用线程池并行处理（最多 4 个并发）
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_item = {executor.submit(process_item, item): item for item in all_items}
        for idx, future in enumerate(as_completed(future_to_item), start=1):
            item = future_to_item[future]
            try:
                result = future.result()
                if result:
                    annotations.append(result)
                    print(f"[{idx}/{len(all_items)}] {result['type']}：{result['content'][:30]} ...")
            except Exception as e:
                print(f"  [ERROR] 处理 '{item['content'][:30]}' 失败：{e}")
    
    # 按位置排序
    annotations.sort(key=lambda x: x["start"])
    
    term_count = sum(1 for a in annotations if a["type"] == "term")
    sent_count = sum(1 for a in annotations if a["type"] == "sentence")
    print(f"[完成] 共生成 {len(annotations)} 条批注（术语 {term_count} 条，句子 {sent_count} 条）")
    
    return annotations


# ── Flask 应用 ──
app = Flask(__name__, static_folder='.', static_url_path='/static')

@app.route('/')
def index():
    """提供 HTML 文件"""
    return send_from_directory('.', 'index.html')

@app.route('/annotate', methods=['POST'])
def annotate():
    """批注 API"""
    data = request.json
    note_text = data.get('note_text', '').strip()
    
    if not note_text:
        return jsonify({"error": "笔记文本为空"}), 400
    
    try:
        annotations = run_rag_pipeline(note_text)
        return jsonify({
            "success": True,
            "annotations": annotations,
            "count": len(annotations),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/test', methods=['POST'])
def test_endpoint():
    """测试端点"""
    print("[DEBUG] /test called")
    return jsonify({"status": "ok"})

@app.route('/kb/upload', methods=['POST'])
def kb_upload():
    """上传文档到知识库（已禁用）"""
    return jsonify({"error": "RAG 功能已禁用，请等待网络问题解决后启用"}), 503


@app.route('/kb/list', methods=['GET'])
def kb_list():
    """列出知识库中的文档（已禁用）"""
    return jsonify({"success": True, "documents": [], "disabled": True, "message": "RAG 功能已禁用"})


@app.route('/kb/delete', methods=['POST'])
def kb_delete():
    """从知识库删除指定文档（已禁用）"""
    return jsonify({"error": "RAG 功能已禁用"}), 503


if __name__ == '__main__':
    print("=" * 60)
    print("笔记智能批注工具 - API 服务")
    print("=" * 60)
    print("[INFO] 启动服务器：http://127.0.0.1:5000")
    _init_kb()  # 启动时加载知识库
    print("[INFO] 在浏览器中打开上述地址即可使用")
    print("[INFO] 按 Ctrl+C 停止服务器")
    print("=" * 60)
    
    # 自动打开浏览器
    import webbrowser
    webbrowser.open('http://127.0.0.1:5000')
    
    app.run(host='127.0.0.1', port=5000, debug=False)
