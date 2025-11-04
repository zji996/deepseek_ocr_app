# vLLM Direct 实施总结

## 完成时间
2025-10-30

## 实施目标
将 DeepSeek-OCR 项目从 vLLM OpenAI 双容器架构迁移到基于 `vllm/vllm-openai:nightly` 的单容器 vLLM Direct 架构，解决 OpenAI API token 限制问题。

## 2025-11 更新概览

- **共享推理服务**：新增 `/internal/infer` 端点以及 `WORKER_REMOTE_INFER_URL`、`INTERNAL_API_TOKEN` 配置，Celery worker 通过内网 HTTP 复用 FastAPI 里已加载的 AsyncLLMEngine，避免重复占用 GPU 显存。
- **PDF 任务增强**：`pdf_processor` 支持并发页级推理、进度上报和 Markdown/JSON/ZIP 产物；`TaskStatusResponse` 增加 `progress` 字段。
- **Grounding 解析稳健性**：清洗全角符号与残留标签，保障检测框始终可解析。
- **前端体验重构**：App 拆分为独立组件，PDF 任务改为 1 s 自动轮询且默认仅露出 ZIP 下载，新增任务 ID 查询面板统一查看进度。
- **Worker 稳定性**：PDF Celery 任务运行在专用事件循环线程，规避 asyncpg Future 附着到错误 loop 的异常。

## 2025-12 更新

- **任务耗时追踪**：`OcrTask` 模型新增 `queued_at` / `started_at` / `finished_at` / `duration_ms` 字段，图片与 PDF 任务都会回写全链路耗时。
- **API & 前端展示**：`TaskStatusResponse.timing` 与 `ImageOCRResponse.duration_ms` 暴露耗时信息，前端三个面板统一展示排队、开始与完成时间。
- **数据库迁移**：首个 Alembic 迁移存放于 `backend/migrations/versions/`，在 Docker 环境下执行 `docker compose exec backend-direct alembic upgrade head` 以应用结构更新。

## 架构变化

### 之前（双容器架构）
```
┌─────────────────┐      OpenAI API       ┌──────────────────┐
│  vLLM Container │ ◄─────────────────────┤ Backend Container│
│  (推理引擎)      │      (base64 图像)     │   (FastAPI)      │
└─────────────────┘                        └──────────────────┘
     ↓ 问题：图像序列化导致 token 过多
```

### 现在（单容器架构）
```
┌────────────────────────────────────────────┐
│        Single Container                    │
│  ┌──────────────┐    ┌─────────────────┐  │
│  │   FastAPI    │───►│ AsyncLLMEngine  │  │
│  │   (后端)     │    │  (直接推理)     │  │
│  └──────────────┘    └─────────────────┘  │
│          ↑ 直接传递原始图像特征             │
└────────────────────────────────────────────┘
```

## 已创建/修改的文件

### 新建文件

#### 1. 模型代码（从 third_party 复制）
- ✅ `backend/app/vllm_models/__init__.py` - 模块初始化
- ✅ `backend/app/vllm_models/deepseek_ocr.py` - DeepSeek-OCR 模型定义
- ✅ `backend/app/vllm_models/config.py` - 模型配置（已适配）
- ✅ `backend/app/vllm_models/process/` - 图像处理模块
  - `__init__.py`
  - `image_process.py` - 图像预处理
  - `ngram_norepeat.py` - N-gram 去重
- ✅ `backend/app/vllm_models/deepencoder/` - 深度编码器
  - `__init__.py`
  - `sam_vary_sdpa.py` - SAM 编码器
  - `clip_sdpa.py` - CLIP 编码器
  - `build_linear.py` - MLP 投影器

#### 2. 核心实现
- ✅ `backend/app/services/vllm_direct_engine.py` - vLLM Direct 引擎实现

#### 3. 部署配置
- ✅ `backend/Dockerfile.vllm-direct` - 单容器 Dockerfile
- ✅ `backend/requirements-vllm-direct.txt` - Python 依赖
- ✅ `docker-compose.yml` - vLLM Direct Compose 配置

#### 4. 文档和配置
- ✅ `.env.vllm-direct` - 配置文件模板
- ✅ `docs/vllm-direct/README.md` - 详细使用文档
- ✅ `start-vllm-direct.sh` - 快速启动脚本
- ✅ `docs/vllm-direct/implementation-summary.md` - 本文档

### 修改的文件

#### 1. 后端代码
- ✅ `backend/app/config.py` - 添加 vLLM Direct 配置项
- ✅ `backend/app/api/routes.py` - 支持多种推理引擎
- ✅ `backend/app/main.py` - 更新启动信息（v4.0.0）

#### 2. 模型代码调整
- ✅ `backend/app/vllm_models/config.py` - 延迟初始化 tokenizer
- ✅ `backend/app/vllm_models/process/image_process.py` - 修复导入路径
- ✅ `backend/app/vllm_models/deepseek_ocr.py` - 修复导入路径

## 关键特性

### 1. 直接推理
- 使用 `AsyncLLMEngine.generate()` 直接传递图像特征
- 避免 OpenAI API 的序列化开销
- 支持超长 token 序列

### 2. 灵活配置
- 支持多种 OCR 模式（Tiny/Small/Base/Large/Gundam）
- 可调整 GPU 内存利用率
- 支持张量并行（多卡推理）

### 3. 兼容性
- 保持原有 API 端点不变
- 支持动态切换推理引擎（通过 `INFERENCE_ENGINE` 环境变量）
- 前端无需修改

### 4. 官方镜像
- 基于 `vllm/vllm-openai:nightly`
- 自动获取最新优化
- 稳定可靠

## 使用方式

### 快速启动
```bash
# 1. 复制配置
cp .env.vllm-direct .env

# 2. 使用启动脚本（推荐）
./start-vllm-direct.sh

# 或者手动启动
docker compose up -d
```

### 配置模型路径
```bash
# 在 .env 中设置
MODEL_PATH=deepseek-ai/DeepSeek-OCR  # 从 HuggingFace/ModelScope 自动下载
# 或
MODEL_PATH=/root/.cache/modelscope/deepseek-ai/DeepSeek-OCR  # 使用本地模型
```

### 多卡推理
```bash
# 在 .env 中设置
TENSOR_PARALLEL_SIZE=2

# 在 docker-compose.yml 中指定 GPU
device_ids: ["0", "1"]
```

## 测试验证

### 1. 健康检查
```bash
curl http://localhost:8001/health
```

预期响应：
```json
{
  "status": "healthy",
  "model_loaded": true,
  "inference_engine": "vllm_direct"
}
```

### 2. 图片 OCR 测试
```bash
curl -X POST "http://localhost:8001/api/ocr/image" \
  -F "image=@test.jpg"
```

### 3. PDF OCR 入队
```bash
curl -X POST "http://localhost:8001/api/ocr/pdf" \
  -F "pdf=@document.pdf"
```

```json
{"task_id": "c1b7bdf2-..."}
```

随后通过 `GET /api/tasks/{task_id}` 查询状态。

### 3. 性能测试
- 首次推理会稍慢（模型初始化）
- 后续推理应该非常快
- 可以处理大尺寸图像而不会因 token 限制失败

## 优势总结

### ✅ 解决的问题
1. **Token 限制** - 不再受 OpenAI API token 数限制
2. **部署复杂度** - 从双容器简化为单容器
3. **通信开销** - 消除容器间网络延迟
4. **灵活性** - 完全控制推理流程

### ✅ 保持的优势
1. **高性能** - vLLM 引擎的所有优化
2. **易用性** - API 端点精简为 `/api/ocr/image` 与 `/api/ocr/pdf`
3. **官方支持** - 使用官方 vLLM 镜像
4. **可扩展性** - 支持多卡、多节点

## 后续建议

### 1. 性能优化
- [ ] 根据实际使用调整 `GPU_MEMORY_UTILIZATION`
- [ ] 测试不同 `MAX_MODEL_LEN` 对性能的影响
- [ ] 考虑启用 FlashAttention-2

### 2. 监控
- [ ] 添加 Prometheus metrics
- [ ] 集成日志聚合系统
- [ ] 监控 GPU 利用率

### 3. 扩展
- [ ] 支持批量推理
- [ ] 添加推理缓存
- [ ] 实现请求队列管理

## 兼容性说明

### 向后兼容
- API 端点调整为图片同步与 PDF 异步两个入口
- 环境变量沿用旧名称，便于脚本迁移

### 迁移路径
```bash
# 从旧架构迁移
1. 停止旧服务: docker compose down
2. 复制配置: cp .env.vllm-direct .env
3. 启动新服务: ./start-vllm-direct.sh
4. 验证功能: curl http://localhost:8001/health
```

## 故障排查

### 常见问题
1. **OOM 错误** → 减少 `GPU_MEMORY_UTILIZATION` 或 `MAX_MODEL_LEN`
2. **推理慢** → 增加 `GPU_MEMORY_UTILIZATION`，检查 GPU 利用率
3. **模型加载失败** → 检查 `MODEL_PATH` 和网络连接
4. **CUDA 错误** → 检查 NVIDIA 驱动版本

详细故障排查见 [vLLM Direct 指南](./README.md)

## 技术细节

### 核心实现
- **引擎**: `vllm.AsyncLLMEngine`
- **模型注册**: `vllm.model_executor.models.registry.ModelRegistry`
- **图像处理**: `DeepseekOCRProcessor.tokenize_with_images()`
- **采样控制**: `NoRepeatNGramLogitsProcessor`

### 依赖版本
- vLLM: latest (from nightly image)
- PyTorch: 2.6.0
- Transformers: 4.48.2
- FastAPI: 0.115.12

## 总结

成功实现了从 vLLM OpenAI 双容器架构到 vLLM Direct 单容器架构的迁移：

- ✅ 所有 8 个 TODO 任务已完成
- ✅ 完整的代码实现和配置文件
- ✅ 详细的文档和使用指南
- ✅ 快速启动脚本
- ✅ 保持向后兼容

用户现在可以直接使用 `./start-vllm-direct.sh` 快速启动服务，享受无 token 限制、高性能的 OCR 推理体验！🚀
