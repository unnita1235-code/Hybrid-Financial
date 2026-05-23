r"""
Ingestion pipeline: PDF (LlamaParse / Unstructured / PyMuPDF), chart vision → SQL
staging, and vector upsert to ``document_embeddings`` (Postgres / Supabase).
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any, Literal, cast

import httpx
from aequitas_database.models.document_embedding import EMBEDDING_DIM, DocumentEmbedding
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ingest", tags=["ingest"])

_CHUNK_MAX = 3000  # IMPROVED: default max chunk size for semantic chunking
_CHUNK_OVERLAP = 200  # IMPROVED: chunk overlap for retrieval continuity
_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


@lru_cache
def _session_factory() -> async_sessionmaker[AsyncSession]:
    eng = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        echo=False,
    )
    return async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)


@dataclass
class ParsedPage:
    text: str
    page_number: int
    parser: str


@dataclass
class IngestChunk:
    text: str
    page_number: int
    chunk_index: int
    source_label: str
    parser: str = ""


def _chunk_text_semantic(
    text: str,
    max_chars: int = 3000,
    overlap_chars: int = 200,
) -> list[str]:
    # IMPROVED: chunk semantically by paragraph -> sentence -> chars with overlap.
    body = (text or "").strip()
    if not body:
        return []
    if len(body) <= max_chars:
        return [body]

    # Prefer paragraph boundaries: explicit blank lines or newline before uppercase line.
    paragraphs = [
        p.strip()
        for p in re.split(r"\n{2,}|\n(?=[A-Z][^\n]*)", body)
        if p and p.strip()
    ]
    if not paragraphs:
        paragraphs = [body]

    units: list[str] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            units.append(para)
            continue
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", para) if s.strip()]
        if not sentences:
            sentences = [para]
        for sent in sentences:
            if len(sent) <= max_chars:
                units.append(sent)
                continue
            # Fall back to hard character splitting for pathological long tokens.
            for i in range(0, len(sent), max_chars):
                part = sent[i : i + max_chars].strip()
                if part:
                    units.append(part)

    chunks: list[str] = []
    current = ""
    for unit in units:
        sep = "\n\n" if current else ""
        candidate = f"{current}{sep}{unit}" if current else unit
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current.strip())
        current = unit
    if current:
        chunks.append(current.strip())

    if overlap_chars <= 0 or len(chunks) <= 1:
        return chunks

    overlapped: list[str] = []
    prev = ""
    for ch in chunks:
        if prev:
            overlap = prev[-overlap_chars:].strip()
            if overlap:
                combined = f"{overlap}\n\n{ch}".strip()
                if len(combined) > max_chars:
                    combined = combined[-max_chars:].strip()
                overlapped.append(combined)
            else:
                overlapped.append(ch)
        else:
            overlapped.append(ch)
        prev = ch
    return overlapped


# ---------------------------------------------------------------------------
# SQL identifiers (staging tables)
# ---------------------------------------------------------------------------


def _sql_ident(s: str, *, default: str = "c") -> str:
    t = re.sub(r"[^a-zA-Z0-9_]+", "_", s.strip())[:40]
    t = t.strip("_") or default
    if t[0].isdigit():
        t = f"c_{t}"
    if not _IDENT_RE.match(t):
        return default
    return t


def _chunk_uuid(source: str, page: int, chunk_i: int) -> uuid.UUID:
    return uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"aequitas:ingest:{source}|p{page}|c{chunk_i}",
    )


# ---------------------------------------------------------------------------
# PDF: PyMuPDF (always available)
# ---------------------------------------------------------------------------


def _parse_pdf_pymupdf(data: bytes) -> list[ParsedPage]:
    import fitz  # pymupdf

    out: list[ParsedPage] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = (page.get_text("text") or "").strip()
            if text:
                out.append(
                    ParsedPage(
                        text=text,
                        page_number=i + 1,
                        parser="pymupdf",
                    )
                )
    return out


# ---------------------------------------------------------------------------
# PDF: Unstructured
# ---------------------------------------------------------------------------


def _parse_pdf_unstructured(data: bytes) -> list[ParsedPage]:
    from unstructured.partition.pdf import partition_pdf

    elements = partition_pdf(file=io.BytesIO(data), strategy="hi_res")
    by_page: dict[int, list[str]] = {}
    for el in elements:
        md: dict[str, Any] = getattr(el, "metadata", None) or {}
        p = int(md.get("page_number", 0) or 0)
        if p < 1:
            p = 1
        t = (getattr(el, "text", None) or str(el) or "").strip()
        if not t:
            continue
        by_page.setdefault(p, []).append(t)
    return [
        ParsedPage(
            text="\n".join(chunks).strip(),
            page_number=pn,
            parser="unstructured",
        )
        for pn, chunks in sorted(by_page.items(), key=lambda x: x[0])
        if "\n".join(chunks).strip()
    ]


# ---------------------------------------------------------------------------
# PDF: LlamaParse (cloud, best for tables / layout)
# ---------------------------------------------------------------------------


def _parse_pdf_llamaparse(
    data: bytes,
    api_key: str,
) -> list[ParsedPage]:
    import nest_asyncio
    from llama_parse import LlamaParse

    nest_asyncio.apply()  # FIXED: apply only where LlamaParse event loop nesting is needed

    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        verbose=False,
    )
    documents = cast(Any, parser.load_data(data))
    out: list[ParsedPage] = []
    for d in documents or []:
        t = (getattr(d, "text", None) or getattr(d, "get_content", lambda: "")()) or ""
        t = (t or "").strip()
        if not t:
            continue
        md: dict[str, Any] = getattr(d, "metadata", {}) or {}
        p = int(md.get("page", md.get("page_label", 1)) or 1)
        if isinstance(p, str) and p.isdigit():
            p = int(p)
        if not isinstance(p, int) or p < 1:
            p = 1
        out.append(ParsedPage(text=t, page_number=p, parser="llamaparse"))
    if not out and documents:
        merged = "\n\n".join(
            (getattr(d, "text", None) or "").strip() for d in documents if getattr(d, "text", None)
        )
        if merged.strip():
            out.append(
                ParsedPage(
                    text=merged.strip(),
                    page_number=1,
                    parser="llamaparse",
                )
            )
    return out


def parse_pdf_bytes(
    data: bytes,
    filename: str,
    source_url: str,
    prefer: Literal["llamaparse", "unstructured", "pymupdf", "auto"] = "auto",
) -> list[IngestChunk]:
    """Extract text with fallback chain; split long pages into chunks."""
    key = (
        settings.llamaparse_api_key
        or __import__("os").environ.get("LLAMA_CLOUD_API_KEY", "").strip() or None
    )
    pages: list[ParsedPage] = []
    label = f"{source_url or filename or 'inline.pdf'}"

    if prefer in ("auto", "llamaparse") and key:
        try:
            pages = _parse_pdf_llamaparse(
                data,
                key,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("LlamaParse failed, falling back: %s", e)
            pages = []

    if not pages and prefer in ("auto", "unstructured"):
        try:
            pages = _parse_pdf_unstructured(data)
        except Exception as e:  # noqa: BLE001
            log.warning("unstructured failed, falling back: %s", e)
            pages = []

    if not pages:
        pages = _parse_pdf_pymupdf(data)

    chunks: list[IngestChunk] = []
    for pg in pages:
        # IMPROVED: replace fixed-width splitting with semantic chunking.
        split_parts = _chunk_text_semantic(
            pg.text,
            max_chars=_CHUNK_MAX,
            overlap_chars=_CHUNK_OVERLAP,
        )
        for idx, part in enumerate(split_parts):
            chunks.append(
                IngestChunk(
                    text=part,
                    page_number=pg.page_number,
                    chunk_index=idx,
                    source_label=label,
                    parser=pg.parser,
                )
            )
    return chunks


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


async def _embed_texts(texts: list[str]) -> list[list[float]]:
    if not settings.openai_api_key and not __import__("os").environ.get("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY (or openai_api_key) is required for embeddings.",
        )
    from openai import AsyncOpenAI

    key = settings.openai_api_key or __import__("os").environ.get("OPENAI_API_KEY", "")
    client = AsyncOpenAI(api_key=key)
    out: list[list[float]] = []
    batch = 32
    for i in range(0, len(texts), batch):
        part = texts[i : i + batch]
        r = await client.embeddings.create(
            model=settings.embedding_model,
            input=part,
        )
        for item in r.data:
            vec = list(item.embedding)
            if len(vec) != EMBEDDING_DIM:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Embedding dim {len(vec)} != {EMBEDDING_DIM} "
                        f"for model {settings.embedding_model}; use text-embedding-3-small or "
                        "align DB with your embedding size."
                    ),
                )
            out.append(vec)
    return out


# ---------------------------------------------------------------------------
# Vector store: Postgres (upsert) + optional Supabase REST
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


async def _upsert_postgres(
    session: AsyncSession,
    items: list[tuple[uuid.UUID, str, str, list[float], dict[str, Any]]],
) -> int:
    """(id, source, content, embedding, metadata) per row; ON CONFLICT DO UPDATE."""
    n = 0
    for row_id, source, content, emb, meta in items:
        stmt = insert(DocumentEmbedding).values(
            id=row_id,
            source=source[:255],
            content=content,
            chunk_metadata=meta,
            embedding=emb,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[DocumentEmbedding.id],
            set_={
                "source": source[:255],
                "content": content,
                "chunk_metadata": meta,
                "embedding": emb,
            },
        )
        await session.execute(stmt)
        n += 1
    return n


async def _upsert_supabase_rest(
    items: list[tuple[uuid.UUID, str, str, list[float], dict[str, Any]]],
) -> None:
    if not (settings.supabase_url and settings.supabase_service_key):
        return
    base = str(settings.supabase_url).rstrip("/")
    url = f"{base}/rest/v1/document_embeddings"
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        for row_id, source, content, emb, meta in items:
            payload: dict[str, Any] = {
                "id": str(row_id),
                "source": source[:255],
                "content": content,
                "chunk_metadata": meta,
                "embedding": emb,
            }
            r = await client.post(
                f"{url}?on_conflict=id",
                headers=headers,
                json=payload,
            )
            r.raise_for_status()


async def index_chunks(
    chunks: list[IngestChunk],
    *,
    source_url: str,
    document_title: str | None = None,
) -> dict[str, Any]:
    """Embed and upsert all chunks; returns summary counts."""
    if not chunks:
        return {"chunks": 0, "embedded": 0, "written": 0}
    ts = _now_iso()
    texts = [c.text for c in chunks]
    vectors = await _embed_texts(texts)
    src = (source_url or document_title or "ingest")[:255]
    batch: list[tuple[uuid.UUID, str, str, list[float], dict[str, Any]]] = []
    for c, emb in zip(chunks, vectors, strict=True):
        row_id = _chunk_uuid(f"{c.source_label}|{document_title or ''}", c.page_number, c.chunk_index)
        meta: dict[str, Any] = {
            "source": c.source_label,  # IMPROVED: normalized metadata baseline across parsers
            "source_url": source_url,
            "page_number": c.page_number,
            "chunk_index": c.chunk_index,
            "char_count": len(c.text),  # IMPROVED: normalized metadata baseline across parsers
            "ingested_at": ts,
            "document_title": document_title,
            "parser": c.parser,
        }
        batch.append((row_id, src, c.text, emb, meta))

    sf = _session_factory()
    async with sf() as session:
        async with session.begin():
            n = await _upsert_postgres(session, batch)
    try:
        await _upsert_supabase_rest(batch)
    except httpx.HTTPError as e:  # noqa: BLE001
        log.warning("Supabase vector mirror failed (Postgres still committed): %s", e)
    return {"chunks": len(chunks), "embedded": len(vectors), "written": n}


# ---------------------------------------------------------------------------
# Vision → structured rows + staging table
# ---------------------------------------------------------------------------

VISION_CHART_SYSTEM = r"""You are a financial data extraction assistant. The user
image may be a chart, table, or mixed layout. Extract quantitative series.

Respond with a single JSON object (no markdown fences) of this form:
{
  "chart_title": "short title or null",
  "unit_notes": "axis units, e.g. $M or % or null",
  "columns": ["series_name", "x", "y"],
  "rows": [
    {"series_name": "Revenue", "x": "2023 Q1", "y": 12.4},
    ...
  ]
}
Rules:
- Use "rows" for every visible Plotted or tabulated data point. If the chart has
  multiple series, disambiguate with "series_name".
- "x" can be a string (period label) or number as appropriate; "y" must be
  numeric when the value is numeric, else a string.
- If you cannot read values, return empty rows and unit_notes explaining why."""


def _b64_mime(b: bytes) -> str:
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:2] == b"\xff\xd8":
        return "image/jpeg"
    if b[:4] in (b"GIF8",) or b[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


async def _vision_openai(
    image_bytes: bytes,
    user_hint: str | None = None,
) -> dict[str, Any]:
    from openai import AsyncOpenAI

    key = settings.openai_api_key or __import__("os").environ.get("OPENAI_API_KEY", "")
    if not key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is required for OpenAI vision.",
        )
    client = AsyncOpenAI(api_key=key)
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    mime = _b64_mime(image_bytes)
    user_parts: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (user_hint or "Extract the chart or table as JSON per instructions."),
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        },
    ]
    r = await client.chat.completions.create(
        model=settings.vision_openai_model,
        messages=[
            {"role": "system", "content": VISION_CHART_SYSTEM},
            {"role": "user", "content": user_parts},
        ],
        max_tokens=4096,
        response_format={"type": "json_object"},
    )
    content = (r.choices[0].message.content or "").strip()
    return json.loads(content)


async def _vision_anthropic(
    image_bytes: bytes,
    user_hint: str | None = None,
) -> dict[str, Any]:
    import anthropic

    key = settings.anthropic_api_key or __import__("os").environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(
            status_code=400,
            detail="ANTHROPIC_API_KEY is required for Anthropic vision.",
        )
    client = anthropic.AsyncAnthropic(api_key=key)
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    mime = _b64_mime(image_bytes)
    msg = await client.messages.create(
        model=settings.vision_anthropic_model,
        max_tokens=4096,
        system=VISION_CHART_SYSTEM,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (user_hint or "Extract the chart or table as JSON per instructions."),
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": b64,
                        },
                    },
                ],
            }
        ],
    )
    text = ""
    for bl in msg.content or []:
        if getattr(bl, "type", None) == "text":
            text += cast(str, getattr(bl, "text", ""))
    return json.loads(text.strip())


def _rows_to_sql_values(
    rows: list[dict[str, Any]], columns: list[str]
) -> tuple[list[str], list[tuple[Any, ...]]]:
    if not columns:
        kset: set[str] = set()
        for r in rows:
            kset |= set((r or {}).keys())
        columns = sorted(kset) if kset else ["x", "y"]
    columns = [c for c in columns if c]
    if not columns:
        columns = ["x", "y"]
    out_cols = [_sql_ident(c) for c in columns]
    norm_rows: list[tuple[Any, ...]] = []
    for r in rows:
        r = r or {}
        vals: list[Any] = []
        for c in out_cols:
            v = None
            for k, val in r.items():
                if _sql_ident(k) == c or k == c:
                    v = val
                    break
            vals.append(v)
        norm_rows.append(tuple(vals))
    return out_cols, norm_rows


def _column_type_numeric(rows: list[tuple[Any, ...]], col_i: int) -> bool:
    have = False
    for row in rows:
        if col_i >= len(row) or row[col_i] is None:
            continue
        have = True
        v = row[col_i]
        if isinstance(v, bool):
            return False
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            continue
        s2 = str(v).strip().replace("%", "").replace(",", "")
        try:
            float(s2)
        except ValueError:
            return False
    return have


async def _create_staging_table(
    table_name: str,
    column_names: list[str],
    rows: list[tuple[Any, ...]],
) -> None:
    if not re.fullmatch(r"[a-f0-9]{32}", table_name):
        raise ValueError("invalid table token")
    n = len(column_names)
    if n == 0:
        return
    col_types = [
        "NUMERIC" if _column_type_numeric(rows, i) else "TEXT" for i in range(n)
    ]
    sc_names = [_sql_ident(column_names[i], default=f"col_{i}") for i in range(n)]
    col_sql = ", ".join(
        f'"{sc_names[i]}" {col_types[i]} NULL' for i in range(n)
    )
    fq = f'ingest_staging."t_{table_name}"'
    sf = _session_factory()
    ins_cols = ", ".join(f'"{sc}"' for sc in sc_names)
    async with sf() as session:
        await session.execute(text("CREATE SCHEMA IF NOT EXISTS ingest_staging"))
        await session.execute(text(f"DROP TABLE IF EXISTS {fq}"))
        await session.execute(text(f"CREATE TABLE {fq} ({col_sql})"))
        if rows:
            for row in rows:
                d: dict[str, Any] = {
                    f"c{i}": (row[i] if i < len(row) else None) for i in range(n)
                }
                ph = ", ".join(f":c{i}" for i in range(n))
                await session.execute(
                    text(f"INSERT INTO {fq} ({ins_cols}) VALUES ({ph})"),
                    d,
                )
        await session.commit()


# ---------------------------------------------------------------------------
# HTTP: PDF ingest + Screenshot-to-Insight
# ---------------------------------------------------------------------------


class PdfIngestResult(BaseModel):
    ok: bool = True
    source_url: str = ""
    parser_hint: str = ""
    chunks_parsed: int
    chunk_preview: str = ""
    embedded: int = 0
    written: int = 0
    embed_skipped: bool = False


class ChartVisionResult(BaseModel):
    ok: bool = True
    table_fqn: str
    table_token: str
    chart_title: str | None = None
    unit_notes: str | None = None
    row_count: int
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)
    structured: dict[str, Any] = Field(default_factory=dict)
    narrative_embedding: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional: embedding upsert of a text summary of the chart",
    )


@router.post("/pdf", response_model=PdfIngestResult)
async def post_ingest_pdf(
    file: UploadFile = File(..., description="PDF to parse and index"),
    source_url: str = Form("", description="Original URL (metadata for vectors)"),
    document_title: str = Form(""),
    embed: bool = Form(
        True,
        description="If true, run embeddings and upsert; otherwise parse only (no API key).",
    ),
    parser: Literal["auto", "llamaparse", "unstructured", "pymupdf"] = Form("auto"),
) -> PdfIngestResult:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    fname = file.filename or "upload.pdf"
    prefer = cast(Any, parser)
    ch = parse_pdf_bytes(
        data,
        filename=fname,
        source_url=source_url or fname,
        prefer=prefer,
    )
    preview = (ch[0].text[:500] + "…") if ch and len(ch[0].text) > 500 else (ch[0].text if ch else "")
    parser_hint = ch[0].parser if ch else "none"
    if not embed:
        return PdfIngestResult(
            source_url=source_url or "",
            parser_hint=parser_hint,
            chunks_parsed=len(ch),
            chunk_preview=preview,
            embed_skipped=True,
        )
    if not ch:
        raise HTTPException(
            status_code=422,
            detail="No text extracted from PDF; try another parser or check the file.",
        )
    r = await index_chunks(
        ch,
        source_url=source_url or fname,
        document_title=document_title or None,
    )
    return PdfIngestResult(
        source_url=source_url,
        parser_hint=parser_hint,
        chunks_parsed=int(r["chunks"]),
        chunk_preview=preview,
        embedded=int(r["embedded"]),
        written=int(r["written"]),
    )


@router.post("/vision/chart", response_model=ChartVisionResult)
async def post_screenshot_to_insight(
    file: UploadFile = File(..., description="Chart or table image (png, jpg, webp, gif)"),
    user_hint: str = Form(""),
    source_url: str = Form(""),
    embed_narrative: bool = Form(
        True,
        description="Embed a short text summary in document_embeddings (requires OpenAI).",
    ),
) -> ChartVisionResult:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image.")
    prov = (settings.vision_provider or "openai").lower()
    if prov == "anthropic":
        structured = await _vision_anthropic(raw, user_hint or None)
    else:
        structured = await _vision_openai(raw, user_hint or None)
    rows_obj = structured.get("rows")
    if not isinstance(rows_obj, list):
        rows_obj = []
    col_obj = structured.get("columns")
    cols: list[str] = list(col_obj) if isinstance(col_obj, list) else []
    rows_dicts = [r for r in rows_obj if isinstance(r, dict)]
    columns, values = _rows_to_sql_values(rows_dicts, cols)
    token = uuid.uuid4().hex
    if columns and values:
        await _create_staging_table(token, columns, values)
    else:
        await _create_staging_table(
            token,
            ["extraction"],
            [("Model returned no row data; see structured JSON in API response.",)],
        )
    tname = f'ingest_staging."t_{token}"'
    sample = [
        {columns[i] if i < len(columns) else f"c{i}": (row[i] if i < len(row) else None) for i in range(len(row))}  # noqa: E501
        for row in values[:5]
    ]
    narr: dict[str, Any] = {}
    if embed_narrative and (settings.openai_api_key or __import__("os").environ.get("OPENAI_API_KEY")):  # noqa: E501
        summary = (
            f"Chart extraction ({structured.get('chart_title') or 'untitled'}). "
            f"Rows: {len(values)}. {structured.get('unit_notes') or ''}"
        )
        ic = [
            IngestChunk(
                text=summary,
                page_number=1,
                chunk_index=0,
                source_label=source_url or f"vision:{token}",
                parser=prov,
            )
        ]
        try:
            narr = await index_chunks(
                ic,
                source_url=source_url or f"ingest/vision/chart/{token}",
                document_title=str(structured.get("chart_title") or "Chart screenshot"),
            )
        except HTTPException as e:
            d = e.detail
            narr = {"error": d if isinstance(d, (str, list)) else str(d)}

    return ChartVisionResult(
        table_fqn=tname,
        table_token=token,
        chart_title=structured.get("chart_title")
        if isinstance(structured.get("chart_title"), (str, type(None)))
        else None,
        unit_notes=structured.get("unit_notes")
        if isinstance(structured.get("unit_notes"), (str, type(None)))
        else None,
        row_count=len(values),
        sample_rows=sample,
        structured=cast(dict[str, Any], structured),
        narrative_embedding=narr,
    )


@router.get("/vision/chart/help")
async def vision_chart_schema() -> dict[str, str]:
    return {
        "description": "POST multipart form: `file` (image), optional `user_hint`, `source_url`, `embed_narrative`.",
        "env": "OPENAI_API_KEY for default vision+embed; ANTHROPIC_API_KEY if VISION_PROVIDER=anthropic.",
    }
