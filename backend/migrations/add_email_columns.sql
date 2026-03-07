-- Migration: Add columns for email delivery module
-- Assumes base tables exist from feature/alerts/email-preferences-schema
-- Run after alert_system_schema.sql

-- user_alert_preferences: add frequency, is_paused if not present
-- Run each ALTER separately (PostgreSQL syntax)
ALTER TABLE user_alert_preferences ADD COLUMN IF NOT EXISTS frequency VARCHAR(20) DEFAULT 'instant';
ALTER TABLE user_alert_preferences ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE;

-- alert_activity: add delivery tracking columns
ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
ALTER TABLE alert_activity ADD COLUMN IF NOT EXISTS alert_type VARCHAR(20) DEFAULT 'immediate';

-- Create tables if they don't exist (for fresh installs - requires users table)
CREATE TABLE IF NOT EXISTS user_alert_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    frequency VARCHAR(20) DEFAULT 'instant',
    risk_threshold NUMERIC(5,2) DEFAULT 70,
    is_paused BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    email VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS user_monitored_areas (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    area_name VARCHAR(255) NOT NULL,
    area_geojson TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, area_name)
);

CREATE TABLE IF NOT EXISTS alert_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    area_id INTEGER REFERENCES user_monitored_areas(id),
    event_signature VARCHAR(64) NOT NULL,
    alert_type VARCHAR(20) DEFAULT 'immediate',
    risk_score NUMERIC(5,2),
    provider_message_id VARCHAR(255),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, event_signature)
);
