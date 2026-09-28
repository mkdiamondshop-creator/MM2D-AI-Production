import { fetch2DResultByDate, validateThaiStockResponse } from '../api/thaistockClient';
import { parseAndVerify2DResult } from '../integrity/parser';
import { VerifiedMarketRecord, RawThaiStockResultDateGroup } from '../../types/market';
import {
  SyncAuditLog,
  SyncAuditStage,
  DateClassification,
  HistoricalBackfillCheckpoint,
  SyncStatus,
} from '../../types/sync';
/**
 * Generate an array of YYYY-MM-DD date strings between start and end dates (inclusive).
 */
export function generateDateRange(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${startDateStr} to ${endDateStr}`);
  }

  if (start > end) {
    throw new Error(`Start date (${startDateStr}) cannot be after end date (${endDateStr})`);
  }

  const current = new Date(start);
  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export const EARLIEST_CONFIRMED_INCEPTION_DATE = '2021-10-28';

export interface BackfillEngineStorage {
  saveRawFeed(date: string, endpoint: string, rawData: unknown, explicitRecordCount?: number): Promise<void>;
  storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<{ attempted: number; inserted: number; duplicatesSkipped: number }>;
  queryVerifiedRecords(options?: { date?: string; limit?: number }): Promise<VerifiedMarketRecord[]>;
  getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint>;
  saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void>;
  saveAuditLog(log: SyncAuditLog): Promise<void>;
  getAuditLogs?(limit?: number): Promise<SyncAuditLog[]>;
}

export interface HistoricalBackfillConfig {
  startDate?: string;
  endDate?: string;
  maxDates?: number;
  batchSize?: number;
  requestDelayMs?: number;
  maxConsecutiveErrors?: number;
  resumeFromCheckpoint?: boolean;
  onProgress?: (progress: BackfillProgress) => void;
}

export interface BackfillProgress {
  currentDate: string;
  currentIndex: number;
  totalDates: number;
  classification: DateClassification;
  inserted: number;
  duplicatesSkipped: number;
  consecutiveErrors: number;
  message: string;
}

export interface BackfillDateResult {
  date: string;
  classification: DateClassification;
  rawCount: number;
  verifiedCount: number;
  rejectedCount: number;
  inserted: number;
  duplicatesSkipped: number;
  errorMessage?: string;
  isPhpDiagnostic?: boolean;
  records: VerifiedMarketRecord[];
}

export interface HistoricalBackfillSummary {
  backfillId: string;
  startDate: string;
  endDate: string;
  resumedFromDate: string | null;
  totalDatesAttempted: number;
  dataAvailableDates: number;
  nonTradingDates: number;
  apiErrorDates: number;
  invalidPayloadDates: number;
  unresolvedErrorDates: string[];
  totalRawRecords: number;
  totalVerifiedRecords: number;
  totalNewlyInserted: number;
  totalDuplicatesSkipped: number;
  lastProcessedDate: string | null;
  lastProcessedTime: string | null;
  lastProcessedHistoryId: string | null;
  status: SyncStatus;
  statusMessage: string;
  startedAt: string;
  completedAt: string;
  dateBreakdown: BackfillDateResult[];
}

/**
 * Historical Backfill Engine
 * Safely backfills historical ThaiStock2D data into D1/local storage with:
 * - Strict verification & provenance tracking
 * - Idempotency & deduplication
 * - Resumable checkpointing (isolated from live sync)
 * - Upstream rate-limiting and error isolation
 * - Non-destructive zero-fabrication guarantees
 */
export class HistoricalBackfillEngine {
  private storage: BackfillEngineStorage;

  constructor(storage: BackfillEngineStorage) {
    this.storage = storage;
  }

  /**
   * Executes historical backfill over a defined or resumable date range.
   */
  public async executeBackfill(config: HistoricalBackfillConfig = {}): Promise<HistoricalBackfillSummary> {
    const startedAt = new Date().toISOString();
    const backfillId = `backfill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const requestDelayMs = config.requestDelayMs ?? 50;
    const maxConsecutiveErrors = config.maxConsecutiveErrors ?? 5;
    const resumeFromCheckpoint = config.resumeFromCheckpoint ?? true;
    const maxDates = config.maxDates ?? config.batchSize ?? 50;

    // 1. Determine effective start and end dates
    const requestedStart = config.startDate || EARLIEST_CONFIRMED_INCEPTION_DATE;
    const requestedEnd = config.endDate || new Date().toISOString().split('T')[0];

    let effectiveStartDate = requestedStart;
    let resumedFromDate: string | null = null;
    let lastProcessedTime: string | null = null;
    let lastProcessedHistoryId: string | null = null;

    if (resumeFromCheckpoint) {
      const checkpoint = await this.storage.getHistoricalCheckpoint();
      if (checkpoint && checkpoint.lastProcessedDate) {
        // If checkpoint date is within or before requested range, calculate next day
        const nextDay = this.getNextDateString(checkpoint.lastProcessedDate);
        if (nextDay > requestedStart && nextDay <= requestedEnd) {
          effectiveStartDate = nextDay;
          resumedFromDate = checkpoint.lastProcessedDate;
          lastProcessedTime = checkpoint.lastProcessedTime || null;
          lastProcessedHistoryId = checkpoint.lastProcessedHistoryId || null;
        }
      }
    }

    const logAudit = async (
      stage: SyncAuditStage,
      status: SyncAuditLog['status'],
      message: string,
      date?: string,
      recordsCount?: number,
      details?: Record<string, unknown>
    ) => {
      const log: SyncAuditLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        syncId: backfillId,
        stage,
        status,
        timestamp: new Date().toISOString(),
        date,
        recordsCount,
        message,
        details,
      };
      await this.storage.saveAuditLog(log);
    };

    // 2. Generate calendar dates
    let allDates: string[] = [];
    try {
      allDates = generateDateRange(effectiveStartDate, requestedEnd);
    } catch (rangeErr) {
      const msg = rangeErr instanceof Error ? rangeErr.message : String(rangeErr);
      await logAudit('SYNC_FAILED', 'ERROR', `Invalid backfill date range: ${msg}`);
      return this.createEmptySummary(backfillId, requestedStart, requestedEnd, resumedFromDate, startedAt, 'ERROR', msg);
    }

    // Strictly bound execution to at most maxDates (default 50)
    const dates = allDates.slice(0, Math.max(1, maxDates));

    await logAudit(
      'BACKFILL_START',
      'INFO',
      `Starting bounded historical backfill (${dates.length} of ${allDates.length} remaining dates) from ${effectiveStartDate} to ${dates[dates.length - 1] || effectiveStartDate} (Resumed from: ${resumedFromDate || 'None'})`,
      effectiveStartDate,
      undefined,
      { requestedStart, requestedEnd, effectiveStartDate, resumedFromDate, backfillId, batchSize: dates.length, totalRemainingDates: allDates.length }
    );

    const dateBreakdown: BackfillDateResult[] = [];
    const unresolvedErrorDates: string[] = [];

    let dataAvailableDates = 0;
    let nonTradingDates = 0;
    let apiErrorDates = 0;
    let invalidPayloadDates = 0;
    let totalRawRecords = 0;
    let totalVerifiedRecords = 0;
    let totalNewlyInserted = 0;
    let totalDuplicatesSkipped = 0;

    let consecutiveErrors = 0;
    let lastProcessedDate: string | null = resumedFromDate;
    let lastSafeCheckpointDate: string | null = resumedFromDate;

    let isAborted = false;
    let abortReason = '';

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];

      if (config.onProgress) {
        config.onProgress({
          currentDate: date,
          currentIndex: i + 1,
          totalDates: dates.length,
          classification: 'TRADING',
          inserted: totalNewlyInserted,
          duplicatesSkipped: totalDuplicatesSkipped,
          consecutiveErrors,
          message: `Inspecting ${date} (${i + 1}/${dates.length})...`,
        });
      }

      // Safe pacing delay
      if (i > 0 && requestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
      }

      let rawPayload: RawThaiStockResultDateGroup[] | null = null;
      let fetchError: Error | null = null;

      try {
        rawPayload = await fetch2DResultByDate(date);
      } catch (err: any) {
        fetchError = err instanceof Error ? err : new Error(String(err));
      }

      // CLASSIFICATION 1: API_ERROR (Upstream PHP, network, HTTP 500, SafeMySQL, etc.)
      if (fetchError !== null || rawPayload === null) {
        const errorMsg = fetchError?.message || 'Unknown fetch error';
        const isPhpDiag = /SafeMySQL|Fatal error|Uncaught Exception|Warning:|Notice:|number_format/i.test(errorMsg);

        consecutiveErrors++;
        apiErrorDates++;
        unresolvedErrorDates.push(date);

        await logAudit(
          'BACKFILL_API_ERROR',
          'WARNING',
          `API_ERROR on ${date}: ${errorMsg} (Unresolvable gap recorded in audit trail)`,
          date,
          0,
          { error: errorMsg, isPhpDiagnostic: isPhpDiag, consecutiveErrors, isPermanentGap: true }
        );

        dateBreakdown.push({
          date,
          classification: 'API_ERROR',
          rawCount: 0,
          verifiedCount: 0,
          rejectedCount: 0,
          inserted: 0,
          duplicatesSkipped: 0,
          errorMessage: errorMsg,
          isPhpDiagnostic: isPhpDiag,
          records: [],
        });

        // Outage protection: halt if consecutive errors exceed safety limit
        if (consecutiveErrors >= maxConsecutiveErrors) {
          isAborted = true;
          lastProcessedDate = lastSafeCheckpointDate;
          abortReason = `Backfill paused after ${consecutiveErrors} consecutive errors ending at ${date}: ${errorMsg}. Checkpoint preserved at ${lastSafeCheckpointDate || 'range inception'} for safe resumption.`;
          await logAudit(
            'SYNC_FAILED',
            'WARNING',
            abortReason,
            date
          );
          break;
        }

        // Isolated API error: record unresolvable gap in audit logs and advance historical frontier
        lastProcessedDate = date;
        await this.storage.saveHistoricalCheckpoint({
          lastBackfillStartDate: requestedStart,
          lastBackfillEndDate: requestedEnd,
          lastProcessedDate: date,
          lastProcessedTime: lastProcessedTime,
          lastProcessedHistoryId: lastProcessedHistoryId,
          lastSyncStatus: 'RUNNING',
          lastSyncMessage: `Processed date ${date} (Recorded as unresolvable API_ERROR gap: ${errorMsg})`,
        });

        continue;
      }

      // Reset consecutive error counter upon successful response
      consecutiveErrors = 0;
      lastSafeCheckpointDate = date;

      // CLASSIFICATION 2: NON_TRADING (confirmed empty array [] or empty child)
      const rawCount = Array.isArray(rawPayload)
        ? rawPayload.reduce((acc, g) => acc + (Array.isArray(g?.child) ? g.child.length : 0), 0)
        : 0;

      if (rawCount === 0) {
        nonTradingDates++;
        lastProcessedDate = date;

        await logAudit(
          'BACKFILL_NON_TRADING',
          'INFO',
          `Confirmed NON_TRADING for ${date} (0 records returned)`,
          date,
          0
        );

        // Update historical checkpoint to record progress through this non-trading day
        await this.storage.saveHistoricalCheckpoint({
          lastBackfillStartDate: requestedStart,
          lastBackfillEndDate: requestedEnd,
          lastProcessedDate: date,
          lastProcessedTime: lastProcessedTime,
          lastProcessedHistoryId: lastProcessedHistoryId,
          lastSyncStatus: 'RUNNING',
          lastSyncMessage: `Processed non-trading date ${date}`,
        });

        dateBreakdown.push({
          date,
          classification: 'NON_TRADING',
          rawCount: 0,
          verifiedCount: 0,
          rejectedCount: 0,
          inserted: 0,
          duplicatesSkipped: 0,
          records: [],
        });

        continue;
      }

      // CLASSIFICATION 3: Parse and Verify DATA_AVAILABLE records
      await this.storage.saveRawFeed(date, `https://api.thaistock2d.com/2d_result?date=${date}`, rawPayload, rawCount);

      await logAudit(
        'BACKFILL_DATE_FETCHED',
        'SUCCESS',
        `Fetched ${rawCount} raw records for ${date}`,
        date,
        rawCount
      );

      const parseResult = parseAndVerify2DResult(rawPayload, date);
      totalRawRecords += parseResult.rawCount;

      // If all child records were malformed or rejected test data -> INVALID_PAYLOAD
      if (parseResult.verifiedCount === 0 && parseResult.rejectedCount > 0) {
        invalidPayloadDates++;
        unresolvedErrorDates.push(date);

        await logAudit(
          'BACKFILL_INVALID',
          'WARNING',
          `Date ${date} rejected all ${parseResult.rejectedCount} records as INVALID_PAYLOAD (Unresolvable gap recorded in audit trail)`,
          date,
          0,
          {
            classification: 'INVALID_PAYLOAD',
            rejectedCount: parseResult.rejectedCount,
            rejectedRecords: parseResult.rejectedRecords,
            isPermanentGap: true,
          }
        );

        dateBreakdown.push({
          date,
          classification: 'INVALID_PAYLOAD',
          rawCount: parseResult.rawCount,
          verifiedCount: 0,
          rejectedCount: parseResult.rejectedCount,
          inserted: 0,
          duplicatesSkipped: 0,
          errorMessage: 'All child records failed mathematical validation or format criteria',
          records: [],
        });

        // Advance historical frontier past the unresolvable gap without inserting any fake data
        lastProcessedDate = date;

        await this.storage.saveHistoricalCheckpoint({
          lastBackfillStartDate: requestedStart,
          lastBackfillEndDate: requestedEnd,
          lastProcessedDate: date,
          lastProcessedTime: lastProcessedTime,
          lastProcessedHistoryId: lastProcessedHistoryId,
          lastSyncStatus: 'RUNNING',
          lastSyncMessage: `Processed date ${date} (Recorded as unresolvable INVALID_PAYLOAD gap; 0 inserted)`,
        });

        continue;
      }

      // CLASSIFICATION 4: DATA_AVAILABLE (Verified market records)
      dataAvailableDates++;
      totalVerifiedRecords += parseResult.verifiedCount;

      // Store in verified records store (Idempotent: skips duplicates via composite key)
      const insertStats = await this.storage.storeVerifiedRecords(parseResult.verifiedRecords);
      totalNewlyInserted += insertStats.inserted;
      totalDuplicatesSkipped += insertStats.duplicatesSkipped;

      if (insertStats.inserted > 0) {
        await logAudit(
          'BACKFILL_INSERTED',
          'SUCCESS',
          `Inserted ${insertStats.inserted} verified records for ${date}`,
          date,
          insertStats.inserted
        );
      }

      if (insertStats.duplicatesSkipped > 0) {
        await logAudit(
          'BACKFILL_DUPLICATED',
          'INFO',
          `Skipped ${insertStats.duplicatesSkipped} duplicate records for ${date}`,
          date,
          insertStats.duplicatesSkipped
        );
      }

      // Update chronological trackers
      const sorted = [...parseResult.verifiedRecords].sort((a, b) => a.time.localeCompare(b.time));
      const latestInDay = sorted[sorted.length - 1];

      lastProcessedDate = date;
      lastProcessedTime = latestInDay.time;
      lastProcessedHistoryId = latestInDay.historyId;

      // Persist checkpoint progress (STRICTLY HISTORICAL CHECKPOINT ONLY)
      await this.storage.saveHistoricalCheckpoint({
        lastBackfillStartDate: requestedStart,
        lastBackfillEndDate: requestedEnd,
        lastProcessedDate: date,
        lastProcessedTime: latestInDay.time,
        lastProcessedHistoryId: latestInDay.historyId,
        lastSyncStatus: 'RUNNING',
        lastSyncMessage: `Backfilled ${date} (${parseResult.verifiedCount} verified)`,
      });

      dateBreakdown.push({
        date,
        classification: 'DATA_AVAILABLE',
        rawCount: parseResult.rawCount,
        verifiedCount: parseResult.verifiedCount,
        rejectedCount: parseResult.rejectedCount,
        inserted: insertStats.inserted,
        duplicatesSkipped: insertStats.duplicatesSkipped,
        records: parseResult.verifiedRecords,
      });
    }

    const completedAt = new Date().toISOString();
    const recordedGaps = invalidPayloadDates + apiErrorDates;
    let finalStatus: SyncStatus = isAborted ? 'PARTIAL' : 'SUCCESS';
    let finalMessage = isAborted
      ? abortReason
      : dates.length < allDates.length
      ? `Bounded batch completed (${dates.length} of ${allDates.length} remaining dates): ${totalNewlyInserted} inserted, ${totalDuplicatesSkipped} duplicates skipped${recordedGaps > 0 ? `, ${recordedGaps} unresolvable gap(s) recorded in audit logs` : ''}. Checkpoint advanced to ${lastProcessedDate}.`
      : `Backfill completed: ${totalNewlyInserted} inserted, ${totalDuplicatesSkipped} duplicates skipped${recordedGaps > 0 ? `, ${recordedGaps} unresolvable gap(s) recorded in audit logs` : ''} across ${dates.length} dates.`;

    if (apiErrorDates > 0 && !isAborted) {
      finalMessage += ` (${apiErrorDates} dates encountered API errors and recorded as gaps)`;
    }

    // Save final historical checkpoint
    await this.storage.saveHistoricalCheckpoint({
      lastBackfillStartDate: requestedStart,
      lastBackfillEndDate: requestedEnd,
      lastProcessedDate,
      lastProcessedTime,
      lastProcessedHistoryId,
      lastSyncStatus: finalStatus,
      lastSyncMessage: finalMessage,
    });

    await logAudit(
      'BACKFILL_COMPLETE',
      finalStatus === 'SUCCESS' ? 'SUCCESS' : 'WARNING',
      finalMessage,
      lastProcessedDate || undefined,
      totalNewlyInserted,
      {
        totalDatesAttempted: dates.length,
        dataAvailableDates,
        nonTradingDates,
        apiErrorDates,
        invalidPayloadDates,
        unresolvedErrorDates,
        totalNewlyInserted,
        totalDuplicatesSkipped,
      }
    );

    return {
      backfillId,
      startDate: requestedStart,
      endDate: requestedEnd,
      resumedFromDate,
      totalDatesAttempted: dates.length,
      dataAvailableDates,
      nonTradingDates,
      apiErrorDates,
      invalidPayloadDates,
      unresolvedErrorDates,
      totalRawRecords,
      totalVerifiedRecords,
      totalNewlyInserted,
      totalDuplicatesSkipped,
      lastProcessedDate,
      lastProcessedTime,
      lastProcessedHistoryId,
      status: finalStatus,
      statusMessage: finalMessage,
      startedAt,
      completedAt,
      dateBreakdown,
    };
  }

  /**
   * Queries the owned dataset directly with explicit state semantics.
   * Never fabricates missing records or predictions.
   */
  public async queryOwnedDataset(date: string): Promise<{
    date: string;
    classification: 'DATA_AVAILABLE' | 'DATA_UNAVAILABLE';
    count: number;
    records: VerifiedMarketRecord[];
  }> {
    const trimmed = (date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return {
        date: trimmed,
        classification: 'DATA_UNAVAILABLE',
        count: 0,
        records: [],
      };
    }

    const records = await this.storage.queryVerifiedRecords({ date: trimmed });
    if (records.length > 0) {
      return {
        date: trimmed,
        classification: 'DATA_AVAILABLE',
        count: records.length,
        records,
      };
    }

    return {
      date: trimmed,
      classification: 'DATA_UNAVAILABLE',
      count: 0,
      records: [],
    };
  }

  private getNextDateString(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
  }

  private createEmptySummary(
    backfillId: string,
    startDate: string,
    endDate: string,
    resumedFromDate: string | null,
    startedAt: string,
    status: SyncStatus,
    statusMessage: string
  ): HistoricalBackfillSummary {
    return {
      backfillId,
      startDate,
      endDate,
      resumedFromDate,
      totalDatesAttempted: 0,
      dataAvailableDates: 0,
      nonTradingDates: 0,
      apiErrorDates: 0,
      invalidPayloadDates: 0,
      unresolvedErrorDates: [],
      totalRawRecords: 0,
      totalVerifiedRecords: 0,
      totalNewlyInserted: 0,
      totalDuplicatesSkipped: 0,
      lastProcessedDate: resumedFromDate,
      lastProcessedTime: null,
      lastProcessedHistoryId: null,
      status,
      statusMessage,
      startedAt,
      completedAt: new Date().toISOString(),
      dateBreakdown: [],
    };
  }
}
