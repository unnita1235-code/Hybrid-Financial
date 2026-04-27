from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.identity import get_identity
from app.config import settings
from app.db import get_session_maker
from app.services import portfolio_svc

router = APIRouter(prefix="/v1/portfolio", tags=["portfolio"])


async def _get_session() -> AsyncIterator[AsyncSession]:
    sm = get_session_maker()
    async with sm() as session:
        yield session


def _synthesis_llm() -> BaseChatModel:
    model = (settings.synthesis_model or "gpt-4o-mini").strip()
    if model.startswith("claude"):
        if settings.anthropic_api_key:
            return ChatAnthropic(
                model=model,
                temperature=0.2,
                api_key=settings.anthropic_api_key,
            )
        if not settings.openai_api_key:
            raise HTTPException(503, "Set ANTHROPIC_API_KEY or OPENAI_API_KEY for synthesis.")
        return ChatOpenAI(model="gpt-4o-mini", temperature=0.2, api_key=settings.openai_api_key)
    if not settings.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY is required for synthesis.")
    return ChatOpenAI(model=model, temperature=0.2, api_key=settings.openai_api_key)


def _parse_user_id_or_400(sub: str | None) -> UUID:
    if not sub:
        raise HTTPException(status_code=401, detail="Missing user identity")
    try:
        return UUID(sub)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Identity subject must be a UUID") from e


def _json_dumps(payload: dict) -> str:
    return json.dumps(payload, default=str)


class PortfolioCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class PortfolioOut(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    description: str | None
    is_active: bool
    created_at: str
    updated_at: str | None

    @classmethod
    def from_row(cls, row) -> "PortfolioOut":
        return cls(
            id=row.id,
            user_id=row.user_id,
            name=row.name,
            description=row.description,
            is_active=row.is_active,
            created_at=row.created_at.isoformat() if row.created_at else "",
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )


class PositionCreateBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    quantity: Decimal
    entry_price: Decimal
    entry_date: date
    notes: str | None = Field(default=None, max_length=500)


class PositionOut(BaseModel):
    id: UUID
    portfolio_id: UUID
    symbol: str
    quantity: Decimal
    entry_price: Decimal
    entry_date: date
    notes: str | None
    created_at: str

    @classmethod
    def from_row(cls, row) -> "PositionOut":
        return cls(
            id=row.id,
            portfolio_id=row.portfolio_id,
            symbol=row.symbol,
            quantity=row.quantity,
            entry_price=row.entry_price,
            entry_date=row.entry_date,
            notes=row.notes,
            created_at=row.created_at.isoformat() if row.created_at else "",
        )


class PortfolioAnalyzeBody(BaseModel):
    question: str = Field(
        default="Analyze concentration risk, sizing, and current portfolio P&L profile.",
        min_length=4,
        max_length=2_000,
    )


@router.post("", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
async def create_portfolio(
    request: Request,
    body: PortfolioCreateBody,
    session: AsyncSession = Depends(_get_session),
) -> PortfolioOut:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    row = await portfolio_svc.create_portfolio(session, user_id, body.name, body.description)
    return PortfolioOut.from_row(row)


@router.get("", response_model=list[PortfolioOut])
async def list_portfolios(
    request: Request,
    session: AsyncSession = Depends(_get_session),
) -> list[PortfolioOut]:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    rows = await portfolio_svc.list_portfolios(session, user_id)
    return [PortfolioOut.from_row(r) for r in rows]


@router.post("/{portfolio_id}/positions", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
async def add_position(
    request: Request,
    portfolio_id: UUID,
    body: PositionCreateBody,
    session: AsyncSession = Depends(_get_session),
) -> PositionOut:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    portfolio = await portfolio_svc.get_portfolio(session, portfolio_id, user_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    row = await portfolio_svc.add_position(
        session=session,
        portfolio_id=portfolio_id,
        symbol=body.symbol,
        quantity=body.quantity,
        entry_price=body.entry_price,
        entry_date=body.entry_date,
        notes=body.notes,
    )
    return PositionOut.from_row(row)


@router.get("/{portfolio_id}/positions", response_model=list[PositionOut])
async def list_positions(
    request: Request,
    portfolio_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> list[PositionOut]:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    portfolio = await portfolio_svc.get_portfolio(session, portfolio_id, user_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    rows = await portfolio_svc.list_positions(session, portfolio_id)
    return [PositionOut.from_row(r) for r in rows]


@router.delete("/{portfolio_id}/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    request: Request,
    portfolio_id: UUID,
    position_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> None:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    portfolio = await portfolio_svc.get_portfolio(session, portfolio_id, user_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    deleted = await portfolio_svc.delete_position(session, position_id, portfolio_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Position not found")


@router.get("/{portfolio_id}/pnl")
async def get_pnl(
    request: Request,
    portfolio_id: UUID,
    session: AsyncSession = Depends(_get_session),
) -> dict:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    portfolio = await portfolio_svc.get_portfolio(session, portfolio_id, user_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return await portfolio_svc.compute_pnl(session, portfolio_id)


async def _analysis_stream(
    request: Request,
    portfolio_id: UUID,
    body: PortfolioAnalyzeBody,
    session: AsyncSession,
) -> AsyncIterator[str]:
    ident = await get_identity(request)
    user_id = _parse_user_id_or_400(ident.sub)
    portfolio = await portfolio_svc.get_portfolio(session, portfolio_id, user_id)
    if portfolio is None:
        yield f"data: {_json_dumps({'type': 'error', 'message': 'Portfolio not found'})}\n\n"
        return

    positions = await portfolio_svc.list_positions(session, portfolio_id)
    pnl = await portfolio_svc.compute_pnl(session, portfolio_id)
    context = {
        "portfolio": PortfolioOut.from_row(portfolio).model_dump(),
        "positions": [PositionOut.from_row(p).model_dump(mode="json") for p in positions],
        "pnl": pnl,
    }

    llm = _synthesis_llm()
    prompt = [
        SystemMessage(
            content=(
                "You are a portfolio risk analyst. Provide concise, actionable analysis with "
                "focus on concentration, sizing, P&L drivers, and risk controls."
            )
        ),
        HumanMessage(
            content=(
                f"User question: {body.question}\n\n"
                f"Portfolio context (JSON):\n{json.dumps(context, default=str)}\n\n"
                "Return a practical narrative with clear recommendations."
            )
        ),
    ]
    res = await llm.ainvoke(prompt)
    content = getattr(res, "content", "")
    text = content if isinstance(content, str) else str(content)

    yield f"data: {_json_dumps({'type': 'context', 'data': context})}\n\n"
    parts = text.split(" ")
    for i, token in enumerate(parts):
        delta = token + (" " if i < len(parts) - 1 else "")
        if delta:
            yield f"data: {_json_dumps({'type': 'narrative', 'delta': delta})}\n\n"
    yield f"data: {_json_dumps({'type': 'done'})}\n\n"


@router.post("/{portfolio_id}/analyze")
async def analyze_portfolio(
    request: Request,
    portfolio_id: UUID,
    body: PortfolioAnalyzeBody,
    session: AsyncSession = Depends(_get_session),
) -> StreamingResponse:
    return StreamingResponse(
        _analysis_stream(request, portfolio_id, body, session),
        media_type="text/event-stream; charset=utf-8",
    )
