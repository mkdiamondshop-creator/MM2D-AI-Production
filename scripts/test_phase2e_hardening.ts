import worker, { Env, executeSyncCycle } from '../src/worker/index';
import { D1Database, D1StorageAdapter } from '../src/core/storage/d1StorageAdapter';
import { D1ApiStorageAdapter, DatasetStorageManager, globalDatasetStorage } from '../src/core/storage/storageAbstraction';

// Simple In-Memory Mock D1 for Testing
class MockD1Database implements D1Database {
  public rawPayloads: Array<Record<string, unknown>> = [];
  public verifiedRecords: Array<Record<string, unknown>> = [];
  public syncCheckpoints: Array<Record<string, unknown>> = [];
  public syncAuditLogs: Array<Record<string, unknown>> = [];

  public prepare(query: string): any {
    const self = this;
    let boundParams: any[] = [];

    const stmt = {
      bind(...values: any[]) {
        boundParams = values;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (query.includes('SELECT COUNT(*) as cnt, MAX(date) as maxDate FROM verified_market_records')) {
          const maxDate = self.verifiedRecords.length > 0
            ? self.verifiedRecords.map(r => r.date as string).sort().slice(-1)[0]
            : null;
          return { cnt: self.verifiedRecords.length, maxDate } as T;
        }
        if (query.includes("session = 'AM'")) {
          return { cnt: self.verifiedRecords.filter(r => r.session === 'AM').length } as T;
        }
        if (query.includes("session = 'PM'")) {
          return { cnt: self.verifiedRecords.filter(r => r.session === 'PM').length } as T;
        }
        if (query.includes('SELECT COUNT(*) as cnt FROM raw_payloads')) {
          return { cnt: self.rawPayloads.length } as T;
        }
        if (query.includes("WHERE id = 'live_sync_checkpoint'")) {
          const cp = self.syncCheckpoints.find(c => c.id === 'live_sync_checkpoint');
          return (cp || null) as T;
        }
        if (query.includes("WHERE id = 'historical_backfill_checkpoint'")) {
          const cp = self.syncCheckpoints.find(c => c.id === 'historical_backfill_checkpoint');
          return (cp || null) as T;
        }
        return null;
      },
      async all<T = unknown>(): Promise<{ results?: T[]; success: boolean; meta: any }> {
        if (query.includes('FROM verified_market_records')) {
          let results = [...self.verifiedRecords];
          if (boundParams.length > 0) {
            // Filter by date or session if passed
            const dateParam = boundParams.find(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
            const sessionParam = boundParams.find(p => p === 'AM' || p === 'PM');
            if (dateParam) results = results.filter(r => r.date === dateParam);
            if (sessionParam) results = results.filter(r => r.session === sessionParam);
          }
          return { results: results as T[], success: true, meta: {} };
        }
        if (query.includes('FROM sync_audit_logs')) {
          const limit = typeof boundParams[0] === 'number' ? boundParams[0] : 50;
          return { results: self.syncAuditLogs.slice(0, limit) as T[], success: true, meta: {} };
        }
        return { results: [], success: true, meta: {} };
      },
      async run<T = unknown>(): Promise<{ success: boolean; meta: any }> {
        if (query.includes('INSERT OR REPLACE INTO raw_payloads')) {
          const [id, date, endpoint, payload_json, record_count, fetched_at, status] = boundParams;
          const idx = self.rawPayloads.findIndex(r => r.id === id);
          const row = { id, date, endpoint, payload_json, record_count, fetched_at, status };
          if (idx >= 0) self.rawPayloads[idx] = row;
          else self.rawPayloads.push(row);
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes('INSERT INTO sync_audit_logs')) {
          const [id, sync_id, stage, status, timestamp, date, records_count, message, details_json] = boundParams;
          self.syncAuditLogs.unshift({ id, sync_id, stage, status, timestamp, date, records_count, message, details_json });
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes('INSERT INTO sync_checkpoints')) {
          const [targetDate, targetTime, targetHistoryId, totalRuns, status, message, updatedAt] = boundParams;
          const cp = {
            id: 'live_sync_checkpoint',
            type: 'LIVE_SYNC',
            last_date: targetDate,
            last_time: targetTime,
            last_history_id: targetHistoryId,
            total_runs: totalRuns,
            last_status: status,
            last_message: message,
            updated_at: updatedAt,
          };
          const idx = self.syncCheckpoints.findIndex(c => c.id === 'live_sync_checkpoint');
          if (idx >= 0) self.syncCheckpoints[idx] = cp;
          else self.syncCheckpoints.push(cp);
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: {} };
      },
    };
    return stmt;
  }

  public async batch<T = unknown>(statements: any[]): Promise<any[]> {
    const results = [];
    for (const stmt of statements) {
      // simulate batch insert into verified_market_records
      results.push({ success: true, meta: { changes: 1 } });
    }
    return results;
  }

  public async exec(query: string): Promise<any> {
    return { success: true, meta: {} };
  }
}

async function runHardeningTests() {
  console.log('================================================================');
  console.log('       PHASE 2E HARDENING & PRODUCTION AUDIT TEST SUITE         ');
  console.log('================================================================\n');

  const mockDb = new MockD1Database();
  const testSecret = 'secret_phase2e_test_key_8899';
  const env: Env = {
    DB: mockDb,
    SYNC_SECRET: testSecret,
  };

  // -------------------------------------------------------------
  // TEST 1: Unauthorized /api/sync/run Returns 401
  // -------------------------------------------------------------
  console.log('--- [TEST 1] Unauthorized /api/sync/run Security Check ---');
  // 1a. Missing Secret Header
  const reqNoAuth = new Request('https://worker.local/api/sync/run', {
    method: 'POST',
    headers: {},
  });
  const resNoAuth = await worker.fetch(reqNoAuth, env);
  const dataNoAuth = await resNoAuth.json();
  if (resNoAuth.status !== 401 || dataNoAuth.success !== false) {
    throw new Error(`TEST 1a FAILED: Missing auth header must return HTTP 401, got ${resNoAuth.status}`);
  }
  console.log('PASS: 1a. Request without X-Sync-Secret header returned HTTP 401.');

  // 1b. Invalid Secret Header
  const reqWrongAuth = new Request('https://worker.local/api/sync/run', {
    method: 'POST',
    headers: { 'X-Sync-Secret': 'wrong-password' },
  });
  const resWrongAuth = await worker.fetch(reqWrongAuth, env);
  const dataWrongAuth = await resWrongAuth.json();
  if (resWrongAuth.status !== 401 || dataWrongAuth.success !== false) {
    throw new Error(`TEST 1b FAILED: Invalid auth header must return HTTP 401, got ${resWrongAuth.status}`);
  }
  console.log('PASS: 1b. Request with invalid X-Sync-Secret returned HTTP 401.');

  // -------------------------------------------------------------
  // TEST 2: Authorized Sync Request
  // -------------------------------------------------------------
  console.log('\n--- [TEST 2] Authorized /api/sync/run Execution Check ---');
  const reqAuth = new Request('https://worker.local/api/sync/run?date=2026-08-20', {
    method: 'POST',
    headers: { 'X-Sync-Secret': testSecret },
  });
  const resAuth = await worker.fetch(reqAuth, env);
  const dataAuth = await resAuth.json();
  if (resAuth.status !== 200 || !dataAuth.success || !dataAuth.result) {
    throw new Error(`TEST 2 FAILED: Authorized request failed: status ${resAuth.status}, body: ${JSON.stringify(dataAuth)}`);
  }
  console.log('PASS: TEST 2 Authorized request succeeded with HTTP 200 and valid sync result.');

  // -------------------------------------------------------------
  // TEST 3: Failed Sync Guarantees SYNC_FAILED Audit Log
  // -------------------------------------------------------------
  console.log('\n--- [TEST 3] Guaranteed SYNC_FAILED Audit Logging ---');
  const failingDb = new MockD1Database();
  // Override prepare to force an error on storeVerifiedRecords batch or stage
  const failingEnv: Env = {
    DB: {
      ...failingDb,
      prepare(q: string) {
        if (q.includes('verified_market_records')) {
          throw new Error('Simulated D1 Disk Write Error');
        }
        return failingDb.prepare(q);
      },
      batch: async () => {
        throw new Error('Simulated D1 Batch Failure');
      },
      exec: failingDb.exec.bind(failingDb),
    },
    SYNC_SECRET: testSecret,
  };

  let caughtError: any = null;
  try {
    await executeSyncCycle(failingEnv, '2026-08-20');
  } catch (err) {
    caughtError = err;
  }

  if (!caughtError) {
    throw new Error('TEST 3 FAILED: Expected executeSyncCycle to throw on failure, but it did not.');
  }

  const failedLog = failingDb.syncAuditLogs.find(l => l.stage === 'SYNC_FAILED');
  if (!failedLog) {
    throw new Error('TEST 3 FAILED: No SYNC_FAILED audit log recorded in D1.');
  }
  if (failedLog.status !== 'FAILED') {
    throw new Error(`TEST 3 FAILED: Expected audit status 'FAILED', got '${failedLog.status}'`);
  }
  console.log('PASS: TEST 3 Error thrown correctly and SYNC_FAILED log captured with status FAILED.');

  // -------------------------------------------------------------
  // TEST 4: raw_payloads.record_count Counts Actual Child Records
  // -------------------------------------------------------------
  console.log('\n--- [TEST 4] raw_payloads.record_count Semantics Verification ---');
  const d1Adapter = new D1StorageAdapter(mockDb);
  
  // Simulated raw payload with 1 top-level group and 4 child records
  const samplePayload = [
    {
      date: '2026-08-20',
      child: [
        { time: '11:00:00', set: '1,320.12', value: '14,500.56', twod: '25', history_id: '101' },
        { time: '12:01:00', set: '1,321.45', value: '18,200.78', twod: '57', history_id: '102' },
        { time: '15:00:00', set: '1,322.89', value: '22,400.12', twod: '91', history_id: '103' },
        { time: '16:30:00', set: '1,325.67', value: '30,100.34', twod: '73', history_id: '104' },
      ],
    },
  ];

  await d1Adapter.saveRawFeed('2026-08-20', 'https://api.thaistock2d.com/2d_result?date=2026-08-20', samplePayload);
  const savedRow = mockDb.rawPayloads.find(r => r.date === '2026-08-20');
  if (!savedRow) {
    throw new Error('TEST 4 FAILED: Raw payload not found in mock D1.');
  }
  if (savedRow.record_count !== 4) {
    throw new Error(`TEST 4 FAILED: Expected record_count = 4 (child items), but got ${savedRow.record_count}`);
  }
  console.log(`PASS: TEST 4 record_count is correctly 4 for 1 group with 4 children (not 1).`);

  // -------------------------------------------------------------
  // TEST 5: D1 API Adapter Functionality with Mock Fetch
  // -------------------------------------------------------------
  console.log('\n--- [TEST 5] D1 API Adapter & DatasetStorageManager Remote Checks ---');
  const d1Manager = new DatasetStorageManager();
  d1Manager.setD1ApiUrl('https://mock-worker.test');
  if (!d1Manager.isD1RemoteConfigured()) {
    throw new Error('TEST 5 FAILED: d1Manager isD1RemoteConfigured() should be true');
  }

  // Intercept global fetch for test
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.includes('/api/stats')) {
      return new Response(JSON.stringify({
        success: true,
        stats: {
          totalVerifiedCount: 150,
          latestStoredDate: '2026-08-20',
          amCount: 75,
          pmCount: 75,
          totalRawPayloadCount: 30,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/api/records')) {
      return new Response(JSON.stringify({
        success: true,
        count: 1,
        records: [{
          id: '2026-08-20_12:01:00_102',
          date: '2026-08-20',
          time: '12:01:00',
          session: 'AM',
          isSettlement: true,
          setRaw: '1,321.45',
          valueRaw: '18,200.78',
          setNumeric: 1321.45,
          valueNumeric: 18200.78,
          twod: '57',
          historyId: '102',
          verifiedAt: '2026-08-20T12:01:00Z',
          mathematicalCheck: {
            setLastDigit: '1',
            valueLastDigitBeforeDecimal: '5',
            derived2D: '15',
            isMathematicallyConsistent: false,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/api/checkpoints')) {
      return new Response(JSON.stringify({
        success: true,
        checkpoints: {
          liveCheckpoint: {
            id: 'live_sync_checkpoint',
            type: 'LIVE_SYNC',
            lastSuccessfulSyncDate: '2026-08-20',
            lastSuccessfulSyncTime: '16:30:00',
            lastSuccessfulHistoryId: '104',
            lastSyncStatus: 'SUCCESS',
            lastSyncMessage: 'D1 Remote Test Live',
            updatedAt: '2026-08-20T16:30:00Z',
          },
          historicalCheckpoint: {
            id: 'historical_backfill_checkpoint',
            type: 'HISTORICAL_BACKFILL',
            lastBackfillStartDate: '2026-08-01',
            lastBackfillEndDate: '2026-08-20',
            lastProcessedDate: '2026-08-20',
            lastProcessedTime: '16:30:00',
            lastProcessedHistoryId: '104',
            lastSyncTimestamp: '2026-08-20T16:30:00Z',
            totalBackfillRuns: 1,
            lastSyncStatus: 'SUCCESS',
            lastSyncMessage: 'D1 Remote Test Historical',
            updatedAt: '2026-08-20T16:30:00Z',
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (urlStr.includes('/api/audit-logs')) {
      return new Response(JSON.stringify({
        success: true,
        count: 1,
        logs: [{
          id: 'log_test_1',
          syncId: 'sync_1001',
          stage: 'SYNC_COMPLETE',
          status: 'SUCCESS',
          timestamp: '2026-08-20T16:30:00Z',
          date: '2026-08-20',
          message: 'D1 Remote Test Audit Log',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  try {
    const stats = await d1Manager.getStats();
    if (stats.totalVerifiedCount !== 150 || stats.storageEngine !== 'CLOUDFLARE_D1') {
      throw new Error(`TEST 5 FAILED: Expected stats.totalVerifiedCount=150, got ${stats.totalVerifiedCount}`);
    }

    const records = await d1Manager.queryAllVerifiedRecords();
    if (records.length !== 1 || records[0].twod !== '57') {
      throw new Error(`TEST 5 FAILED: Expected 1 record with 2D 57, got ${records.length}`);
    }

    const dual = await d1Manager.getDualCheckpoints();
    if (dual.liveCheckpoint.lastSuccessfulSyncDate !== '2026-08-20' || dual.historicalCheckpoint.lastBackfillStartDate !== '2026-08-01') {
      throw new Error('TEST 5 FAILED: getDualCheckpoints did not return expected remote checkpoints');
    }

    const live = await d1Manager.getLiveCheckpoint();
    if (live.lastSuccessfulSyncTime !== '16:30:00') {
      throw new Error('TEST 5 FAILED: getLiveCheckpoint did not return expected remote live checkpoint');
    }

    const hist = await d1Manager.getHistoricalCheckpoint();
    if (hist.lastProcessedDate !== '2026-08-20') {
      throw new Error('TEST 5 FAILED: getHistoricalCheckpoint did not return expected remote historical checkpoint');
    }

    const logs = await d1Manager.getAuditLogs(10);
    if (logs.length !== 1 || logs[0].message !== 'D1 Remote Test Audit Log') {
      throw new Error('TEST 5 FAILED: getAuditLogs did not return expected remote audit logs');
    }

    console.log('PASS: TEST 5 DatasetStorageManager accurately reads stats, records, dual checkpoints, and audit logs via D1 API.');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // TEST 6: Local Storage Behavior When VITE_D1_API_URL is Absent
  // -------------------------------------------------------------
  console.log('\n--- [TEST 6] Local Storage Integrity Without VITE_D1_API_URL ---');
  const localManager = new DatasetStorageManager();
  // Ensure unconfigured
  localManager.setD1ApiUrl('');
  if (localManager.isD1RemoteConfigured()) {
    throw new Error('TEST 6 FAILED: localManager should not be remote-configured');
  }
  const engineInfo = localManager.getEngineInfo();
  console.log('Local Storage Engine Info:', engineInfo);
  if (engineInfo.engine === 'CLOUDFLARE_D1') {
    throw new Error('TEST 6 FAILED: Engine must be local/in-memory, not CLOUDFLARE_D1');
  }
  console.log('PASS: TEST 6 Local storage fallback and non-remote operation verified.');

  // -------------------------------------------------------------
  // TEST 7: Remote D1 Network Error Fallback Verification
  // -------------------------------------------------------------
  console.log('\n--- [TEST 7] Remote D1 Error Fallback to Local/Memory Storage ---');
  const failingRemoteManager = new DatasetStorageManager();
  failingRemoteManager.setD1ApiUrl('https://failing-worker.test');

  const failingFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    return new Response(JSON.stringify({ success: false, error: 'Simulated 500 Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    // Should warn and fall back gracefully without throwing
    const fallbackStats = await failingRemoteManager.getStats();
    if (fallbackStats.storageEngine === 'CLOUDFLARE_D1') {
      throw new Error('TEST 7 FAILED: Expected fallback storageEngine not to be CLOUDFLARE_D1 on network failure');
    }

    const fallbackRecords = await failingRemoteManager.queryAllVerifiedRecords();
    if (!Array.isArray(fallbackRecords)) {
      throw new Error('TEST 7 FAILED: Expected fallbackRecords to be an array');
    }

    const fallbackDual = await failingRemoteManager.getDualCheckpoints();
    if (!fallbackDual.liveCheckpoint || !fallbackDual.historicalCheckpoint) {
      throw new Error('TEST 7 FAILED: Expected fallbackDual checkpoints to be returned');
    }

    const fallbackLive = await failingRemoteManager.getLiveCheckpoint();
    if (!fallbackLive) {
      throw new Error('TEST 7 FAILED: Expected fallbackLive checkpoint');
    }

    const fallbackHist = await failingRemoteManager.getHistoricalCheckpoint();
    if (!fallbackHist) {
      throw new Error('TEST 7 FAILED: Expected fallbackHist checkpoint');
    }

    const fallbackLogs = await failingRemoteManager.getAuditLogs(10);
    if (!Array.isArray(fallbackLogs)) {
      throw new Error('TEST 7 FAILED: Expected fallbackLogs to be an array');
    }

    console.log('PASS: TEST 7 Remote D1 network failures gracefully fall back to local store across all read methods.');
  } finally {
    globalThis.fetch = failingFetch;
  }

  console.log('\n================================================================');
  console.log('     ALL 7 PHASE 2E HARDENING CHECKS PASSED SUCCESSFULLY!       ');
  console.log('================================================================\n');
}

runHardeningTests().catch(err => {
  console.error('\nFATAL ERROR in hardening test suite:', err);
  process.exit(1);
});
