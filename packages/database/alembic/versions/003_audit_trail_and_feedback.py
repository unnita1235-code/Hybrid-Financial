"""Audit trail, human feedback, and placeholder executive-restricted tables.

Revision ID: 003
Revises: 002
Create Date: 2026-04-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column(
            "id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("user_role", sa.Text(), nullable=False, server_default="analyst"),
        sa.Column("prompt_template", sa.Text(), nullable=False),
        sa.Column("user_query", sa.Text(), nullable=True),
        sa.Column("generated_sql", sa.Text(), nullable=True),
        sa.Column("rag_chunks", sa.JSON(), nullable=True),
        sa.Column("model_versions", sa.JSON(), nullable=True),
        sa.Column("final_narrative", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"], unique=False)
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], unique=False)

    op.create_table(
        "human_feedback",
        sa.Column(
            "id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("audit_log_id", sa.Uuid(), nullable=False),
        sa.Column("vote", sa.SmallInteger(), nullable=False),
        sa.Column("correction_text", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["audit_log_id"],
            ["audit_logs.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_human_feedback_audit", "human_feedback", ["audit_log_id"], unique=False)

    # Placeholder “Executive” tables (RBAC enforced in the API / SQL agent).
    op.create_table(
        "salaries",
        sa.Column(
            "id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(128), nullable=True),
        sa.Column("amount_annual", sa.Numeric(18, 2), nullable=True),
        sa.Column("as_of_utc", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_table(
        "m_and_a_plans",
        sa.Column(
            "id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("deal_name", sa.String(255), nullable=True),
        sa.Column("status", sa.String(64), nullable=True),
        sa.Column("confidential_memo", sa.Text(), nullable=True),
        sa.Column("updated_utc", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("m_and_a_plans")
    op.drop_table("salaries")
    op.execute("DROP INDEX IF EXISTS ix_human_feedback_audit")
    op.drop_table("human_feedback")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_created_at")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_user_id")
    op.drop_table("audit_logs")
