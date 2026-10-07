-- Migration: Create set_last_digit_signals table
-- Matches schema.sql definition exactly

CREATE TABLE IF NOT EXISTS set_last_digit_signals (
    id TEXT PRIMARY KEY, -- Format: set_digit_${date}_${session}
    date TEXT NOT NULL,
    session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
    signal_version TEXT NOT NULL DEFAULT 'SET_LAST_DIGIT_V1',
    status TEXT NOT NULL,
    is_frozen INTEGER NOT NULL CHECK(is_frozen IN (0, 1)),
    frozen_at TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    primary_digit TEXT NOT NULL,
    observed_set REAL,
    live_observations_count INTEGER NOT NULL DEFAULT 0,
    settlement_last_digit TEXT,
    settlement_status TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_set_last_digit_date_session ON set_last_digit_signals(date, session);
