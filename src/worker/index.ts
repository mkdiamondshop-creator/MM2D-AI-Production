import { fetch2DResultByDate } from '../core/api/thaistockClient';
import { parseAndVerify2DResult } from '../core/integrity/parser';
import { D1StorageAdapter, D1Database } from '../core/storage/d1StorageAdapter';
import { SyncAuditLog, SyncAuditStage, DateClassification } from '../types/sync';
import { HistoricalBackfillEngine } from '../core/ingestion/historicalBackfillEngine';
import { ThaiStock2dSource } from '../core/market/thaistock2dSource';
import { LiveObservationBuffer } from '../core/market/liveObservationBuffer';
import { TimezoneContract } from '../core/market/timezoneUtils';
import { MarketSession } from '../types/market';
import {
  ServerSideV2Coordinator,
  CoordinatorSessionOptions,
  ServerSidePredictionResult,
} from '../core/prediction/serverSideV2Coordinator';

export interface Env {
  DB: D1Database;
  SYNC_SECRET?: string;
}

export interface ScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Standard CORS headers for worker responses
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Secret',
  'Content-Type': 'application/json',
};

/**
 * Helper to build JSON responses with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: CORS_HEADERS,
  });
}

/**
 * Formats current date in Asia/Bangkok (UTC+7) timezone
 */
export function getBangkokToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Core unattended synchronization cycle for a specific date
 */
export async function executeSyncCycle(env: Env, targetDate?: string): Promise<{
  date: string;
  classification: DateClassification;
  rawCount: number;
  verifiedCount: number;
  inserted: number;
  duplicatesSkipped: number;
  liveCheckpointUpdated: boolean;
}> {
  const date = targetDate || getBangkokToday();
  const d1 = new D1StorageAdapter(env.DB);
  const syncId = `d1_sync_${Date.now()}`;

  const createLog = (stage: SyncAuditStage, status: SyncAuditLog['status'], message: string, details?: Record<string, unknown>): SyncAuditLog => ({
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    syncId,
    stage,
    status,
    timestamp: new Date().toISOString(),
    date,
    message,
    details,
  });

  try {
    // Stage 1: SYNC_START
    await d1.saveAuditLog(createLog('SYNC_START', 'INFO', `Starting unattended D1 sync cycle for ${date}`));

    // Stage 2: Fetch RAW from ThaiStock2D API
    const rawGroups = await fetch2DResultByDate(date);
    
    // Count exact market records (child elements across all groups)
    const rawCount = Array.isArray(rawGroups)
      ? rawGroups.reduce((acc, g) => acc + (Array.isArray(g?.child) ? g.child.length : 0), 0)
      : 0;

    await d1.saveRawFeed(date, `https://api.thaistock2d.com/2d_result?date=${date}`, rawGroups, rawCount);

    await d1.saveAuditLog(createLog(
      'FETCHED',
      'SUCCESS',
      `Fetched ${rawCount} raw items for ${date}`,
      { rawGroupsCount: Array.isArray(rawGroups) ? rawGroups.length : 0, rawCount }
    ));

    // Stage 3: Parse and Mathematically Validate
    const ingestion = parseAndVerify2DResult(rawGroups, date);
    const verifiedRecords = ingestion.verifiedRecords;

    let classification: DateClassification = 'TRADING';
    if (verifiedRecords.length === 0) {
      classification = 'NON_TRADING';
    } else if (verifiedRecords.length < 4) {
      classification = 'PARTIAL_TRADING';
    } else {
      classification = 'TRADING';
    }

    await d1.saveAuditLog(createLog(
      'VALIDATED',
      classification === 'TRADING' ? 'SUCCESS' : classification === 'PARTIAL_TRADING' ? 'WARNING' : 'INFO',
      `Validated ${verifiedRecords.length} records. Classification: ${classification}`,
      { classification, verifiedCount: verifiedRecords.length, rejectedCount: ingestion.rejectedCount }
    ));

    // Stage 4: Idempotent Insertion into D1 (SQLite)
    const insertStats = await d1.storeVerifiedRecords(verifiedRecords);

    if (insertStats.inserted > 0) {
      await d1.saveAuditLog(createLog('INSERTED', 'SUCCESS', `Inserted ${insertStats.inserted} new verified records into D1`, { insertStats }));
    }
    if (insertStats.duplicatesSkipped > 0) {
      await d1.saveAuditLog(createLog('DUPLICATED', 'INFO', `Skipped ${insertStats.duplicatesSkipped} duplicate records in D1`, { insertStats }));
    }

    // Stage 5: Monotonic LIVE_SYNC_CHECKPOINT Update
    let liveCheckpointUpdated = false;
    if (verifiedRecords.length > 0) {
      const sorted = [...verifiedRecords].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
      const latest = sorted[0];

      const currentCheckpoint = await d1.getLiveCheckpoint();
      const isNewer = !currentCheckpoint.lastSuccessfulSyncDate ||
        latest.date > currentCheckpoint.lastSuccessfulSyncDate ||
        (latest.date === currentCheckpoint.lastSuccessfulSyncDate && latest.time > (currentCheckpoint.lastSuccessfulSyncTime || ''));

      if (isNewer) {
        await d1.saveLiveCheckpoint({
          lastSuccessfulSyncDate: latest.date,
          lastSuccessfulSyncTime: latest.time,
          lastSuccessfulHistoryId: latest.historyId,
          lastSyncStatus: 'SUCCESS',
          lastSyncMessage: `Auto-synced ${latest.date} ${latest.time} (${classification})`,
        });
        liveCheckpointUpdated = true;
      }
    }

    // Stage 6: SYNC_COMPLETE
    await d1.saveAuditLog(createLog('SYNC_COMPLETE', 'SUCCESS', `D1 sync complete for ${date}: ${insertStats.inserted} inserted, ${insertStats.duplicatesSkipped} skipped`));

    return {
      date,
      classification,
      rawCount,
      verifiedCount: verifiedRecords.length,
      inserted: insertStats.inserted,
      duplicatesSkipped: insertStats.duplicatesSkipped,
      liveCheckpointUpdated,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Guarantee FAILED sync audit without risking crash of the handler
    try {
      await d1.saveAuditLog(createLog('SYNC_FAILED', 'FAILED', `Sync failed for ${date}: ${errorMsg}`, {
        errorName: err instanceof Error ? err.name : 'Error',
        errorMessage: errorMsg,
      }));
    } catch (auditErr) {
      console.error('[MM2D Worker] Failed to write SYNC_FAILED audit log:', auditErr);
    }
    // Do NOT swallow the original error silently
    throw err;
  }
}

/**
 * Server-Side Live Collector Cycle
 * Invariants:
 * 1. Executes unattended in Cloudflare Worker (browser/tab may be completely closed).
 * 2. Collects official ThaiStock2D /live data during AM and PM market windows.
 * 3. Validates timestamp, SET and Value; rejects stale/future/invalid data.
 * 4. Stores ONLY date, time, session, SET, Value, timestamp in D1 live_observations.
 * 5. NEVER stores or uses live 2D.
 * 6. Strictly isolates AM and PM sessions.
 */
export async function executeLiveCollectionCycle(
  env: Env,
  options?: {
    targetDate?: string;
    targetTime?: string;
    overrideMarketGate?: boolean;
    customSource?: ThaiStock2dSource;
    simulatedClock?: Date | string;
  }
): Promise<{
  success: boolean;
  status: string;
  message?: string;
  inserted?: boolean;
  duplicate?: boolean;
  observation?: {
    date: string;
    time: string;
    session: MarketSession;
    set: number;
    value: number;
    timestamp: string;
  };
}> {
  const nowBkk = TimezoneContract.toBangkok(Date.now());
  const date = options?.targetDate || nowBkk.dateStr;
  const time = options?.targetTime || nowBkk.timeStr;
  const validationClock =
    options?.simulatedClock ||
    (options?.targetDate && options?.targetTime ? new Date(`${options.targetDate}T${options.targetTime}+07:00`) : new Date());

  // AM Window: 10:00:00 - 12:00:00 Bangkok (Market Open to Lock)
  // PM Window: 14:00:00 - 16:00:00 Bangkok (Market Open to Lock)
  const isAmWindow = time >= '10:00:00' && time <= '12:00:00';
  const isPmWindow = time >= '14:00:00' && time <= '16:00:00';

  if (!isAmWindow && !isPmWindow && !options?.overrideMarketGate) {
    return {
      success: false,
      status: 'OUTSIDE_MARKET_HOURS',
      message: `Bangkok time ${time} is outside AM (10:00-12:00) and PM (14:00-16:00) live collection windows`,
    };
  }

  const session: MarketSession = isAmWindow || time < '13:00:00' ? 'AM' : 'PM';
  const source = options?.customSource || new ThaiStock2dSource();

  const liveRes = await source.fetchLiveSnapshot(date);
  if (!liveRes.success || !liveRes.snapshot) {
    return {
      success: false,
      status: liveRes.status,
      message: liveRes.errorDetails || 'Failed to fetch live market snapshot from ThaiStock2D',
    };
  }

  // Strict Validation using LiveObservationBuffer:
  // - Rejects placeholders (-- or 0.00)
  // - Rejects non-numeric SET/Value
  // - Rejects timestamps ahead of clock (>60s)
  // - Rejects stale observations (>15m)
  // - Rejects observations outside market open & lock window
  // - NEVER uses or extracts live 2D
  const validator = new LiveObservationBuffer();
  const validation = validator.validateObservation(
    {
      date: liveRes.snapshot.date,
      time: liveRes.snapshot.time,
      set: liveRes.snapshot.setNumeric,
      value: liveRes.snapshot.valueNumeric,
      timestamp: liveRes.snapshot.timestamp,
      session,
      source: 'WORKER_LIVE_COLLECTOR',
    },
    validationClock
  );

  if (!validation.isValid || !validation.sanitizedObservation) {
    return {
      success: false,
      status: 'VALIDATION_REJECTED',
      message: validation.reason || 'Observation failed strict mathematical validation',
    };
  }

  const sanitized = validation.sanitizedObservation;
  const d1 = new D1StorageAdapter(env.DB);

  // Store ONLY date, time, session, SET, Value, timestamp. Zero 2D.
  const storeRes = await d1.storeLiveObservation({
    date: sanitized.date,
    time: sanitized.time,
    session: sanitized.session,
    set: sanitized.set,
    value: sanitized.value,
    timestamp: sanitized.timestamp,
  });

  return {
    success: true,
    status: storeRes.inserted ? 'INSERTED' : 'DUPLICATE',
    inserted: storeRes.inserted,
    duplicate: storeRes.duplicate,
    observation: {
      date: sanitized.date,
      time: sanitized.time,
      session: sanitized.session,
      set: sanitized.set,
      value: sanitized.value,
      timestamp: sanitized.timestamp,
    },
  };
}

/**
 * Unattended server-side V2 prediction coordinator cycle.
 * Coordinates early predictions, refining distributions as new observations arrive,
 * and immutable lock at 11:30 MMT (12:00 BKK) / 15:30 MMT (16:00 BKK).
 */
export async function executeServerSidePredictionCycle(
  env: Env,
  options?: CoordinatorSessionOptions
): Promise<{
  date: string;
  amResult?: ServerSidePredictionResult;
  pmResult?: ServerSidePredictionResult;
}> {
  const d1 = new D1StorageAdapter(env.DB);
  return ServerSideV2Coordinator.coordinateActiveCycle(d1, options);
}

export default {
  /**
   * Cloudflare Worker Scheduled (Cron) Entry Point
   * Triggered unattended 24/7 without browser tabs.
   * Runs live collection every minute during market windows, runs prediction updates & lock, and regular sync.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[MM2D Worker Cron] Triggered at ${new Date().toISOString()} (Cron: ${event.cron})`);
    ctx.waitUntil(
      (async () => {
        // 1. Unattended server-side live observation collection
        try {
          await executeLiveCollectionCycle(env);
        } catch (liveErr) {
          console.error('[MM2D Worker Cron] Live collection cycle notice:', liveErr);
        }

        // 2. Unattended server-side V2 prediction and lock cycle
        try {
          await executeServerSidePredictionCycle(env);
        } catch (predErr) {
          console.error('[MM2D Worker Cron] Server-side prediction cycle notice:', predErr);
        }

        // 3. Official settlement result synchronization
        try {
          await executeSyncCycle(env);
        } catch (syncErr) {
          console.error('[MM2D Worker Cron] Error during scheduled sync:', syncErr);
        }
      })()
    );
  },

  /**
   * Cloudflare Worker Fetch (HTTP API) Entry Point
   * Provides minimal read-only dataset endpoints and manual testing trigger.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    try {
      const d1 = new D1StorageAdapter(env.DB);

      // GET / or /health -> Status
      if (pathname === '/' || pathname === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'MM2D Cloudflare D1 Unattended Worker',
          database: 'mm2d-production-db (Cloudflare D1 SQLite)',
          timestamp: new Date().toISOString(),
          bangkokDate: getBangkokToday(),
        });
      }

      // GET or POST /api/migrate -> Ensure all D1 tables and indexes exist
      if (pathname === '/api/migrate') {
        await d1.ensureSchema();
        return jsonResponse({
          success: true,
          message: 'D1 schema ensured successfully (live_observations, v2_predictions, and indexes active)',
        });
      }

      // GET /api/stats -> Dataset statistics
      if (pathname === '/api/stats') {
        const stats = await d1.getStats();
        return jsonResponse({ success: true, stats });
      }

      // GET /api/checkpoints -> Dual checkpoints
      if (pathname === '/api/checkpoints') {
        const checkpoints = await d1.getDualCheckpoints();
        return jsonResponse({ success: true, checkpoints });
      }

      // GET /api/records -> Query verified market records
      if (pathname === '/api/records') {
        const date = searchParams.get('date') || undefined;
        const session = (searchParams.get('session') as 'AM' | 'PM') || undefined;
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;

        const records = await d1.queryVerifiedRecords({ date, session, limit });
        return jsonResponse({
          success: true,
          count: records.length,
          filter: { date, session, limit },
          records,
        });
      }

      // GET /api/live-observations -> Query stored live observations (Zero Live 2D)
      if (pathname === '/api/live-observations') {
        const date = searchParams.get('date') || undefined;
        const session = (searchParams.get('session') as 'AM' | 'PM') || undefined;
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;

        const observations = await d1.queryLiveObservations({ date, session, limit });
        return jsonResponse({
          success: true,
          count: observations.length,
          filter: { date, session, limit },
          observations,
        });
      }

      // POST or GET /api/live/collect -> Server-side live observation collector trigger
      if (pathname === '/api/live/collect') {
        const targetDate = searchParams.get('date') || undefined;
        const targetTime = searchParams.get('time') || undefined;
        const overrideGate = searchParams.get('overrideGate') === 'true' || searchParams.get('force') === 'true';

        const result = await executeLiveCollectionCycle(env, {
          targetDate,
          targetTime,
          overrideMarketGate: overrideGate,
        });

        return jsonResponse(result, result.success ? 200 : 400);
      }

      // GET /api/predictions -> Query stored server-side V2 predictions & lock snapshots
      if (pathname === '/api/predictions') {
        const date = searchParams.get('date') || undefined;
        const session = (searchParams.get('session') as MarketSession) || undefined;
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : undefined;

        const predictions = await d1.queryV2Predictions({ date, session, limit });
        return jsonResponse({
          success: true,
          count: predictions.length,
          filter: { date, session, limit },
          predictions,
        });
      }

      // POST or GET /api/predict/cycle -> Server-side prediction coordinator execution trigger
      if (pathname === '/api/predict/cycle') {
        const targetDate = searchParams.get('date') || undefined;
        const session = (searchParams.get('session') as MarketSession) || undefined;
        const forceLock = searchParams.get('forceLock') === 'true';
        const overrideGate = searchParams.get('overrideGate') === 'true' || searchParams.get('force') === 'true';
        const clockParam = searchParams.get('clock') || undefined;

        const results = await executeServerSidePredictionCycle(env, {
          targetDate,
          session,
          forceLock,
          overrideMarketGate: overrideGate,
          simulatedClock: clockParam,
        });

        return jsonResponse({ success: true, ...results });
      }

      // GET /api/audit-logs -> Recent audit logs
      if (pathname === '/api/audit-logs') {
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 30;
        const logs = await d1.getAuditLogs(limit);
        return jsonResponse({ success: true, count: logs.length, logs });
      }

      // GET /api/owned-dataset -> Query owned historical records (explicit DATA_AVAILABLE / DATA_UNAVAILABLE)
      if (pathname === '/api/owned-dataset') {
        const date = searchParams.get('date');
        if (!date) {
          return jsonResponse({ success: false, error: 'Missing required query parameter: date (YYYY-MM-DD)' }, 400);
        }
        const engine = new HistoricalBackfillEngine(d1);
        const result = await engine.queryOwnedDataset(date);
        return jsonResponse({ success: true, ...result });
      }

      // POST or GET /api/sync/run -> Protected manual test execution trigger
      if (pathname === '/api/sync/run') {
        const providedSecret = request.headers.get('X-Sync-Secret') || request.headers.get('x-sync-secret');
        const configuredSecret = env.SYNC_SECRET;

        if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
          return jsonResponse(
            {
              success: false,
              error: 'Unauthorized: Missing or invalid X-Sync-Secret header',
            },
            401
          );
        }

        const targetDate = searchParams.get('date') || undefined;
        const result = await executeSyncCycle(env, targetDate);
        return jsonResponse({ success: true, result });
      }

      // POST or GET /api/backfill/run -> Protected historical backfill execution trigger
      if (pathname === '/api/backfill/run') {
        const providedSecret = request.headers.get('X-Sync-Secret') || request.headers.get('x-sync-secret');
        const configuredSecret = env.SYNC_SECRET;

        if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
          return jsonResponse(
            {
              success: false,
              error: 'Unauthorized: Missing or invalid X-Sync-Secret header',
            },
            401
          );
        }

        const startDate = searchParams.get('startDate') || undefined;
        const endDate = searchParams.get('endDate') || undefined;
        const maxDates = searchParams.get('maxDates')
          ? parseInt(searchParams.get('maxDates')!, 10)
          : searchParams.get('batchSize')
          ? parseInt(searchParams.get('batchSize')!, 10)
          : undefined;
        const requestDelayMs = searchParams.get('delayMs') ? parseInt(searchParams.get('delayMs')!, 10) : 50;
        const resume = searchParams.get('resume') !== 'false';

        const engine = new HistoricalBackfillEngine(d1);
        const summary = await engine.executeBackfill({
          startDate,
          endDate,
          maxDates,
          requestDelayMs,
          resumeFromCheckpoint: resume,
        });

        return jsonResponse({ success: true, summary });
      }

      return jsonResponse({ error: 'Endpoint not found', path: pathname }, 404);
    } catch (err) {
      console.error('[MM2D Worker Fetch] Error handling request:', err);
      return jsonResponse(
        {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        },
        500
      );
    }
  },
};
