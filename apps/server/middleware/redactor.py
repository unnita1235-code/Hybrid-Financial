"""
Local PII redaction for synthesis LLM calls: scrub prompts with Presidio, keep an
in-memory placeholder map for the request, restore model output before returning.

Upstream SQL-splitter / other LLM nodes may still see raw user_query; see temporal
agent and graph wiring.
"""

from __future__ import annotations

import copy
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ConfigDict, Field

# Presidio entity type -> stable bracket label (no spaces for token safety)
_ENTITY_LABELS: dict[str, str] = {
    "PERSON": "CLIENT_NAME",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "CREDIT_CARD": "ACCT_ID",
    "US_BANK_NUMBER": "ACCT_ID",
    "IBAN_CODE": "ACCT_ID",
    "US_SSN": "GOV_ID",
    "US_PASSPORT": "GOV_ID",
    "US_DRIVER_LICENSE": "GOV_ID",
    "IP_ADDRESS": "IP",
    "LOCATION": "LOCATION",
    "DATE_TIME": "DATETIME",
    "NRP": "NRP",
    "CRYPTO": "CRYPTO",
    "MEDICAL_LICENSE": "MEDICAL_ID",
    "URL": "URL",
}

_redaction_ctx: ContextVar[RedactionSession | None] = ContextVar(
    "aequitas_redaction_session", default=None
)


def get_redaction_session() -> RedactionSession | None:
    return _redaction_ctx.get()


class ContextRedactionPiiGuard:
    """
    Implements the ``SynthesisPiiGuard`` protocol via :func:`get_redaction_session`.
    Use inside :func:`redaction_session` when calling :func:`run_hybrid_synthesis`.
    """

    def redact_for_synthesis(self, text: str) -> str:
        session = get_redaction_session()
        return session.redact_text(text) if session else text

    def restore_answer(self, text: str) -> str:
        session = get_redaction_session()
        return session.restore(text) if session else text


@asynccontextmanager
async def redaction_session() -> AsyncIterator[RedactionSession]:
    """Attach a fresh redaction map for the current async task (e.g. one API request)."""
    session = RedactionSession()
    token = _redaction_ctx.set(session)
    try:
        yield session
    finally:
        _redaction_ctx.reset(token)
        session.clear()


@dataclass
class RedactionSession:
    """
    Per-request reversible redaction. Placeholders look like [[AEQ_CLIENT_NAME_0]].
    """

    placeholder_to_secret: dict[str, str] = field(default_factory=dict)
    _next_id: dict[str, int] = field(default_factory=dict)
    _key_to_placeholder: dict[tuple[str, str], str] = field(default_factory=dict)

    def clear(self) -> None:
        self.placeholder_to_secret.clear()
        self._next_id.clear()
        self._key_to_placeholder.clear()

    def redact_text(self, text: str) -> str:
        if not text or not text.strip():
            return text
        engine = _get_analyzer_engine()
        if engine is None:
            return text
        try:
            results = engine.analyze(text=text, language="en")
        except Exception:
            return text
        if not results:
            return text
        spans: list[tuple[int, int, str, str]] = []
        for r in results:
            spans.append((r.start, r.end, r.entity_type, text[r.start : r.end]))
        spans.sort(key=lambda x: (x[0], -(x[1] - x[0])))
        merged: list[tuple[int, int, str, str]] = []
        for s, e, et, val in spans:
            if merged and s < merged[-1][1]:
                # overlap: keep the longer span
                ps, pe, pet, pval = merged[-1]
                if (e - s) > (pe - ps):
                    merged[-1] = (s, e, et, val)
                continue
            merged.append((s, e, et, val))
        out = text
        for s, e, et, val in sorted(merged, key=lambda x: x[0], reverse=True):
            label = _ENTITY_LABELS.get(et, et)
            key = (label, val)
            ph = self._key_to_placeholder.get(key)
            if ph is None:
                n = self._next_id.get(label, 0)
                self._next_id[label] = n + 1
                ph = f"[[AEQ_{label}_{n}]]"
                self._key_to_placeholder[key] = ph
                self.placeholder_to_secret[ph] = val
            out = out[:s] + ph + out[e:]
        return out

    def restore(self, text: str) -> str:
        if not text or not self.placeholder_to_secret:
            return text
        keys = sorted(self.placeholder_to_secret.keys(), key=len, reverse=True)
        out = text
        for ph in keys:
            secret = self.placeholder_to_secret[ph]
            out = out.replace(ph, secret)
        return out


_analyzer_engine: Any = None
_analyzer_failed: bool = False


def _get_analyzer_engine() -> Any | None:
    global _analyzer_engine, _analyzer_failed
    if _analyzer_failed:
        return None
    if _analyzer_engine is not None:
        return _analyzer_engine
    try:
        from presidio_analyzer import AnalyzerEngine
    except ImportError:
        _analyzer_failed = True
        return None
    try:
        _analyzer_engine = AnalyzerEngine()
    except Exception:
        _analyzer_failed = True
        return None
    return _analyzer_engine


def reset_analyzer_cache_for_tests() -> None:
    global _analyzer_engine, _analyzer_failed
    _analyzer_engine = None
    _analyzer_failed = False


def _redact_message_content(msg: BaseMessage, session: RedactionSession) -> BaseMessage:
    c = msg.content
    if isinstance(c, str):
        new_c = session.redact_text(c)
        if new_c == c:
            return msg
        if isinstance(msg, HumanMessage):
            return HumanMessage(content=new_c, additional_kwargs=msg.additional_kwargs)
        if isinstance(msg, SystemMessage):
            return SystemMessage(content=new_c, additional_kwargs=msg.additional_kwargs)
        if isinstance(msg, AIMessage):
            return AIMessage(content=new_c, additional_kwargs=msg.additional_kwargs)
        return copy.copy(msg)
    if isinstance(c, list):
        parts = []
        changed = False
        for block in c:
            if isinstance(block, dict) and block.get("type") == "text":
                t = str(block.get("text", ""))
                rt = session.redact_text(t)
                if rt != t:
                    changed = True
                    nb = dict(block)
                    nb["text"] = rt
                    parts.append(nb)
                else:
                    parts.append(block)
            else:
                parts.append(block)
        if not changed:
            return msg
        if isinstance(msg, HumanMessage):
            return HumanMessage(content=parts, additional_kwargs=msg.additional_kwargs)
        if isinstance(msg, SystemMessage):
            return SystemMessage(content=parts, additional_kwargs=msg.additional_kwargs)
        if isinstance(msg, AIMessage):
            return AIMessage(content=parts, additional_kwargs=msg.additional_kwargs)
    return msg


def _redact_messages(messages: list[BaseMessage], session: RedactionSession) -> list[BaseMessage]:
    return [_redact_message_content(m, session) for m in messages]


def _restore_chat_result(result: ChatResult, session: RedactionSession) -> ChatResult:
    gens: list[ChatGeneration] = []
    for g in result.generations:
        msg = g.message
        raw = getattr(msg, "content", "")
        if isinstance(raw, str):
            restored = session.restore(raw)
            if restored != raw:
                msg = AIMessage(
                    content=restored,
                    additional_kwargs=getattr(msg, "additional_kwargs", {}) or {},
                    response_metadata=getattr(msg, "response_metadata", None) or {},
                )
        gens.append(
            ChatGeneration(
                message=msg,
                generation_info=g.generation_info,
            )
        )
    return ChatResult(generations=gens, llm_output=result.llm_output)


class RedactingChatModel(BaseChatModel):
    """Delegates to ``bound``; redacts message text before the call and restores output."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    bound: BaseChatModel = Field(..., description="Inner chat model (e.g. ChatOpenAI).")

    @property
    def _llm_type(self) -> str:
        return "redacting_proxy"

    def _maybe_redact(
        self, messages: list[BaseMessage]
    ) -> tuple[list[BaseMessage], RedactionSession | None]:
        session = get_redaction_session()
        if session is None:
            return messages, None
        return _redact_messages(messages, session), session

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        redacted, session = self._maybe_redact(messages)
        result = self.bound._generate(
            redacted, stop=stop, run_manager=run_manager, **kwargs
        )
        if session is None:
            return result
        return _restore_chat_result(result, session)

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        redacted, session = self._maybe_redact(messages)
        result = await self.bound._agenerate(
            redacted, stop=stop, run_manager=run_manager, **kwargs
        )
        if session is None:
            return result
        return _restore_chat_result(result, session)

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {"bound": self.bound._llm_type}
