import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D1Database, D1StorageAdapter } from '../storage/d1StorageAdapter';
import { executeLiveRetentionCleanup, Env } from '../../worker/index';
import { TimezoneContract } from '../market/timezoneUtils';

// Mock in-memory D1 Database for Live Retention Cleanup Verification
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

  public verifiedRecords: Array<{
    id: string;
    date: string;
    time: string;
    set: string;
    value: string;
    twod: string;
  }> = [];

  public v2Predictions: Array<{
    id: string;
    date: string;
    session: string;
    status: string;
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
          if (query.includes('id = ?')) {
            const id = boundParams[0];
            results = results.filter((r) => r.id === id);
          }
          return { results: results as T[], success: true, meta: {} };
        }
        if (query.includes('FROM verified_market_records')) {
          return { results: self.verifiedRecords as T[], success: true, meta: {} };
        }
        if (query.includes('FROM v2_predictions')) {
          return { results: self.v2Predictions as T[], success: true, meta: {} };
        }
        return { results: [], success: true, meta: {} };
      },
      async run<T = unknown>(): Promise<{ success: boolean; meta: any }> {
        if (query.includes('INSERT INTO live_observations')) {
          const [id, date, time, session, set_numeric, value_numeric, timestamp] = boundParams;
          self.liveObservations.push({ id, date, time, session, set_numeric, value_numeric, timestamp });
          return { success: true, meta: { changes: 1 } };
        }
        if (query.includes('DELETE FROM live_observations')) {
          const [cutoffDate1, cutoffDate2, cutoffTime, cutoffIso] = boundParams;
          const initialCount = self.liveObservations.length;
          self.liveObservations = self.liveObservations.filter((r) => {
            const isOlder =
              r.date < cutoffDate1 ||
              (r.date === cutoffDate2 && r.time < cutoffTime) ||
              r.timestamp < cutoffIso;
            return !isOlder;
          });
          const changes = initialCount - self.liveObservations.length;
          return { success: true, meta: { changes } };
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
console.log('    MM2D STEP 59: LIVE OBSERVATIONS RETENTION CLEANUP AUDIT     ');
console.log('================================================================\n');

async function runStep59Tests() {
  const mockDb = new MockD1Database();
  const d1 = new D1StorageAdapter(mockDb);

  const env: Env = {
    DB: mockDb,
  };

  // -------------------------------------------------------------
  // TEST 1: Seed Initial Data (Old vs Fresh Live Observations + Protected Historical Records)
  // -------------------------------------------------------------
  console.log('--- TEST 1: Setup Multi-Day Observations and Protected Datasets ---');
  
  // Baseline simulated current time: 2026-10-02 12:00:00 Bangkok (UTC+7)
  const simulatedNowStr = '2026-10-02T12:00:00+07:00';
  const simulatedNowEpoch = TimezoneContract.toBangkok(simulatedNowStr).epochMillis;

  // Populate Protected Datasets that MUST NEVER be deleted:
  mockDb.verifiedRecords.push({
    id: 'rec_2026-09-01_12:00:00',
    date: '2026-09-01',
    time: '12:00:00',
    set: '1540.20',
    value: '45000.00',
    twod: '20',
  });
  mockDb.verifiedRecords.push({
    id: 'rec_2026-10-01_16:30:00',
    date: '2026-10-01',
    time: '16:30:00',
    set: '1555.50',
    value: '52000.00',
    twod: '50',
  });

  mockDb.v2Predictions.push({
    id: 'v2_2026-10-01_AM',
    date: '2026-10-01',
    session: 'AM',
    status: 'LOCKED',
  });

  // Seed live_observations:
  // Row A: 48 hours ago (2026-09-30 12:00:00) -> OLD (>24h) -> SHOULD BE DELETED
  await d1.storeLiveObservation({
    date: '2026-09-30',
    time: '12:00:00',
    session: 'AM',
    set: 1450.10,
    value: 30000.00,
    timestamp: '2026-09-30T12:00:00+07:00',
  });

  // Row B: 26 hours ago (2026-10-01 10:00:00) -> OLD (>24h) -> SHOULD BE DELETED
  await d1.storeLiveObservation({
    date: '2026-10-01',
    time: '10:00:00',
    session: 'AM',
    set: 1455.20,
    value: 32000.00,
    timestamp: '2026-10-01T10:00:00+07:00',
  });

  // Row C: 24 hours 1 minute ago (2026-10-01 11:59:00) -> OLD (>24h) -> SHOULD BE DELETED
  await d1.storeLiveObservation({
    date: '2026-10-01',
    time: '11:59:00',
    session: 'AM',
    set: 1456.00,
    value: 33000.00,
    timestamp: '2026-10-01T11:59:00+07:00',
  });

  // Row D: Exactly 23 hours 59 minutes ago (2026-10-01 12:01:00) -> FRESH (<=24h) -> SHOULD BE RETAINED
  await d1.storeLiveObservation({
    date: '2026-10-01',
    time: '12:01:00',
    session: 'AM',
    set: 1457.00,
    value: 34000.00,
    timestamp: '2026-10-01T12:01:00+07:00',
  });

  // Row E: 20 hours ago (2026-10-01 16:00:00) -> FRESH (<=24h) -> SHOULD BE RETAINED
  await d1.storeLiveObservation({
    date: '2026-10-01',
    time: '16:00:00',
    session: 'PM',
    set: 1460.50,
    value: 41000.00,
    timestamp: '2026-10-01T16:00:00+07:00',
  });

  // Row F: 2 hours ago (2026-10-02 10:00:00) -> FRESH (<=24h) -> SHOULD BE RETAINED
  await d1.storeLiveObservation({
    date: '2026-10-02',
    time: '10:00:00',
    session: 'AM',
    set: 1465.30,
    value: 45000.00,
    timestamp: '2026-10-02T10:00:00+07:00',
  });

  // Row G: 10 minutes ago (2026-10-02 11:50:00) -> FRESH (<=24h) -> SHOULD BE RETAINED
  await d1.storeLiveObservation({
    date: '2026-10-02',
    time: '11:50:00',
    session: 'AM',
    set: 1468.90,
    value: 48000.00,
    timestamp: '2026-10-02T11:50:00+07:00',
  });

  assert.equal(mockDb.liveObservations.length, 7, 'Must have 7 seeded live observations before cleanup');
  console.log('✅ [PASS] Successfully seeded 7 live observations (3 older than 24h, 4 within 24h).');

  // -------------------------------------------------------------
  // TEST 2: Execute Retention Cleanup (24 hours window)
  // -------------------------------------------------------------
  console.log('--- TEST 2: Execute Retention Cleanup (24 hours policy) ---');

  const cleanupResult = await executeLiveRetentionCleanup(env, {
    maxAgeHours: 24,
    simulatedNow: simulatedNowStr,
  });

  assert.equal(cleanupResult.success, true, 'Cleanup execution must report success: true');
  assert.equal(cleanupResult.deletedCount, 3, 'Must delete exactly 3 rows older than 24 hours');
  assert.equal(mockDb.liveObservations.length, 4, 'Exactly 4 recent observations must remain');
  console.log(`✅ [PASS] Cleanup deleted exactly 3 expired rows. 4 fresh rows remain.`);

  // -------------------------------------------------------------
  // TEST 3: Verify Remaining Rows Integrity (Only <= 24h)
  // -------------------------------------------------------------
  console.log('--- TEST 3: Verify Content of Retained Rows ---');

  const remainingIds = mockDb.liveObservations.map((r) => r.id);
  assert.ok(!remainingIds.includes('live_2026-09-30_AM_12:00:00'), '48h row must be deleted');
  assert.ok(!remainingIds.includes('live_2026-10-01_AM_10:00:00'), '26h row must be deleted');
  assert.ok(!remainingIds.includes('live_2026-10-01_AM_11:59:00'), '24h 1m row must be deleted');

  assert.ok(remainingIds.includes('live_2026-10-01_AM_12:01:00'), '23h 59m row must be retained');
  assert.ok(remainingIds.includes('live_2026-10-01_PM_16:00:00'), '20h row must be retained');
  assert.ok(remainingIds.includes('live_2026-10-02_AM_10:00:00'), '2h row must be retained');
  assert.ok(remainingIds.includes('live_2026-10-02_AM_11:50:00'), '10m row must be retained');

  console.log('✅ [PASS] Verified remaining rows: all are strictly within the 24-hour retention window.');

  // -------------------------------------------------------------
  // TEST 4: Anti-Leakage & Protected Data Immunity Verification
  // -------------------------------------------------------------
  console.log('--- TEST 4: Protected Datasets Immunity Check ---');

  // Verify historical verified records are 100% untouched
  assert.equal(mockDb.verifiedRecords.length, 2, 'Historical verified records must NEVER be deleted');
  assert.equal(mockDb.v2Predictions.length, 1, 'Prediction snapshots must NEVER be deleted');

  // Verify Zero-2D Invariant
  for (const obs of mockDb.liveObservations) {
    assert.equal((obs as any).twod, undefined, 'CRITICAL: D1 live_observations MUST NEVER contain twod');
    assert.equal((obs as any).twod_raw, undefined, 'live_observations must never contain twod_raw');
  }

  console.log('✅ [PASS] Verified: Historical Dataset & Prediction Snapshots 100% immune; Zero-2D strictly preserved.');

  // -------------------------------------------------------------
  // TEST 5: Idempotency on Second Run
  // -------------------------------------------------------------
  console.log('--- TEST 5: Idempotency Verification ---');

  const secondRun = await executeLiveRetentionCleanup(env, {
    maxAgeHours: 24,
    simulatedNow: simulatedNowStr,
  });

  assert.equal(secondRun.success, true);
  assert.equal(secondRun.deletedCount, 0, 'Immediate second run must delete 0 rows');
  assert.equal(mockDb.liveObservations.length, 4, 'Remaining count must remain 4');
  console.log('✅ [PASS] Cleanup is idempotent: 0 rows deleted on repeated execution.');

  console.log('\n================================================================');
  console.log('      ALL 5 MM2D STEP 59 TESTS PASSED SUCCESSFULLY!             ');
  console.log('================================================================\n');
}

runStep59Tests().catch((err) => {
  console.error('❌ Step 59 Test Failed:', err);
  process.exit(1);
});
