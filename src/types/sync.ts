import { VerifiedMarketRecord, MarketSession } from './market';

export type SyncStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'ERROR';

export type DateClassification =
  | 'TRADING'
  | 'NON_TRADING'
  | 'PARTIAL_TRADING'
  | 'DATA_AVAILABLE'
  | 'API_ERROR'
  | 'INVALID_PAYLOAD'
  | 'SYNC_ERROR';

export type SyncAuditStage =
  | 'SYNC_START'
  | 'FETCHED'
  | 'VALIDATED'
  | 'INSERTED'
  | 'DUPLICATED'
  | 'REJECTED'
  | 'FIREBASE_SYNCED'
  | 'RECONCILED'
  | 'SYNC_COMPLETE'
  | 'SYNC_FAILED'
  | 'BACKFILL_START'
  | 'BACKFILL_DATE_FETCHED'
  | 'BACKFILL_INSERTED'
  | 'BACKFILL_DUPLICATED'
  | 'BACKFILL_NON_TRADING'
  | 'BACKFILL_API_ERROR'
  | 'BACKFILL_INVALID'
  | 'BACKFILL_COMPLETE';

export interface SyncAuditLog {
  id: string;
  syncId: string;
  stage: SyncAuditStage;
  status: 'SUCCESS' | 'WARNING' | 'ERROR' | 'INFO' | 'FAILED';
  timestamp: string;
  date?: string;
  recordsCount?: number;
  message: string;
  details?: Record<string, unknown>;
}

export interface LiveSyncCheckpoint {
  id: 'live_sync_checkpoint';
  type: 'LIVE_SYNC';
  lastSuccessfulSyncDate: string | null;
  lastSuccessfulSyncTime: string | null;
  lastSuccessfulHistoryId: string | null;
  lastSyncTimestamp: string | null;
  totalSyncRuns: number;
  lastSyncStatus: SyncStatus;
  lastSyncMessage?: string;
  updatedAt: string;
}

export interface HistoricalBackfillCheckpoint {
  id: 'historical_backfill_checkpoint';
  type: 'HISTORICAL_BACKFILL';
  lastBackfillStartDate: string | null;
  lastBackfillEndDate: string | null;
  lastProcessedDate: string | null;
  lastProcessedTime: string | null;
  lastProcessedHistoryId: string | null;
  lastSyncTimestamp: string | null;
  totalBackfillRuns: number;
  lastSyncStatus: SyncStatus;
  lastSyncMessage?: string;
  updatedAt: string;
}

export type SyncCheckpoint = LiveSyncCheckpoint | HistoricalBackfillCheckpoint;

export interface DualCheckpointState {
  liveCheckpoint: LiveSyncCheckpoint;
  historicalCheckpoint: HistoricalBackfillCheckpoint;
}

export interface DateSyncResult {
  date: string;
  classification: DateClassification;
  rawCount: number;
  verifiedCount: number;
  rejectedCount: number;
  inserted: number;
  duplicatesSkipped: number;
  amCount: number;
  pmCount: number;
  isPartialSession: boolean;
  partialReason?: string;
  errorMessage?: string;
  records: VerifiedMarketRecord[];
}

export interface ReconciliationReport {
  reconciledAt: string;
  localCount: number;
  firestoreCount: number;
  matchedCount: number;
  missingLocallyCount: number;
  missingRemotelyCount: number;
  duplicateCount: number;
  mismatchCount: number;
  unverifiedCount: number;
  status: 'SYNCHRONIZED' | 'DRIFT_DETECTED' | 'REMOTE_EMPTY' | 'LOCAL_EMPTY' | 'ERROR';
  details: {
    missingLocallyIds: string[];
    missingRemotelyIds: string[];
    mismatchedRecords: Array<{ id: string; reason: string }>;
  };
}

export interface AutoSyncConfig {
  autoSyncEnabled: boolean;
  intervalMinutes: number;
  maxRetryAttempts: number;
  retryDelayMs: number;
  syncFirestore: boolean;
}

export interface SyncSummaryReport {
  syncId: string;
  type: 'HISTORICAL_BACKFILL' | 'DAILY_AUTO_SYNC' | 'MANUAL_TRIGGER';
  startDate: string;
  endDate: string;
  totalDatesProcessed: number;
  tradingDatesCount: number;
  nonTradingDatesCount: number;
  partialTradingDatesCount: number;
  failedDatesCount: number;
  totalRawFetched: number;
  totalVerified: number;
  totalInserted: number;
  totalDuplicatesSkipped: number;
  totalRejected: number;
  totalAmRecords: number;
  totalPmRecords: number;
  firebaseSyncedCount: number;
  reconciliation: ReconciliationReport;
  liveCheckpoint: LiveSyncCheckpoint;
  historicalCheckpoint: HistoricalBackfillCheckpoint;
  status: SyncStatus;
  overallVerdict: 'PASS' | 'PASS WITH EXCEPTION' | 'FAIL';
  verdictMessage: string;
  startedAt: string;
  completedAt: string;
  dateBreakdown: DateSyncResult[];
  auditLogs: SyncAuditLog[];
}

