"""Alert channel toggles + per-location zone-ID pre-resolution

Adds three per-channel alert toggles to notification_preferences and four
zone-resolution columns to user_locations. Both blocks are additive only
(IF NOT EXISTS) so we never blow up if a prior runtime shim already added
the same column, and so a rollback is loss-free.

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-05-25
"""
from alembic import op


revision = 'b9c0d1e2f3a4'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE notification_preferences "
        "ADD COLUMN IF NOT EXISTS breaking_news_enabled BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE notification_preferences "
        "ADD COLUMN IF NOT EXISTS high_risk_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    )
    op.execute(
        "ALTER TABLE notification_preferences "
        "ADD COLUMN IF NOT EXISTS evacuation_enabled BOOLEAN NOT NULL DEFAULT TRUE"
    )

    op.execute("ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS county_fips VARCHAR(5)")
    op.execute("ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS zip_code VARCHAR(10)")
    op.execute("ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS neighborhood_id VARCHAR(64)")
    op.execute("ALTER TABLE user_locations ADD COLUMN IF NOT EXISTS census_tract_id VARCHAR(11)")


def downgrade():
    op.execute("ALTER TABLE user_locations DROP COLUMN IF EXISTS census_tract_id")
    op.execute("ALTER TABLE user_locations DROP COLUMN IF EXISTS neighborhood_id")
    op.execute("ALTER TABLE user_locations DROP COLUMN IF EXISTS zip_code")
    op.execute("ALTER TABLE user_locations DROP COLUMN IF EXISTS county_fips")
    op.execute("ALTER TABLE notification_preferences DROP COLUMN IF EXISTS evacuation_enabled")
    op.execute("ALTER TABLE notification_preferences DROP COLUMN IF EXISTS high_risk_enabled")
    op.execute("ALTER TABLE notification_preferences DROP COLUMN IF EXISTS breaking_news_enabled")
