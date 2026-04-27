from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from api.ingest import (
    _chunk_uuid,
    _embed_texts,
    _session_factory,
    _upsert_postgres,
    _upsert_supabase_rest,
    parse_pdf_bytes,
)
from app.auth import require_role

try:
    from psycopg_pool import AsyncConnectionPool
except Exception:  # pragma: no cover - optional dependency for runtime check only
    AsyncConnectionPool = None  # type: ignore[assignment]

router = APIRouter(
    prefix="/v1/admin",
    tags=["admin"],
    dependencies=[require_role("executive", "admin", "superuser")],
)


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _is_pdf(file: UploadFile) -> bool:
    name = (file.filename or "").lower()
    content_type = (file.content_type or "").lower()
    return content_type == "application/pdf" or name.endswith(".pdf")


async def _ingest_stream(file: UploadFile, source_label: str) -> AsyncIterator[str]:
    try:
        if not _is_pdf(file):
            raise HTTPException(status_code=400, detail="File must be a PDF.")

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty file.")

        filename = file.filename or "upload.pdf"
        source = source_label or filename

        yield _sse(
            {
                "type": "status",
                "phase": "parsing",
                "message": "Parsing PDF with LlamaParse / PyMuPDF...",
            }
        )
        chunks = parse_pdf_bytes(
            data,
            filename=filename,
            source_url=source,
            prefer="auto",
        )
        total_chunks = len(chunks)

        yield _sse(
            {
                "type": "status",
                "phase": "chunking",
                "message": f"Splitting into {total_chunks} chunks...",
            }
        )
        if total_chunks == 0:
            raise HTTPException(
                status_code=422,
                detail="No text extracted from PDF; try another parser or check the file.",
            )

        vectors: list[list[float]] = []
        batch_size = 10
        for start in range(0, total_chunks, batch_size):
            end = min(start + batch_size, total_chunks)
            yield _sse(
                {
                    "type": "status",
                    "phase": "embedding",
                    "message": f"Embedding chunk {end}/{total_chunks}...",
                }
            )
            batch_texts = [c.text for c in chunks[start:end]]
            batch_vectors = await _embed_texts(batch_texts)
            vectors.extend(batch_vectors)

        yield _sse(
            {
                "type": "status",
                "phase": "storing",
                "message": "Upserting to document_embeddings...",
            }
        )

        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        items: list[tuple[Any, str, str, list[float], dict[str, Any]]] = []
        for c, emb in zip(chunks, vectors, strict=True):
            row_id = _chunk_uuid(f"{c.source_label}|", c.page_number, c.chunk_index)
            meta: dict[str, Any] = {
                "source_url": source,
                "page_number": c.page_number,
                "chunk_index": c.chunk_index,
                "ingested_at": ts,
                "document_title": None,
                "parser": c.parser,
            }
            items.append((row_id, source[:255], c.text, emb, meta))

        sf = _session_factory()
        async with sf() as session:
            async with session.begin():
                written = await _upsert_postgres(session, items)
        await _upsert_supabase_rest(items)

        yield _sse(
            {
                "type": "done",
                "chunks_stored": written,
                "source": source_label,
            }
        )
    except Exception as e:  # noqa: BLE001
        yield _sse({"type": "error", "message": str(e)})
        return


@router.post("/ingest")
async def admin_ingest_pdf(
    file: UploadFile = File(...),
    source_label: str = Form(default=""),
) -> StreamingResponse:
    return StreamingResponse(
        _ingest_stream(file=file, source_label=source_label),
        media_type="text/event-stream; charset=utf-8",
    )


@router.get("/system")
async def admin_system_summary(request: Request) -> dict[str, Any]:
    database = "ok"
    document_embeddings_count = 0
    notifications_unread = 0

    try:
        sf = _session_factory()
        async with sf() as session:
            de_count = await session.execute(text("SELECT count(*) FROM document_embeddings"))
            n_count = await session.execute(
                text("SELECT count(*) FROM notifications WHERE read_at IS NULL")
            )
            document_embeddings_count = int(de_count.scalar() or 0)
            notifications_unread = int(n_count.scalar() or 0)
    except Exception:  # noqa: BLE001
        database = "error"

    shadow_analyst = getattr(request.app.state, "shadow_analyst", None)
    shadow_analyst_running = bool(
        shadow_analyst is not None and getattr(shadow_analyst, "started", False)
    )

    cp_pool = getattr(request.app.state, "checkpoint_pool", None)
    if cp_pool is None:
        checkpointer = "none"
    elif AsyncConnectionPool is not None and isinstance(cp_pool, AsyncConnectionPool):
        checkpointer = "postgres"
    else:
        checkpointer = "memory"

    return {
        "database": database,
        "shadow_analyst_running": shadow_analyst_running,
        "checkpointer": checkpointer,
        "document_embeddings_count": document_embeddings_count,
        "notifications_unread": notifications_unread,
    }
