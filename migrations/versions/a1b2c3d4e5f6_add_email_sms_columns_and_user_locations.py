"""Add email_enabled, sms_enabled to notification_preferences and user_locations table

Revision ID: a1b2c3d4e5f6
Revises: f862ecd2313f
Create Date: 2026-03-23

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'f862ecd2313f'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('notification_preferences',
        sa.Column('email_enabled', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('notification_preferences',
        sa.Column('sms_enabled', sa.Boolean(), nullable=False, server_default='false'))

    op.create_table('user_locations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('address', sa.String(length=255), nullable=True),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lon', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade():
    op.drop_table('user_locations')
    op.drop_column('notification_preferences', 'sms_enabled')
    op.drop_column('notification_preferences', 'email_enabled')
