"""add feature_cache_kbdi table

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-05-20 22:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = 'e6f7a8b9c0d1'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'feature_cache_kbdi',
        sa.Column('tile_lat', sa.Numeric(7, 4), nullable=False),
        sa.Column('tile_lon', sa.Numeric(8, 4), nullable=False),
        sa.Column('kbdi', sa.Float(), nullable=False),
        sa.Column('source', sa.String(32), nullable=False, server_default='nasa_power'),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('tile_lat', 'tile_lon', name='pk_feature_cache_kbdi'),
    )
    op.create_index('ix_feature_cache_kbdi_fetched_at', 'feature_cache_kbdi', ['fetched_at'])


def downgrade() -> None:
    op.drop_index('ix_feature_cache_kbdi_fetched_at', table_name='feature_cache_kbdi')
    op.drop_table('feature_cache_kbdi')
