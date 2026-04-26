"""Transactions, market_data, and AI insight notifications (shadow analyst output).

Revision ID: 002
Revises: 001
Create Date: 2026-01-01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("ts_utc", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("price", sa.Numeric(18, 6), nullable=False),
        sa.Column("volume", sa.Numeric(24, 6), nullable=False),
        sa.Column("buy_sell", sa.String(1), nullable=True),
    )
    op.create_index("ix_transactions_ts", "transactions", ["ts_utc"], unique=False)
    op.create_index("ix_transactions_sym", "transactions", ["symbol"], unique=False)

    op.create_table(
        "market_data",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("as_of_utc", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("value", sa.Numeric(24, 8), nullable=False),
        sa.Column("return_1d", sa.Numeric(18, 10), nullable=True),
        sa.Column("chunk_metadata", sa.JSON(), nullable=True),
    )
    op.create_index("ix_market_data_asof", "market_data", ["as_of_utc"], unique=False)
    op.create_index("ix_market_data_code", "market_data", ["code"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "kind",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'ai_insight'"),
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("z_score", sa.Numeric(18, 6), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_notifications_user", "notifications", ["user_id"], unique=False)
    op.create_index("ix_notifications_created", "notifications", ["created_at"], unique=False)
    op.create_index("ix_notifications_kind", "notifications", ["kind"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notifications_kind", table_name="notifications")
    op.drop_index("ix_notifications_created", table_name="notifications")
    op.drop_index("ix_notifications_user", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_market_data_code", table_name="market_data")
    op.drop_index("ix_market_data_asof", table_name="market_data")
    op.drop_table("market_data")
    op.drop_index("ix_transactions_sym", table_name="transactions")
    op.drop_index("ix_transactions_ts", table_name="transactions")
    op.drop_table("transactions")
