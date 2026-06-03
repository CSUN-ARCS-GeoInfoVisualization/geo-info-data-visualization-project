"""Drop training_samples — the continuous-retrain dataset now lives in the
GitHub repo (committed CSVs), not the DB, to keep zero database cost-risk.

The table was created empty (revision f3a4b5c6d7e8) and never populated in prod,
so dropping it is safe.

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-03
"""
from alembic import op


revision = 'a4b5c6d7e8f9'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP INDEX IF EXISTS ix_training_samples_ingested_at")
    op.execute("DROP TABLE IF EXISTS training_samples")


def downgrade():
    # Re-create from f3a4b5c6d7e8's definition if ever rolled back.
    op.execute("""
        CREATE TABLE IF NOT EXISTS training_samples (
            id               SERIAL PRIMARY KEY,
            lat              DOUBLE PRECISION NOT NULL,
            lon              DOUBLE PRECISION NOT NULL,
            acq_date         VARCHAR(10) NOT NULL,
            evi              DOUBLE PRECISION NOT NULL,
            air_temp_encoded DOUBLE PRECISION NOT NULL,
            wind             DOUBLE PRECISION NOT NULL,
            humidity         DOUBLE PRECISION NOT NULL,
            elevation        DOUBLE PRECISION NOT NULL,
            kbdi             DOUBLE PRECISION NOT NULL,
            fire             INTEGER NOT NULL,
            source           VARCHAR(32) NOT NULL DEFAULT 'firms_viirs',
            ingested_at      TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_training_sample_point UNIQUE (lat, lon, acq_date)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_training_samples_ingested_at "
               "ON training_samples (ingested_at)")
