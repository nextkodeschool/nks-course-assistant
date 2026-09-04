"""Chunk position within a session

Revision ID: 0002
Revises: 0001

Lets a session be read back in order. Nullable: chunks indexed before this
existed simply sort last.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kb_chunks", sa.Column("position", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("kb_chunks", "position")
