import uuid
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from aequitas_database.models.base import Base

# Keep in sync with Alembic revision and embedding model output dimension
EMBEDDING_DIM = 1536


class DocumentEmbedding(Base):
    __tablename__ = "document_embeddings"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    source: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text())
    chunk_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
