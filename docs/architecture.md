# 架构说明文档

本文档记录 DeepSeek OCR 的系统架构、模块职责与最新的运行时改动。

## 目录
- [总体架构](#总体架构)
- [后台组件](#后台组件)
- [前端组件](#前端组件)
- [数据与控制流](#数据与控制流)
- [关键设计决策](#关键设计决策)
- [运行与配置要点](#运行与配置要点)

## 总体架构

```
┌─────────────────┐  HTTP/WebSocket  ┌───────────────────────┐
│ React 前端(Nginx)│◄───────────────►│ FastAPI 服务 (Uvicorn) │
└─────────────────┘                  │  /app/api/routes.py   │
                                     └───────────┬───────────┘
                                                 │ Celery 任务
                                     ┌───────────▼───────────┐
                                     │ Worker (Celery + Solo)│
                                     │ /app/tasks/pdf.py     │
                                     └───────────┬───────────┘
                                                 │ 内部推理 API
                                     ┌───────────▼───────────┐
                                     │ AsyncLLMEngine (vLLM) │
                                     │ /internal/infer       │
                                     └───────────┬───────────┘
                                                 │
                                     ┌───────────▼───────────┐
                                     │   GPU + CUDA 驱动     │
                                     └───────────────────────┘

支撑服务：PostgreSQL（任务状态）、Redis（Celery broker / backend）、共享文件系统 `/data/ocr`（输入输出资产）。
```

## 后台组件

### API 层
- `backend/app/api/routes.py`
  - 公共端点：`/api/ocr/image`、`/api/ocr/pdf`、`/api/tasks/{task_id}`。
  - 内部端点：`/internal/infer`，供 Celery worker 复用 FastAPI 进程内的 `AsyncLLMEngine`。
  - 统一返回 `TaskStatusResponse`；`result` 字段包含 Markdown/JSON/ZIP 下载地址，`progress` 提供实时进度，`timing` 则返回标准化的排队/启动/完成时间与耗时。

### 服务层
- `vllm_direct_engine.py`：FastAPI 进程的 vLLM 封装，负责加载模型、接受推理请求。
- `worker_engine.py`：Celery 进程推理适配层，可选直接加载模型或通过 HTTP 请求内部端点（默认）。
- `pdf_processor.py`：
  - 将 PDF 渲染为高分辨率图片。
  - 并行推理（受 `PDF_MAX_CONCURRENCY` 控制）并裁剪检测到的图片区域。
  - 写出 `result.md`（逐页插入 `<!-- page:x -->` 注释、`---` 分隔符）、`raw.json`（原始文本 + 检测框）与 `result.zip`（Markdown + JSON + assets）。
  - 处理过程中持续回调进度，写入数据库。
- `grounding_parser.py`：解析 `<|ref|><|det|>` 标签，支持全角符号清洗、嵌套坐标。
- 其它辅助模块：`prompt_builder.py`、`storage.py` 等。

### 数据层
- ORM：`backend/app/db/models.py`，记录 `OcrTask`、状态机（pending/running/succeeded/failed），并追踪 `queued_at`、`started_at`、`finished_at`、`duration_ms` 以便分析排队延迟与执行耗时。
- 配置：`backend/app/config.py` 使用 `pydantic-settings` 暴露以下关键变量：
  - `WORKER_REMOTE_INFER_URL`、`INTERNAL_API_TOKEN` 用于 worker 与 API 同步推理。
  - `PDF_MAX_CONCURRENCY` 控制每个 worker 并发提交推理请求的数量。
  - 其余模型、GPU、数据库、存储参数同以往。

### 任务执行
- `backend/app/tasks/pdf.py`
  - Celery 入口将 `_run_pdf_task` 派发到专用的 `pdf-task-loop` 线程，保证 asyncpg 连接与 SQLAlchemy 会话绑定到固定事件循环，避免 “Future attached to a different loop”。
  - `_run_pdf_task` 继续通过 `asyncio.to_thread(process_pdf, …)` 执行 CPU 密集型 PDF 处理，同时 `_update_progress` 协程安全回写进度。
  - 成功后调用 `mark_succeeded`；失败时保留最后一次进度并写入错误信息。

## 前端组件

- `frontend/src/App.tsx`：组合独立功能 panel，保持响应式双栏布局。
- `frontend/src/components/ImageOcrPanel.tsx`：图片识别、预览叠层与检测框列表，上传后即时返回结果。
- `frontend/src/components/PdfTaskPanel.tsx`：PDF 上传 + 1 s 自动轮询进度，移除手动刷新按钮，任务完成后仅暴露 ZIP 下载。
- `frontend/src/components/TaskLookupPanel.tsx`：支持粘贴任意任务 ID，统一的状态徽标、进度条与 ZIP 下载。
- `frontend/src/api/client.ts`：与后端模型保持一致，新增 `TaskProgress`、`archive_url`。
- 样式整合 `index.css`、Tailwind，保留两列布局与卡片式视觉。

## 数据与控制流

### 图片 OCR
1. 用户上传图片 → `/api/ocr/image`。
2. FastAPI 使用 `VLLMDirectEngine.infer` 推理，`GroundingParser` 解析检测框。
3. 过程中创建 `TaskType.IMAGE` 记录并回写开始/完成时间。
4. 响应包含 `text`、`raw_text`、`boxes`、`image_dims`、`timing`，前端即时渲染并显示耗时。

### PDF OCR
1. 上传 PDF → 存储到 `/data/ocr/{task_id}/input.pdf`，写入 `OcrTask` 记录，Celery 入队。
2. Worker:
   - 渲染各页 → `Image`.
   - 使用 `worker_engine.submit_infer` 并发调用 `/internal/infer`（带 `X-Internal-Token`）。
   - 生成 Markdown 片段、裁剪图片、解析检测框 → 写入 `PageResult`。
   - 每完成一页调用进度回调，数据库中 `result_payload.progress` 获得 `current/total/percent/message`。
3. 结束时输出：
   - `result.md`：页面注释 + 分隔线，保留模型原生 Markdown。
   - `raw.json`：原始文本、检测框、资产列表。
   - `result.zip`：打包 Markdown + JSON + `images/`。
4. 前端轮询 `/api/tasks/{task_id}`：
   - `status` 控制徽标（排队中/执行中/完成/失败）。
   - `progress.percent` 渲染条形图和提示语。
   - `timing.duration_ms` 显示总耗时，`started_at`/`finished_at` 用于时间线。
   - `result.archive_url` 用于 ZIP 下载（默认展示），`markdown_url` 与 `image_urls` 可供其他调用方使用。

## 关键设计决策

1. **共享 AsyncLLMEngine**
   - 通过内部 API 避免 Celery worker 重复加载 20+ GB 模型，缩短启动时间、降低 GPU 内存占用。
   - 支持回退：若未配置 `WORKER_REMOTE_INFER_URL`，worker 会在自身进程内加载模型（适用于开发环境）。

2. **细粒度进度回传**
   - `TaskProgress` 包含 `current`、`total`、`percent`、`message`，前端无需额外推理即可展示实时状态。
   - 专用 `pdf-task-loop` 线程管理异步会话， `_update_progress` 在同一事件循环内提交数据库变更，避免跨循环 Future 冲突。

3. **健壮的 Grounding 解析**
   - 清洗全角标点、剔除残留标签，保障 `ast.literal_eval` 始终成功。
   - 支持 `[[x1,y1],[x2,y2]]`、`[x1,y1,x2,y2]` 等多种模型输出格式。

4. **Markdown 输出约定**
   - 页与页之间使用 `---` 分隔，便于在渲染器或导出工具中识别页面边界。
   - 每一页的开头注入 `<!-- page:{index} -->` 注释，方便下游做二次处理。

5. **部署一致性**
   - Docker Compose 已为 `backend-worker` 注入 `WORKER_REMOTE_INFER_URL` 与 `INTERNAL_API_TOKEN`。
   - 健康检查依赖 `/health`，要求 FastAPI 在模型加载完成后才对外宣告 `healthy`。

## 运行与配置要点

- `.env` 关键变量：
  - `MODEL_PATH`：HuggingFace / ModelScope 模型路径或本地缓存目录。
  - `WORKER_REMOTE_INFER_URL`：默认 `http://backend-direct:8001/internal/infer`。
  - `INTERNAL_API_TOKEN`：API 与 worker 共享的密钥，前后端需保持一致。
  - `PDF_MAX_CONCURRENCY`：单 worker 并发推理页数，推荐根据 GPU 显存调整（默认 3）。

- 常用命令：
  - 全栈启动：`docker compose up --build`.
  - 仅后端（开发）：`uvicorn backend.app.main:app --reload`.
  - Celery worker（开发）：`celery -A app.celery_app worker --loglevel=INFO --pool=solo`.

- 故障排查：
  - 若 worker 报 `Forbidden`，检查 `INTERNAL_API_TOKEN`。
  - 若进度永远停留在 “任务已启动”，确认 worker 能访问 `/internal/infer`，并检查 PostgreSQL/Redis 连接。
  - Grounding 解析失败通常伴随模型输出格式变更，可开启日志排查 `sanitize_coords_text`。
- 数据库迁移：
  - 新增/修改表结构会同步提交到 `backend/migrations/versions/`。
  - Docker 环境下执行 `docker compose exec backend-direct alembic upgrade head` 应用迁移；本地开发可使用 `alembic upgrade head`（需配置 `DATABASE_URL`）。

最新修改日期：2025-12。
