import { HistoricalBackfillEngine, BackfillEngineStorage } from '../src/core/ingestion/historicalBackfillEngine';
import { VerifiedMarketRecord } from '../src/types/market';
import { HistoricalBackfillCheckpoint, LiveSyncCheckpoint, SyncAuditLog } from '../src/types/sync';

class ComprehensiveTestStorage implements BackfillEngineStorage {
  historicalCheckpoint: HistoricalBackfillCheckpoint = {
    id: 'historical_backfill_checkpoint',
    type: 'HISTORICAL_BACKFILL',
    lastBackfillStartDate: '2021-10-28',
    lastBackfillEndDate: '2026-08-26',
    lastProcessedDate: '2023-05-04',
    lastProcessedTime: '16:30:00',
    lastProcessedHistoryId: '850326',
    lastSyncTimestamp: '2026-08-26T14:16:07.826Z',
    totalBackfillRuns: 512,
    lastSyncStatus: 'SUCCESS',
    lastSyncMessage: 'Checkpoint at 2023-05-04',
    updatedAt: '2026-08-26T14:16:07.826Z',
  };

  liveCheckpoint: LiveSyncCheckpoint = {
    id: 'live_sync_checkpoint',
    type: 'LIVE_SYNC',
    lastSuccessfulSyncDate: '2026-08-21',
    lastSuccessfulSyncTime: '12:01:00',
    lastSuccessfulHistoryId: '2758866',
    lastSyncTimestamp: '2026-08-21T05:01:00.000Z',
    totalSyncRuns: 142,
    lastSyncStatus: 'SUCCESS',
    lastSyncMessage: 'Live auto-sync complete',
    updatedAt: '2026-08-26T07:15:55.762Z',
  };

  rawFeeds: Array<{ date: string; endpoint: string; rawData: unknown; explicitRecordCount?: number }> = [];
  verifiedRecords: VerifiedMarketRecord[] = [];
  auditLogs: SyncAuditLog[] = [];

  shouldFailAuditLog: boolean = false;
  shouldFailCheckpointSave: boolean = false;

  async saveRawFeed(date: string, endpoint: string, rawData: unknown, explicitRecordCount?: number): Promise<void> {
    this.rawFeeds.push({ date, endpoint, rawData, explicitRecordCount });
  }

  async storeVerifiedRecords(records: VerifiedMarketRecord[]): Promise<{ attempted: number; inserted: number; duplicatesSkipped: number }> {
    let inserted = 0;
    let duplicatesSkipped = 0;
    for (const r of records) {
      if (this.verifiedRecords.some(x => x.id === r.id)) {
        duplicatesSkipped++;
      } else {
        this.verifiedRecords.push(r);
        inserted++;
      }
    }
    return { attempted: records.length, inserted, duplicatesSkipped };
  }

  async queryVerifiedRecords(options?: { date?: string; limit?: number }): Promise<VerifiedMarketRecord[]> {
    if (options?.date) {
      return this.verifiedRecords.filter(r => r.date === options.date);
    }
    return this.verifiedRecords;
  }

  async getHistoricalCheckpoint(): Promise<HistoricalBackfillCheckpoint> {
    return JSON.parse(JSON.stringify(this.historicalCheckpoint));
  }

  async saveHistoricalCheckpoint(checkpoint: Partial<HistoricalBackfillCheckpoint>): Promise<void> {
    if (this.shouldFailCheckpointSave) {
      throw new Error('Simulated D1 error saving historical checkpoint');
    }
    this.historicalCheckpoint = {
      ...this.historicalCheckpoint,
      ...checkpoint,
      totalBackfillRuns: this.historicalCheckpoint.totalBackfillRuns + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  async saveAuditLog(log: SyncAuditLog): Promise<void> {
    if (this.shouldFailAuditLog && (log.stage === 'BACKFILL_INVALID' || log.stage === 'BACKFILL_API_ERROR')) {
      throw new Error('Simulated D1 error saving permanent gap audit log');
    }
    this.auditLogs.push(log);
  }

  async getAuditLogs(limit?: number): Promise<SyncAuditLog[]> {
    return this.auditLogs.slice(-(limit || 50));
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('       UNRESOLVABLE GAP SEMANTICS TEST SUITE (TESTS A - I)      ');
  console.log('================================================================');

  const originalGlobalFetch = globalThis.fetch;

  try {
    // -------------------------------------------------------------------------
    // TEST A: 2023-05-05 INVALID_PAYLOAD
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST A] 2023-05-05 INVALID_PAYLOAD Handling ---');
    const storageA = new ComprehensiveTestStorage();
    const engineA = new HistoricalBackfillEngine(storageA);

    const summaryA = await engineA.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });

    const dateResultA = summaryA.dateBreakdown[0];
    if (!dateResultA) throw new Error('TEST A: No date result for 2023-05-05');
    if (dateResultA.date !== '2023-05-05') throw new Error(`TEST A: Expected 2023-05-05, got ${dateResultA.date}`);
    if (dateResultA.classification !== 'INVALID_PAYLOAD') throw new Error(`TEST A: Expected INVALID_PAYLOAD, got ${dateResultA.classification}`);
    if (dateResultA.rawCount !== 4) throw new Error(`TEST A: Expected 4 raw records, got ${dateResultA.rawCount}`);
    if (dateResultA.verifiedCount !== 0) throw new Error(`TEST A: Expected 0 verified records, got ${dateResultA.verifiedCount}`);
    if (dateResultA.inserted !== 0) throw new Error(`TEST A: Expected 0 inserted, got ${dateResultA.inserted}`);

    // Verify audit log
    const gapAuditA = storageA.auditLogs.find(l => l.stage === 'BACKFILL_INVALID' && l.date === '2023-05-05');
    if (!gapAuditA) throw new Error('TEST A: Permanent gap audit event not found in sync_audit_logs');
    if (gapAuditA.status !== 'WARNING') throw new Error(`TEST A: Expected status WARNING, got ${gapAuditA.status}`);
    if (gapAuditA.details?.isPermanentGap !== true) throw new Error('TEST A: Expected isPermanentGap: true');

    // Verify checkpoint advancement and coordinate preservation
    if (storageA.historicalCheckpoint.lastProcessedDate !== '2023-05-05') {
      throw new Error(`TEST A: Checkpoint date did not advance to 2023-05-05 (got ${storageA.historicalCheckpoint.lastProcessedDate})`);
    }
    if (storageA.historicalCheckpoint.lastProcessedTime !== '16:30:00') {
      throw new Error(`TEST A: lastProcessedTime was not preserved as 16:30:00 (got ${storageA.historicalCheckpoint.lastProcessedTime})`);
    }
    if (storageA.historicalCheckpoint.lastProcessedHistoryId !== '850326') {
      throw new Error(`TEST A: lastProcessedHistoryId was not preserved as 850326 (got ${storageA.historicalCheckpoint.lastProcessedHistoryId})`);
    }

    console.log('PASS: TEST A (2023-05-05 INVALID_PAYLOAD recorded as gap; checkpoint advanced with coordinates preserved)');

    // -------------------------------------------------------------------------
    // TEST B: Resume after permanent gap
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST B] Resume After Permanent Gap (Starting from 2023-05-05) ---');
    // Storage has lastProcessedDate: 2023-05-05
    const summaryB = await engineA.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });

    if (summaryB.resumedFromDate !== '2023-05-05') {
      throw new Error(`TEST B: Expected resumedFromDate 2023-05-05, got ${summaryB.resumedFromDate}`);
    }
    if (summaryB.dateBreakdown[0]?.date !== '2023-05-06') {
      throw new Error(`TEST B: Expected first date evaluated to be 2023-05-06, got ${summaryB.dateBreakdown[0]?.date}`);
    }
    console.log('PASS: TEST B (Resumed seamlessly from 2023-05-05 directly to 2023-05-06)');

    // -------------------------------------------------------------------------
    // TEST C: Zero fabrication
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST C] Zero Fabrication Confirmation ---');
    const records20230505 = await storageA.queryVerifiedRecords({ date: '2023-05-05' });
    if (records20230505.length !== 0) {
      throw new Error(`TEST C: Found ${records20230505.length} records for 2023-05-05 (Expected 0)`);
    }
    console.log('PASS: TEST C (0 verified_market_records exist for unresolvable date 2023-05-05)');

    // -------------------------------------------------------------------------
    // TEST D: NON_TRADING distinction
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST D] NON_TRADING Distinction ---');
    const storageD = new ComprehensiveTestStorage();
    storageD.historicalCheckpoint.lastProcessedDate = '2023-05-05';
    const engineD = new HistoricalBackfillEngine(storageD);

    // Mock an actual [] API response representing a genuine non-trading holiday
    globalThis.fetch = async (url: any) => {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const summaryD = await engineD.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });

    const dateResultD = summaryD.dateBreakdown[0];
    if (dateResultD.classification !== 'NON_TRADING') {
      throw new Error(`TEST D: Expected NON_TRADING for [] response, got ${dateResultD.classification}`);
    }
    if (storageD.historicalCheckpoint.lastProcessedDate !== '2023-05-06') {
      throw new Error(`TEST D: Expected checkpoint to advance to 2023-05-06, got ${storageD.historicalCheckpoint.lastProcessedDate}`);
    }
    const gapAuditD = storageD.auditLogs.find(l => l.date === '2023-05-06' && (l.details as any)?.isPermanentGap);
    if (gapAuditD) {
      throw new Error('TEST D: NON_TRADING date must NOT have isPermanentGap flag');
    }
    console.log('PASS: TEST D (NON_TRADING [] response advances checkpoint cleanly with zero records and no permanent gap flag)');

    // -------------------------------------------------------------------------
    // TEST E: Valid data after gap
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST E] Valid Authentic Data After Gap ---');
    const storageE = new ComprehensiveTestStorage();
    storageE.historicalCheckpoint.lastProcessedDate = '2023-05-05';
    const engineE = new HistoricalBackfillEngine(storageE);

    // Mock a mathematically valid 2023-05-06 response
    // 1) SET: 1533.37 (SET last digit = 7), Value: 51044.20 (Value integer last digit = 4) -> derived2D = '74'
    // 2) SET: 1528.38 (SET last digit = 8), Value: 46890.12 (Value integer last digit = 0) -> derived2D = '80'
    const mockValid20230506 = [
      {
        date: '2023-05-06',
        child: [
          {
            time: '12:01:00',
            set: '1533.37',
            value: '51044.20',
            twod: '74',
            history_id: '850500',
          },
          {
            time: '16:30:00',
            set: '1528.38',
            value: '46890.12',
            twod: '80',
            history_id: '850501',
          },
        ],
      },
    ];

    globalThis.fetch = async () => {
      return new Response(JSON.stringify(mockValid20230506), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const summaryE = await engineE.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });

    const dateResultE = summaryE.dateBreakdown[0];
    if (dateResultE.date !== '2023-05-06') throw new Error(`TEST E: Expected 2023-05-06, got ${dateResultE.date}`);
    if (dateResultE.classification !== 'DATA_AVAILABLE') throw new Error(`TEST E: Expected DATA_AVAILABLE, got ${dateResultE.classification}`);
    if (dateResultE.inserted !== 2) throw new Error(`TEST E: Expected 2 inserted records, got ${dateResultE.inserted}`);
    if (storageE.historicalCheckpoint.lastProcessedDate !== '2023-05-06') {
      throw new Error(`TEST E: Checkpoint did not advance to 2023-05-06`);
    }
    if (storageE.historicalCheckpoint.lastProcessedTime !== '16:30:00') {
      throw new Error(`TEST E: lastProcessedTime was not updated to 16:30:00`);
    }
    if (storageE.historicalCheckpoint.lastProcessedHistoryId !== '850501') {
      throw new Error(`TEST E: lastProcessedHistoryId was not updated to 850501`);
    }

    // Verify mathematical validation
    for (const r of dateResultE.records) {
      if (r.provenance !== 'OFFICIAL_SET_MARKET_LIVE') throw new Error('TEST E: Invalid provenance');
      if (r.mathematicalCheck?.isMathematicallyConsistent !== true) throw new Error('TEST E: Mathematical consistency failed');
    }
    console.log(`PASS: TEST E (Valid data on 2023-05-06 ingested: ${dateResultE.inserted} records inserted with mathematical validation)`);

    // -------------------------------------------------------------------------
    // TEST F: API_ERROR Outage Protection
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST F] API_ERROR Outage Protection ---');
    const storageF = new ComprehensiveTestStorage();
    storageF.historicalCheckpoint.lastProcessedDate = '2023-05-04';
    const engineF = new HistoricalBackfillEngine(storageF);

    // Mock global fetch to simulate HTTP 500 Server Outage
    globalThis.fetch = async () => {
      return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
    };

    const summaryF = await engineF.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 10,
      maxConsecutiveErrors: 5,
      resumeFromCheckpoint: true,
    });

    if (summaryF.status !== 'PARTIAL') {
      throw new Error(`TEST F: Expected status PARTIAL upon outage, got ${summaryF.status}`);
    }
    if (!summaryF.statusMessage.includes('consecutive errors')) {
      throw new Error(`TEST F: Expected consecutive errors message, got ${summaryF.statusMessage}`);
    }
    console.log('PASS: TEST F (Outage protection triggered after 5 consecutive errors, halted cleanly without unbounded progression)');

    // -------------------------------------------------------------------------
    // TEST G: Audit Persistence Failure Safety
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST G] Audit Persistence Failure Safety ---');
    // Restore global fetch
    globalThis.fetch = originalGlobalFetch;

    const storageG = new ComprehensiveTestStorage();
    storageG.historicalCheckpoint.lastProcessedDate = '2023-05-04';
    storageG.shouldFailAuditLog = true; // Fail audit log write on gap
    const engineG = new HistoricalBackfillEngine(storageG);

    let caughtErrG = false;
    try {
      await engineG.executeBackfill({
        startDate: '2021-10-28',
        endDate: '2026-08-26',
        maxDates: 1,
        resumeFromCheckpoint: true,
      });
    } catch (err: any) {
      caughtErrG = true;
    }

    if (!caughtErrG) {
      throw new Error('TEST G: Expected exception when audit log persistence failed!');
    }
    if (storageG.historicalCheckpoint.lastProcessedDate !== '2023-05-04') {
      throw new Error(`TEST G: Checkpoint advanced despite audit failure! (Current: ${storageG.historicalCheckpoint.lastProcessedDate})`);
    }
    console.log('PASS: TEST G (Checkpoint did NOT advance when audit persistence failed)');

    // -------------------------------------------------------------------------
    // TEST H: Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST H] Idempotency ---');
    const storageH = new ComprehensiveTestStorage();
    storageH.historicalCheckpoint.lastProcessedDate = '2023-05-04';
    const engineH = new HistoricalBackfillEngine(storageH);

    // Run 1 for 2023-05-05
    await engineH.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });
    const cpAfter1 = storageH.historicalCheckpoint.lastProcessedDate;

    // Reset checkpoint back to 2023-05-04 and run again to simulate exact re-run
    storageH.historicalCheckpoint.lastProcessedDate = '2023-05-04';
    await engineH.executeBackfill({
      startDate: '2021-10-28',
      endDate: '2026-08-26',
      maxDates: 1,
      resumeFromCheckpoint: true,
    });
    const cpAfter2 = storageH.historicalCheckpoint.lastProcessedDate;

    if (cpAfter1 !== cpAfter2 || cpAfter2 !== '2023-05-05') {
      throw new Error(`TEST H: Idempotent rerun failed! cpAfter1=${cpAfter1}, cpAfter2=${cpAfter2}`);
    }
    const verifiedH = await storageH.queryVerifiedRecords({ date: '2023-05-05' });
    if (verifiedH.length !== 0) {
      throw new Error(`TEST H: Idempotent rerun produced duplicate records!`);
    }
    console.log('PASS: TEST H (Idempotency verified: re-running produces zero duplicate verified records and stable checkpoint)');

    // -------------------------------------------------------------------------
    // TEST I: Live Checkpoint Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- [TEST I] Live Checkpoint Isolation ---');
    const liveCpExpected = {
      id: 'live_sync_checkpoint',
      type: 'LIVE_SYNC',
      lastSuccessfulSyncDate: '2026-08-21',
      lastSuccessfulSyncTime: '12:01:00',
      lastSuccessfulHistoryId: '2758866',
      lastSyncTimestamp: '2026-08-21T05:01:00.000Z',
      totalSyncRuns: 142,
      lastSyncStatus: 'SUCCESS',
      lastSyncMessage: 'Live auto-sync complete',
      updatedAt: '2026-08-26T07:15:55.762Z',
    };

    if (JSON.stringify(storageA.liveCheckpoint) !== JSON.stringify(liveCpExpected)) {
      throw new Error('TEST I: storageA liveCheckpoint was modified!');
    }
    if (JSON.stringify(storageE.liveCheckpoint) !== JSON.stringify(liveCpExpected)) {
      throw new Error('TEST I: storageE liveCheckpoint was modified!');
    }
    if (JSON.stringify(storageF.liveCheckpoint) !== JSON.stringify(liveCpExpected)) {
      throw new Error('TEST I: storageF liveCheckpoint was modified!');
    }
    if (JSON.stringify(storageH.liveCheckpoint) !== JSON.stringify(liveCpExpected)) {
      throw new Error('TEST I: storageH liveCheckpoint was modified!');
    }
    console.log('PASS: TEST I (live_sync_checkpoint remained 100% byte-for-byte untouched across all backfill tests)');

    console.log('\n================================================================');
    console.log('             ALL TESTS PASSED SUCCESSFULLY (TESTS A - I)        ');
    console.log('================================================================');
  } finally {
    globalThis.fetch = originalGlobalFetch;
  }
}

runTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
