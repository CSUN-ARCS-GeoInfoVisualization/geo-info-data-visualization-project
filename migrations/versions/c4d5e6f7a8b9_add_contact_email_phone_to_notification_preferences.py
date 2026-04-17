"""Add contact_email and contact_phone to notification_preferences

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-04-17

"""
from alembic import op
import sqlalchemy as sa


revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'notification_preferences',
        sa.Column('contact_email', sa.String(length=255), nullable=True),
    )
    op.add_column(
        'notification_preferences',
        sa.Column('contact_phone', sa.String(length=32), nullable=True),
    )


def downgrade():
    op.drop_column('notification_preferences', 'contact_phone')
    op.drop_column('notification_preferences', 'contact_email')
