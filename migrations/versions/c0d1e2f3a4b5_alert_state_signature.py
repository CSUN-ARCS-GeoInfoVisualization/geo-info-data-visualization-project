"""Change-driven alert dedup via state_signature on alert_activity

Replaces the 24h-bucket dedup with a state-driven one: an alert is only
re-sent when the (tier_bucket, sorted_at_risk_location_ids) tuple actually
differs from the most recent send for that user. Additive column only.

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-05-25
"""
from alembic import op


revision = 'c0d1e2f3a4b5'
down_revision = 'b9c0d1e2f3a4'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS state_signature VARCHAR(64)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_alert_activity_user_signature "
               "ON alert_activity (user_id, state_signature)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_alert_activity_user_signature")
    op.execute("ALTER TABLE alert_activity DROP COLUMN IF EXISTS state_signature")
