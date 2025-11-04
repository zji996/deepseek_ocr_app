"""Add task timing fields to ocr_tasks

Revision ID: c1e4d619d3f5
Revises: None
Create Date: 2025-05-07 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "c1e4d619d3f5"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ocr_tasks",
        sa.Column(
            "queued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.add_column(
        "ocr_tasks",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "ocr_tasks",
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "ocr_tasks",
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    )
    op.alter_column("ocr_tasks", "queued_at", server_default=None)


def downgrade() -> None:
    op.drop_column("ocr_tasks", "duration_ms")
    op.drop_column("ocr_tasks", "finished_at")
    op.drop_column("ocr_tasks", "started_at")
    op.drop_column("ocr_tasks", "queued_at")

