-- ==============================================================================
-- MM2D Phase 2E: Cloudflare D1 Database Schema
-- Database: mm2d-production-db (SQLite-compatible)
-- Binding: DB
-- ==============================================================================

-- 1. Raw Payloads Store (Provenance & Auditing)
CREATE TABLE IF NOT EXISTS raw_payloads (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_payloads_date ON raw_payloads(date);

-- 2. Verified Market Records (Composite uniqueness: date + time + history_id)
CREATE TABLE IF NOT EXISTS verified_market_records (
    id TEXT PRIMARY KEY, -- Format: ${date}_${time}_${historyId}
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
    is_settlement INTEGER NOT NULL CHECK(is_settlement IN (0, 1)),
    set_raw TEXT NOT NULL,
    value_raw TEXT NOT NULL,
    set_numeric REAL NOT NULL,
    value_numeric REAL NOT NULL,
    twod TEXT NOT NULL,
    history_id TEXT NOT NULL,
    is_mathematically_consistent INTEGER NOT NULL CHECK(is_mathematically_consistent IN (0, 1)),
    set_last_digit TEXT NOT NULL,
    value_first_decimal TEXT NOT NULL,
    recalculated_twod TEXT NOT NULL,
    discrepancy_details TEXT,
    verified_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verified_records_date ON verified_market_records(date);
CREATE INDEX IF NOT EXISTS idx_verified_records_session ON verified_market_records(session);
CREATE INDEX IF NOT EXISTS idx_verified_records_date_session ON verified_market_records(date, session);

-- 3. Dual Sync Checkpoints (Live vs Historical Isolation)
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    id TEXT PRIMARY KEY CHECK(id IN ('live_sync_checkpoint', 'historical_backfill_checkpoint')),
    type TEXT NOT NULL CHECK(type IN ('LIVE_SYNC', 'HISTORICAL_BACKFILL')),
    last_date TEXT,
    last_time TEXT,
    last_history_id TEXT,
    range_start_date TEXT,
    range_end_date TEXT,
    total_runs INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL,
    last_message TEXT,
    updated_at TEXT NOT NULL
);

-- 4. Sync Audit Logs (Real-time tracing & verdicts)
CREATE TABLE IF NOT EXISTS sync_audit_logs (
    id TEXT PRIMARY KEY,
    sync_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    date TEXT,
    records_count INTEGER,
    message TEXT NOT NULL,
    details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON sync_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON sync_audit_logs(date);

-- 5. Live Observations (Server-side pre-lock collection, Zero Live 2D)
CREATE TABLE IF NOT EXISTS live_observations (
    id TEXT PRIMARY KEY, -- Format: live_${date}_${session}_${time}
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
    set_numeric REAL NOT NULL,
    value_numeric REAL NOT NULL,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_observations_date_session ON live_observations(date, session);
CREATE INDEX IF NOT EXISTS idx_live_observations_date_session_time ON live_observations(date, session, time);

-- 6. Server-Side V2 Predictions & Final Frozen Lock Snapshots
CREATE TABLE IF NOT EXISTS v2_predictions (
    id TEXT PRIMARY KEY, -- Format: v2_${date}_${session}
    date TEXT NOT NULL,
    session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
    model_version TEXT NOT NULL DEFAULT 'AUTO_WEIGHTED_V2',
    status TEXT NOT NULL,
    is_frozen INTEGER NOT NULL CHECK(is_frozen IN (0, 1)),
    frozen_at TEXT,
    top1 TEXT NOT NULL,
    top5_json TEXT NOT NULL,
    top10_json TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    probabilities_json TEXT NOT NULL,
    engine_weights_json TEXT NOT NULL,
    observed_set REAL,
    observed_value REAL,
    live_observations_count INTEGER NOT NULL DEFAULT 0,
    live_snapshot_json TEXT NOT NULL,
    integrity_hash TEXT NOT NULL,
    settlement_comparison_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_predictions_date_session ON v2_predictions(date, session);
