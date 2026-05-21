"""add endpoint_cache table — universal DB-backed response cache

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-05-21 00:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = 'f7a8b9c0d1e2'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'endpoint_cache',
        sa.Column('cache_key', sa.String(128), nullable=False),
        sa.Column('body', sa.LargeBinary(), nullable=False),
        sa.Column('etag', sa.String(64), nullable=False),
        sa.Column('content_type', sa.String(64), nullable=False, server_default='application/json'),
        sa.Column('computed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('cache_key', name='pk_endpoint_cache'),
    )
    op.create_index('ix_endpoint_cache_computed_at', 'endpoint_cache', ['computed_at'])


def downgrade() -> None:
    op.drop_index('ix_endpoint_cache_computed_at', table_name='endpoint_cache')
    op.drop_table('endpoint_cache')
