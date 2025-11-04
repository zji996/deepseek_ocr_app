# Repository Guidelines

## Project Structure & Module Organization
Backend logic lives in `backend/app/`, with routers in `api/`, business logic in `services/`, shared schemas under `models/`, and helpers in `utils/`. Environment-specific dependencies sit in the various `backend/requirements-*.txt` files. The React interface is under `frontend/src/`, split into `components/`, `hooks/`, `api/`, and `utils/`. Visual assets are stored in `assets/`; model checkpoints and caches belong in `models/` (keep large downloads out of version control). Architectural references live in `docs/architecture.md`, `docs/vllm-direct/implementation-summary.md`, and the rest of `docs/`. The `third_party/` directory is vendored code—open issues before modifying it.

## Build, Test, and Development Commands
Use Docker for an end-to-end stack: `docker compose up --build` (or `./start-vllm-direct.sh`) builds the vLLM Direct backend and React frontend together. For local backend work, create a virtualenv and install dependencies with `python -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements-vllm-direct.txt`, then run `uvicorn backend.app.main:app --reload`. Frontend development uses pnpm: `npm install -g pnpm`, `pnpm install`, and `pnpm run dev`; build output with `pnpm run build`.

## Coding Style & Naming Conventions
Follow PEP 8 in the backend: 4-space indentation, snake_case modules, PascalCase models, and type hints on public functions. Keep HTTP handlers thin—delegate to `services/` for heavy lifting and centralise configuration in `config.py`. In the frontend, prefer two-space indentation, PascalCase component files, `useX` naming for hooks, and colocate feature-specific assets under the matching folder. Enforce lint rules with `pnpm exec eslint src --max-warnings=0` and keep Tailwind utility classes readable (group by layout → typography → state).

## Testing Guidelines
Automated coverage is light; new backend features should ship with `pytest` suites under `backend/tests/` using fast fixtures that stub model loading. Target critical OCR flows first (plain, describe, find, freeform). For UI behaviour, add Vitest + React Testing Library specs in `frontend/src/__tests__/` and run `pnpm exec vitest --run`. Document any manual GPU/vLLM smoke checks in PR descriptions until CI is in place.

## Commit & Pull Request Guidelines
Commits use concise sentence-case summaries (e.g., `Update README.md with new content`) and may reference issues inline `(#12)`. Bundle related work only and update docs/config snapshots alongside code changes. Pull requests need a problem statement, implementation notes, and validation steps (lint, tests, engine mode exercised). Attach screenshots or GIFs for UI tweaks and call out configuration changes (e.g., new `.env` keys). Keep the checklist updated so reviewers know what was verified.

## Tailwind + Vite Integration Notes
- Install Tailwind CSS alongside the official Vite plugin: `pnpm add -D tailwindcss@latest @tailwindcss/vite`.
- Register the plugin in `vite.config.ts` with `plugins: [react(), tailwindcss()]` so Vite generates utilities during dev and build.
- Import Tailwind once at the top of the entry stylesheet with `@import "tailwindcss";`, then layer any bespoke base tokens below it.
- Ensure the Docker build stage runs `pnpm install --prod=false` so Tailwind (a dev dependency) is present when `pnpm run build` executes.
- When migrating from the Vite scaffold, update `index.html` to load `/src/main.tsx` if the JSX entrypoint was removed.

## Recent Enhancements (2025-11)
- **Shared vLLM service** – FastAPI 暴露 `/internal/infer` 供 Celery worker 复用同一个 AsyncLLMEngine，避免重复加载模型。Worker 通过 `WORKER_REMOTE_INFER_URL`、`INTERNAL_API_TOKEN` 与 `PDF_MAX_CONCURRENCY` 控制访问与并发。
- **PDF 管线升级** – `process_pdf` 采用线程内并发，实时回写进度 (`TaskStatusResponse.progress`)，产出 Markdown、原始 JSON 与自动打包的 ZIP。回调会在 `backend/app/tasks/pdf.py` 中异步落库。
- **Grounding 解析增强** – `GroundingParser` 支持全角符号清洗、嵌套坐标和标记裁剪，确保检测框始终可用。
- **前端体验** – 控制台拆分为 `ImageOcrPanel`/`PdfTaskPanel`/`TaskLookupPanel` 三个功能块：PDF 状态以 1 s 轮询自动刷新（移除手动刷新按钮），任务完成后仅提供 ZIP 下载；任务 ID 查询区域支持任意任务实时追踪。
- **Worker 稳定性** – Celery PDF 任务复用专用事件循环线程，避免 asyncio run-loop 混用导致的 “Future attached to a different loop” 异常。
- **部署注意事项** – Docker Compose 已为 worker 注入新的内部推理环境变量；重启前确认 `.env` 中的 token、URL 一致，确保健康检查正常。
- **任务耗时追踪** – `OcrTask` 记录 `queued_at`/`started_at`/`finished_at`/`duration_ms`，同步图片与 PDF 任务都会回写耗时并在前端显示。新增 Alembic 迁移位于 `backend/migrations/versions/`，通过 `docker compose exec backend-direct alembic upgrade head` 应用。
