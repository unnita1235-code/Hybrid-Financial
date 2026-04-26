import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from aequitas_database.models.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_role: Mapped[str] = mapped_column(String(32), default="analyst")
    prompt_template: Mapped[str] = mapped_column(Text)
    user_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    rag_chunks: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(
        JSON, nullable=True
    )
    model_versions: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    final_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    feedback: Mapped[list["HumanFeedback"]] = relationship(
        "HumanFeedback", back_populates="audit_log", cascade="all, delete-orphan"
    )


class HumanFeedback(Base):
    __tablename__ = "human_feedback"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    audit_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("audit_logs.id", ondelete="CASCADE"),
        index=True,
    )
    vote: Mapped[int] = mapped_column(Integer, nullable=False)
    correction_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    audit_log: Mapped["AuditLog"] = relationship("AuditLog", back_populates="feedback")
