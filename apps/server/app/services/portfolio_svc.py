from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from aequitas_database.models.portfolio import Portfolio, Position


def _to_decimal(value: Decimal | int | float | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


async def create_portfolio(
    session: AsyncSession,
    user_id: UUID,
    name: str,
    description: str | None,
) -> Portfolio:
    row = Portfolio(
        user_id=user_id,
        name=name.strip(),
        description=(description or None),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_portfolios(session: AsyncSession, user_id: UUID) -> list[Portfolio]:
    stmt: Select[tuple[Portfolio]] = (
        select(Portfolio)
        .where(Portfolio.user_id == user_id, Portfolio.is_active.is_(True))
        .order_by(Portfolio.created_at.desc())
    )
    res = await session.execute(stmt)
    return list(res.scalars().all())


async def get_portfolio(
    session: AsyncSession,
    portfolio_id: UUID,
    user_id: UUID,
) -> Portfolio | None:
    stmt: Select[tuple[Portfolio]] = select(Portfolio).where(
        Portfolio.id == portfolio_id,
        Portfolio.user_id == user_id,
        Portfolio.is_active.is_(True),
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def add_position(
    session: AsyncSession,
    portfolio_id: UUID,
    symbol: str,
    quantity: Decimal | int | float | str,
    entry_price: Decimal | int | float | str,
    entry_date: date,
    notes: str | None,
) -> Position:
    row = Position(
        portfolio_id=portfolio_id,
        symbol=symbol.strip().upper(),
        quantity=_to_decimal(quantity),
        entry_price=_to_decimal(entry_price),
        entry_date=entry_date,
        notes=(notes or None),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_positions(session: AsyncSession, portfolio_id: UUID) -> list[Position]:
    stmt: Select[tuple[Position]] = (
        select(Position)
        .where(Position.portfolio_id == portfolio_id)
        .order_by(Position.created_at.asc())
    )
    res = await session.execute(stmt)
    return list(res.scalars().all())


async def delete_position(session: AsyncSession, position_id: UUID, portfolio_id: UUID) -> bool:
    stmt = delete(Position).where(
        Position.id == position_id,
        Position.portfolio_id == portfolio_id,
    )
    res = await session.execute(stmt)
    await session.commit()
    return bool(res.rowcount and res.rowcount > 0)


async def compute_pnl(session: AsyncSession, portfolio_id: UUID) -> dict:
    rows = await list_positions(session, portfolio_id)
    out_positions: list[dict[str, float | str]] = []
    total_pnl = Decimal("0")
    total_value = Decimal("0")

    for pos in rows:
        latest_price_res = await session.execute(
            text(
                "SELECT value "
                "FROM market_data "
                "WHERE code = :code "
                "ORDER BY as_of_utc DESC "
                "LIMIT 1"
            ),
            {"code": pos.symbol},
        )
        current_price_raw = latest_price_res.scalar_one_or_none()
        current_price = _to_decimal(current_price_raw or Decimal("0"))

        position_value = pos.quantity * current_price
        pnl = (current_price - pos.entry_price) * pos.quantity
        basis = pos.entry_price * pos.quantity
        pnl_pct = (pnl / basis * Decimal("100")) if basis != 0 else Decimal("0")

        total_pnl += pnl
        total_value += position_value

        out_positions.append(
            {
                "symbol": pos.symbol,
                "quantity": float(pos.quantity),
                "entry_price": float(pos.entry_price),
                "current_price": float(current_price),
                "pnl": float(pnl),
                "pnl_pct": float(pnl_pct),
            }
        )

    return {
        "positions": out_positions,
        "total_pnl": float(total_pnl),
        "total_value": float(total_value),
    }
