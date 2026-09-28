import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D1Database, D1StorageAdapter } from '../storage/d1StorageAdapter';
import type { D1LiveObservationRecord } from '../storage/d1StorageAdapter';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { executeLiveCollectionCycle, Env } from '../../worker/index';
import { ThaiStock2dSource } from '../market/thaistock2dSource';
import { LiveSourceResult } from '../../types/liveSource';
import { TimezoneContract } from '../market/timezoneUtils';
import { DatasetStorageManager } from '../storage/storageAbstraction';

// Mock in-memory D1 Database for Step 55 verification
class MockD1Database implements D1Database {
  public liveObservations: Array<{
    id: string;
    date: string;
    time: string;
    session: string;
    set_numeric: number;
    value_numeric: number;
    timestamp: string;
  }> = [];

  public prepare(query: string) {
    const self = this;
    let boundParams: any[] = [];

    const stmt = {
      bind(...params: any[]) {
        boundParams = params;
        return stmt;
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const res = await stmt.all<T>();
        if (!res.results || res.results.length === 0) return null;
        if (colName) return (res.results[0] as any)[colName] as T;
        return res.results[0] as T;
      },
      async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: any }> {
        if (query.includes('FROM live_observations')) {
          let results = [...self.liveObservations];
          // Check WHERE conditions
          if (query.includes('id = ?')) {
            const id = boundParams[0];
            results = results.filter((r) => r.id === id);
          } else {
            if (boundParams.length > 0) {
              const dateParam = boundParams.find((p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
              const sessionParam = boundParams.find((p) => p === 'AM' || p === 'PM');
              if (dateParam) results = results.filter((r) => r.date === dateParam);
              if (sessionParam) results = results.filter((r) => r.session === sessionParam);
            }
          }
          return { results: results as T[], success: true, meta: {} };
        }
        return { results: [], success: true, meta: {} };
      },
      async run<T = unknown>(): Promise<{ success: boolean; meta: any }> {
        if (query.includes('INSERT INTO live_observations')) {
          const [id, date, time, session, set_numeric, value_numeric, timestamp] = boundParams;
          self.liveObservations.push({ id, date, time, session, set_numeric, value_numeric, timestamp });
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes('UPDATE live_observations')) {
          const [set_numeric, value_numeric, timestamp, id] = boundParams;
          const idx = self.liveObservations.findIndex((r) => r.id === id);
          if (idx >= 0) {
            self.liveObservations[idx] = {
              ...self.liveObservations[idx],
              set_numeric,
              value_numeric,
              timestamp,
            };
          }
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: {} };
      },
    };
    return stmt;
  }

  public async batch<T = unknown>(statements: any[]): Promise<any[]> {
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }

  public async exec(query: string): Promise<any> {
    return { success: true, meta: {} };
  }
}

console.log('================================================================');
console.log('       MM2D STEP 55: SERVER-SIDE LIVE COLLECTOR AUDIT           ');
console.log('================================================================\n');

async function runStep55Tests() {
  const mockDb = new MockD1Database();
  const d1 = new D1StorageAdapter(mockDb);

  // -------------------------------------------------------------
  // TEST 1: Schema Invariant - Store ONLY date, time, session, SET, Value, timestamp. NEVER 2D.
  // -------------------------------------------------------------
  console.log('--- TEST 1: D1 Storage Invariants (Zero 2D, Pure SET & Value) ---');
  const storeRes = await d1.storeLiveObservation({
    date: '2026-09-21',
    time: '10:05:00',
    session: 'AM',
    set: 1452.34,
    value: 36500.12,
    timestamp: '2026-09-21T10:05:00+07:00',
  });

  assert.equal(storeRes.inserted, true, 'Observation must be inserted');
  assert.equal(storeRes.duplicate, false, 'First insertion must not be flagged as duplicate');
  assert.equal(mockDb.liveObservations.length, 1, 'Mock D1 must hold exactly 1 observation');

  const storedRow = mockDb.liveObservations[0];
  assert.equal(storedRow.id, 'live_2026-09-21_AM_10:05:00');
  assert.equal(storedRow.set_numeric, 1452.34);
  assert.equal(storedRow.value_numeric, 36500.12);
  assert.equal(storedRow.session, 'AM');
  // CRITICAL ANTI-LEAKAGE INVARIANT: Row must NOT have any 2D property!
  assert.equal((storedRow as any).twod, undefined, 'CRITICAL: D1 live_observations table MUST NEVER contain twod');
  assert.equal((storedRow as any).twod_raw, undefined, 'D1 live_observations table must never have twod_raw');
  console.log('✅ [PASS] Stored live observation strictly contains only date, time, session, SET, Value, timestamp (Zero 2D).');

  // Test duplicate prevention:
  const dupRes = await d1.storeLiveObservation({
    date: '2026-09-21',
    time: '10:05:00',
    session: 'AM',
    set: 1452.34,
    value: 36500.12,
    timestamp: '2026-09-21T10:05:00+07:00',
  });
  assert.equal(dupRes.inserted, false, 'Duplicate observation must not be inserted');
  assert.equal(dupRes.duplicate, true, 'Duplicate observation must be flagged as duplicate');
  assert.equal(mockDb.liveObservations.length, 1, 'Mock D1 count must remain 1');
  console.log('✅ [PASS] Idempotency: Duplicate identical observation safely deduplicated.');

  // -------------------------------------------------------------
  // TEST 2: Validation Invariants - Rejection of Stale, Future, Placeholder, and Invalid Data
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Live Observation Validation Rules ---');
  const buffer = new LiveObservationBuffer();
  const simulatedClock = new Date('2026-09-21T10:30:00+07:00');

  // 2a. Rejection of Placeholder SET / Value (e.g. 0.00 or empty)
  const placeholderRes = buffer.validateObservation(
    {
      date: '2026-09-21',
      time: '10:15:00',
      set: 0,
      value: 0,
      session: 'AM',
    },
    simulatedClock
  );
  assert.equal(placeholderRes.isValid, false, 'Zero placeholder SET must be rejected');
  console.log('✅ [PASS] Placeholder SET/Value (0.00) rejected.');

  // 2b. Rejection of Out-of-Window Time (before 10:00 AM market open)
  const preOpenRes = buffer.validateObservation(
    {
      date: '2026-09-21',
      time: '09:45:00',
      set: 1450.0,
      value: 35000.0,
      session: 'AM',
    },
    simulatedClock
  );
  assert.equal(preOpenRes.isValid, false, 'Pre-market open observation must be rejected');
  console.log('✅ [PASS] Pre-market open observation (09:45:00) rejected.');

  // 2c. Rejection of Future Timestamp (> 60s ahead of clock)
  const futureRes = buffer.validateObservation(
    {
      date: '2026-09-21',
      time: '10:35:00',
      set: 1450.0,
      value: 35000.0,
      timestamp: '2026-09-21T10:35:00+07:00',
      session: 'AM',
    },
    simulatedClock
  );
  assert.equal(futureRes.isValid, false, 'Future timestamp must be rejected');
  console.log('✅ [PASS] Future timestamp (ahead of clock) rejected.');

  // 2d. Rejection of Stale Live Observation (> 15 minutes old from live feed)
  const staleRes = buffer.validateObservation(
    {
      date: '2026-09-21',
      time: '10:10:00',
      set: 1450.0,
      value: 35000.0,
      timestamp: '2026-09-21T10:10:00+07:00', // 20 min prior to simulatedClock 10:30:00
      session: 'AM',
      source: 'AUTHENTIC_FEED',
    },
    simulatedClock
  );
  assert.equal(staleRes.isValid, false, 'Live feed stale by >15 min must be rejected');
  console.log('✅ [PASS] Stale live observation (>15 minutes) rejected.');

  // 2e. Valid Live Observation accepted
  const validRes = buffer.validateObservation(
    {
      date: '2026-09-21',
      time: '10:28:00',
      set: 1453.8,
      value: 38200.5,
      timestamp: '2026-09-21T10:28:00+07:00',
      session: 'AM',
    },
    simulatedClock
  );
  assert.equal(validRes.isValid, true, 'Fresh valid observation must be accepted');
  assert.equal(validRes.sanitizedObservation?.set, 1453.8);
  assert.equal(validRes.sanitizedObservation?.value, 38200.5);
  assert.equal((validRes.sanitizedObservation as any)?.twod, undefined, 'Zero 2D in sanitized observation');
  console.log('✅ [PASS] Valid fresh live observation accepted with zero 2D.');

  // -------------------------------------------------------------
  // TEST 3: Worker Server-Side Collector Execution & Market Window Gating
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Worker Server-Side Live Collector Cycle ---');
  const mockEnv: Env = {
    DB: mockDb,
    SYNC_SECRET: 'test-secret',
  };

  // Mock ThaiStock2D live source returning authentic snapshot
  class MockThaiStockSource extends ThaiStock2dSource {
    public mockSnapshot = {
      source: 'THAISTOCK_2D_PRIMARY' as const,
      sourceName: 'ThaiStock2D Live Feed',
      timestamp: '2026-09-21T10:15:00+07:00',
      date: '2026-09-21',
      time: '10:15:00',
      setNumeric: 1454.67,
      valueNumeric: 39120.45,
      setRaw: '1,454.67',
      valueRaw: '39,120.45',
      isCheckpoint1100: false,
      isCheckpoint1500: false,
      provenance: 'https://api.thaistock2d.com/live',
      quality: 'OFFICIAL_VERIFIED' as const,
      latencyMs: 120,
    };

    public async fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult> {
      return {
        success: true,
        status: 'SUCCESS',
        snapshot: this.mockSnapshot,
        totalLatencyMs: 120,
        sourceAttempts: [],
      };
    }
  }

  // Outside Market Window test (e.g. 08:00:00 Bangkok)
  const outsideWindowRes = await executeLiveCollectionCycle(mockEnv, {
    targetDate: '2026-09-21',
    targetTime: '08:00:00',
    overrideMarketGate: false,
  });
  assert.equal(outsideWindowRes.success, false);
  assert.equal(outsideWindowRes.status, 'OUTSIDE_MARKET_HOURS');
  console.log('✅ [PASS] Worker collector correctly skips when outside AM/PM market window (08:00:00).');

  // Inside AM Window test (e.g. 10:15:00 Bangkok)
  const mockSource = new MockThaiStockSource();
  const amCollectRes = await executeLiveCollectionCycle(mockEnv, {
    targetDate: '2026-09-21',
    targetTime: '10:15:00',
    overrideMarketGate: true,
    customSource: mockSource,
  });
  assert.equal(amCollectRes.success, true, 'Worker live cycle must succeed during market window');
  assert.equal(amCollectRes.inserted, true, 'Observation must be inserted into D1');
  assert.equal(amCollectRes.observation?.set, 1454.67);
  assert.equal(amCollectRes.observation?.value, 39120.45);
  assert.equal(amCollectRes.observation?.session, 'AM');
  assert.equal((amCollectRes.observation as any)?.twod, undefined, 'Worker collection MUST NOT store or return 2D');
  console.log('✅ [PASS] Worker successfully collected and stored AM live observation in D1.');

  // -------------------------------------------------------------
  // TEST 4: D1 Querying & Session Isolation (GET /api/live-observations)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: D1 Live Observations Query & Session Isolation ---');
  // Store a PM observation as well
  await d1.storeLiveObservation({
    date: '2026-09-21',
    time: '14:20:00',
    session: 'PM',
    set: 1458.12,
    value: 52000.8,
    timestamp: '2026-09-21T14:20:00+07:00',
  });

  // Query AM observations
  const amObs = await d1.queryLiveObservations({ date: '2026-09-21', session: 'AM' });
  assert.ok(amObs.length >= 2, 'Should find at least 2 AM observations');
  for (const o of amObs) {
    assert.equal(o.session, 'AM', 'All queried observations must belong to AM session');
    assert.equal((o as any).twod, undefined, 'Zero 2D in queried observations');
    assert.ok(typeof o.set === 'number', 'SET must be numeric');
    assert.ok(typeof o.value === 'number', 'Value must be numeric');
  }
  console.log(`✅ [PASS] AM query returned ${amObs.length} observations with 100% AM isolation and zero 2D.`);

  // Query PM observations
  const pmObs = await d1.queryLiveObservations({ date: '2026-09-21', session: 'PM' });
  assert.equal(pmObs.length, 1, 'Should find exactly 1 PM observation');
  assert.equal(pmObs[0].session, 'PM');
  assert.equal(pmObs[0].time, '14:20:00');
  console.log('✅ [PASS] PM query returned 1 observation with 100% PM isolation and zero 2D.');

  // -------------------------------------------------------------
  // TEST 5: App.tsx Buffer Hydration from D1 on Startup
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: App.tsx Startup Hydration into LiveObservationBuffer ---');
  const freshClientBuffer = new LiveObservationBuffer();
  assert.equal(freshClientBuffer.getObservationCount('AM', '2026-09-21'), 0, 'Buffer initially empty');

  // Hydrate from D1 observations:
  const hydratedCount = freshClientBuffer.hydrateObservations(amObs);
  assert.ok(hydratedCount >= 2, 'Must hydrate all valid D1 observations');
  assert.equal(freshClientBuffer.getObservationCount('AM', '2026-09-21'), hydratedCount);

  // Check chronological feed for prediction engine:
  const amFeed = freshClientBuffer.getEngineFeed('AM', '2026-09-21');
  assert.equal(amFeed.length, hydratedCount);
  assert.equal(amFeed[0].time <= amFeed[1].time, true, 'Engine feed must be chronologically sorted');
  console.log(`✅ [PASS] LiveObservationBuffer successfully hydrated ${hydratedCount} observations from D1 on startup.`);

  // -------------------------------------------------------------
  // TEST 6: Supplemental Client Polling Safety
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Supplemental Client Polling Verification ---');
  // Ingest a supplemental client tick:
  const supplementalSnapshot = {
    source: 'THAISTOCK_2D_PRIMARY' as const,
    sourceName: 'ThaiStock2D Live Feed',
    timestamp: '2026-09-21T10:25:00+07:00',
    date: '2026-09-21',
    time: '10:25:00',
    setNumeric: 1456.1,
    valueNumeric: 41200.0,
    setRaw: '1,456.10',
    valueRaw: '41,200.00',
    isCheckpoint1100: false,
    isCheckpoint1500: false,
    provenance: 'https://api.thaistock2d.com/live',
    quality: 'OFFICIAL_VERIFIED' as const,
    latencyMs: 95,
  };

  const added = freshClientBuffer.ingestSnapshot(supplementalSnapshot, '2026-09-21T10:26:00+07:00');
  assert.equal(added, true, 'Supplemental snapshot must be ingested safely');
  assert.equal(freshClientBuffer.getObservationCount('AM', '2026-09-21'), hydratedCount + 1);
  console.log('✅ [PASS] Supplemental client polling supplements the hydrated buffer safely without dependency.');

  // -------------------------------------------------------------
  // TEST 7: DatasetStorageManager Unified D1 / Local Fallback
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: DatasetStorageManager Storage Contract ---');
  const datasetStorage = new DatasetStorageManager();
  await datasetStorage.storeLiveObservation({
    date: '2026-09-21',
    time: '10:45:00',
    session: 'AM',
    set: 1459.0,
    value: 45000.0,
    timestamp: '2026-09-21T10:45:00+07:00',
  });

  const retrieved = await datasetStorage.queryLiveObservations({ date: '2026-09-21', session: 'AM' });
  assert.ok(retrieved.length >= 1, 'DatasetStorageManager must store and retrieve live observations');
  const found = retrieved.find((r) => r.time === '10:45:00');
  assert.ok(found, 'Stored observation 10:45:00 must exist');
  assert.equal(found?.set, 1459.0);
  assert.equal(found?.value, 45000.0);
  console.log('✅ [PASS] DatasetStorageManager storeLiveObservation & queryLiveObservations contract verified.');

  console.log('\n================================================================');
  console.log('       ALL 7 MM2D STEP 55 TESTS PASSED SUCCESSFULLY!            ');
  console.log('================================================================\n');
}

runStep55Tests().catch((err) => {
  console.error('❌ Step 55 Test Failure:', err);
  process.exit(1);
});
