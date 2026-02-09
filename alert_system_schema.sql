BEGIN;

-- 1) User alert preferences
-- One row per user: whether alerts are enabled, email to use, threshold
CREATE TABLE user_alert_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  email_address TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  numeric_threshold REAL DEFAULT 0.5,  -- alert if risk_score >= this
  opted_in_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_alert_preferences_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2) Areas a user wants to monitor
CREATE TABLE user_monitored_areas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  area_id TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  CONSTRAINT fk_user_monitored_areas_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uniq_user_area UNIQUE (user_id, area_id)
);

-- 3) Alert activity log
-- Used for deduplication and basic history
CREATE TABLE alert_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  event_signature TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  channel_address TEXT NOT NULL,
  status TEXT DEFAULT 'sent',  -- 'sent','delivered','failed'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alert_activity_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uniq_user_event UNIQUE (user_id, event_signature)
);

COMMIT;
