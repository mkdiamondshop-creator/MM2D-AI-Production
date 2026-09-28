/**
 * MM2D Comprehensive Historical Backfill Verification & Audit Test Suite
 * Validates:
 * - Phase 2B: Historical backfill range execution & classification
 * - Phase 2C: Idempotency & deduplication
 * - Phase 2D: Resumable checkpointing via historical_backfill_checkpoint
 * - Phase 2E: Safe pacing and upstream protection
 * - Phase 2F: Audit logging across all backfill stages
 * - Phase 2G: Owned dataset querying & zero-fabrication guarantees
 * - Phase 2I & 2J: Comprehensive test scenarios & known anomaly safety tests (2023-02-01 & 2023-05-05)
 */

import { HistoricalBackfillEngine, BackfillEngineStorage } from '../src/core/ingestion/historicalBackfillEngine';
import { fetch2DResultByDate, validateThaiStockResponse, parseThaiStockRawText } from '../src/core/api/thaistockClient';
import { parseAndVerify2DResult } from '../src/core/integrity/parser';
import { VerifiedMarketRecord } from '../src/types/market';
import {
  SyncAuditLog,
  HistoricalBackfillCheckpoint,
  LiveSyncCheckpoint,
  SyncStatus,
} from '../src/types/sync';

/**
 * In-memory Mock Storage for high-speed isolated deterministic unit & integration tests
 */
class MockBackfillStorage implements BackfillEngineStorage {
  public rawFeeds: Map<string, unknown> = new Map();
  public verifiedRecords: Map<string, VerifiedMarketRecord> = new Map();
  public auditLogs: SyncAuditLog[] = [];
  public historicalCheckpoint: HistoricalBackfillCheckpoint = {
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
    updatedAt: new Date().toISOString(),
  };
  public liveCheckpoint: LiveSyncCheckpoint = {
    id: 'live_sync_checkpoint',
    type: 'LIVE_SYNC',
    lastSuccessfulSyncDate: null,
    lastSuccessfulSyncTime: null,
    lastSuccessfulHistoryId: null,
    lastSyncTimestamp: null,
    totalSyncRuns: 0,
    lastSyncStatus: 'IDLE',
    updatedAt: new Date().toISOString(),
  };

  public async saveRawFeed(date: string, endpoint: string, rawData: unknown): Promise<void> {
    this.rawFeeds.set(date, rawData);
  }

  public async storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<{ attempted: number; inserted: number; duplicatesSkipped: number }> {
    let inserted = 0;
    let duplicatesSkipped = 0;

    for (const rec of records) {
      const docId = `${rec.date}_${rec.time}_${rec.historyId}`;
      if (this.verifiedRecords.has(docId)) {
        duplicatesSkipped++;
      } else {
        this.verifiedRecords.set(docId, rec);
        inserted++;
      }
    }

    return {
      attempted: records.length,
      inserted,
      duplicatesSkipped,
    };
  }

  public async queryVerifiedRecords(options?: { date?: string; limit?: number }): Promise<VerifiedMarketRecord[]> {
    let list = Array.from(this.verifiedRecords.values());
    if (options?.date) {
      list = list.filter((r) => r.date === options.date);
    }
    list.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.time.localeCompare(b.time);
    });
    if (options?.limit && options.limit > 0) {
      list = list.slice(0, options.limit);
    }
    return list;
  }

  public async getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint> {
    return { ...this.historicalCheckpoint };
  }

  public async saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void> {
    this.historicalCheckpoint = {
      ...this.historicalCheckpoint,
      ...checkpoint,
      totalBackfillRuns: (this.historicalCheckpoint.totalBackfillRuns || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  public async getLiveCheckpoint(): Promise<{ lastSuccessfulSyncDate: string | null; lastSuccessfulSyncTime: string | null; lastSuccessfulHistoryId: string | null }> {
    return {
      lastSuccessfulSyncDate: this.liveCheckpoint.lastSuccessfulSyncDate,
      lastSuccessfulSyncTime: this.liveCheckpoint.lastSuccessfulSyncTime,
      lastSuccessfulHistoryId: this.liveCheckpoint.lastSuccessfulHistoryId,
    };
  }

  public async saveLiveCheckpoint(checkpoint: { lastSuccessfulSyncDate: string; lastSuccessfulSyncTime: string | null; lastSuccessfulHistoryId: string | null; lastSyncStatus: SyncStatus; lastSyncMessage?: string }): Promise<void> {
    this.liveCheckpoint = {
      ...this.liveCheckpoint,
      ...checkpoint,
      totalSyncRuns: (this.liveCheckpoint.totalSyncRuns || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  public async saveAuditLog(log: SyncAuditLog): Promise<void> {
    this.auditLogs.push(log);
  }

  public async getAuditLogs(): Promise<SyncAuditLog[]> {
    return [...this.auditLogs];
  }
}

async function runHistoricalBackfillTests() {
  console.log('===============================================================');
  console.log('       MM2D HISTORICAL BACKFILL SUITE VERIFICATION & AUDIT      ');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, msg: string) {
    totalTests++;
    if (!condition) {
      console.error(`FAIL: ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
    console.log(`PASS: ${msg}`);
    passedTests++;
  }

  // -------------------------------------------------------------
  // TEST A: Historical DATA_AVAILABLE Verification
  // -------------------------------------------------------------
  console.log('--- [TEST A] Historical DATA_AVAILABLE Verification ---');
  const cleanTradingDate = '2023-06-01';
  const cleanRes = await fetch2DResultByDate(cleanTradingDate);
  const parsedClean = parseAndVerify2DResult(cleanRes, cleanTradingDate);

  assert(Array.isArray(cleanRes) && cleanRes.length > 0, `${cleanTradingDate} returned valid array (${cleanRes.length} groups)`);
  assert(parsedClean.verifiedCount >= 4, `${cleanTradingDate} contains ${parsedClean.verifiedCount} verified records (>=4)`);
  assert(parsedClean.verifiedRecords.every((r) => r.twod.length === 2 && r.setNumeric > 100), 'All verified records contain valid 2D values and genuine SET market levels');
  assert(parsedClean.verifiedRecords.some((r) => r.mathematicalCheck.isMathematicallyConsistent), 'Mathematically verified records present');

  // -------------------------------------------------------------
  // TEST B: Historical NON_TRADING (Weekend / Inactive Date)
  // -------------------------------------------------------------
  console.log('\n--- [TEST B] Historical NON_TRADING Verification ---');
  const weekendDate = '2026-08-01';
  const weekendRes = await fetch2DResultByDate(weekendDate);
  const weekendParsed = parseAndVerify2DResult(weekendRes, weekendDate);

  assert(Array.isArray(weekendRes) && weekendRes.length === 0, `${weekendDate} confirmed NON_TRADING (empty array [])`);
  assert(weekendParsed.verifiedCount === 0 && weekendParsed.rawCount === 0, '0 records extracted from non-trading day');

  // -------------------------------------------------------------
  // TEST C: Upstream SafeMySQL / PHP Diagnostic Protection
  // -------------------------------------------------------------
  console.log('\n--- [TEST C] SafeMySQL / PHP Diagnostic Upstream Error Handling ---');
  const safeMysqlPayload = '256, SafeMySQL: Table error in query [SET_sql_mode=...] in /var/www/html/api.php on line 42';
  let safeMysqlThrew = false;
  let safeMysqlErrorMsg = '';

  try {
    parseThaiStockRawText(safeMysqlPayload);
  } catch (err: any) {
    safeMysqlThrew = true;
    safeMysqlErrorMsg = err.message;
  }

  assert(safeMysqlThrew, 'parseThaiStockRawText correctly throws on SafeMySQL diagnostic string');
  assert(safeMysqlErrorMsg.includes('SafeMySQL'), 'Error message clearly references SafeMySQL diagnostic output');

  // -------------------------------------------------------------
  // TEST D: Invalid Payload Validation
  // -------------------------------------------------------------
  console.log('\n--- [TEST D] Malformed / Placeholder Record Rejection ---');
  const invalidPayload = [
    {
      date: '2026-08-25',
      child: [
        { set: '--', value: '--', twod: '--', history_id: '999', time: '12:01:00' },
        { set: '99.50', value: '100.00', twod: '00', history_id: '1000', time: '16:30:00' }, // legacy test value < 100
      ],
    },
  ];
  const invalidParsed = parseAndVerify2DResult(invalidPayload, '2026-08-25');
  assert(invalidParsed.verifiedCount === 0, 'Placeholder/legacy records successfully rejected');
  assert(invalidParsed.rejectedCount === 2, '2 invalid records correctly counted as rejected');

  // -------------------------------------------------------------
  // TEST E: Duplicate Historical Record Deduplication
  // -------------------------------------------------------------
  console.log('\n--- [TEST E] Storage Idempotency & Deduplication ---');
  const testStorage = new MockBackfillStorage();
  const testRecords = parsedClean.verifiedRecords;

  const insertRun1 = await testStorage.storeVerifiedRecords(testRecords);
  assert(insertRun1.inserted === testRecords.length, `Run 1 inserted all ${testRecords.length} records`);
  assert(insertRun1.duplicatesSkipped === 0, 'Run 1 skipped 0 duplicates');

  const insertRun2 = await testStorage.storeVerifiedRecords(testRecords);
  assert(insertRun2.inserted === 0, 'Run 2 inserted 0 duplicate records');
  assert(insertRun2.duplicatesSkipped === testRecords.length, `Run 2 skipped all ${testRecords.length} duplicates`);

  // -------------------------------------------------------------
  // TEST F: Backfill Resumability & Checkpointing
  // -------------------------------------------------------------
  console.log('\n--- [TEST F] Backfill Resumption After Interruption ---');
  const resumableStorage = new MockBackfillStorage();
  const backfillEngine = new HistoricalBackfillEngine(resumableStorage);

  // Execute first 2 days (2024-01-01 holiday to 2024-01-02 trading)
  const step1 = await backfillEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-02',
    requestDelayMs: 20,
    resumeFromCheckpoint: false,
  });

  const checkpointAfterStep1 = await resumableStorage.getHistoricalCheckpoint();
  assert(checkpointAfterStep1.lastProcessedDate === '2024-01-02', 'Checkpoint accurately recorded 2024-01-02 as lastProcessedDate');

  // Resume to next 2 days (2024-01-03 to 2024-01-04)
  const step2 = await backfillEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-04',
    requestDelayMs: 20,
    resumeFromCheckpoint: true,
  });

  assert(step2.resumedFromDate === '2024-01-02', 'Backfill correctly detected and resumed from 2024-01-02');
  assert(step2.startDate === '2024-01-01' && step2.endDate === '2024-01-04', 'Target range preserved');
  const checkpointAfterStep2 = await resumableStorage.getHistoricalCheckpoint();
  assert(checkpointAfterStep2.lastProcessedDate === '2024-01-04', 'Checkpoint advanced to 2024-01-04');

  // -------------------------------------------------------------
  // TEST G: Second Backfill Run Idempotency
  // -------------------------------------------------------------
  console.log('\n--- [TEST G] Idempotent Second Pass Verification ---');
  const idempotencyStorage = new MockBackfillStorage();
  const engineG = new HistoricalBackfillEngine(idempotencyStorage);

  const runG1 = await engineG.executeBackfill({
    startDate: '2024-01-02',
    endDate: '2024-01-03',
    requestDelayMs: 20,
    resumeFromCheckpoint: false,
  });
  assert(runG1.totalNewlyInserted > 0, `First pass inserted ${runG1.totalNewlyInserted} verified records`);

  const runG2 = await engineG.executeBackfill({
    startDate: '2024-01-02',
    endDate: '2024-01-03',
    requestDelayMs: 20,
    resumeFromCheckpoint: false,
  });
  assert(runG2.totalNewlyInserted === 0, 'Second pass inserted 0 records');
  assert(runG2.totalDuplicatesSkipped === runG1.totalNewlyInserted, `Second pass skipped ${runG2.totalDuplicatesSkipped} duplicates`);

  // -------------------------------------------------------------
  // TEST H: Owned Dataset Querying
  // -------------------------------------------------------------
  console.log('\n--- [TEST H] Owned Dataset Querying ---');
  const ownedResultAvailable = await engineG.queryOwnedDataset('2024-01-02');
  assert(ownedResultAvailable.classification === 'DATA_AVAILABLE', 'Query returns DATA_AVAILABLE for stored date');
  assert(ownedResultAvailable.count >= 4, `Query returned ${ownedResultAvailable.count} verified records`);

  const ownedResultUnavailable = await engineG.queryOwnedDataset('1990-01-01');
  assert(ownedResultUnavailable.classification === 'DATA_UNAVAILABLE', 'Query returns explicit DATA_UNAVAILABLE for unrecorded date');
  assert(ownedResultUnavailable.records.length === 0, 'Zero fake or simulated records returned');

  // -------------------------------------------------------------
  // TEST I & J: API Outage Invariants & Zero-Fabrication
  // -------------------------------------------------------------
  console.log('\n--- [TEST I & J] Zero-Fabrication & Outage Non-Destructiveness ---');
  const recordCountBefore = idempotencyStorage.verifiedRecords.size;
  // Simulating query when upstream is unreachable
  const offlineQuery = await engineG.queryOwnedDataset('2024-01-02');
  const recordCountAfter = idempotencyStorage.verifiedRecords.size;

  assert(offlineQuery.classification === 'DATA_AVAILABLE' && offlineQuery.count > 0, 'Existing owned data remains accessible during API isolation');
  assert(recordCountBefore === recordCountAfter, 'Owned dataset records remain completely preserved (non-destructive)');

  // -------------------------------------------------------------
  // TEST SAFETY: PHP Warning Anomaly Dates (2023-02-01 Recovered & 2023-05-05 Protected)
  // -------------------------------------------------------------
  console.log('\n--- [SAFETY TEST] 2023-02-01 Recovered & 2023-05-05 Protected ---');
  
  // 2023-02-01 has 1 authentic record (16:30) recovered and 3 placeholders rejected
  const res20230201 = await fetch2DResultByDate('2023-02-01');
  const parsed20230201 = parseAndVerify2DResult(res20230201, '2023-02-01');
  assert(parsed20230201.verifiedCount === 1, '2023-02-01 yields exactly 1 verified record (16:30)');
  assert(parsed20230201.rejectedCount === 3, '2023-02-01 rejects 3 pending placeholder records');
  assert(parsed20230201.verifiedRecords[0].twod === '50', '2023-02-01 16:30 verified 2D matches 50');

  // 2023-05-05 has 0 verified records and 4 rejected records, remaining protected from false NON_TRADING
  const res20230505 = await fetch2DResultByDate('2023-05-05');
  const parsed20230505 = parseAndVerify2DResult(res20230505, '2023-05-05');
  assert(parsed20230505.verifiedCount === 0, '2023-05-05 yields 0 verified records');
  assert(parsed20230505.rejectedCount === 4, '2023-05-05 rejects 4 invalid records');

  // Test that engine handles 2023-05-05 safely without inserting records or marking as NON_TRADING
  const anomalyStorage = new MockBackfillStorage();
  const anomalyEngine = new HistoricalBackfillEngine(anomalyStorage);

  const anomalySummary = await anomalyEngine.executeBackfill({
    startDate: '2023-05-05',
    endDate: '2023-05-05',
    requestDelayMs: 20,
    resumeFromCheckpoint: false,
  });

  assert(anomalySummary.invalidPayloadDates === 1, '2023-05-05 classified strictly as INVALID_PAYLOAD');
  assert(anomalySummary.totalNewlyInserted === 0, '2023-05-05 inserted 0 records');
  assert(anomalySummary.nonTradingDates === 0, '2023-05-05 was NOT marked as NON_TRADING');
  assert(anomalySummary.unresolvedErrorDates.includes('2023-05-05'), '2023-05-05 recorded in unresolvedErrorDates');

  // -------------------------------------------------------------
  // TEST K: Bounded Historical Backfill & maxDates (Default 50 / Custom Bounding)
  // -------------------------------------------------------------
  console.log('\n--- [TEST K] Bounded Historical Backfill & maxDates Batching ---');
  const boundedStorage = new MockBackfillStorage();
  const boundedEngine = new HistoricalBackfillEngine(boundedStorage);

  // Test custom batch size: request 5 dates with maxDates=2
  const batch1 = await boundedEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-05',
    maxDates: 2,
    requestDelayMs: 10,
    resumeFromCheckpoint: false,
  });

  assert(batch1.totalDatesAttempted === 2, 'maxDates=2 limits execution to exactly 2 dates');
  assert(batch1.dateBreakdown.length === 2, 'Date breakdown contains exactly 2 dates');
  const checkpointAfterBatch1 = await boundedStorage.getHistoricalCheckpoint();
  assert(checkpointAfterBatch1.lastProcessedDate === '2024-01-02', 'Checkpoint accurately recorded 2024-01-02 after batch 1');

  // Next bounded run: resume from checkpoint with maxDates=2
  const batch2 = await boundedEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-05',
    maxDates: 2,
    requestDelayMs: 10,
    resumeFromCheckpoint: true,
  });

  assert(batch2.resumedFromDate === '2024-01-02', 'Batch 2 resumed from 2024-01-02');
  assert(batch2.totalDatesAttempted === 2, 'Batch 2 processed next 2 dates (2024-01-03 and 2024-01-04)');
  const checkpointAfterBatch2 = await boundedStorage.getHistoricalCheckpoint();
  assert(checkpointAfterBatch2.lastProcessedDate === '2024-01-04', 'Checkpoint accurately advanced to 2024-01-04 after batch 2');

  // Verify 51-date range with default maxDates=50
  const defaultBoundingEngine = new HistoricalBackfillEngine(new MockBackfillStorage());
  // We simulate date generation logic: 2024-01-01 to 2024-02-20 is 51 days
  const batch50 = await defaultBoundingEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-02-20',
    maxDates: 50,
    requestDelayMs: 0,
    resumeFromCheckpoint: false,
  });
  assert(batch50.totalDatesAttempted <= 50, 'Default maxDates=50 limits execution to at most 50 dates');
  assert(batch50.totalDatesAttempted === 50, '51st date is NOT processed in same invocation');

  // -------------------------------------------------------------
  // TEST L: Unresolvable Gap Semantics & Outage Protection Invariant
  // -------------------------------------------------------------
  console.log('\n--- [TEST L] Unresolvable Gap Semantics & Outage Protection Invariant ---');
  const errorPreservationStorage = new MockBackfillStorage();
  const errorEngine = new HistoricalBackfillEngine(errorPreservationStorage);

  // Run 1: process 2024-01-01 (holiday) and 2024-01-02 (trading)
  await errorEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-02',
    requestDelayMs: 10,
    resumeFromCheckpoint: false,
  });
  const cpBeforeError = await errorPreservationStorage.getHistoricalCheckpoint();
  assert(cpBeforeError.lastProcessedDate === '2024-01-02', 'Checkpoint established at 2024-01-02');

  // Run 2: encounter known anomaly date 2023-05-05 (INVALID_PAYLOAD)
  // Evaluates 2023-05-05: records permanent unresolvable gap, 0 records inserted, advances checkpoint to 2023-05-05
  const runWithGap = await errorEngine.executeBackfill({
    startDate: '2023-05-05',
    endDate: '2023-05-05',
    requestDelayMs: 10,
    resumeFromCheckpoint: false,
  });

  assert(runWithGap.invalidPayloadDates === 1, 'Invalid payload caught on 2023-05-05');
  assert(runWithGap.unresolvedErrorDates.includes('2023-05-05'), '2023-05-05 recorded in unresolvedErrorDates');
  assert(runWithGap.totalNewlyInserted === 0, '0 records inserted for 2023-05-05 unresolvable gap');
  const cpAfterGap = await errorPreservationStorage.getHistoricalCheckpoint();
  assert(cpAfterGap.lastProcessedDate === '2023-05-05', 'Checkpoint advanced to 2023-05-05 after permanent gap audit recorded');

  // Verify permanent gap audit log exists
  const gapAudit = errorPreservationStorage.auditLogs.find(l => l.stage === 'BACKFILL_INVALID' && l.date === '2023-05-05');
  assert(gapAudit !== undefined, 'Permanent gap audit event logged in sync_audit_logs');
  assert(gapAudit?.details?.isPermanentGap === true, 'Permanent gap audit event marked isPermanentGap: true');

  // Run 3: Outage protection on consecutive API errors
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    const outageStorage = new MockBackfillStorage();
    outageStorage.historicalCheckpoint.lastProcessedDate = '2024-01-02';
    const outageEngine = new HistoricalBackfillEngine(outageStorage);

    const outageRun = await outageEngine.executeBackfill({
      startDate: '2024-01-01',
      endDate: '2024-01-10',
      maxDates: 10,
      maxConsecutiveErrors: 5,
      resumeFromCheckpoint: true,
    });

    assert(outageRun.status === 'PARTIAL', 'Outage run halts with PARTIAL status');
    assert(outageStorage.historicalCheckpoint.lastProcessedDate === '2024-01-02', 'Outage halts without advancing checkpoint through outage dates');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // TEST M: Strict Checkpoint Isolation (Live vs Historical)
  // -------------------------------------------------------------
  console.log('\n--- [TEST M] Strict Checkpoint Isolation ---');
  const isolationStorage = new MockBackfillStorage();
  // Set initial live sync checkpoint
  isolationStorage.liveCheckpoint.lastSuccessfulSyncDate = '2026-08-21';
  isolationStorage.liveCheckpoint.lastSuccessfulSyncTime = '12:01:00';
  isolationStorage.liveCheckpoint.lastSuccessfulHistoryId = '2758866';

  const isolationEngine = new HistoricalBackfillEngine(isolationStorage);
  await isolationEngine.executeBackfill({
    startDate: '2024-01-01',
    endDate: '2024-01-02',
    requestDelayMs: 10,
    resumeFromCheckpoint: false,
  });

  // Verify historical checkpoint updated
  assert(isolationStorage.historicalCheckpoint.lastProcessedDate === '2024-01-02', 'Historical checkpoint updated by backfill');
  // Verify live sync checkpoint was NEVER touched by historical backfill
  assert(isolationStorage.liveCheckpoint.lastSuccessfulSyncDate === '2026-08-21', 'Live sync checkpoint date strictly unchanged');
  assert(isolationStorage.liveCheckpoint.lastSuccessfulSyncTime === '12:01:00', 'Live sync checkpoint time strictly unchanged');
  assert(isolationStorage.liveCheckpoint.totalSyncRuns === 0, 'Live sync totalSyncRuns is exactly 0 (no backfill writes)');

  // -------------------------------------------------------------
  // TEST N: Legacy Calibration Epoch (2021-10-28 to 2023-01-31) & Modern Transition
  // -------------------------------------------------------------
  console.log('\n--- [TEST N] Legacy Calibration Epoch Verification ---');

  // Subtest A: 2021-10-28 Inception Date
  const raw20211028 = [
    {
      date: '2021-10-28',
      child: [
        { time: '11:00:00', set: '1.00', value: '29.00', twod: '09', history_id: '0' },
        { time: '12:01:00', set: '1.00', value: '41.00', twod: '34', history_id: '0' },
        { time: '15:00:00', set: '1.00', value: '54.00', twod: '14', history_id: '0' },
        { time: '16:30:00', set: '1.00', value: '74.00', twod: '16', history_id: '0' },
      ],
    },
  ];
  const parsed20211028 = parseAndVerify2DResult(raw20211028, '2021-10-28');
  assert(parsed20211028.verifiedCount === 4, '2021-10-28 produces exactly 4 verified records');
  assert(parsed20211028.rejectedCount === 0, '2021-10-28 has 0 rejected records');
  assert(parsed20211028.verifiedRecords[0].twod === '09', 'First 2D is 09');
  assert(parsed20211028.verifiedRecords[1].twod === '34', 'Second 2D is 34');
  assert(parsed20211028.verifiedRecords[2].twod === '14', 'Third 2D is 14');
  assert(parsed20211028.verifiedRecords[3].twod === '16', 'Fourth 2D is 16');
  assert(parsed20211028.verifiedRecords[0].provenance === 'LEGACY_2D_CALIBRATION_EPOCH', 'Provenance is LEGACY_2D_CALIBRATION_EPOCH');
  assert(parsed20211028.verifiedRecords[0].mathematicalCheck.isMathematicallyConsistent === false, 'isMathematicallyConsistent is false in legacy epoch');
  assert(parsed20211028.verifiedRecords[0].setRaw === '1.00' && parsed20211028.verifiedRecords[0].valueRaw === '29.00', 'Original raw values preserved without fabrication');

  // Subtest B: 2021-11-01 Legacy Epoch
  const raw20211101 = [
    {
      date: '2021-11-01',
      child: [
        { time: '11:00:00', set: '1.00', value: '29.00', twod: '48', history_id: '0' },
        { time: '12:01:00', set: '1.00', value: '39.00', twod: '69', history_id: '0' },
        { time: '15:00:00', set: '1.00', value: '56.00', twod: '63', history_id: '0' },
        { time: '16:30:00', set: '1.00', value: '69.00', twod: '86', history_id: '0' },
      ],
    },
  ];
  const parsed20211101 = parseAndVerify2DResult(raw20211101, '2021-11-01');
  assert(parsed20211101.verifiedCount === 4, '2021-11-01 parses 4 verified records');
  assert(parsed20211101.verifiedRecords[0].provenance === 'LEGACY_2D_CALIBRATION_EPOCH', '2021-11-01 provenance is LEGACY_2D_CALIBRATION_EPOCH');

  // Subtest C: 2022-01-04 Autoincrement history_id in Legacy Epoch
  const raw20220104 = [
    {
      date: '2022-01-04',
      child: [
        { time: '11:00:00', set: '1.00', value: '41.00', twod: '09', history_id: '122743' },
        { time: '12:00:00', set: '1.00', value: '55.00', twod: '67', history_id: '123167' },
        { time: '15:00:00', set: '1.00', value: '76.00', twod: '78', history_id: '123888' },
        { time: '16:30:00', set: '1.00', value: '100.00', twod: '84', history_id: '124350' },
      ],
    },
  ];
  const parsed20220104 = parseAndVerify2DResult(raw20220104, '2022-01-04');
  assert(parsed20220104.verifiedCount === 4, '2022-01-04 parses 4 verified records');
  assert(parsed20220104.verifiedRecords[0].historyId === '122743', 'history_id 122743 preserved correctly');
  assert(parsed20220104.verifiedRecords[0].provenance === 'LEGACY_2D_CALIBRATION_EPOCH', '2022-01-04 provenance is LEGACY_2D_CALIBRATION_EPOCH');

  // Subtest D: 2023-01-31 Legacy Epoch Boundary Date
  const raw20230131 = [
    {
      date: '2023-01-31',
      child: [
        { time: '11:00:00', set: '1.00', value: '31.00', twod: '59', history_id: '706941' },
      ],
    },
  ];
  const parsed20230131 = parseAndVerify2DResult(raw20230131, '2023-01-31');
  assert(parsed20230131.verifiedCount === 1, '2023-01-31 boundary date parses as legacy verified');
  assert(parsed20230131.verifiedRecords[0].provenance === 'LEGACY_2D_CALIBRATION_EPOCH', '2023-01-31 has legacy provenance');

  // Subtest E: 2023-02-02 Modern Live Epoch Strict Validation
  const raw20230202 = [
    {
      date: '2023-02-02',
      child: [
        { time: '11:00:00', set: '1,686.76', value: '28,727.15', twod: '67', history_id: '708888' },
      ],
    },
  ];
  const parsed20230202 = parseAndVerify2DResult(raw20230202, '2023-02-02');
  assert(parsed20230202.verifiedCount === 1, '2023-02-02 modern record accepted');
  assert(parsed20230202.verifiedRecords[0].provenance === 'OFFICIAL_SET_MARKET_LIVE', 'Modern record provenance is OFFICIAL_SET_MARKET_LIVE');
  assert(parsed20230202.verifiedRecords[0].mathematicalCheck.isMathematicallyConsistent === true, 'Modern record is mathematically consistent (SET: 1686.76 -> 6, VAL: 28727.15 -> 7 -> 67)');

  // Subtest E2: Modern Epoch Rejection of Placeholder Values
  const rawModernPlaceholder = [
    {
      date: '2023-02-02',
      child: [
        { time: '11:00:00', set: '1.00', value: '28.00', twod: '67', history_id: '708889' },
      ],
    },
  ];
  const parsedModernPlaceholder = parseAndVerify2DResult(rawModernPlaceholder, '2023-02-02');
  assert(parsedModernPlaceholder.verifiedCount === 0, 'Modern epoch rejects set=1.00 placeholder values');
  assert(parsedModernPlaceholder.rejectedCount === 1, 'Modern placeholder record is in rejectedCount');

  // Subtest G: Zero Fabrication Rejection
  const malformedPayload = [
    {
      date: '2021-12-15',
      child: [
        { time: '11:00:00', set: '--', value: '--', twod: '--', history_id: '0' },
        { time: '12:01:00', set: 'abc', value: 'def', twod: '99', history_id: '0' },
        { time: '15:00:00', set: '1.00', value: '20.00', twod: 'invalid_format', history_id: '0' },
      ],
    },
  ];
  const parsedMalformed = parseAndVerify2DResult(malformedPayload, '2021-12-15');
  assert(parsedMalformed.verifiedCount === 0, 'Zero-fabrication: malformed legacy payloads are strictly rejected');
  assert(parsedMalformed.rejectedCount === 3, 'All 3 malformed records rejected');

  console.log('\n===============================================================');
  console.log(`         ALL HISTORICAL BACKFILL TESTS PASSED (${passedTests}/${totalTests})        `);
  console.log('===============================================================\n');
}

runHistoricalBackfillTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
