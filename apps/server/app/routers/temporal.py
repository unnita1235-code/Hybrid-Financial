r"""Temporal agent over WebSocket; phase logs (see :mod:`app.graph.temporal`)."""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from aequitas_ai import TemporalAgentOutput
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.graph.temporal import get_temporal_graph
from middleware.redactor import redaction_session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/temporal", tags=["temporal"])

_NODE_PHASE_LOGS: dict[str, str] = {
    "sql_splitter": "Generating SQL...",
    "delta_calculator": "Executing query...",
    "targeted_rag": "Searching documents...",
    "assemble": "Synthesizing narrative...",
}


class _RunMessage(BaseModel):
    type: Literal["run"] = "run"
    thread_id: str = Field(min_length=1, max_length=256)
    user_query: str = Field(min_length=4, max_length=4_000)


@router.websocket("/ws")
async def temporal_websocket(websocket: WebSocket) -> None:
    """
    **Requires** ``OPENAI_API_KEY`` (chat + embeddings). Supabase (``SUPABASE_URL`` +
    ``SUPABASE_SERVICE_KEY``) is optional for the RAG node.

    Client sends a single JSON text frame, e.g.:
    ``{"type":"run","thread_id":"<uuid>","user_query":"..."}``.

    Server streams JSON: ``log`` (phase lines), then ``result`` (payload + ``warning``), or
    ``error``.
    """
    await websocket.accept()
    if not settings.openai_api_key:
        await websocket.send_json(
            {
                "type": "error",
                "message": "OPENAI_API_KEY is required for the temporal agent.",
            }
        )
        await websocket.close()
        return
    try:
        try:
            graph = get_temporal_graph()
        except RuntimeError as e:
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close()
            return

        try:
            raw = await websocket.receive_text()
        except WebSocketDisconnect:
            return
        try:
            body = json.loads(raw)
        except json.JSONDecodeError as e:
            await websocket.send_json(
                {"type": "error", "message": f"Invalid JSON: {e}"}
            )
            return
        try:
            run = _RunMessage.model_validate(body)
        except ValidationError as e:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Invalid run message: {e!s}",
                }
            )
            return

        config: dict[str, Any] = {
            "configurable": {"thread_id": run.thread_id},
        }
        uq = run.user_query

        async def send_log(msg: str, node: str) -> None:
            try:
                await websocket.send_json(
                    {"type": "log", "message": msg, "node": node}
                )
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001
                log.debug("WebSocket log send failed", exc_info=True)

        stream_body = {
            "user_query": uq,
        }

        if settings.pii_redaction_enabled:

            async def run_stream() -> None:
                async for ev in graph.astream_events(
                    stream_body,
                    config,
                    version="v2",
                ):
                    if ev.get("event") != "on_chain_start":
                        continue
                    name = ev.get("name")
                    if not isinstance(name, str) or name not in _NODE_PHASE_LOGS:
                        continue
                    await send_log(_NODE_PHASE_LOGS[name], name)

            async with redaction_session():
                await run_stream()
        else:
            async for ev in graph.astream_events(
                stream_body,
                config,
                version="v2",
            ):
                if ev.get("event") != "on_chain_start":
                    continue
                name = ev.get("name")
                if not isinstance(name, str) or name not in _NODE_PHASE_LOGS:
                    continue
                await send_log(_NODE_PHASE_LOGS[name], name)

        snap = await graph.aget_state(config)
        values = (snap.values if snap is not None else None) or {}
        raw_res = values.get("result")
        if not isinstance(raw_res, dict):
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Temporal graph returned no result payload.",
                }
            )
            return
        w = raw_res.get("_warning")
        d = {k: v for k, v in raw_res.items() if k != "_warning"}
        base = TemporalAgentOutput.model_validate(d)
        out: dict[str, Any] = {
            **base.model_dump(),
            "warning": w,
        }
        # Extra fields for clients (e.g. SQL preview) from graph state, not in output model
        for key in (
            "sql_baseline",
            "sql_new",
        ):
            v = values.get(key)
            if v is not None:
                out[key] = v
        try:
            await websocket.send_json({"type": "result", "data": out})
        except WebSocketDisconnect:
            return
    except WebSocketDisconnect:
        return
    except Exception as e:  # noqa: BLE001
        log.exception("temporal WebSocket run failed")
        try:
            await websocket.send_json(
                {"type": "error", "message": f"Temporal run failed: {e!s}"}
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
