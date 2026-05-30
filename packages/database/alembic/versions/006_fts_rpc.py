"""FTS RPC

Revision ID: 006_fts_rpc
Revises: 005_portfolio_positions
Create Date: 2026-05-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '006_fts_rpc'
down_revision = '005_portfolio_positions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create or replace function public.match_rag_chunks_fts(
      fts_query text,
      match_count int,
      source_filter text[] default null
    ) returns setof public.document_embeddings
    language sql stable as $$
      select d.*
      from public.document_embeddings d
      where d.content @@ plainto_tsquery('english', fts_query)
        and (source_filter is null or d.source = any (source_filter))
      limit match_count
    $$;
    """)


def downgrade() -> None:
    op.execute("drop function if exists public.match_rag_chunks_fts")
