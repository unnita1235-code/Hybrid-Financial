"""Tests for PII redaction session and LLM proxy."""

from __future__ import annotations

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from middleware.redactor import (
    RedactingChatModel,
    RedactionSession,
    get_redaction_session,
    redaction_session,
)


class EchoChat(BaseChatModel):
    """Returns the last human message string as the assistant reply."""

    @property
    def _llm_type(self) -> str:
        return "echo"

    def _generate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager=None,
        **kwargs,
    ) -> ChatResult:
        last = messages[-1]
        text = last.content if isinstance(last.content, str) else ""
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    async def _agenerate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager=None,
        **kwargs,
    ) -> ChatResult:
        return self._generate(messages, stop, run_manager, **kwargs)


def test_restore_prefers_longest_placeholder_first() -> None:
    s = RedactionSession()
    s.placeholder_to_secret["[[AEQ_A_10]]"] = "first"
    s.placeholder_to_secret["[[AEQ_A_1]]"] = "second"
    out = s.restore("[[AEQ_A_10]] [[AEQ_A_1]]")
    assert out == "first second"


@pytest.mark.asyncio
async def test_redaction_session_context_is_isolated() -> None:
    assert get_redaction_session() is None
    async with redaction_session() as sess:
        assert get_redaction_session() is sess
    assert get_redaction_session() is None


@pytest.mark.asyncio
async def test_redacting_proxy_restores_using_session_map(monkeypatch) -> None:
    # Avoid loading Presidio/spaCy in CI; redact is a no-op for this scenario.
    monkeypatch.setattr(
        RedactionSession,
        "redact_text",
        lambda self, text: text,
    )
    async with redaction_session() as sess:
        sess.placeholder_to_secret["[[AEQ_ZZ_0]]"] = "RestoredValue"
        proxy = RedactingChatModel(bound=EchoChat())
        msg = HumanMessage(content="prefix [[AEQ_ZZ_0]] suffix")
        out = await proxy.ainvoke([msg])
        assert out.content == "prefix RestoredValue suffix"


@pytest.mark.asyncio
async def test_redacting_proxy_no_session_passthrough() -> None:
    proxy = RedactingChatModel(bound=EchoChat())
    msg = HumanMessage(content="unchanged")
    out = await proxy.ainvoke([msg])
    assert out.content == "unchanged"
