"""widen endpoint_cache.cache_key + add body_br for pre-compressed responses

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-05-21 00:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = 'a8b9c0d1e2f3'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Widen cache_key — String(128) was overflowing for some endpoints (DINS w/ full URL).
    op.alter_column('endpoint_cache', 'cache_key', existing_type=sa.String(128), type_=sa.String(256))
    # body_br: optional pre-compressed Brotli body. When present, serve directly
    # with Content-Encoding: br — eliminates per-request compression CPU.
    op.add_column('endpoint_cache', sa.Column('body_br', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column('endpoint_cache', 'body_br')
    op.alter_column('endpoint_cache', 'cache_key', existing_type=sa.String(256), type_=sa.String(128))
