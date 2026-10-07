import { VerifiedMarketRecord, MarketSession, RawThaiStockResultDateGroup } from '../../types/market';
import {
  SyncCheckpoint,
  LiveSyncCheckpoint,
  HistoricalBackfillCheckpoint,
  DualCheckpointState,
  SyncAuditLog,
} from '../../types/sync';
import { StoredModelPrediction, PRODUCTION_MODEL_VERSION } from '../../types/prediction';
import type { D1LiveObservationRecord, D1V2PredictionRecord, D1V2PredictionInput, D1SetLastDigitRecord, D1SetLastDigitInput } from './d1StorageAdapter';
import type { ServerSideSetLastDigitResult } from '../prediction/serverSideSetLastDigitCoordinator';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

export type { D1LiveObservationRecord, D1V2PredictionRecord, D1V2PredictionInput, D1SetLastDigitRecord, D1SetLastDigitInput } from './d1StorageAdapter';

export interface StorageStats {
  totalVerifiedCount: number;
  latestStoredDate: string | null;
  amCount: number;
  pmCount: number;
  totalRawPayloadCount: number;
  totalStoredPredictionsCount?: number;
  storageEngine: 'SQLITE_WASM' | 'INDEXED_DB' | 'MEMORY_STORE' | 'CLOUDFLARE_D1';
  isPersistent: boolean;
}

export interface InsertStats {
  attempted: number;
  inserted: number;
  duplicatesSkipped: number;
}

export interface RawFeedRecord {
  id: string;
  date: string;
  source: string;
  endpoint: string;
  rawJson: string;
  fetchedAt: string;
}

export interface StoredVerifiedRecord {
  id: string;
  date: string;
  session: MarketSession;
  time: string;
  setRaw: string;
  valueRaw: string;
  setNumeric: number;
  valueNumeric: number;
  twod: string;
  historyId: string;
  source: string;
  fetchedAt: string;
  verifiedStatus: string;
  isSettlement: number;
}

export interface IDatasetStorage {
  init(): Promise<void>;
  getEngineInfo(): { engine: string; persistent: boolean; description: string };
  saveRawFeed(date: string, endpoint: string, rawData: unknown, explicitRecordCount?: number): Promise<void>;
  storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<InsertStats>;
  queryAllVerifiedRecords(): Promise<VerifiedMarketRecord[]>;
  queryVerifiedRecords(options?: { date?: string; session?: MarketSession; limit?: number }): Promise<VerifiedMarketRecord[]>;
  queryAllRawFeeds(): Promise<RawFeedRecord[]>;
  queryRawFeedsByDate(date: string): Promise<RawFeedRecord[]>;
  saveModelPrediction(prediction: StoredModelPrediction): Promise<void>;
  getModelPrediction(targetDate: string, session: MarketSession, modelVersion?: string): Promise<StoredModelPrediction | null>;
  queryModelPredictions(options?: { date?: string; session?: MarketSession; modelVersion?: string; limit?: number }): Promise<StoredModelPrediction[]>;
  getStats(): Promise<StorageStats>;
  getLiveCheckpoint(): Promise<LiveSyncCheckpoint>;
  saveLiveCheckpoint(checkpoint: Partial<LiveSyncCheckpoint>): Promise<void>;
  getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint>;
  saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void>;
  getDualCheckpoints(): Promise<DualCheckpointState>;
  getCheckpoint(): Promise<LiveSyncCheckpoint>;
  saveCheckpoint(checkpoint: Partial<LiveSyncCheckpoint>): Promise<void>;
  saveAuditLog(log: SyncAuditLog): Promise<void>;
  getAuditLogs(limit?: number): Promise<SyncAuditLog[]>;
  storeLiveObservation(obs: { date: string; time: string; session: MarketSession; set: number; value: number; timestamp: string }): Promise<{ inserted: boolean; duplicate: boolean }>;
  queryLiveObservations(options?: { date?: string; session?: MarketSession; limit?: number }): Promise<D1LiveObservationRecord[]>;
  storeV2Prediction(prediction: D1V2PredictionInput): Promise<{ inserted: boolean; updated: boolean; frozen: boolean }>;
  queryV2Predictions(options?: { date?: string; session?: MarketSession; limit?: number }): Promise<D1V2PredictionRecord[]>;
  getV2Prediction(date: string, session: MarketSession): Promise<D1V2PredictionRecord | null>;
  querySetLastDigitSignals(options?: { date?: string; session?: MarketSession; limit?: number }): Promise<D1SetLastDigitRecord[]>;
  getSetLastDigitSignal(date: string, session: MarketSession): Promise<D1SetLastDigitRecord | null>;
  fetchSetLastDigitSignal(options?: { date?: string; session?: MarketSession; clock?: string }): Promise<ServerSideSetLastDigitResult | null>;
  clearAll(): Promise<void>;
}

const DB_NAME = 'MM2D_MarketDatabase';
const DB_VERSION = 3;
const STORE_RAW = 'raw_market_feeds';
const STORE_VERIFIED = 'verified_market_records';
const STORE_PREDICTIONS = 'model_predictions';
const STORE_CHECKPOINTS = 'sync_checkpoints';
const STORE_AUDIT_LOGS = 'sync_audit_logs';
const DB_SOURCE = 'thaistock2d';

// Default In-Memory Initial Checkpoints
const defaultLiveCheckpoint: LiveSyncCheckpoint = {
  id: 'live_sync_checkpoint',
  type: 'LIVE_SYNC',
  lastSuccessfulSyncDate: null,
  lastSuccessfulSyncTime: null,
  lastSuccessfulHistoryId: null,
  lastSyncTimestamp: null,
  totalSyncRuns: 0,
  lastSyncStatus: 'IDLE',
  lastSyncMessage: 'Initialized',
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
  lastSyncMessage: 'Initialized',
  updatedAt: new Date().toISOString(),
};

// Global In-Memory Stores
const memoryRawStore = new Map<string, RawFeedRecord>();
const memoryVerifiedStore = new Map<string, StoredVerifiedRecord>();
const memoryPredictionStore = new Map<string, StoredModelPrediction>();
const memoryAuditLogs: SyncAuditLog[] = [];
const memoryLiveObservations: D1LiveObservationRecord[] = [];
const memoryV2PredictionStore = new Map<string, D1V2PredictionRecord>();
const memorySetLastDigitStore = new Map<string, D1SetLastDigitRecord>();
let memoryLiveCheckpoint: LiveSyncCheckpoint = { ...defaultLiveCheckpoint };
let memoryHistoricalCheckpoint: HistoricalBackfillCheckpoint = { ...defaultHistoricalCheckpoint };

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
 * Safely retrieves VITE_D1_API_URL from environment (browser import.meta.env or Node process.env)
 */
export function getD1ApiUrl(): string {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (metaEnv && metaEnv.VITE_D1_API_URL) {
      return String(metaEnv.VITE_D1_API_URL).trim();
    }
  } catch {
    // Ignore in non-Vite environments
  }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.VITE_D1_API_URL) {
      return String(process.env.VITE_D1_API_URL).trim();
    }
  } catch {
    // Ignore in environments without process.env
  }
  return '';
}

/**
 * Minimal D1 Worker API Client for reading verified records and stats from Cloudflare D1
 */
export class D1ApiStorageAdapter {
  private baseUrl: string;

  constructor(customBaseUrl?: string) {
    const raw = customBaseUrl !== undefined ? customBaseUrl : getD1ApiUrl();
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async getStats(): Promise<StorageStats> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const res = await fetch(`${this.baseUrl}/api/stats`);
    if (!res.ok) {
      throw new Error(`D1 API stats request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string; stats?: Record<string, unknown> };
    if (!data.success || !data.stats) {
      throw new Error(data.error || 'Failed to fetch D1 stats');
    }
    return {
      totalVerifiedCount: Number(data.stats.totalVerifiedCount || 0),
      latestStoredDate: (data.stats.latestStoredDate as string) || null,
      amCount: Number(data.stats.amCount || 0),
      pmCount: Number(data.stats.pmCount || 0),
      totalRawPayloadCount: Number(data.stats.totalRawPayloadCount || 0),
      storageEngine: 'CLOUDFLARE_D1',
      isPersistent: true,
    };
  }

  public async queryVerifiedRecords(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<VerifiedMarketRecord[]> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const params = new URLSearchParams();
    if (options?.date) params.append('date', options.date);
    if (options?.session) params.append('session', options.session);
    if (options?.limit && options.limit > 0) params.append('limit', options.limit.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/api/records${query}`);
    if (!res.ok) {
      throw new Error(`D1 API records request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string; records?: VerifiedMarketRecord[] };
    if (!data.success || !Array.isArray(data.records)) {
      throw new Error(data.error || 'Failed to fetch D1 records');
    }
    return data.records;
  }

  public async queryAllVerifiedRecords(): Promise<VerifiedMarketRecord[]> {
    return this.queryVerifiedRecords({ limit: 10000 });
  }

  public async getDualCheckpoints(): Promise<DualCheckpointState> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const res = await fetch(`${this.baseUrl}/api/checkpoints`);
    if (!res.ok) {
      throw new Error(`D1 API checkpoints request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { checkpoints: DualCheckpointState };
    return data.checkpoints;
  }

  public async getAuditLogs(limit = 50): Promise<SyncAuditLog[]> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const res = await fetch(`${this.baseUrl}/api/audit-logs?limit=${limit}`);
    if (!res.ok) {
      throw new Error(`D1 API audit logs request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { logs?: SyncAuditLog[] };
    return data.logs || [];
  }

  public async queryLiveObservations(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1LiveObservationRecord[]> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const params = new URLSearchParams();
    if (options?.date) params.append('date', options.date);
    if (options?.session) params.append('session', options.session);
    if (options?.limit && options.limit > 0) params.append('limit', options.limit.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/api/live-observations${query}`);
    if (!res.ok) {
      throw new Error(`D1 API live observations request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string; observations?: D1LiveObservationRecord[] };
    if (!data.success || !Array.isArray(data.observations)) {
      throw new Error(data.error || 'Failed to fetch D1 live observations');
    }
    return data.observations;
  }

  public async queryV2Predictions(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1V2PredictionRecord[]> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const params = new URLSearchParams();
    if (options?.date) params.append('date', options.date);
    if (options?.session) params.append('session', options.session);
    if (options?.limit && options.limit > 0) params.append('limit', options.limit.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/api/predictions${query}`);
    if (!res.ok) {
      throw new Error(`D1 API predictions request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string; predictions?: D1V2PredictionRecord[] };
    if (!data.success || !Array.isArray(data.predictions)) {
      throw new Error(data.error || 'Failed to fetch D1 predictions');
    }
    return data.predictions;
  }

  public async querySetLastDigitSignals(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1SetLastDigitRecord[]> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const params = new URLSearchParams();
    if (options?.date) params.append('date', options.date);
    if (options?.session) params.append('session', options.session);
    if (options?.limit && options.limit > 0) params.append('limit', options.limit.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/api/set-last-digit/history${query}`);
    if (!res.ok) {
      throw new Error(`D1 API SET last digit signals request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string; signals?: D1SetLastDigitRecord[] };
    if (!data.success || !Array.isArray(data.signals)) {
      throw new Error(data.error || 'Failed to fetch D1 SET last digit signals');
    }
    return data.signals;
  }

  public async fetchSetLastDigitSignal(options?: {
    date?: string;
    session?: MarketSession;
    clock?: string;
  }): Promise<ServerSideSetLastDigitResult | null> {
    if (!this.isConfigured()) {
      throw new Error('D1 API URL is not configured');
    }
    const params = new URLSearchParams();
    if (options?.date) params.append('date', options.date);
    if (options?.session) params.append('session', options.session);
    if (options?.clock) params.append('clock', options.clock);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/api/set-last-digit/signal${query}`);
    if (!res.ok) {
      throw new Error(`D1 API SET last digit signal request failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { success?: boolean; error?: string } & ServerSideSetLastDigitResult;
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch D1 SET last digit signal');
    }
    return data;
  }
}

/**
 * Universal Dataset Storage Implementation
 * Supports Native IndexedDB persistence in browser, SQL.js WebAssembly queries,
 * and reliable fallback memory structures in Node.js/CLI environments.
 */
export class DatasetStorageManager implements IDatasetStorage {
  private db: IDBDatabase | null = null;
  private isIndexedDBAvailable = false;
  private sqlDb: SqlJsDatabase | null = null;
  private isSqliteAvailable = false;
  private initPromise: Promise<void> | null = null;
  private d1Adapter: D1ApiStorageAdapter = new D1ApiStorageAdapter();

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // 1. Initialize SQLite (sql.js) in browser environment if available
      if (typeof window !== 'undefined') {
        try {
          const SQL = await initSqlJs({
            locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/${file}`,
          });
          this.sqlDb = new SQL.Database();
          this.createSqliteTables();
          this.isSqliteAvailable = true;
        } catch {
          this.isSqliteAvailable = false;
        }
      }

      // 2. Initialize Browser IndexedDB
      if (typeof window !== 'undefined' && window.indexedDB) {
        await new Promise<void>((resolve) => {
          try {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
              this.isIndexedDBAvailable = false;
              resolve();
            };

            request.onsuccess = () => {
              this.db = request.result;
              this.isIndexedDBAvailable = true;
              resolve();
            };

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
              const db = (event.target as IDBOpenDBRequest).result;

              if (!db.objectStoreNames.contains(STORE_RAW)) {
                const rawStore = db.createObjectStore(STORE_RAW, { keyPath: 'id' });
                rawStore.createIndex('date', 'date', { unique: false });
              }

              if (!db.objectStoreNames.contains(STORE_VERIFIED)) {
                const verifiedStore = db.createObjectStore(STORE_VERIFIED, { keyPath: 'id' });
                verifiedStore.createIndex('date', 'date', { unique: false });
                verifiedStore.createIndex('session', 'session', { unique: false });
                verifiedStore.createIndex('date_session', ['date', 'session'], { unique: false });
              }

              if (!db.objectStoreNames.contains(STORE_PREDICTIONS)) {
                const predStore = db.createObjectStore(STORE_PREDICTIONS, { keyPath: 'id' });
                predStore.createIndex('date', 'targetDate', { unique: false });
                predStore.createIndex('session', 'session', { unique: false });
                predStore.createIndex('modelVersion', 'modelVersion', { unique: false });
              }

              if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
                db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'id' });
              }

              if (!db.objectStoreNames.contains(STORE_AUDIT_LOGS)) {
                const auditStore = db.createObjectStore(STORE_AUDIT_LOGS, { keyPath: 'id' });
                auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                auditStore.createIndex('syncId', 'syncId', { unique: false });
              }
            };
          } catch {
            this.isIndexedDBAvailable = false;
            resolve();
          }
        });
      } else {
        this.isIndexedDBAvailable = false;
      }
    })();

    return this.initPromise;
  }

  private createSqliteTables(): void {
    if (!this.sqlDb) return;
    this.sqlDb.run(`
      CREATE TABLE IF NOT EXISTS raw_market_feeds (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        source TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verified_market_records (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        session TEXT NOT NULL,
        time TEXT NOT NULL,
        set_raw TEXT NOT NULL,
        value_raw TEXT NOT NULL,
        set_numeric REAL NOT NULL,
        value_numeric REAL NOT NULL,
        twod TEXT NOT NULL,
        history_id TEXT NOT NULL,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        verified_status TEXT NOT NULL,
        is_settlement INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_predictions (
        id TEXT PRIMARY KEY,
        record_type TEXT NOT NULL,
        target_date TEXT NOT NULL,
        session TEXT NOT NULL,
        model_version TEXT NOT NULL,
        status TEXT NOT NULL,
        top1 TEXT NOT NULL,
        top3_json TEXT NOT NULL,
        top5_json TEXT NOT NULL,
        top10_json TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        entropy REAL NOT NULL,
        top_margin REAL NOT NULL,
        confidence_score REAL NOT NULL,
        feature_integrity_hash TEXT NOT NULL,
        cutoff_time TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        is_frozen INTEGER NOT NULL,
        frozen_at TEXT,
        pre_lock_source_used TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        last_date TEXT,
        last_time TEXT,
        last_history_id TEXT,
        last_sync_timestamp TEXT,
        total_runs INTEGER,
        last_status TEXT,
        last_message TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_audit_logs (
        id TEXT PRIMARY KEY,
        sync_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS live_observations (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        session TEXT NOT NULL,
        time TEXT NOT NULL,
        set_numeric REAL NOT NULL,
        value_numeric REAL NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);
  }

  public isD1RemoteConfigured(): boolean {
    return this.d1Adapter.isConfigured();
  }

  public getD1Adapter(): D1ApiStorageAdapter {
    return this.d1Adapter;
  }

  public setD1ApiUrl(url: string): void {
    this.d1Adapter = new D1ApiStorageAdapter(url);
  }

  public getEngineInfo(): { engine: string; persistent: boolean; description: string } {
    if (this.d1Adapter.isConfigured()) {
      return {
        engine: 'CLOUDFLARE_D1',
        persistent: true,
        description: `Cloudflare D1 Remote Database API (${this.d1Adapter.getBaseUrl()})`,
      };
    }
    if (this.isIndexedDBAvailable) {
      return {
        engine: 'Native IndexedDB + SQLite Abstraction',
        persistent: true,
        description: 'Browser Native IndexedDB persistent storage backing with SQLite relational schema mapping',
      };
    }
    if (this.isSqliteAvailable) {
      return {
        engine: 'SQLite WebAssembly (sql.js)',
        persistent: false,
        description: 'In-Memory SQLite WebAssembly relational engine',
      };
    }
    return {
      engine: 'In-Memory Key-Value Store',
      persistent: false,
      description: 'Transient memory structures for test and execution',
    };
  }

  public async saveRawFeed(date: string, endpoint: string, rawData: unknown): Promise<void> {
    await this.init();
    const rawJson = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const feedId = `raw_${date}_${Date.now()}`;
    const record: RawFeedRecord = {
      id: feedId,
      date,
      source: DB_SOURCE,
      endpoint,
      rawJson,
      fetchedAt: new Date().toISOString(),
    };

    memoryRawStore.set(record.id, record);

    if (this.sqlDb) {
      try {
        this.sqlDb.run(
          `INSERT OR REPLACE INTO raw_market_feeds (id, date, source, endpoint, raw_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [record.id, record.date, record.source, record.endpoint, record.rawJson, record.fetchedAt]
        );
      } catch (e) {
        console.warn('SQLite raw feed insert warning:', e);
      }
    }

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readwrite');
        const store = tx.objectStore(STORE_RAW);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  public async storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<InsertStats> {
    await this.init();
    let inserted = 0;
    let duplicatesSkipped = 0;

    const storedRows: StoredVerifiedRecord[] = records.map((r) => ({
      id: r.id,
      date: r.date,
      session: r.session,
      time: r.time,
      setRaw: r.setRaw,
      valueRaw: r.valueRaw,
      setNumeric: r.setNumeric,
      valueNumeric: r.valueNumeric,
      twod: r.twod,
      historyId: r.historyId,
      source: DB_SOURCE,
      fetchedAt: r.verifiedAt || new Date().toISOString(),
      verifiedStatus: 'VERIFIED',
      isSettlement: r.isSettlement ? 1 : 0,
    }));

    if (this.isIndexedDBAvailable && this.db) {
      const existingIds = await this.getAllVerifiedIdsFromIndexedDB();
      const newRows: StoredVerifiedRecord[] = [];

      for (const row of storedRows) {
        if (existingIds.has(row.id)) {
          duplicatesSkipped++;
        } else {
          newRows.push(row);
          existingIds.add(row.id);
          memoryVerifiedStore.set(row.id, row);
        }
      }

      if (newRows.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(STORE_VERIFIED, 'readwrite');
          const store = tx.objectStore(STORE_VERIFIED);
          for (const row of newRows) {
            store.put(row);
          }
          tx.oncomplete = () => {
            inserted += newRows.length;
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        });
      }
    } else {
      for (const row of storedRows) {
        if (memoryVerifiedStore.has(row.id)) {
          duplicatesSkipped++;
        } else {
          memoryVerifiedStore.set(row.id, row);
          inserted++;
        }
      }
    }

    // Sync into SQLite in-memory instance
    if (this.sqlDb) {
      for (const row of storedRows) {
        try {
          this.sqlDb.run(
            `INSERT OR IGNORE INTO verified_market_records (id, date, session, time, set_raw, value_raw, set_numeric, value_numeric, twod, history_id, source, fetched_at, verified_status, is_settlement) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.id,
              row.date,
              row.session,
              row.time,
              row.setRaw,
              row.valueRaw,
              row.setNumeric,
              row.valueNumeric,
              row.twod,
              row.historyId,
              row.source,
              row.fetchedAt,
              row.verifiedStatus,
              row.isSettlement,
            ]
          );
        } catch (err) {
          console.warn('SQLite record insert warning:', err);
        }
      }
    }

    return {
      attempted: records.length,
      inserted,
      duplicatesSkipped,
    };
  }

  private async getAllVerifiedIdsFromIndexedDB(): Promise<Set<string>> {
    if (!this.db) return new Set<string>();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
      const store = tx.objectStore(STORE_VERIFIED);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const set = new Set<string>((req.result as string[]) || []);
        resolve(set);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async queryAllVerifiedRecords(): Promise<VerifiedMarketRecord[]> {
    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.queryAllVerifiedRecords();
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 queryAllVerifiedRecords failed, falling back to local:', err);
      }
    }

    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_VERIFIED, 'readonly');
        const store = tx.objectStore(STORE_VERIFIED);
        const req = store.getAll();

        req.onsuccess = () => {
          const rows: StoredVerifiedRecord[] = req.result || [];
          rows.sort((a, b) => {
            const dateComp = b.date.localeCompare(a.date);
            if (dateComp !== 0) return dateComp;
            return b.time.localeCompare(a.time);
          });
          resolve(rows.map(this.mapStoredToVerifiedRecord));
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      const rows = Array.from(memoryVerifiedStore.values()).sort((a, b) => {
        const dateComp = b.date.localeCompare(a.date);
        if (dateComp !== 0) return dateComp;
        return b.time.localeCompare(a.time);
      });
      return rows.map(this.mapStoredToVerifiedRecord);
    }
  }

  public async queryVerifiedRecords(options?: { date?: string; session?: MarketSession; limit?: number }): Promise<VerifiedMarketRecord[]> {
    const all = await this.queryAllVerifiedRecords();
    let filtered = all;
    if (options?.date) {
      filtered = filtered.filter((r) => r.date === options.date);
    }
    if (options?.session) {
      filtered = filtered.filter((r) => r.session === options.session);
    }
    if (options?.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }
    return filtered;
  }

  public async queryAllRawFeeds(): Promise<RawFeedRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readonly');
        const store = tx.objectStore(STORE_RAW);
        const req = store.getAll();

        req.onsuccess = () => {
          const rows: RawFeedRecord[] = req.result || [];
          rows.sort((a, b) => a.date.localeCompare(b.date));
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      return Array.from(memoryRawStore.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  public async queryRawFeedsByDate(date: string): Promise<RawFeedRecord[]> {
    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(STORE_RAW, 'readonly');
        const store = tx.objectStore(STORE_RAW);
        const index = store.index('date');
        const req = index.getAll(IDBKeyRange.only(date));

        req.onsuccess = () => {
          const rows: RawFeedRecord[] = req.result || [];
          resolve(rows);
        };
        req.onerror = () => reject(req.error);
      });
    } else {
      return Array.from(memoryRawStore.values()).filter((r) => r.date === date);
    }
  }

  public async saveModelPrediction(prediction: StoredModelPrediction): Promise<void> {
    await this.init();
    memoryPredictionStore.set(prediction.id, prediction);

    if (this.sqlDb) {
      try {
        this.sqlDb.run(
          `INSERT OR REPLACE INTO model_predictions (
            id, record_type, target_date, session, model_version, status, top1,
            top3_json, top5_json, top10_json, candidates_json, entropy, top_margin,
            confidence_score, feature_integrity_hash, cutoff_time, generated_at, is_frozen, frozen_at, pre_lock_source_used
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            prediction.id,
            prediction.recordType,
            prediction.targetDate,
            prediction.session,
            prediction.modelVersion,
            prediction.status,
            prediction.top1,
            prediction.top3Json,
            prediction.top5Json,
            prediction.top10Json,
            prediction.candidatesJson,
            prediction.entropy,
            prediction.topMargin,
            prediction.confidenceScore,
            prediction.featureIntegrityHash,
            prediction.cutoffTime,
            prediction.generatedAt,
            prediction.isFrozen,
            prediction.frozenAt || null,
            prediction.preLockSourceUsed || null,
          ]
        );
      } catch (err) {
        console.warn('SQLite model prediction insert warning:', err);
      }
    }

    if (this.isIndexedDBAvailable && this.db) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_PREDICTIONS, 'readwrite');
        const store = tx.objectStore(STORE_PREDICTIONS);
        store.put(prediction);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  public async getModelPrediction(
    targetDate: string,
    session: MarketSession,
    modelVersion = PRODUCTION_MODEL_VERSION
  ): Promise<StoredModelPrediction | null> {
    const list = await this.queryModelPredictions({ date: targetDate, session, modelVersion, limit: 1 });
    return list.length > 0 ? list[0] : null;
  }

  public async queryModelPredictions(options?: {
    date?: string;
    session?: MarketSession;
    modelVersion?: string;
    limit?: number;
  }): Promise<StoredModelPrediction[]> {
    await this.init();

    let list: StoredModelPrediction[] = [];

    if (this.isIndexedDBAvailable && this.db) {
      list = await new Promise<StoredModelPrediction[]>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_PREDICTIONS, 'readonly');
        const store = tx.objectStore(STORE_PREDICTIONS);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as StoredModelPrediction[]) || []);
        req.onerror = () => reject(req.error);
      });
    } else {
      list = Array.from(memoryPredictionStore.values());
    }

    if (options?.date) {
      list = list.filter((p) => p.targetDate === options.date);
    }
    if (options?.session) {
      list = list.filter((p) => p.session === options.session);
    }
    if (options?.modelVersion) {
      list = list.filter((p) => p.modelVersion === options.modelVersion);
    }

    list.sort((a, b) => {
      const dComp = b.targetDate.localeCompare(a.targetDate);
      if (dComp !== 0) return dComp;
      return b.generatedAt.localeCompare(a.generatedAt);
    });

    if (options?.limit && options.limit > 0) {
      list = list.slice(0, options.limit);
    }

    return list;
  }

  public async getStats(): Promise<StorageStats> {
    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.getStats();
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 getStats failed, falling back to local:', err);
      }
    }

    await this.init();
    const records = await this.queryAllVerifiedRecords();
    const rawFeeds = await this.queryAllRawFeeds();
    const predictions = await this.queryModelPredictions();

    const amCount = records.filter((r) => r.session === 'AM').length;
    const pmCount = records.filter((r) => r.session === 'PM').length;
    const latestStoredDate = records.length > 0 ? records[0].date : null;

    let engine: 'INDEXED_DB' | 'SQLITE_WASM' | 'MEMORY_STORE' | 'CLOUDFLARE_D1' = 'MEMORY_STORE';
    if (this.isIndexedDBAvailable) engine = 'INDEXED_DB';
    else if (this.isSqliteAvailable) engine = 'SQLITE_WASM';

    return {
      totalVerifiedCount: records.length,
      latestStoredDate,
      amCount,
      pmCount,
      totalRawPayloadCount: rawFeeds.length,
      totalStoredPredictionsCount: predictions.length,
      storageEngine: engine,
      isPersistent: this.isIndexedDBAvailable,
    };
  }

  /**
   * Get the Live Synchronization Checkpoint.
   * This checkpoint strictly represents the latest live feed time reached.
   */
  public async getLiveCheckpoint(): Promise<LiveSyncCheckpoint> {
    if (this.d1Adapter.isConfigured()) {
      try {
        const dual = await this.d1Adapter.getDualCheckpoints();
        if (dual && dual.liveCheckpoint) {
          return dual.liveCheckpoint;
        }
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 getLiveCheckpoint failed, falling back to local:', err);
      }
    }

    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction(STORE_CHECKPOINTS, 'readonly');
        const store = tx.objectStore(STORE_CHECKPOINTS);
        const req = store.get('live_sync_checkpoint');

        req.onsuccess = () => {
          if (req.result) {
            resolve(req.result as LiveSyncCheckpoint);
          } else {
            resolve(memoryLiveCheckpoint);
          }
        };
        req.onerror = () => resolve(memoryLiveCheckpoint);
      });
    }

    return memoryLiveCheckpoint;
  }

  /**
   * Save Live Checkpoint.
   * Monotonic constraint: will only advance forward in date/time or update run metadata.
   */
  public async saveLiveCheckpoint(checkpoint: Partial<LiveSyncCheckpoint>): Promise<void> {
    await this.init();
    const current = await this.getLiveCheckpoint();

    let newDate = current.lastSuccessfulSyncDate;
    let newTime = current.lastSuccessfulSyncTime;
    let newHistoryId = current.lastSuccessfulHistoryId;

    if (checkpoint.lastSuccessfulSyncDate) {
      if (
        isDateTimeAfter(
          checkpoint.lastSuccessfulSyncDate,
          checkpoint.lastSuccessfulSyncTime,
          current.lastSuccessfulSyncDate,
          current.lastSuccessfulSyncTime
        )
      ) {
        newDate = checkpoint.lastSuccessfulSyncDate;
        newTime = checkpoint.lastSuccessfulSyncTime || null;
        newHistoryId = checkpoint.lastSuccessfulHistoryId || null;
      }
    }

    const updated: LiveSyncCheckpoint = {
      ...current,
      ...checkpoint,
      id: 'live_sync_checkpoint',
      type: 'LIVE_SYNC',
      lastSuccessfulSyncDate: newDate,
      lastSuccessfulSyncTime: newTime,
      lastSuccessfulHistoryId: newHistoryId,
      totalSyncRuns: (current.totalSyncRuns || 0) + (checkpoint.totalSyncRuns ? 1 : 0),
      updatedAt: new Date().toISOString(),
    };

    memoryLiveCheckpoint = updated;

    if (this.sqlDb) {
      try {
        this.sqlDb.run(
          `INSERT OR REPLACE INTO sync_checkpoints (id, type, last_date, last_time, last_history_id, last_sync_timestamp, total_runs, last_status, last_message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            updated.id,
            updated.type,
            updated.lastSuccessfulSyncDate,
            updated.lastSuccessfulSyncTime,
            updated.lastSuccessfulHistoryId,
            updated.lastSyncTimestamp,
            updated.totalSyncRuns,
            updated.lastSyncStatus,
            updated.lastSyncMessage || '',
            updated.updatedAt,
          ]
        );
      } catch (err) {
        console.warn('SQLite checkpoint save warning:', err);
      }
    }

    if (this.isIndexedDBAvailable && this.db) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_CHECKPOINTS, 'readwrite');
        const store = tx.objectStore(STORE_CHECKPOINTS);
        store.put(updated);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  /**
   * Get Historical Backfill Checkpoint.
   */
  public async getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint> {
    if (this.d1Adapter.isConfigured()) {
      try {
        const dual = await this.d1Adapter.getDualCheckpoints();
        if (dual && dual.historicalCheckpoint) {
          return dual.historicalCheckpoint;
        }
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 getHistoricalCheckpoint failed, falling back to local:', err);
      }
    }

    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction(STORE_CHECKPOINTS, 'readonly');
        const store = tx.objectStore(STORE_CHECKPOINTS);
        const req = store.get('historical_backfill_checkpoint');

        req.onsuccess = () => {
          if (req.result) {
            resolve(req.result as HistoricalBackfillCheckpoint);
          } else {
            resolve(memoryHistoricalCheckpoint);
          }
        };
        req.onerror = () => resolve(memoryHistoricalCheckpoint);
      });
    }

    return memoryHistoricalCheckpoint;
  }

  /**
   * Save Historical Backfill Checkpoint.
   * Completely independent from Live Sync Checkpoint.
   */
  public async saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void> {
    await this.init();
    const current = await this.getHistoricalCheckpoint();

    const updated: HistoricalBackfillCheckpoint = {
      ...current,
      ...checkpoint,
      id: 'historical_backfill_checkpoint',
      type: 'HISTORICAL_BACKFILL',
      totalBackfillRuns: (current.totalBackfillRuns || 0) + (checkpoint.totalBackfillRuns ? 1 : 0),
      updatedAt: new Date().toISOString(),
    };

    memoryHistoricalCheckpoint = updated;

    if (this.sqlDb) {
      try {
        this.sqlDb.run(
          `INSERT OR REPLACE INTO sync_checkpoints (id, type, last_date, last_time, last_history_id, last_sync_timestamp, total_runs, last_status, last_message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            updated.id,
            updated.type,
            updated.lastProcessedDate,
            updated.lastProcessedTime,
            updated.lastProcessedHistoryId,
            updated.lastSyncTimestamp,
            updated.totalBackfillRuns,
            updated.lastSyncStatus,
            updated.lastSyncMessage || '',
            updated.updatedAt,
          ]
        );
      } catch (err) {
        console.warn('SQLite checkpoint save warning:', err);
      }
    }

    if (this.isIndexedDBAvailable && this.db) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_CHECKPOINTS, 'readwrite');
        const store = tx.objectStore(STORE_CHECKPOINTS);
        store.put(updated);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  /**
   * Get both live and historical checkpoints in one atomic call.
   */
  public async getDualCheckpoints(): Promise<DualCheckpointState> {
    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.getDualCheckpoints();
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 getDualCheckpoints failed, falling back to local:', err);
      }
    }

    const live = await this.getLiveCheckpoint();
    const historical = await this.getHistoricalCheckpoint();
    return {
      liveCheckpoint: live,
      historicalCheckpoint: historical,
    };
  }

  // Backward compatibility alias for live checkpoint
  public async getCheckpoint(): Promise<LiveSyncCheckpoint> {
    return this.getLiveCheckpoint();
  }

  public async saveCheckpoint(checkpoint: Partial<LiveSyncCheckpoint>): Promise<void> {
    return this.saveLiveCheckpoint(checkpoint);
  }

  public async saveAuditLog(log: SyncAuditLog): Promise<void> {
    await this.init();
    memoryAuditLogs.unshift(log);
    if (memoryAuditLogs.length > 200) {
      memoryAuditLogs.pop();
    }

    if (this.isIndexedDBAvailable && this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE_AUDIT_LOGS, 'readwrite');
        const store = tx.objectStore(STORE_AUDIT_LOGS);
        store.put(log);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  }

  public async getAuditLogs(limit = 50): Promise<SyncAuditLog[]> {
    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.getAuditLogs(limit);
      } catch (err) {
        console.warn('[DatasetStorage] Remote D1 getAuditLogs failed, falling back to local:', err);
      }
    }

    await this.init();

    if (this.isIndexedDBAvailable && this.db) {
      return new Promise((resolve) => {
        const tx = this.db!.transaction(STORE_AUDIT_LOGS, 'readonly');
        const store = tx.objectStore(STORE_AUDIT_LOGS);
        const req = store.getAll();

        req.onsuccess = () => {
          const logs: SyncAuditLog[] = req.result || [];
          logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
          resolve(logs.slice(0, limit));
        };
        req.onerror = () => resolve(memoryAuditLogs.slice(0, limit));
      });
    }

    return memoryAuditLogs.slice(0, limit);
  }

  public async storeLiveObservation(obs: {
    date: string;
    time: string;
    session: MarketSession;
    set: number;
    value: number;
    timestamp: string;
  }): Promise<{ inserted: boolean; duplicate: boolean }> {
    await this.init();
    const id = `live_${obs.date}_${obs.session}_${obs.time}`;
    const record: D1LiveObservationRecord = {
      id,
      date: obs.date,
      time: obs.time,
      session: obs.session,
      set: obs.set,
      value: obs.value,
      timestamp: obs.timestamp,
    };

    const existingIdx = memoryLiveObservations.findIndex(
      (o) => o.id === id || (o.date === obs.date && o.session === obs.session && o.time === obs.time)
    );

    if (existingIdx >= 0) {
      if (memoryLiveObservations[existingIdx].set === obs.set && memoryLiveObservations[existingIdx].value === obs.value) {
        return { inserted: false, duplicate: true };
      }
      memoryLiveObservations[existingIdx] = record;
    } else {
      memoryLiveObservations.push(record);
      memoryLiveObservations.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    }

    if (this.sqlDb) {
      try {
        this.sqlDb.run(
          `INSERT OR REPLACE INTO live_observations (id, date, session, time, set_numeric, value_numeric, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, obs.date, obs.session, obs.time, obs.set, obs.value, obs.timestamp]
        );
      } catch (err) {
        console.warn('[DatasetStorageManager] SQLite live observation store error:', err);
      }
    }

    return { inserted: true, duplicate: false };
  }

  public async queryLiveObservations(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1LiveObservationRecord[]> {
    await this.init();

    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.queryLiveObservations(options);
      } catch (err) {
        console.warn('[DatasetStorageManager] Remote D1 live observation query failed, falling back to local store:', err);
      }
    }

    let results = [...memoryLiveObservations];
    if (options?.date) {
      results = results.filter((r) => r.date === options.date);
    }
    if (options?.session) {
      results = results.filter((r) => r.session === options.session);
    }
    results.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  public async storeV2Prediction(prediction: D1V2PredictionInput): Promise<{
    inserted: boolean;
    updated: boolean;
    frozen: boolean;
  }> {
    await this.init();
    const id = `v2_${prediction.date}_${prediction.session}`;
    const now = new Date().toISOString();
    const existing = memoryV2PredictionStore.get(id);

    if (existing) {
      if (existing.isFrozen === 1) {
        if (prediction.settlementComparison && !existing.settlementComparisonJson) {
          existing.settlementComparisonJson = JSON.stringify(prediction.settlementComparison);
          existing.status = 'OFFICIAL_RESULT_AVAILABLE';
          existing.updatedAt = now;
          return { inserted: false, updated: true, frozen: true };
        }
        return { inserted: false, updated: false, frozen: true };
      }

      const updatedRec: D1V2PredictionRecord = {
        ...existing,
        status: prediction.status,
        isFrozen: prediction.isFrozen ? 1 : 0,
        frozenAt: prediction.isFrozen ? (prediction.frozenAt || now) : null,
        top1: prediction.top1,
        top5Json: JSON.stringify(prediction.top5),
        top10Json: JSON.stringify(prediction.top10),
        candidatesJson: JSON.stringify(prediction.candidates),
        probabilitiesJson: JSON.stringify(prediction.probabilities),
        engineWeightsJson: JSON.stringify(prediction.engineWeights),
        observedSet: prediction.observedSet,
        observedValue: prediction.observedValue,
        liveObservationsCount: prediction.liveObservationsCount,
        liveSnapshotJson: JSON.stringify(prediction.liveSnapshot),
        integrityHash: prediction.integrityHash,
        settlementComparisonJson: prediction.settlementComparison ? JSON.stringify(prediction.settlementComparison) : existing.settlementComparisonJson,
        updatedAt: now,
      };
      memoryV2PredictionStore.set(id, updatedRec);
      return { inserted: false, updated: true, frozen: prediction.isFrozen };
    }

    const newRec: D1V2PredictionRecord = {
      id,
      date: prediction.date,
      session: prediction.session,
      modelVersion: prediction.modelVersion || 'AUTO_WEIGHTED_V2',
      status: prediction.status,
      isFrozen: prediction.isFrozen ? 1 : 0,
      frozenAt: prediction.isFrozen ? (prediction.frozenAt || now) : null,
      top1: prediction.top1,
      top5Json: JSON.stringify(prediction.top5),
      top10Json: JSON.stringify(prediction.top10),
      candidatesJson: JSON.stringify(prediction.candidates),
      probabilitiesJson: JSON.stringify(prediction.probabilities),
      engineWeightsJson: JSON.stringify(prediction.engineWeights),
      observedSet: prediction.observedSet,
      observedValue: prediction.observedValue,
      liveObservationsCount: prediction.liveObservationsCount,
      liveSnapshotJson: JSON.stringify(prediction.liveSnapshot),
      integrityHash: prediction.integrityHash,
      settlementComparisonJson: prediction.settlementComparison ? JSON.stringify(prediction.settlementComparison) : null,
      createdAt: now,
      updatedAt: now,
    };
    memoryV2PredictionStore.set(id, newRec);
    return { inserted: true, updated: false, frozen: prediction.isFrozen };
  }

  public async queryV2Predictions(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1V2PredictionRecord[]> {
    await this.init();

    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.queryV2Predictions(options);
      } catch (err) {
        console.warn('[DatasetStorageManager] Remote D1 predictions query failed, falling back to local store:', err);
      }
    }

    let results = Array.from(memoryV2PredictionStore.values());
    if (options?.date) {
      results = results.filter((r) => r.date === options.date);
    }
    if (options?.session) {
      results = results.filter((r) => r.session === options.session);
    }
    results.sort((a, b) => b.date.localeCompare(a.date) || a.session.localeCompare(b.session));
    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  public async getV2Prediction(date: string, session: MarketSession): Promise<D1V2PredictionRecord | null> {
    const list = await this.queryV2Predictions({ date, session, limit: 1 });
    return list.length > 0 ? list[0] : null;
  }

  public async querySetLastDigitSignals(options?: {
    date?: string;
    session?: MarketSession;
    limit?: number;
  }): Promise<D1SetLastDigitRecord[]> {
    await this.init();

    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.querySetLastDigitSignals(options);
      } catch (err) {
        console.warn('[DatasetStorageManager] Remote D1 SET last digit query failed, falling back to local store:', err);
      }
    }

    let results = Array.from(memorySetLastDigitStore.values());
    if (options?.date) {
      results = results.filter((r) => r.date === options.date);
    }
    if (options?.session) {
      results = results.filter((r) => r.session === options.session);
    }
    results.sort((a, b) => b.date.localeCompare(a.date) || a.session.localeCompare(b.session));
    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  public async getSetLastDigitSignal(date: string, session: MarketSession): Promise<D1SetLastDigitRecord | null> {
    const list = await this.querySetLastDigitSignals({ date, session, limit: 1 });
    return list.length > 0 ? list[0] : null;
  }

  public async fetchSetLastDigitSignal(options?: {
    date?: string;
    session?: MarketSession;
    clock?: string;
  }): Promise<ServerSideSetLastDigitResult | null> {
    if (this.d1Adapter.isConfigured()) {
      try {
        return await this.d1Adapter.fetchSetLastDigitSignal(options);
      } catch (err) {
        console.warn('[DatasetStorageManager] Remote D1 fetchSetLastDigitSignal failed:', err);
      }
    }
    return null;
  }

  public async clearAll(): Promise<void> {
    await this.init();
    memoryV2PredictionStore.clear();
    memoryRawStore.clear();
    memoryVerifiedStore.clear();
    memoryPredictionStore.clear();
    memoryAuditLogs.length = 0;
    memoryLiveObservations.length = 0;
    memoryLiveCheckpoint = { ...defaultLiveCheckpoint };
    memoryHistoricalCheckpoint = { ...defaultHistoricalCheckpoint };

    if (this.sqlDb) {
      this.createSqliteTables();
    }

    if (this.isIndexedDBAvailable && this.db) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction([STORE_RAW, STORE_VERIFIED, STORE_PREDICTIONS, STORE_CHECKPOINTS, STORE_AUDIT_LOGS], 'readwrite');
        tx.objectStore(STORE_RAW).clear();
        tx.objectStore(STORE_VERIFIED).clear();
        tx.objectStore(STORE_PREDICTIONS).clear();
        tx.objectStore(STORE_CHECKPOINTS).clear();
        tx.objectStore(STORE_AUDIT_LOGS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  private mapStoredToVerifiedRecord(row: StoredVerifiedRecord): VerifiedMarketRecord {
    const cleanSet = row.setRaw.replace(/,/g, '').trim();
    const cleanVal = row.valueRaw.replace(/,/g, '').trim();
    const setDigitsOnly = cleanSet.replace(/[^\d]/g, '');
    const setLastDigit = setDigitsOnly.length > 0 ? setDigitsOnly.slice(-1) : '';
    const valIntegerPart = cleanVal.split('.')[0].replace(/[^\d]/g, '');
    const valueLastDigitBeforeDecimal = valIntegerPart.length > 0 ? valIntegerPart.slice(-1) : '';
    const derived2D = `${setLastDigit}${valueLastDigitBeforeDecimal}`;
    const isConsistent = derived2D === row.twod;

    return {
      id: row.id,
      date: row.date,
      time: row.time,
      session: row.session,
      isSettlement: row.isSettlement === 1,
      setRaw: row.setRaw,
      valueRaw: row.valueRaw,
      setNumeric: row.setNumeric,
      valueNumeric: row.valueNumeric,
      twod: row.twod,
      historyId: row.historyId,
      verifiedAt: row.fetchedAt,
      mathematicalCheck: {
        setLastDigit,
        valueLastDigitBeforeDecimal,
        derived2D,
        isMathematicallyConsistent: isConsistent,
      },
    };
  }
}

export const globalDatasetStorage = new DatasetStorageManager();

