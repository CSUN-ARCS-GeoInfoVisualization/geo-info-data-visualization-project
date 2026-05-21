"""add feature_cache_elevation and feature_cache_evi tables

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-05-20 21:15:00
"""
from alembic import op
import sqlalchemy as sa


revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'feature_cache_elevation',
        sa.Column('tile_lat', sa.Numeric(7, 4), nullable=False),
        sa.Column('tile_lon', sa.Numeric(8, 4), nullable=False),
        sa.Column('elevation_m', sa.Float(), nullable=False),
        sa.Column('source', sa.String(32), nullable=False, server_default='usgs_3dep'),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('tile_lat', 'tile_lon', name='pk_feature_cache_elevation'),
    )

    op.create_table(
        'feature_cache_evi',
        sa.Column('tile_lat', sa.Numeric(7, 4), nullable=False),
        sa.Column('tile_lon', sa.Numeric(8, 4), nullable=False),
        sa.Column('evi', sa.Float(), nullable=False),
        sa.Column('source', sa.String(32), nullable=False),
        sa.Column('composite_date', sa.Date(), nullable=False),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('tile_lat', 'tile_lon', name='pk_feature_cache_evi'),
    )
    op.create_index('ix_feature_cache_evi_composite_date', 'feature_cache_evi', ['composite_date'])


def downgrade() -> None:
    op.drop_index('ix_feature_cache_evi_composite_date', table_name='feature_cache_evi')
    op.drop_table('feature_cache_evi')
    op.drop_table('feature_cache_elevation')
