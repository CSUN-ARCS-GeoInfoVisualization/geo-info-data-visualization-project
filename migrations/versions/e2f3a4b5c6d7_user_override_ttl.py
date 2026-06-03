"""Per-user 24h TTL on user_overrides: expires_at + updated_at + unique zone

Turns user_overrides from append-only snapshots into one auto-expiring override
per (user, scope, zone). expires_at = last save + 24h; expired rows are pruned
on the next read/write so the zone reverts to live data.

The table was created empty (revision d1e2f3a4b5c6, never populated in prod),
so expires_at can be added NOT NULL with a now()+24h default applied to any
stray rows, then the default dropped.

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-03
"""
from alembic import op


revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE user_overrides ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()")
    # Add expires_at with a temporary default so any pre-existing rows get a value,
    # then drop the default (the app always sets it explicitly on insert/upsert).
    op.execute("ALTER TABLE user_overrides ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
    op.execute("UPDATE user_overrides SET expires_at = now() + interval '24 hours' WHERE expires_at IS NULL")
    op.execute("ALTER TABLE user_overrides ALTER COLUMN expires_at SET NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_overrides_expires_at ON user_overrides (expires_at)")
    # One active override per (user, scope, zone). De-dupe any stray rows first,
    # keeping the most recent, so the unique constraint can be created.
    op.execute("""
        DELETE FROM user_overrides a
        USING user_overrides b
        WHERE a.user_id = b.user_id
          AND a.scope = b.scope
          AND a.zone_id = b.zone_id
          AND a.id < b.id
    """)
    op.execute("ALTER TABLE user_overrides "
               "ADD CONSTRAINT uq_user_override_zone UNIQUE (user_id, scope, zone_id)")


def downgrade():
    op.execute("ALTER TABLE user_overrides DROP CONSTRAINT IF EXISTS uq_user_override_zone")
    op.execute("DROP INDEX IF EXISTS ix_user_overrides_expires_at")
    op.execute("ALTER TABLE user_overrides DROP COLUMN IF EXISTS expires_at")
    op.execute("ALTER TABLE user_overrides DROP COLUMN IF EXISTS updated_at")
