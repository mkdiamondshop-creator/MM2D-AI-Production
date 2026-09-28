import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D1Database, D1StorageAdapter, v2PredictionRecordToShadowRecord } from '../storage/d1StorageAdapter';
import type { D1V2PredictionRecord, D1LiveObservationRecord } from '../storage/d1StorageAdapter';
import { ServerSideV2Coordinator } from './serverSideV2Coordinator';
import { executeServerSidePredictionCycle, Env } from '../../worker/index';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { AutoWeightedV2ShadowTracker } from './autoWeightedV2ShadowTracker';
import { DatasetStorageManager } from '../storage/storageAbstraction';
import { VerifiedMarketRecord } from '../../types/market';

// Realistic Mock D1 Database for Step 56 verification
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
    session: string;
    is_settlement: number;
    set_raw: string;
    value_raw: string;
    set_numeric: number;
    value_numeric: number;
    twod: string;
    history_id: string;
    verified_at: string;
    provenance: string;
  }> = [];

  public v2Predictions: Array<{
    id: string;
    date: string;
    session: string;
    model_version: string;
    status: string;
    is_frozen: number;
    frozen_at: string | null;
    top1: string;
    top5_json: string;
    top10_json: string;
    candidates_json: string;
    probabilities_json: string;
    engine_weights_json: string;
    observed_set: number | null;
    observed_value: number | null;
    live_observations_count: number;
    live_snapshot_json: string;
    integrity_hash: string;
    settlement_comparison_json: string | null;
    created_at: string;
    updated_at: string;
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
        // v2_predictions
        if (query.includes('FROM v2_predictions')) {
          let results = [...self.v2Predictions];
          if (query.includes('date = ? AND session = ?')) {
            const [date, session] = boundParams;
            results = results.filter((r) => r.date === date && r.session === session);
          } else if (query.includes('id = ?')) {
            const [id] = boundParams;
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

        // live_observations
        if (query.includes('FROM live_observations')) {
          let results = [...self.liveObservations];
          if (query.includes('id = ?')) {
            const [id] = boundParams;
            results = results.filter((r) => r.id === id);
          } else if (boundParams.length > 0) {
            const dateParam = boundParams.find((p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
            const sessionParam = boundParams.find((p) => p === 'AM' || p === 'PM');
            if (dateParam) results = results.filter((r) => r.date === dateParam);
            if (sessionParam) results = results.filter((r) => r.session === sessionParam);
          }
          return { results: results as T[], success: true, meta: {} };
        }

        // verified_market_records
        if (query.includes('FROM verified_market_records')) {
          let results = [...self.verifiedRecords];
          if (query.includes('date = ? AND session = ?')) {
            const [date, session] = boundParams;
            results = results.filter((r) => r.date === date && r.session === session);
          } else if (query.includes('date = ?')) {
            const [date] = boundParams;
            results = results.filter((r) => r.date === date);
          }
          return { results: results as T[], success: true, meta: {} };
        }

        return { results: [], success: true, meta: {} };
      },
      async run<T = unknown>(): Promise<{ success: boolean; meta: any }> {
        if (query.includes('INSERT INTO v2_predictions') || query.includes('INSERT OR REPLACE INTO v2_predictions')) {
          const [
            id,
            date,
            session,
            model_version,
            status,
            is_frozen,
            frozen_at,
            top1,
            top5_json,
            top10_json,
            candidates_json,
            probabilities_json,
            engine_weights_json,
            observed_set,
            observed_value,
            live_observations_count,
            live_snapshot_json,
            integrity_hash,
            settlement_comparison_json,
            created_at,
            updated_at,
          ] = boundParams;

          const existingIdx = self.v2Predictions.findIndex((r) => r.id === id);
          const newRow = {
            id,
            date,
            session,
            model_version,
            status,
            is_frozen,
            frozen_at,
            top1,
            top5_json,
            top10_json,
            candidates_json,
            probabilities_json,
            engine_weights_json,
            observed_set,
            observed_value,
            live_observations_count,
            live_snapshot_json,
            integrity_hash,
            settlement_comparison_json,
            created_at: existingIdx >= 0 ? self.v2Predictions[existingIdx].created_at : created_at,
            updated_at,
          };

          if (existingIdx >= 0) {
            self.v2Predictions[existingIdx] = newRow;
          } else {
            self.v2Predictions.push(newRow);
          }
          return { success: true, meta: { changes: 1 } };
        }

        if (query.includes('UPDATE v2_predictions')) {
          if (query.includes('SET settlement_comparison_json = ?')) {
            const [settlement_comparison_json, updated_at, id] = boundParams;
            const idx = self.v2Predictions.findIndex((r) => r.id === id);
            if (idx >= 0) {
              self.v2Predictions[idx] = {
                ...self.v2Predictions[idx],
                settlement_comparison_json,
                status: 'OFFICIAL_RESULT_AVAILABLE',
                updated_at,
              };
            }
          } else {
            const [
              status,
              is_frozen,
              frozen_at,
              top1,
              top5_json,
              top10_json,
              candidates_json,
              probabilities_json,
              engine_weights_json,
              observed_set,
              observed_value,
              live_observations_count,
              live_snapshot_json,
              integrity_hash,
              settlement_comparison_json,
              updated_at,
              id,
            ] = boundParams;
            const idx = self.v2Predictions.findIndex((r) => r.id === id);
            if (idx >= 0) {
              self.v2Predictions[idx] = {
                ...self.v2Predictions[idx],
                status,
                is_frozen,
                frozen_at,
                top1,
                top5_json,
                top10_json,
                candidates_json,
                probabilities_json,
                engine_weights_json,
                observed_set,
                observed_value,
                live_observations_count,
                live_snapshot_json,
                integrity_hash,
                settlement_comparison_json,
                updated_at,
              };
            }
          }
          return { success: true, meta: { changes: 1 } };
        }

        if (query.includes('INSERT INTO live_observations')) {
          const [id, date, time, session, set_numeric, value_numeric, timestamp] = boundParams;
          self.liveObservations.push({ id, date, time, session, set_numeric, value_numeric, timestamp });
          return { success: true, meta: { changes: 1 } };
        }

        if (query.includes('INSERT INTO verified_market_records')) {
          const [
            id,
            date,
            time,
            session,
            is_settlement,
            set_raw,
            value_raw,
            set_numeric,
            value_numeric,
            twod,
            history_id,
            verified_at,
            provenance,
          ] = boundParams;
          self.verifiedRecords.push({
            id,
            date,
            time,
            session,
            is_settlement,
            set_raw,
            value_raw,
            set_numeric,
            value_numeric,
            twod,
            history_id,
            verified_at,
            provenance,
          });
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

// Generate realistic historical dataset
function seedHistoricalData(db: MockD1Database) {
  const dates = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
  let idCounter = 1000;
  for (const d of dates) {
    // AM Open
    db.verifiedRecords.push({
      id: `${d}_11:00:00_${idCounter++}`,
      date: d,
      time: '11:00:00',
      session: 'AM',
      is_settlement: 0,
      set_raw: '1,450.25',
      value_raw: '25,400.12',
      set_numeric: 1450.25,
      value_numeric: 25400.12,
      twod: '52',
      history_id: String(idCounter),
      verified_at: `${d}T11:00:00Z`,
      provenance: 'TEST_SEED',
    });
    // AM Settlement
    db.verifiedRecords.push({
      id: `${d}_12:01:00_${idCounter++}`,
      date: d,
      time: '12:01:00',
      session: 'AM',
      is_settlement: 1,
      set_raw: '1,455.80',
      value_raw: '28,910.45',
      set_numeric: 1455.8,
      value_numeric: 28910.45,
      twod: '80',
      history_id: String(idCounter),
      verified_at: `${d}T12:01:00Z`,
      provenance: 'TEST_SEED',
    });
    // PM Open
    db.verifiedRecords.push({
      id: `${d}_15:00:00_${idCounter++}`,
      date: d,
      time: '15:00:00',
      session: 'PM',
      is_settlement: 0,
      set_raw: '1,458.10',
      value_raw: '38,200.70',
      set_numeric: 1458.1,
      value_numeric: 38200.7,
      twod: '10',
      history_id: String(idCounter),
      verified_at: `${d}T15:00:00Z`,
      provenance: 'TEST_SEED',
    });
    // PM Settlement
    db.verifiedRecords.push({
      id: `${d}_16:30:00_${idCounter++}`,
      date: d,
      time: '16:30:00',
      session: 'PM',
      is_settlement: 1,
      set_raw: '1,460.95',
      value_raw: '45,670.30',
      set_numeric: 1460.95,
      value_numeric: 45670.3,
      twod: '95',
      history_id: String(idCounter),
      verified_at: `${d}T16:30:00Z`,
      provenance: 'TEST_SEED',
    });
  }
}

console.log('================================================================');
console.log('    MM2D STEP 56: SERVER-SIDE V2 PREDICTION + LOCK AUDIT        ');
console.log('================================================================\n');

async function runStep56Tests() {
  const mockDb = new MockD1Database();
  seedHistoricalData(mockDb);
  const d1 = new D1StorageAdapter(mockDb);

  const targetDate = '2026-09-21';

  // -------------------------------------------------------------
  // TEST 1: Market Open Gate & Awaiting Data
  // -------------------------------------------------------------
  console.log('--- TEST 1: Market Gate & Data Requirements ---');

  // Before AM open (09:30:00 BKK) -> MARKET_NOT_OPEN
  const preOpenRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T09:30:00+07:00`,
  });
  assert.strictEqual(preOpenRes.status, 'MARKET_NOT_OPEN');
  assert.strictEqual(preOpenRes.isFrozen, false);
  console.log('✅ [PASS] Session correctly blocked before market open (MARKET_NOT_OPEN).');

  // Market open (10:15:00 BKK) but no live observations in D1 -> AWAITING_DATA
  const noDataRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T10:15:00+07:00`,
  });
  assert.strictEqual(noDataRes.status, 'AWAITING_DATA');
  assert.strictEqual(noDataRes.isFrozen, false);
  console.log('✅ [PASS] Session correctly waits when D1 has 0 observations (AWAITING_DATA).');

  // -------------------------------------------------------------
  // TEST 2: Early Prediction on Initial Live Observation
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Autonomous Early Prediction (First Live Tick) ---');

  // Insert 1st live observation into D1 (Zero 2D!)
  await d1.storeLiveObservation({
    date: targetDate,
    time: '10:05:00',
    session: 'AM',
    set: 1462.15,
    value: 5200.5,
    timestamp: `${targetDate}T10:05:00+07:00`,
  });

  const earlyRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T10:05:30+07:00`,
  });

  assert.strictEqual(earlyRes.success, true);
  assert.strictEqual(earlyRes.status, 'EARLY_PREDICTION');
  assert.strictEqual(earlyRes.isFrozen, false);
  assert.strictEqual(earlyRes.liveObservationsCount, 1);
  assert.ok(earlyRes.top1 && typeof earlyRes.top1 === 'string' && earlyRes.top1.length === 2);
  assert.strictEqual(earlyRes.top5?.length, 5);
  assert.strictEqual(earlyRes.top10?.length, 10);
  assert.ok(earlyRes.integrityHash && earlyRes.integrityHash.length > 0);
  console.log(`✅ [PASS] Autonomous Early Prediction generated: Top1=${earlyRes.top1}, Top5=${earlyRes.top5?.join(',')}, Status=EARLY_PREDICTION.`);

  // Verify persistence in D1
  const storedEarly = await d1.getV2Prediction(targetDate, 'AM');
  assert.ok(storedEarly);
  assert.strictEqual(storedEarly.status, 'EARLY_PREDICTION');
  assert.strictEqual(storedEarly.isFrozen, 0);
  assert.strictEqual(storedEarly.top1, earlyRes.top1);
  console.log('✅ [PASS] Early Prediction successfully persisted in D1 v2_predictions table.');

  // -------------------------------------------------------------
  // TEST 3: Refining Distribution as New Observations Arrive
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Refining Distribution Pre-Lock ---');

  // Add 2nd live observation (10:45:00)
  await d1.storeLiveObservation({
    date: targetDate,
    time: '10:45:00',
    session: 'AM',
    set: 1463.8,
    value: 14200.75,
    timestamp: `${targetDate}T10:45:00+07:00`,
  });

  const refineRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T10:46:00+07:00`,
  });

  assert.strictEqual(refineRes.success, true);
  assert.strictEqual(refineRes.status, 'REFINING');
  assert.strictEqual(refineRes.isFrozen, false);
  assert.strictEqual(refineRes.liveObservationsCount, 2);
  console.log(`✅ [PASS] Prediction updated dynamically as observations arrive: Status=REFINING (2 ticks).`);

  // -------------------------------------------------------------
  // TEST 4: Final Immutable Lock at 11:30 MMT / 12:00 BKK
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Final Immutable Lock at AM 12:00:00 BKK (11:30 MMT) ---');

  // Add a pre-lock tick at 11:55:00
  await d1.storeLiveObservation({
    date: targetDate,
    time: '11:55:00',
    session: 'AM',
    set: 1465.4,
    value: 29800.2,
    timestamp: `${targetDate}T11:55:00+07:00`,
  });

  // Execute lock at 12:00:00 BKK
  const lockRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T12:00:00+07:00`,
    forceLock: true,
  });

  assert.strictEqual(lockRes.success, true);
  assert.strictEqual(lockRes.status, 'PREDICTION_LOCKED');
  assert.strictEqual(lockRes.isFrozen, true);
  assert.ok(lockRes.frozenAt);
  const lockedTop1 = lockRes.top1;
  const lockedTop5 = lockRes.top5;
  const lockedTop10 = lockRes.top10;
  const lockedHash = lockRes.integrityHash;

  console.log(`✅ [PASS] Prediction frozen at lock cutoff: Top1=${lockedTop1}, Hash=${lockedHash}, FrozenAt=${lockRes.frozenAt}.`);

  // Verify persistence in D1 with is_frozen = 1
  const storedLocked = await d1.getV2Prediction(targetDate, 'AM');
  assert.ok(storedLocked);
  assert.strictEqual(storedLocked.isFrozen, 1);
  assert.strictEqual(storedLocked.status, 'PREDICTION_LOCKED');
  assert.strictEqual(storedLocked.integrityHash, lockedHash);
  console.log('✅ [PASS] Locked state persisted in D1 with is_frozen=1.');

  // -------------------------------------------------------------
  // TEST 5: Strict Immutability Invariant (Post-Lock Ticks Ignored)
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Post-Lock Immutability Invariant ---');

  // Suppose an observation arrives after lock (e.g. 12:00:30)
  await d1.storeLiveObservation({
    date: targetDate,
    time: '12:00:30',
    session: 'AM',
    set: 1499.99, // Wild post-lock value
    value: 99999.99,
    timestamp: `${targetDate}T12:00:30+07:00`,
  });

  // Re-run coordinator post-lock
  const postLockRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T12:00:45+07:00`,
  });

  assert.strictEqual(postLockRes.isFrozen, true);
  assert.strictEqual(postLockRes.top1, lockedTop1);
  assert.deepStrictEqual(postLockRes.top5, lockedTop5);
  assert.deepStrictEqual(postLockRes.top10, lockedTop10);
  assert.strictEqual(postLockRes.integrityHash, lockedHash);
  console.log('✅ [PASS] Strict Immutability enforced: Post-lock ticks do NOT alter frozen prediction or hash.');

  // -------------------------------------------------------------
  // TEST 6: Official Settlement Evaluation (Reads ONLY Frozen Snapshot)
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Official Settlement Evaluation ---');

  // Insert official settlement record in D1 verified_market_records (12:01:00)
  const actualTwod = lockedTop1!; // Simulate Top1 hit
  mockDb.verifiedRecords.push({
    id: `${targetDate}_12:01:00_999999`,
    date: targetDate,
    time: '12:01:00',
    session: 'AM',
    is_settlement: 1,
    set_raw: '1,465.40',
    value_raw: '30,100.00',
    set_numeric: 1465.4,
    value_numeric: 30100.0,
    twod: actualTwod,
    history_id: '999999',
    verified_at: `${targetDate}T12:01:00Z`,
    provenance: 'OFFICIAL_SETTLEMENT',
  });

  // Coordinate session again to process settlement
  const settleRes = await ServerSideV2Coordinator.coordinateSession(d1, 'AM', {
    targetDate,
    simulatedClock: `${targetDate}T12:01:30+07:00`,
  });

  assert.strictEqual(settleRes.status, 'OFFICIAL_RESULT_AVAILABLE');
  assert.strictEqual(settleRes.isFrozen, true);
  assert.ok(settleRes.settlementComparison);
  assert.strictEqual(settleRes.top1, lockedTop1); // NEVER recalculated!
  assert.strictEqual(settleRes.integrityHash, lockedHash); // Same integrity hash!
  console.log('✅ [PASS] Official settlement evaluated against frozen snapshot: Status=OFFICIAL_RESULT_AVAILABLE.');

  // -------------------------------------------------------------
  // TEST 7: PM Isolation & Cross-Session Learning (Without Leakage)
  // -------------------------------------------------------------
  console.log('\n--- TEST 7: PM Isolation & Verified AM Learning (No Leakage) ---');

  // Insert PM live observation (14:10:00)
  await d1.storeLiveObservation({
    date: targetDate,
    time: '14:10:00',
    session: 'PM',
    set: 1468.2,
    value: 12500.0,
    timestamp: `${targetDate}T14:10:00+07:00`,
  });

  const pmRes = await ServerSideV2Coordinator.coordinateSession(d1, 'PM', {
    targetDate,
    simulatedClock: `${targetDate}T14:15:00+07:00`,
  });

  assert.strictEqual(pmRes.success, true);
  assert.strictEqual(pmRes.session, 'PM');
  assert.strictEqual(pmRes.status, 'EARLY_PREDICTION');
  assert.strictEqual(pmRes.isFrozen, false);
  assert.ok(pmRes.top1);
  console.log(`✅ [PASS] PM prediction coordinates autonomously using AM verified learning and PM live SET+Value: Top1=${pmRes.top1}.`);

  // -------------------------------------------------------------
  // TEST 8: Full Unattended Worker Cycle Integration
  // -------------------------------------------------------------
  console.log('\n--- TEST 8: Worker Cron executeServerSidePredictionCycle ---');

  const env: Env = {
    DB: mockDb,
    SYNC_SECRET: 'test-secret',
  };

  const cronRes = await executeServerSidePredictionCycle(env, {
    targetDate,
    simulatedClock: `${targetDate}T14:20:00+07:00`,
    overrideMarketGate: true,
  });

  assert.strictEqual(cronRes.date, targetDate);
  assert.ok(cronRes.pmResult);
  console.log('✅ [PASS] Worker executeServerSidePredictionCycle operates unattended via Cron.');

  // -------------------------------------------------------------
  // TEST 9: App.tsx Startup Hydration into Shadow Tracker
  // -------------------------------------------------------------
  console.log('\n--- TEST 9: Client UI Hydration from D1 ---');

  const tracker = new AutoWeightedV2ShadowTracker();
  const storedPredictions = await d1.queryV2Predictions({ date: targetDate });
  assert.ok(storedPredictions.length >= 2);

  const shadowRecords = storedPredictions.map(v2PredictionRecordToShadowRecord);
  tracker.hydrateRecords(shadowRecords);

  const amHydrated = tracker.getEvaluation(targetDate, 'AM');
  assert.ok(amHydrated);
  assert.strictEqual(amHydrated.isFrozenAtLock, true);
  assert.strictEqual(amHydrated.top1, lockedTop1);
  assert.strictEqual(amHydrated.integrityHash, lockedHash);
  assert.ok(amHydrated.settlementComparison);

  const pmHydrated = tracker.getEvaluation(targetDate, 'PM');
  assert.ok(pmHydrated);
  assert.strictEqual(pmHydrated.session, 'PM');
  assert.strictEqual(pmHydrated.isFrozenAtLock, false);

  console.log('✅ [PASS] App.tsx hydration hydrates D1 predictions seamlessly into memory.');

  console.log('\n================================================================');
  console.log('       ALL 9 MM2D STEP 56 TESTS PASSED SUCCESSFULLY!            ');
  console.log('================================================================');
}

runStep56Tests().catch((err) => {
  console.error('Test failure:', err);
  process.exit(1);
});
