"""Compatibility view: market_indices maps to market_data (same columns, metadata alias).

Revision ID: 004
Revises: 003
Create Date: 2026-04-27
"""

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE VIEW market_indices AS
        SELECT
          id,
          as_of_utc,
          code,
          value,
          return_1d,
          chunk_metadata AS metadata
        FROM market_data;
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS market_indices;")
