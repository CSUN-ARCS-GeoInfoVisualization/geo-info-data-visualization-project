"""Add news_articles table for 90-day fire news retention and ML snapshots

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-03-24

"""
from alembic import op
import sqlalchemy as sa


revision = 'b3c4d5e6f7a8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'news_articles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('url_hash', sa.String(length=64), nullable=False),
        sa.Column('article_id', sa.String(length=64), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('category', sa.String(length=24), nullable=False),
        sa.Column('source_bucket', sa.String(length=32), nullable=False),
        sa.Column('source_label', sa.String(length=255), nullable=False),
        sa.Column('is_breaking', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_fallback', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('provenance', sa.String(length=64), nullable=True),
        sa.Column('training_meta', sa.JSON(), nullable=True),
        sa.Column('first_ingested_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_news_articles_article_id'), 'news_articles', ['article_id'], unique=False)
    op.create_index(op.f('ix_news_articles_is_fallback'), 'news_articles', ['is_fallback'], unique=False)
    op.create_index(op.f('ix_news_articles_published_at'), 'news_articles', ['published_at'], unique=False)
    op.create_index(op.f('ix_news_articles_source_bucket'), 'news_articles', ['source_bucket'], unique=False)
    op.create_index(op.f('ix_news_articles_url_hash'), 'news_articles', ['url_hash'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_news_articles_url_hash'), table_name='news_articles')
    op.drop_index(op.f('ix_news_articles_source_bucket'), table_name='news_articles')
    op.drop_index(op.f('ix_news_articles_published_at'), table_name='news_articles')
    op.drop_index(op.f('ix_news_articles_is_fallback'), table_name='news_articles')
    op.drop_index(op.f('ix_news_articles_article_id'), table_name='news_articles')
    op.drop_table('news_articles')
