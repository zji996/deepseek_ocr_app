"""API 路由 - 精简版"""

from __future__ import annotations

import base64
import io
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image

from ..config import settings
from ..db.dependencies import get_db_session
from ..db.models import OcrTask, TaskStatus, TaskType
from ..models.schemas import (
    BoundingBox,
    HealthResponse,
    ImageDimensions,
    ImageOCRResponse,
    InternalInferRequest,
    InternalInferResponse,
    PdfPageResult,
    TaskCreateResponse,
    TaskProgress,
    TaskResult,
    TaskStatusResponse,
    TaskTiming,
)
from ..services.grounding_parser import GroundingParser
from ..services.prompt_builder import PromptBuilder
from ..services.storage import StorageManager
from ..services.vllm_direct_engine import VLLMDirectEngine
from ..tasks.pdf import process_pdf_task
from ..utils.image_utils import ImageUtils


router = APIRouter()
_inference_service: Optional[VLLMDirectEngine] = None
_storage = StorageManager()


async def get_inference_service() -> VLLMDirectEngine:
    global _inference_service
    if _inference_service is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    return _inference_service


@router.get("/")
async def root() -> dict[str, str | int | float | bool]:
    return {
        "message": "DeepSeek-OCR API is running! 🚀",
        "docs": "/docs",
        "inference_engine": "vllm_direct",
        "model_path": settings.model_path,
    }


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    is_loaded = _inference_service is not None and _inference_service.is_loaded()
    return HealthResponse(
        status="healthy" if is_loaded else "starting",
        model_loaded=is_loaded,
        inference_engine="vllm_direct",
    )


@router.post("/api/ocr/image", response_model=ImageOCRResponse)
async def ocr_image(
    image: UploadFile = File(..., description="待识别图像"),
    session: AsyncSession = Depends(get_db_session),
    inference_service: VLLMDirectEngine = Depends(get_inference_service),
) -> ImageOCRResponse:
    tmp_img = None
    task: OcrTask | None = None

    try:
        tmp_img = await ImageUtils.save_upload_file(image)
        prompt = PromptBuilder.image_prompt()

        task_id = uuid.uuid4()
        task = OcrTask(
            id=task_id,
            task_type=TaskType.IMAGE,
            input_path=tmp_img,
            queued_at=datetime.now(timezone.utc),
        )
        session.add(task)
        await session.flush()

        task.mark_running()
        await session.commit()
        await session.refresh(task)

        raw_text = await inference_service.infer(
            prompt=prompt,
            image_path=tmp_img,
            base_size=settings.base_size,
            image_size=settings.image_size,
            crop_mode=settings.crop_mode,
        )

        orig_w, orig_h = ImageUtils.get_image_dimensions(tmp_img)

        boxes: list[dict[str, Any]] = []
        if GroundingParser.has_grounding_tags(raw_text) and orig_w and orig_h:
            boxes = GroundingParser.parse_detections(raw_text, orig_w, orig_h)

        cleaned_text = GroundingParser.clean_grounding_text(raw_text) or raw_text

        payload: dict[str, Any] = {
            "text": cleaned_text,
            "raw_text": raw_text,
            "boxes": boxes,
        }
        if orig_w and orig_h:
            payload["image_dims"] = {"w": orig_w, "h": orig_h}

        task.mark_succeeded(payload, output_dir=None)
        await session.commit()
        await session.refresh(task)

        timing = _build_task_timing(task)

        return ImageOCRResponse(
            success=True,
            text=cleaned_text,
            raw_text=raw_text,
            boxes=[BoundingBox(**box) for box in boxes],
            image_dims=ImageDimensions(w=orig_w, h=orig_h) if orig_w and orig_h else None,
            task_id=task.id,
            timing=timing,
            duration_ms=task.duration_ms,
        )

    except Exception as exc:
        if task is not None:
            await session.rollback()
            task.mark_failed(f"{type(exc).__name__}: {exc}")
            session.add(task)
            await session.commit()
        error_detail = f"{type(exc).__name__}: {exc}"
        raise HTTPException(status_code=500, detail=error_detail) from exc

    finally:
        if tmp_img and os.path.exists(tmp_img):
            try:
                os.remove(tmp_img)
            except OSError:
                pass


@router.post("/internal/infer", response_model=InternalInferResponse)
async def internal_infer(
    payload: InternalInferRequest,
    token: str | None = Header(default=None, alias="X-Internal-Token"),
    inference_service: VLLMDirectEngine = Depends(get_inference_service),
) -> InternalInferResponse:
    expected_token = settings.internal_api_token
    if expected_token and token != expected_token:
        raise HTTPException(status_code=403, detail="Forbidden")

    image_data: Image.Image | None = None

    try:
        if payload.image_base64:
            try:
                image_bytes = base64.b64decode(payload.image_base64)
                image_data = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid image payload: {exc}") from exc

        raw_text = await inference_service.infer(
            prompt=payload.prompt,
            image_data=image_data,
            base_size=payload.base_size or settings.base_size,
            image_size=payload.image_size or settings.image_size,
            crop_mode=settings.crop_mode if payload.crop_mode is None else payload.crop_mode,
        )

        return InternalInferResponse(text=raw_text)

    finally:
        if image_data is not None:
            try:
                image_data.close()
            except Exception:
                pass


@router.post("/api/ocr/pdf", response_model=TaskCreateResponse, status_code=202)
async def enqueue_pdf_ocr(
    pdf: UploadFile = File(..., description="PDF 文件"),
    session: AsyncSession = Depends(get_db_session),
) -> TaskCreateResponse:
    if (pdf.content_type or "application/pdf").lower() not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")

    task_id = uuid.uuid4()
    task_id_str = str(task_id)

    filename = Path(pdf.filename or f"{task_id_str}.pdf").name
    if not filename.lower().endswith(".pdf"):
        filename = f"{task_id_str}.pdf"

    input_dir = _storage.get_task_input_dir(task_id_str)
    input_path = input_dir / filename
    await _storage.save_upload_file(pdf, input_path)

    task = OcrTask(
        id=task_id,
        task_type=TaskType.PDF,
        input_path=str(input_path),
        queued_at=datetime.now(timezone.utc),
    )
    session.add(task)
    await session.commit()

    process_pdf_task.delay(task_id_str)

    return TaskCreateResponse(task_id=task_id)


@router.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> TaskStatusResponse:
    task = await session.get(OcrTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    payload = task.result_payload or {}
    result_model = _build_task_result(task, payload)
    progress_model = _build_task_progress(payload.get("progress"))

    return TaskStatusResponse(
        task_id=task.id,
        status=task.status,
        task_type=task.task_type,
        created_at=task.created_at,
        updated_at=task.updated_at,
        error_message=task.error_message,
        result=result_model,
        progress=progress_model,
        timing=_build_task_timing(task),
    )


@router.get("/api/tasks/{task_id}/download/{file_path:path}")
async def download_task_file(
    task_id: uuid.UUID,
    file_path: str,
    session: AsyncSession = Depends(get_db_session),
):
    task = await session.get(OcrTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task.status != TaskStatus.SUCCEEDED or not task.output_dir:
        raise HTTPException(status_code=404, detail="任务尚未生成结果")

    base_dir = Path(task.output_dir).resolve()
    target = (base_dir / file_path).resolve()

    if not str(target).startswith(str(base_dir)):
        raise HTTPException(status_code=400, detail="非法文件路径")

    if not target.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    return FileResponse(target, filename=target.name)


def _task_path(task_id: uuid.UUID, relative: Optional[str]) -> Optional[str]:
    if not relative:
        return None
    return f"/api/tasks/{task_id}/download/{relative}"


def _build_task_result(task: OcrTask, payload: dict[str, Any]) -> Optional[TaskResult]:
    if not payload:
        return None

    markdown_url = _task_path(task.id, payload.get("markdown_file"))
    raw_json_url = _task_path(task.id, payload.get("raw_json_file"))
    archive_url = _task_path(task.id, payload.get("archive_file"))

    image_urls = [
        url for rel in payload.get("images", []) if (url := _task_path(task.id, rel))
    ]

    pages_payload = payload.get("pages", []) or []
    pages: list[PdfPageResult] = []
    for page in pages_payload:
        boxes_payload = page.get("boxes", []) or []
        boxes = []
        for item in boxes_payload:
            if isinstance(item, dict) and {"label", "box"} <= item.keys():
                boxes.append(BoundingBox(label=item["label"], box=item["box"]))
        pages.append(
            PdfPageResult(
                index=page.get("index", 0),
                markdown=page.get("markdown", ""),
                raw_text=page.get("raw_text", ""),
                image_assets=page.get("image_assets", []),
                boxes=boxes,
            )
        )

    if not any([markdown_url, raw_json_url, archive_url, image_urls, pages]):
        return None

    return TaskResult(
        markdown_url=markdown_url,
        raw_json_url=raw_json_url,
        archive_url=archive_url,
        image_urls=image_urls,
        pages=pages,
    )


def _build_task_timing(task: OcrTask) -> Optional[TaskTiming]:
    if task is None:
        return None

    has_data = any([task.queued_at, task.started_at, task.finished_at, task.duration_ms is not None])
    if not has_data:
        return None

    return TaskTiming(
        queued_at=task.queued_at,
        started_at=task.started_at,
        finished_at=task.finished_at,
        duration_ms=task.duration_ms,
    )


def _build_task_progress(progress_payload: Any) -> Optional[TaskProgress]:
    if not isinstance(progress_payload, dict):
        return None

    current = int(progress_payload.get("current", 0) or 0)
    total = int(progress_payload.get("total", 0) or 0)
    try:
        percent = float(progress_payload.get("percent", 0.0) or 0.0)
    except (TypeError, ValueError):
        percent = 0.0
    message = progress_payload.get("message")

    return TaskProgress(
        current=current,
        total=total,
        percent=percent,
        message=message if isinstance(message, str) else None,
    )


async def initialize_service() -> None:
    global _inference_service

    _inference_service = VLLMDirectEngine()
    await _inference_service.load(
        model_path=settings.model_path,
        tensor_parallel_size=settings.tensor_parallel_size,
        gpu_memory_utilization=settings.gpu_memory_utilization,
        max_model_len=settings.max_model_len,
        enforce_eager=settings.enforce_eager,
        use_v1_engine=settings.vllm_use_v1,
    )


async def shutdown_service() -> None:
    global _inference_service
    if _inference_service:
        await _inference_service.unload()
        _inference_service = None
