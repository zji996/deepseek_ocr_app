"""Pydantic 响应模型"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from ..db.models import TaskStatus, TaskType


class BoundingBox(BaseModel):
    label: str = Field(..., description="标签文本")
    box: List[int] = Field(..., description="边界框坐标 [x1, y1, x2, y2]")


class ImageDimensions(BaseModel):
    w: int = Field(..., description="宽度（像素）")
    h: int = Field(..., description="高度（像素）")


class ImageOCRResponse(BaseModel):
    success: bool
    text: str
    raw_text: str
    boxes: List[BoundingBox] = Field(default_factory=list)
    image_dims: Optional[ImageDimensions] = None
    task_id: Optional[UUID] = Field(default=None, description="对应的任务 ID（仅同步调用）")
    timing: Optional["TaskTiming"] = None
    duration_ms: Optional[int] = Field(default=None, description="任务耗时（毫秒）")


class TaskCreateResponse(BaseModel):
    task_id: UUID


class PdfPageResult(BaseModel):
    index: int
    markdown: str
    raw_text: str
    image_assets: List[str]
    boxes: List[BoundingBox]


class TaskResult(BaseModel):
    markdown_url: Optional[str] = None
    raw_json_url: Optional[str] = None
    archive_url: Optional[str] = None
    image_urls: List[str] = Field(default_factory=list)
    pages: List[PdfPageResult] = Field(default_factory=list)


class TaskProgress(BaseModel):
    current: int = Field(0, description="已完成数量")
    total: int = Field(0, description="总量")
    percent: float = Field(0.0, description="完成百分比 (0-100)")
    message: Optional[str] = Field(None, description="进度说明")


class TaskTiming(BaseModel):
    queued_at: Optional[datetime] = Field(default=None, description="进入队列时间")
    started_at: Optional[datetime] = Field(default=None, description="开始执行时间")
    finished_at: Optional[datetime] = Field(default=None, description="完成时间")
    duration_ms: Optional[int] = Field(default=None, description="执行耗时（毫秒）")


class TaskStatusResponse(BaseModel):
    task_id: UUID
    status: TaskStatus
    task_type: TaskType
    created_at: datetime
    updated_at: datetime
    error_message: Optional[str] = None
    result: Optional[TaskResult] = None
    progress: Optional[TaskProgress] = None
    timing: Optional[TaskTiming] = None


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    inference_engine: str


class InternalInferRequest(BaseModel):
    prompt: str
    image_base64: Optional[str] = Field(
        default=None, description="Base64 编码的图像数据（JPEG/PNG）"
    )
    base_size: Optional[int] = None
    image_size: Optional[int] = None
    crop_mode: Optional[bool] = None


class InternalInferResponse(BaseModel):
    text: str = Field(..., description="模型原始输出文本")


ImageOCRResponse.model_rebuild()
