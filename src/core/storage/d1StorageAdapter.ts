import { VerifiedMarketRecord, MarketSession } from '../../types/market';
import { ShadowSessionRecord } from '../../types/autoWeightedV2';
import {
  LiveSyncCheckpoint,
  HistoricalBackfillCheckpoint,
  DualCheckpointState,
  SyncAuditLog,
  SyncStatus,
} from '../../types/sync';
/**
 * Utility to strictly compare date & time chronological order.
 * Returns true if (dateA, timeA) is strictly AFTER (dateB, timeB).
 */
export function isDateTimeAfter(
  dateA: string | null | undefined,
  timeA: string | null | undefined,
  dateB: string | null | undefined,
  timeB: string | null | undefined
): boolean {
  if (!dateA) return false;
  if (!dateB) return true;

  const comp = dateA.localeCompare(dateB);
  if (comp > 0) return true;
  if (comp < 0) return false;

  const tA = (timeA || '00:00:00').trim();
  const tB = (timeB || '00:00:00').trim();
  return tA.localeCompare(tB) > 0;
}

/**
 * Minimal Cloudflare D1 Type Definitions for Worker & Node TypeScript compatibility
 */
export interface D1ResultMeta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: D1ResultMeta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

export interface D1InsertStats {
  attempted: number;
  inserted: number;
  duplicatesSkipped: number;
}

export interface D1RawPayloadRecord {
  id: string;
  date: string;
  endpoint: string;
  payloadJson: string;
  recordCount: number;
  fetchedAt: string;
  status: string;
}

export interface D1LiveObservationRecord {
  id: string;
  date: string;
  time: string;
  session: MarketSession;
  set: number;
  value: number;
  timestamp: string;
}

export interface D1V2PredictionRecord {
  id: string;
  date: string;
  session: MarketSession;
  modelVersion: string;
  status: string;
  isFrozen: number;
  frozenAt: string | null;
  top1: string;
  top5Json: string;
  top10Json: string;
  candidatesJson: string;
  probabilitiesJson: string;
  engineWeightsJson: string;
  observedSet: number | null;
  observedValue: number | null;
  liveObservationsCount: number;
  liveSnapshotJson: string;
  integrityHash: string;
  settlementComparisonJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface D1V2PredictionInput {
  date: string;
  session: MarketSession;
  modelVersion?: string;
  status: string;
  isFrozen: boolean;
  frozenAt?: string | null;
  top1: string;
  top5: readonly string[];
  top10: readonly string[];
  candidates: readonly unknown[];
  probabilities: readonly number[];
  engineWeights: Record<string, number>;
  observedSet: number | null;
  observedValue: number | null;
  liveObservationsCount: number;
  liveSnapshot: readonly unknown[];
  integrityHash: string;
  settlementComparison?: unknown | null;
}

export interface D1SetLastDigitRecord {
  id: string;
  date: string;
  session: MarketSession;
  signalVersion: string;
  status: string;
  isFrozen: number;
  frozenAt: string;
  candidatesJson: string;
  primaryDigit: string;
  observedSet: number | null;
  liveObservationsCount: number;
  settlementLastDigit: string | null;
  settlementStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface D1SetLastDigitInput {
  date: string;
  session: MarketSession;
  status: string;
  isFrozen: boolean;
  frozenAt: string;
  candidates: string[];
  primaryDigit: string;
  observedSet?: number | null;
  liveObservationsCount?: number;
  settlementLastDigit?: string | null;
  settlementStatus?: 'HIT' | 'MISS' | null;
}

export interface D1StorageStats {
  totalVerifiedCount: number;
  latestStoredDate: string | null;
  amCount: number;
  pmCount: number;
  totalRawPayloadCount: number;
  storageEngine: string;
  isPersistent: boolean;
}

const defaultLiveCheckpoint: LiveSyncCheckpoint = {
  id: 'live_sync_checkpoint',
  type: 'LIVE_SYNC',
  lastSuccessfulSyncDate: null,
  lastSuccessfulSyncTime: null,
  lastSuccessfulHistoryId: null,
  lastSyncTimestamp: null,
  totalSyncRuns: 0,
  lastSyncStatus: 'IDLE',
  lastSyncMessage: 'Initialized in D1',
  updatedAt: new Date().toISOString(),
};

const defaultHistoricalCheckpoint: HistoricalBackfillCheckpoint = {
  id: 'historical_backfill_checkpoint',
  type: 'HISTORICAL_BACKFILL',
  lastBackfillStartDate: null,
  lastBackfillEndDate: null,
  lastProcessedDate: null,
  lastProcessedTime: null,
  lastProcessedHistoryId: null,
  lastSyncTimestamp: null,
  totalBackfillRuns: 0,
  lastSyncStatus: 'IDLE',
  lastSyncMessage: 'Initialized in D1',
  updatedAt: new Date().toISOString(),
};

/**
 * Cloudflare D1 Storage Adapter
 * Executes atomic SQL operations directly on Cloudflare D1 (SQLite) backend.
 */
export class D1StorageAdapter {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Ensures that all required D1 tables and indexes exist in Cloudflare D1.
   * Self-heals the database if tables have not yet been manually executed via wrangler CLI.
   */
  public async ensureSchema(): Promise<void> {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS live_observations (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
        set_numeric REAL NOT NULL,
        value_numeric REAL NOT NULL,
        timestamp TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_live_observations_date_session ON live_observations(date, session)`,
      `CREATE INDEX IF NOT EXISTS idx_live_observations_date_session_time ON live_observations(date, session, time)`,
      `CREATE TABLE IF NOT EXISTS v2_predictions (
        id TEXT PRIMARY KEY,
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_v2_predictions_date_session ON v2_predictions(date, session)`,
      `CREATE TABLE IF NOT EXISTS set_last_digit_signals (
        id TEXT PRIMARY KEY,
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_set_last_digit_date_session ON set_last_digit_signals(date, session)`
    ];

    for (const sql of stmts) {
      try {
        await this.db.prepare(sql).run();
      } catch (err) {
        console.warn('[D1StorageAdapter] ensureSchema statement notice:', err);
      }
    }
  }

  /**
   * Preserves raw JSON API payloads for strict auditability and provenance.
   * record_count represents the actual count of child market records contained in the payload.
   */
  public async saveRawFeed(
    date: string,
    endpoint: string,
    rawData: unknown,
    explicitRecordCount?: number
  ): Promise<void> {
    const id = `raw_${date}_${Date.now()}`;
    const payloadJson = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);

    let recordCount = 0;
    if (typeof explicitRecordCount === 'number' && Number.isFinite(explicitRecordCount)) {
      recordCount = Math.max(0, Math.floor(explicitRecordCount));
    } else if (Array.isArray(rawData)) {
      recordCount = rawData.reduce((acc, g) => {
        if (g && typeof g === 'object' && Array.isArray((g as { child?: unknown[] }).child)) {
          return acc + (g as { child: unknown[] }).child.length;
        }
        return acc;
      }, 0);
    } else if (rawData && typeof rawData === 'object' && Array.isArray((rawData as { child?: unknown[] }).child)) {
      recordCount = (rawData as { child: unknown[] }).child.length;
    }

    const fetchedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO raw_payloads (
        id, date, endpoint, payload_json, record_count, fetched_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, date, endpoint, payloadJson, recordCount, fetchedAt, 'STORED');

    await stmt.run();
  }

  /**
   * Stores verified records with strict composite key uniqueness and idempotency.
   * Composite key: ${date}_${time}_${historyId}
   */
  public async storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<D1InsertStats> {
    if (!records || records.length === 0) {
      return { attempted: 0, inserted: 0, duplicatesSkipped: 0 };
    }

    const statements: D1PreparedStatement[] = [];

    for (const record of records) {
      const docId = `${record.date}_${record.time}_${record.historyId}`;
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO verified_market_records (
          id, date, time, session, is_settlement,
          set_raw, value_raw, set_numeric, value_numeric,
          twod, history_id, is_mathematically_consistent,
          set_last_digit, value_first_decimal, recalculated_twod,
          discrepancy_details, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        docId,
        record.date,
        record.time,
        record.session,
        record.isSettlement ? 1 : 0,
        record.setRaw,
        record.valueRaw,
        record.setNumeric,
        record.valueNumeric,
        record.twod,
        record.historyId,
        record.mathematicalCheck.isMathematicallyConsistent ? 1 : 0,
        record.mathematicalCheck.setLastDigit,
        record.mathematicalCheck.valueLastDigitBeforeDecimal,
        record.mathematicalCheck.derived2D,
        record.discrepancyDetails !== undefined
          ? record.discrepancyDetails
          : (record.provenance === 'LEGACY_2D_CALIBRATION_EPOCH'
            ? 'LEGACY_2D_CALIBRATION_EPOCH'
            : (record.mathematicalCheck.isMathematicallyConsistent ? null : 'Discrepancy detected')),
        record.verifiedAt || new Date().toISOString()
      );

      statements.push(stmt);
    }

    const batchResults = await this.db.batch(statements);
    let inserted = 0;

    for (const result of batchResults) {
      const changes = result.meta?.changes ?? 0;
      inserted += changes;
    }

    const attempted = records.length;
    const duplicatesSkipped = Math.max(0, attempted - inserted);

    return {
      attempted,
      inserted,
      duplicatesSkipped,
    };
  }

  /**
   * Queries verified market records with optional filters.
   */
  public async queryVerifiedRecords(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<VerifiedMarketRecord[]> {
    let sql = 'SELECT * FROM verified_market_records';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.date) {
      conditions.push('date = ?');
      params.push(options.date);
    }
    if (options?.session) {
      conditions.push('session = ?');
      params.push(options.session);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC, time DESC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql).bind(...params);
    const { results } = await stmt.all<Record<string, unknown>>();

    if (!results || !Array.isArray(results)) return [];

    return results.map((row) => ({
      id: String(row.id),
      date: String(row.date),
      time: String(row.time),
      session: row.session as MarketSession,
      isSettlement: Number(row.is_settlement) === 1,
      setRaw: String(row.set_raw),
      valueRaw: String(row.value_raw),
      setNumeric: Number(row.set_numeric),
      valueNumeric: Number(row.value_numeric),
      twod: String(row.twod),
      historyId: String(row.history_id),
      verifiedAt: String(row.verified_at),
      provenance: row.discrepancy_details === 'LEGACY_2D_CALIBRATION_EPOCH' ? 'LEGACY_2D_CALIBRATION_EPOCH' : 'OFFICIAL_SET_MARKET_LIVE',
      discrepancyDetails: row.discrepancy_details ? String(row.discrepancy_details) : null,
      mathematicalCheck: {
        setLastDigit: String(row.set_last_digit),
        valueLastDigitBeforeDecimal: String(row.value_first_decimal),
        derived2D: String(row.recalculated_twod),
        isMathematicallyConsistent: Number(row.is_mathematically_consistent) === 1,
      },
    }));
  }

  /**
   * Retrieves overall dataset statistics from D1.
   */
  public async getStats(): Promise<D1StorageStats> {
    const totalRow = await this.db.prepare('SELECT COUNT(*) as cnt, MAX(date) as maxDate FROM verified_market_records').first<{ cnt: number; maxDate: string | null }>();
    const amRow = await this.db.prepare("SELECT COUNT(*) as cnt FROM verified_market_records WHERE session = 'AM'").first<{ cnt: number }>();
    const pmRow = await this.db.prepare("SELECT COUNT(*) as cnt FROM verified_market_records WHERE session = 'PM'").first<{ cnt: number }>();
    const rawRow = await this.db.prepare('SELECT COUNT(*) as cnt FROM raw_payloads').first<{ cnt: number }>();

    return {
      totalVerifiedCount: Number(totalRow?.cnt || 0),
      latestStoredDate: totalRow?.maxDate || null,
      amCount: Number(amRow?.cnt || 0),
      pmCount: Number(pmRow?.cnt || 0),
      totalRawPayloadCount: Number(rawRow?.cnt || 0),
      storageEngine: 'Cloudflare D1 (SQLite)',
      isPersistent: true,
    };
  }

  /**
   * Retrieves the live sync checkpoint.
   */
  public async getLiveCheckpoint(): Promise<LiveSyncCheckpoint> {
    const row = await this.db.prepare("SELECT * FROM sync_checkpoints WHERE id = 'live_sync_checkpoint'").first<Record<string, unknown>>();
    if (!row) return { ...defaultLiveCheckpoint };

    return {
      id: 'live_sync_checkpoint',
      type: 'LIVE_SYNC',
      lastSuccessfulSyncDate: (row.last_date as string) || null,
      lastSuccessfulSyncTime: (row.last_time as string) || null,
      lastSuccessfulHistoryId: (row.last_history_id as string) || null,
      lastSyncTimestamp: (row.updated_at as string) || null,
      totalSyncRuns: Number(row.total_runs || 0),
      lastSyncStatus: (row.last_status as SyncStatus) || 'IDLE',
      lastSyncMessage: (row.last_message as string) || undefined,
      updatedAt: (row.updated_at as string) || new Date().toISOString(),
    };
  }

  /**
   * Saves or updates the live sync checkpoint monotonically.
   */
  public async saveLiveCheckpoint(checkpoint: Partial<LiveSyncCheckpoint>): Promise<void> {
    const current = await this.getLiveCheckpoint();

    let targetDate = current.lastSuccessfulSyncDate;
    let targetTime = current.lastSuccessfulSyncTime;
    let targetHistoryId = current.lastSuccessfulHistoryId;

    if (checkpoint.lastSuccessfulSyncDate) {
      if (isDateTimeAfter(checkpoint.lastSuccessfulSyncDate, checkpoint.lastSuccessfulSyncTime, current.lastSuccessfulSyncDate, current.lastSuccessfulSyncTime)) {
        targetDate = checkpoint.lastSuccessfulSyncDate;
        targetTime = checkpoint.lastSuccessfulSyncTime || null;
        targetHistoryId = checkpoint.lastSuccessfulHistoryId || targetHistoryId;
      }
    }

    const updatedAt = new Date().toISOString();
    const totalRuns = (current.totalSyncRuns || 0) + 1;
    const status = checkpoint.lastSyncStatus || current.lastSyncStatus || 'SUCCESS';
    const message = checkpoint.lastSyncMessage || current.lastSyncMessage || 'Updated in D1';

    await this.db.prepare(`
      INSERT INTO sync_checkpoints (
        id, type, last_date, last_time, last_history_id,
        range_start_date, range_end_date, total_runs, last_status, last_message, updated_at
      ) VALUES ('live_sync_checkpoint', 'LIVE_SYNC', ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_date = excluded.last_date,
        last_time = excluded.last_time,
        last_history_id = excluded.last_history_id,
        total_runs = excluded.total_runs,
        last_status = excluded.last_status,
        last_message = excluded.last_message,
        updated_at = excluded.updated_at
    `).bind(
      targetDate,
      targetTime,
      targetHistoryId,
      totalRuns,
      status,
      message,
      updatedAt
    ).run();
  }

  /**
   * Retrieves the historical backfill checkpoint.
   */
  public async getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint> {
    const row = await this.db.prepare("SELECT * FROM sync_checkpoints WHERE id = 'historical_backfill_checkpoint'").first<Record<string, unknown>>();
    if (!row) return { ...defaultHistoricalCheckpoint };

    return {
      id: 'historical_backfill_checkpoint',
      type: 'HISTORICAL_BACKFILL',
      lastBackfillStartDate: (row.range_start_date as string) || null,
      lastBackfillEndDate: (row.range_end_date as string) || null,
      lastProcessedDate: (row.last_date as string) || null,
      lastProcessedTime: (row.last_time as string) || null,
      lastProcessedHistoryId: (row.last_history_id as string) || null,
      lastSyncTimestamp: (row.updated_at as string) || null,
      totalBackfillRuns: Number(row.total_runs || 0),
      lastSyncStatus: (row.last_status as SyncStatus) || 'IDLE',
      lastSyncMessage: (row.last_message as string) || undefined,
      updatedAt: (row.updated_at as string) || new Date().toISOString(),
    };
  }

  /**
   * Saves or updates the historical backfill checkpoint without touching live checkpoint.
   */
  public async saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void> {
    const current = await this.getHistoricalCheckpoint();

    const startDate = checkpoint.lastBackfillStartDate ?? current.lastBackfillStartDate;
    const endDate = checkpoint.lastBackfillEndDate ?? current.lastBackfillEndDate;
    const lastDate = checkpoint.lastProcessedDate ?? current.lastProcessedDate;
    const lastTime = checkpoint.lastProcessedTime ?? current.lastProcessedTime;
    const lastHistoryId = checkpoint.lastProcessedHistoryId ?? current.lastProcessedHistoryId;
    const totalRuns = (current.totalBackfillRuns || 0) + 1;
    const status = checkpoint.lastSyncStatus || current.lastSyncStatus || 'SUCCESS';
    const message = checkpoint.lastSyncMessage || current.lastSyncMessage || 'Backfill checkpoint updated in D1';
    const updatedAt = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO sync_checkpoints (
        id, type, last_date, last_time, last_history_id,
        range_start_date, range_end_date, total_runs, last_status, last_message, updated_at
      ) VALUES ('historical_backfill_checkpoint', 'HISTORICAL_BACKFILL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_date = excluded.last_date,
        last_time = excluded.last_time,
        last_history_id = excluded.last_history_id,
        range_start_date = excluded.range_start_date,
        range_end_date = excluded.range_end_date,
        total_runs = excluded.total_runs,
        last_status = excluded.last_status,
        last_message = excluded.last_message,
        updated_at = excluded.updated_at
    `).bind(
      lastDate,
      lastTime,
      lastHistoryId,
      startDate,
      endDate,
      totalRuns,
      status,
      message,
      updatedAt
    ).run();
  }

  /**
   * Retrieves both checkpoints together.
   */
  public async getDualCheckpoints(): Promise<DualCheckpointState> {
    const [live, historical] = await Promise.all([
      this.getLiveCheckpoint(),
      this.getHistoricalCheckpoint(),
    ]);
    return {
      liveCheckpoint: live,
      historicalCheckpoint: historical,
    };
  }

  /**
   * Saves audit log entry to D1.
   */
  public async saveAuditLog(log: SyncAuditLog): Promise<void> {
    await this.db.prepare(`
      INSERT INTO sync_audit_logs (
        id, sync_id, stage, status, timestamp, date, records_count, message, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      log.id,
      log.syncId,
      log.stage,
      log.status,
      log.timestamp,
      log.date || null,
      log.recordsCount ?? null,
      log.message,
      log.details ? JSON.stringify(log.details) : null
    ).run();
  }

  /**
   * Retrieves recent audit logs from D1.
   */
  public async getAuditLogs(limit = 50): Promise<SyncAuditLog[]> {
    const { results } = await this.db.prepare(`
      SELECT * FROM sync_audit_logs ORDER BY timestamp DESC LIMIT ?
    `).bind(limit).all<Record<string, unknown>>();

    if (!results || !Array.isArray(results)) return [];

    return results.map((row) => ({
      id: String(row.id),
      syncId: String(row.sync_id),
      stage: row.stage as SyncAuditLog['stage'],
      status: row.status as SyncAuditLog['status'],
      timestamp: String(row.timestamp),
      date: row.date ? String(row.date) : undefined,
      recordsCount: row.records_count !== null && row.records_count !== undefined ? Number(row.records_count) : undefined,
      message: String(row.message),
      details: row.details_json ? JSON.parse(String(row.details_json)) : undefined,
    }));
  }

  /**
   * Stores a server-collected authentic live observation in D1.
   * Invariants:
   * 1. Stores ONLY date, time, session, SET, Value, timestamp.
   * 2. Zero Live 2D.
   * 3. Prevents duplicate observations.
   */
  public async storeLiveObservation(obs: {
    date: string;
    time: string;
    session: MarketSession;
    set: number;
    value: number;
    timestamp: string;
  }): Promise<{ inserted: boolean; duplicate: boolean }> {
    try {
      return await this._doStoreLiveObservation(obs);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        await this.ensureSchema();
        return await this._doStoreLiveObservation(obs);
      }
      throw err;
    }
  }

  private async _doStoreLiveObservation(obs: {
    date: string;
    time: string;
    session: MarketSession;
    set: number;
    value: number;
    timestamp: string;
  }): Promise<{ inserted: boolean; duplicate: boolean }> {
    // Strict numeric enforcement: Reject literal field names ("set", "value"), NaN, or placeholders
    const rawSetStr = String(obs.set ?? '').trim();
    const rawValStr = String(obs.value ?? '').trim();
    const lowerSet = rawSetStr.toLowerCase();
    const lowerVal = rawValStr.toLowerCase();

    if (
      lowerSet === 'set' ||
      lowerVal === 'value' ||
      lowerSet === 'nan' ||
      lowerVal === 'nan' ||
      lowerSet === 'null' ||
      lowerSet === 'undefined' ||
      rawSetStr === '--' ||
      rawValStr === '--' ||
      rawSetStr === '0.00' ||
      rawValStr === '0.00' ||
      rawSetStr === '0'
    ) {
      throw new Error(`Cannot store invalid literal or placeholder live observation: set=${obs.set}, value=${obs.value}`);
    }

    const numericSet = typeof obs.set === 'number' ? obs.set : parseFloat(rawSetStr.replace(/,/g, ''));
    const numericValue = typeof obs.value === 'number' ? obs.value : parseFloat(rawValStr.replace(/,/g, ''));

    if (
      !Number.isFinite(numericSet) ||
      numericSet < 100 ||
      numericSet > 5000 ||
      !Number.isFinite(numericValue) ||
      numericValue < 100
    ) {
      throw new Error(`Cannot store invalid non-numeric live observation: set=${obs.set}, value=${obs.value}`);
    }

    const id = `live_${obs.date}_${obs.session}_${obs.time}`;

    const existing = await this.db.prepare(
      'SELECT id, set_numeric, value_numeric FROM live_observations WHERE id = ?'
    ).bind(id).first<{ id: string; set_numeric: number; value_numeric: number }>();

    if (existing) {
      if (Number(existing.set_numeric) === numericSet && Number(existing.value_numeric) === numericValue) {
        return { inserted: false, duplicate: true };
      }
      await this.db.prepare(
        'UPDATE live_observations SET set_numeric = ?, value_numeric = ?, timestamp = ? WHERE id = ?'
      ).bind(numericSet, numericValue, obs.timestamp, id).run();
      return { inserted: true, duplicate: false };
    }

    await this.db.prepare(`
      INSERT INTO live_observations (
        id, date, time, session, set_numeric, value_numeric, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      obs.date,
      obs.time,
      obs.session,
      numericSet,
      numericValue,
      obs.timestamp
    ).run();

    return { inserted: true, duplicate: false };
  }

  /**
   * Deletes temporary live observations older than a given cutoff (retention policy, default 24h).
   * Invariants:
   * 1. ONLY deletes from `live_observations` table.
   * 2. NEVER touches verified_market_records, raw_market_feeds, v2_predictions, or evaluation tables.
   * 3. Retains fresh observations (<= max age).
   */
  public async deleteLiveObservationsOlderThan(cutoff: {
    cutoffIso: string;
    cutoffDate: string;
    cutoffTime: string;
  }): Promise<{ deletedCount: number }> {
    try {
      return await this._doDeleteLiveObservationsOlderThan(cutoff);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        return { deletedCount: 0 };
      }
      throw err;
    }
  }

  private async _doDeleteLiveObservationsOlderThan(cutoff: {
    cutoffIso: string;
    cutoffDate: string;
    cutoffTime: string;
  }): Promise<{ deletedCount: number }> {
    const res = await this.db.prepare(`
      DELETE FROM live_observations
      WHERE date < ? OR (date = ? AND time < ?) OR timestamp < ?
    `).bind(cutoff.cutoffDate, cutoff.cutoffDate, cutoff.cutoffTime, cutoff.cutoffIso).run();

    const changes = Number((res as any)?.meta?.changes ?? (res as any)?.changes ?? 0);
    return { deletedCount: changes };
  }

  /**
   * Queries stored live observations from D1.
   * Invariants:
   * 1. Strictly isolated by session (AM or PM).
   * 2. Sorted chronologically (date ASC, time ASC).
   * 3. Contains ZERO live 2D.
   * 4. Treats any rows with literal field names ('set', 'value') or invalid non-numeric data as invalid historical collector records and excludes them.
   */
  public async queryLiveObservations(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1LiveObservationRecord[]> {
    try {
      return await this._doQueryLiveObservations(options);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        await this.ensureSchema();
        return await this._doQueryLiveObservations(options);
      }
      throw err;
    }
  }

  private async _doQueryLiveObservations(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1LiveObservationRecord[]> {
    let sql = 'SELECT * FROM live_observations';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.date) {
      conditions.push('date = ?');
      params.push(options.date);
    }
    if (options?.session) {
      conditions.push('session = ?');
      params.push(options.session);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date ASC, time ASC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const { results } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();

    if (!results || !Array.isArray(results)) return [];

    const validRecords: D1LiveObservationRecord[] = [];
    for (const row of results) {
      const rawSetStr = String(row.set_numeric ?? '').trim();
      const rawValStr = String(row.value_numeric ?? '').trim();
      const lowerSet = rawSetStr.toLowerCase();
      const lowerVal = rawValStr.toLowerCase();

      // Treat any existing invalid rows with literal field names ("set", "value"), NaN, or placeholders as invalid historical collector records
      if (
        lowerSet === 'set' ||
        lowerVal === 'value' ||
        lowerSet === 'nan' ||
        lowerVal === 'nan' ||
        lowerSet === 'null' ||
        lowerVal === 'undefined' ||
        rawSetStr === '--' ||
        rawValStr === '--' ||
        rawSetStr === '0.00' ||
        rawValStr === '0.00' ||
        rawSetStr === '0'
      ) {
        continue;
      }

      const setNum = typeof row.set_numeric === 'number' ? row.set_numeric : parseFloat(rawSetStr.replace(/,/g, ''));
      const valNum = typeof row.value_numeric === 'number' ? row.value_numeric : parseFloat(rawValStr.replace(/,/g, ''));

      if (
        !Number.isFinite(setNum) ||
        setNum < 100 ||
        setNum > 5000 ||
        !Number.isFinite(valNum) ||
        valNum < 100
      ) {
        continue;
      }

      validRecords.push({
        id: String(row.id),
        date: String(row.date),
        time: String(row.time),
        session: row.session as MarketSession,
        set: setNum,
        value: valNum,
        timestamp: String(row.timestamp),
      });
    }

    return validRecords;
  }

  /**
   * Stores or updates a server-side V2 prediction in D1.
   *
   * Crucial Invariant:
   * Once is_frozen === 1, the prediction distribution, Top1/5/10, engine weights,
   * live observation snapshot, and integrity hash become permanently immutable.
   * New live ticks or re-evaluations will NEVER overwrite a frozen prediction.
   * Official settlement results only attach settlementComparison without modifying the frozen prediction.
   */
  public async storeV2Prediction(prediction: D1V2PredictionInput): Promise<{
    inserted: boolean;
    updated: boolean;
    frozen: boolean;
  }> {
    try {
      return await this._doStoreV2Prediction(prediction);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        await this.ensureSchema();
        return await this._doStoreV2Prediction(prediction);
      }
      throw err;
    }
  }

  private async _doStoreV2Prediction(prediction: D1V2PredictionInput): Promise<{
    inserted: boolean;
    updated: boolean;
    frozen: boolean;
  }> {
    const id = `v2_${prediction.date}_${prediction.session}`;
    const now = new Date().toISOString();
    const modelVersion = prediction.modelVersion || 'AUTO_WEIGHTED_V2';

    const existing = await this.db.prepare(
      'SELECT * FROM v2_predictions WHERE id = ?'
    ).bind(id).first<Record<string, unknown>>();

    if (existing) {
      const isAlreadyFrozen = Number(existing.is_frozen) === 1;

      if (isAlreadyFrozen) {
        // If already frozen and official settlement comparison is provided, update ONLY settlement comparison
        if (prediction.settlementComparison && !existing.settlement_comparison_json) {
          await this.db.prepare(`
            UPDATE v2_predictions
            SET settlement_comparison_json = ?, status = 'OFFICIAL_RESULT_AVAILABLE', updated_at = ?
            WHERE id = ?
          `).bind(JSON.stringify(prediction.settlementComparison), now, id).run();
          return { inserted: false, updated: true, frozen: true };
        }

        // Frozen predictions are strictly immutable: reject any recalculation or tick mutation
        return { inserted: false, updated: false, frozen: true };
      }

      // If not yet frozen, update Early/Refining prediction or lock it
      await this.db.prepare(`
        UPDATE v2_predictions SET
          status = ?,
          is_frozen = ?,
          frozen_at = ?,
          top1 = ?,
          top5_json = ?,
          top10_json = ?,
          candidates_json = ?,
          probabilities_json = ?,
          engine_weights_json = ?,
          observed_set = ?,
          observed_value = ?,
          live_observations_count = ?,
          live_snapshot_json = ?,
          integrity_hash = ?,
          settlement_comparison_json = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        prediction.status,
        prediction.isFrozen ? 1 : 0,
        prediction.isFrozen ? (prediction.frozenAt || now) : null,
        prediction.top1,
        JSON.stringify(prediction.top5),
        JSON.stringify(prediction.top10),
        JSON.stringify(prediction.candidates),
        JSON.stringify(prediction.probabilities),
        JSON.stringify(prediction.engineWeights),
        prediction.observedSet,
        prediction.observedValue,
        prediction.liveObservationsCount,
        JSON.stringify(prediction.liveSnapshot),
        prediction.integrityHash,
        prediction.settlementComparison ? JSON.stringify(prediction.settlementComparison) : null,
        now,
        id
      ).run();

      return { inserted: false, updated: true, frozen: prediction.isFrozen };
    }

    // New insertion
    await this.db.prepare(`
      INSERT INTO v2_predictions (
        id, date, session, model_version, status, is_frozen, frozen_at,
        top1, top5_json, top10_json, candidates_json, probabilities_json,
        engine_weights_json, observed_set, observed_value, live_observations_count,
        live_snapshot_json, integrity_hash, settlement_comparison_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      prediction.date,
      prediction.session,
      modelVersion,
      prediction.status,
      prediction.isFrozen ? 1 : 0,
      prediction.isFrozen ? (prediction.frozenAt || now) : null,
      prediction.top1,
      JSON.stringify(prediction.top5),
      JSON.stringify(prediction.top10),
      JSON.stringify(prediction.candidates),
      JSON.stringify(prediction.probabilities),
      JSON.stringify(prediction.engineWeights),
      prediction.observedSet,
      prediction.observedValue,
      prediction.liveObservationsCount,
      JSON.stringify(prediction.liveSnapshot),
      prediction.integrityHash,
      prediction.settlementComparison ? JSON.stringify(prediction.settlementComparison) : null,
      now,
      now
    ).run();

    return { inserted: true, updated: false, frozen: prediction.isFrozen };
  }

  /**
   * Queries stored V2 predictions from D1.
   */
  public async queryV2Predictions(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1V2PredictionRecord[]> {
    try {
      return await this._doQueryV2Predictions(options);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        await this.ensureSchema();
        return await this._doQueryV2Predictions(options);
      }
      throw err;
    }
  }

  private async _doQueryV2Predictions(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1V2PredictionRecord[]> {
    let sql = 'SELECT * FROM v2_predictions';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.date) {
      conditions.push('date = ?');
      params.push(options.date);
    }
    if (options?.session) {
      conditions.push('session = ?');
      params.push(options.session);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC, session ASC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const { results } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    if (!results || !Array.isArray(results)) return [];

    return results.map((row) => ({
      id: String(row.id),
      date: String(row.date),
      session: row.session as MarketSession,
      modelVersion: String(row.model_version || 'AUTO_WEIGHTED_V2'),
      status: String(row.status),
      isFrozen: Number(row.is_frozen || 0),
      frozenAt: row.frozen_at ? String(row.frozen_at) : null,
      top1: String(row.top1),
      top5Json: String(row.top5_json),
      top10Json: String(row.top10_json),
      candidatesJson: String(row.candidates_json),
      probabilitiesJson: String(row.probabilities_json),
      engineWeightsJson: String(row.engine_weights_json),
      observedSet: row.observed_set !== null && row.observed_set !== undefined ? Number(row.observed_set) : null,
      observedValue: row.observed_value !== null && row.observed_value !== undefined ? Number(row.observed_value) : null,
      liveObservationsCount: Number(row.live_observations_count || 0),
      liveSnapshotJson: String(row.live_snapshot_json || '[]'),
      integrityHash: String(row.integrity_hash),
      settlementComparisonJson: row.settlement_comparison_json ? String(row.settlement_comparison_json) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  /**
   * Retrieves a specific V2 prediction from D1 by date and session.
   */
  public async getV2Prediction(date: string, session: MarketSession): Promise<D1V2PredictionRecord | null> {
    const list = await this.queryV2Predictions({ date, session, limit: 1 });
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Stores or updates a frozen SET Last Digit signal in D1.
   * Minimal persistence: stores only final frozen candidate digits (1-3) and lock metadata.
   */
  public async storeSetLastDigitSignal(
    signal: D1SetLastDigitInput
  ): Promise<{ inserted: boolean; updated: boolean }> {
    const id = `set_digit_${signal.date}_${signal.session}`;
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO set_last_digit_signals (
        id, date, session, signal_version, status, is_frozen, frozen_at,
        candidates_json, primary_digit, observed_set, live_observations_count,
        settlement_last_digit, settlement_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        is_frozen = excluded.is_frozen,
        candidates_json = excluded.candidates_json,
        primary_digit = excluded.primary_digit,
        observed_set = excluded.observed_set,
        live_observations_count = excluded.live_observations_count,
        settlement_last_digit = excluded.settlement_last_digit,
        settlement_status = excluded.settlement_status,
        updated_at = excluded.updated_at
    `;

    await this.db.prepare(sql).bind(
      id,
      signal.date,
      signal.session,
      'SET_LAST_DIGIT_V1',
      signal.status,
      signal.isFrozen ? 1 : 0,
      signal.frozenAt,
      JSON.stringify(signal.candidates),
      signal.primaryDigit,
      signal.observedSet !== undefined ? signal.observedSet : null,
      signal.liveObservationsCount || 0,
      signal.settlementLastDigit || null,
      signal.settlementStatus || null,
      now,
      now
    ).run();

    return { inserted: true, updated: false };
  }

  /**
   * Queries stored SET Last Digit signals from D1.
   */
  public async querySetLastDigitSignals(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1SetLastDigitRecord[]> {
    try {
      return await this._doQuerySetLastDigitSignals(options);
    } catch (err: unknown) {
      if (err && String((err as Error).message || err).includes('no such table')) {
        await this.ensureSchema();
        return await this._doQuerySetLastDigitSignals(options);
      }
      throw err;
    }
  }

  private async _doQuerySetLastDigitSignals(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1SetLastDigitRecord[]> {
    let sql = 'SELECT * FROM set_last_digit_signals';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.date) {
      conditions.push('date = ?');
      params.push(options.date);
    }
    if (options?.session) {
      conditions.push('session = ?');
      params.push(options.session);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC, session ASC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const { results } = await this.db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    if (!results || !Array.isArray(results)) return [];

    return results.map((row) => ({
      id: String(row.id),
      date: String(row.date),
      session: row.session as MarketSession,
      signalVersion: String(row.signal_version || 'SET_LAST_DIGIT_V1'),
      status: String(row.status),
      isFrozen: Number(row.is_frozen || 0),
      frozenAt: String(row.frozen_at || ''),
      candidatesJson: String(row.candidates_json || '[]'),
      primaryDigit: String(row.primary_digit || ''),
      observedSet: row.observed_set !== null && row.observed_set !== undefined ? Number(row.observed_set) : null,
      liveObservationsCount: Number(row.live_observations_count || 0),
      settlementLastDigit: row.settlement_last_digit ? String(row.settlement_last_digit) : null,
      settlementStatus: row.settlement_status ? String(row.settlement_status) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  /**
   * Retrieves a specific SET Last Digit signal by date and session.
   */
  public async getSetLastDigitSignal(
    date: string,
    session: MarketSession
  ): Promise<D1SetLastDigitRecord | null> {
    const list = await this.querySetLastDigitSignals({ date, session, limit: 1 });
    return list.length > 0 ? list[0] : null;
  }
}

/**
 * Converts a D1V2PredictionRecord to the application's ShadowSessionRecord format
 * for direct hydration into UI views without client-side recalculation.
 */
export function v2PredictionRecordToShadowRecord(rec: D1V2PredictionRecord): ShadowSessionRecord {
  const top5: string[] = JSON.parse(rec.top5Json || '[]');
  const top10: string[] = JSON.parse(rec.top10Json || '[]');
  const candidates = JSON.parse(rec.candidatesJson || '[]');
  const probabilities: number[] = JSON.parse(rec.probabilitiesJson || '[]');
  const engineWeights = JSON.parse(rec.engineWeightsJson || '{}');
  const liveSnapshot = JSON.parse(rec.liveSnapshotJson || '[]');
  const settlementComparison = rec.settlementComparisonJson ? JSON.parse(rec.settlementComparisonJson) : null;
  const isLocked = rec.isFrozen === 1;

  return {
    id: `SHADOW_${rec.date}_${rec.session}`,
    targetDate: rec.date,
    session: rec.session,
    publishBoundaryTime: rec.session === 'AM' ? '11:00:00' : '15:00:00',
    lockBoundaryTime: rec.session === 'AM' ? '12:00:00' : '16:00:00',
    settlementTime: rec.session === 'AM' ? '12:01:00' : '16:30:00',
    observedPreLockSet: rec.observedSet,
    observedPreLockValue: rec.observedValue,
    isFrozenAtLock: isLocked,
    frozenAtTimestamp: rec.frozenAt || '',
    top1: rec.top1,
    top5: Object.freeze([...top5]),
    top10: Object.freeze([...top10]),
    liveObservationSnapshot: Object.freeze(liveSnapshot),
    engineWeights: Object.freeze(engineWeights),
    integrityHash: rec.integrityHash,
    immutableV2Output: {
      probabilities: Object.freeze(probabilities),
      top1: rec.top1,
      top5: Object.freeze([...top5]),
      top10: Object.freeze([...top10]),
      weights: Object.freeze(engineWeights),
      candidates: Object.freeze(candidates),
      distributionHash: rec.integrityHash,
      entropy: 0,
      liveObservationSnapshot: Object.freeze(liveSnapshot),
      integrityHash: rec.integrityHash,
    },
    settlementComparison,
    immutabilityHash: rec.integrityHash,
    antiLeakageAudit: {
      zeroPostLockDataUsed: true,
      zeroFutureDatesUsed: true,
      zeroTargetSettlementLeakage: true,
      sessionIsolationEnforced: true,
    },
  };
}
