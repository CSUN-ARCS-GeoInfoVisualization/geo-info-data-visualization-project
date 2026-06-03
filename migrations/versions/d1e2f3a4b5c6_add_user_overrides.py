"""Per-user saved risk-override snapshots (user_overrides)

Stores the slider values a user saved for a zone plus the risk_score+label
frozen at save time. Features mirror the live model: evi, air_temp_encoded,
wind, humidity, elevation, kbdi.

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-06-03
"""
from alembic import op


revision = 'd1e2f3a4b5c6'
down_revision = 'c0d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_overrides (
            id               SERIAL PRIMARY KEY,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            scope            VARCHAR(16)  NOT NULL,
            zone_id          VARCHAR(64)  NOT NULL,
            zone_name        VARCHAR(128),
            evi              DOUBLE PRECISION NOT NULL,
            air_temp_encoded DOUBLE PRECISION NOT NULL,
            wind             DOUBLE PRECISION NOT NULL,
            humidity         DOUBLE PRECISION NOT NULL,
            elevation        DOUBLE PRECISION NOT NULL,
            kbdi             DOUBLE PRECISION NOT NULL,
            risk_score       DOUBLE PRECISION NOT NULL,
            label            VARCHAR(32)  NOT NULL,
            note             VARCHAR(280),
            created_at       TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_overrides_user_id "
               "ON user_overrides (user_id)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_user_overrides_user_id")
    op.execute("DROP TABLE IF EXISTS user_overrides")
