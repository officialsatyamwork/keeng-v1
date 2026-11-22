"""customer date of birth, allergies, and preferences

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("users", "customers"):
        op.add_column(table, sa.Column("date_of_birth", sa.Date(), nullable=True))
        op.add_column(table, sa.Column("allergies", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("preferences", sa.Text(), nullable=True))


def downgrade() -> None:
    for table in ("customers", "users"):
        op.drop_column(table, "preferences")
        op.drop_column(table, "allergies")
        op.drop_column(table, "date_of_birth")
