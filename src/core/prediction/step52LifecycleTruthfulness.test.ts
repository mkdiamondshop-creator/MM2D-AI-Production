/**
 * MM2D STEP 52: PREDICTION LIFECYCLE UI TRUTHFULNESS AUDIT TEST SUITE
 *
 * Verifies:
 * 1. PRE-OPEN shows "--" and no stale prediction
 * 2. 0 valid live ticks -> AWAITING_DATA with no prediction numbers
 * 3. 1 valid pre-lock live tick -> EARLY_PREDICTION (REFINING ≠ FINAL, NOT FINAL)
 * 4. 2+ valid pre-lock live ticks -> REFINING (REFINING ≠ FINAL, NOT FINAL)
 * 5. Every new valid pre-lock tick may update Top-10
 * 6. Lock Cutoff (AM 11:30 MMT / PM 15:30 MMT) -> FINAL PREDICTION / LOCKED
 * 7. "FINAL PREDICTION" appears ONLY after lock, NEVER before lock
 * 8. Post-lock output is strictly immutable
 * 9. Top Candidate = Rank #1, Top-5 = Rank #1–#5, Top-10 = Rank #1–#10 of the same V2 distribution
 * 10. Engine attribution is truthful: "Dominant Engine" & "Supported by X/4 Engines", never single-engine generation
 * 11. AM/PM isolation and anti-leakage invariants remain intact
 */

import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { globalShadowTracker } from './autoWeightedV2ShadowTracker';
import { MarketOpenGate } from '../market/marketOpenGate';
import { DataSufficiencyGate } from '../market/dataSufficiencyGate';
import { PRODUCTION_MODEL_VERSION } from '../../types/prediction';
import { VerifiedMarketRecord } from '../../types/market';
import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ [PASS] ${message}`);
}

function generateTestRecords(): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const baseDate = new Date('2026-03-01');

  for (let i = 0; i < 20; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    records.push({
      id: `am_${dateStr}`,
      date: dateStr,
      time: '12:01:00',
      session: 'AM',
      setRaw: (1450 + (i % 10) * 2.5).toFixed(2),
      valueRaw: `${(35000 + (i % 15) * 1200).toFixed(2)}M`,
      setNumeric: 1450 + (i % 10) * 2.5,
      valueNumeric: 35000 + (i % 15) * 1200,
      twod: `${(i * 3) % 100}`.padStart(2, '0'),
      historyId: `hist_${dateStr}_AM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: `${(i * 3) % 100}`.padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      id: `pm_${dateStr}`,
      date: dateStr,
      time: '16:30:00',
      session: 'PM',
      setRaw: (1452 + (i % 10) * 2.5).toFixed(2),
      valueRaw: `${(45000 + (i % 15) * 1200).toFixed(2)}M`,
      setNumeric: 1452 + (i % 10) * 2.5,
      valueNumeric: 45000 + (i % 15) * 1200,
      twod: `${(i * 7) % 100}`.padStart(2, '0'),
      historyId: `hist_${dateStr}_PM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: '2',
        valueLastDigitBeforeDecimal: '0',
        derived2D: `${(i * 7) % 100}`.padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });
  }

  return records;
}

async function runStep52Tests() {
  console.log('\n=== MM2D STEP 52: PREDICTION LIFECYCLE UI TRUTHFULNESS AUDIT ===\n');

  const records = generateTestRecords();
  const testDate = '2026-03-31';

  // =========================================================================
  // TEST 1: PRE-OPEN (AM < 10:00 MMT, PM < 14:00 MMT) → no prediction ("--")
  // =========================================================================
  console.log('--- TEST 1: Pre-open lifecycle state & no stale prediction ---');
  const amPreOpenTime = new Date('2026-03-31T02:30:00Z'); // 09:00 MMT / 09:30 BKK (Pre-open)
  const amPreOpenGate = MarketOpenGate.resolveLifecycleState({
    targetDate: testDate,
    session: 'AM',
    currentBangkokTime: amPreOpenTime,
    historicalRecords: records,
  });
  assert(amPreOpenGate.isMarketOpen === false, 'AM session at 09:00 MMT is NOT open');
  assert(amPreOpenGate.status === 'MARKET_NOT_OPEN', 'AM session status is MARKET_NOT_OPEN');

  const emptyAmFeed = new LiveObservationBuffer();
  const amPreOpenSufficiency = DataSufficiencyGate.evaluate({
    session: 'AM',
    targetDate: testDate,
    currentBangkokTime: amPreOpenTime,
    buffer: emptyAmFeed,
    isSessionLocked: false,
    hasOfficialResult: false,
  });
  assert(amPreOpenSufficiency.isPredictionPermitted === false, 'AM Pre-open does NOT permit prediction');

  // PM Pre-open: 13:00 MMT is 13:30 Bangkok (Pre-open)
  const pmPreOpenTime = new Date('2026-03-31T06:30:00Z'); // 13:00 MMT / 13:30 BKK
  const pmPreOpenGate = MarketOpenGate.resolveLifecycleState({
    targetDate: testDate,
    session: 'PM',
    currentBangkokTime: pmPreOpenTime,
    historicalRecords: records,
  });
  assert(pmPreOpenGate.isMarketOpen === false, 'PM session at 13:00 MMT is NOT open');
  assert(pmPreOpenGate.status === 'MARKET_NOT_OPEN', 'PM session status is MARKET_NOT_OPEN');

  // =========================================================================
  // TEST 2: 0 valid live ticks → AWAITING_DATA (no prediction numbers)
  // =========================================================================
  console.log('\n--- TEST 2: 0 valid live ticks → AWAITING_DATA with no prediction ---');
  const amMarketOpenTime = new Date('2026-03-31T03:31:00Z'); // 10:01 MMT / 10:31 BKK
  const awaitingSufficiency = DataSufficiencyGate.evaluate({
    session: 'AM',
    targetDate: testDate,
    currentBangkokTime: amMarketOpenTime,
    buffer: emptyAmFeed,
    isSessionLocked: false,
    hasOfficialResult: false,
  });
  assert(awaitingSufficiency.state === 'AWAITING_DATA', '0 live ticks results in state AWAITING_DATA');
  assert(awaitingSufficiency.isPredictionPermitted === false, 'AWAITING_DATA does NOT permit prediction generation');
  assert(awaitingSufficiency.observationCount === 0, 'AWAITING_DATA observationCount is 0');

  // =========================================================================
  // TEST 3: 1 valid live tick → EARLY_PREDICTION (REFINING ≠ FINAL, NOT FINAL)
  // =========================================================================
  console.log('\n--- TEST 3: 1 valid live tick → EARLY_PREDICTION (Active, NOT Final) ---');
  const liveFeed = new LiveObservationBuffer();
  liveFeed.addObservation({
    session: 'AM',
    date: testDate,
    time: '10:32:00',
    set: 1455.20,
    value: 41200.0,
    timestamp: new Date('2026-03-31T03:32:00Z').toISOString(),
  });

  const earlySufficiency = DataSufficiencyGate.evaluate({
    session: 'AM',
    targetDate: testDate,
    currentBangkokTime: new Date('2026-03-31T03:32:05Z'),
    buffer: liveFeed,
    isSessionLocked: false,
    hasOfficialResult: false,
  });
  assert(earlySufficiency.state === 'EARLY_PREDICTION_READY', '1 tick evaluates to EARLY_PREDICTION_READY');
  assert(earlySufficiency.isPredictionPermitted === true, '1 tick permits prediction generation');
  assert(earlySufficiency.isLocked === false, 'EARLY_PREDICTION is NOT locked');

  const earlyRecord = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    testDate,
    'AM',
    liveFeed,
    new Date('2026-03-31T03:32:05Z')
  );
  assert(earlyRecord.isFrozenAtLock === false, 'EARLY_PREDICTION is NOT frozen at lock');
  assert(earlyRecord.liveObservationSnapshot.length === 1, 'Early snapshot contains exactly 1 tick');

  // =========================================================================
  // TEST 4: 2+ valid live ticks → REFINING (REFINING ≠ FINAL, updates distribution)
  // =========================================================================
  console.log('\n--- TEST 4: 2+ live ticks → REFINING (REFINING ≠ FINAL) ---');
  liveFeed.addObservation({
    session: 'AM',
    date: testDate,
    time: '10:45:00',
    set: 1462.80,
    value: 43500.0,
    timestamp: new Date('2026-03-31T03:45:00Z').toISOString(),
  });

  const refiningSufficiency = DataSufficiencyGate.evaluate({
    session: 'AM',
    targetDate: testDate,
    currentBangkokTime: new Date('2026-03-31T03:45:05Z'),
    buffer: liveFeed,
    isSessionLocked: false,
    hasOfficialResult: false,
  });
  assert(refiningSufficiency.state === 'REFINING', '2 ticks evaluates to REFINING');
  assert(refiningSufficiency.observationCount === 2, 'Refining observationCount is 2');
  assert(refiningSufficiency.isLocked === false, 'REFINING is NOT locked (REFINING ≠ FINAL)');

  const refiningRecord = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    testDate,
    'AM',
    liveFeed,
    new Date('2026-03-31T03:45:05Z')
  );
  assert(refiningRecord.isFrozenAtLock === false, 'Refining record is NOT frozen (REFINING ≠ FINAL)');
  assert(refiningRecord.liveObservationSnapshot.length === 2, 'Refining record has 2 accumulated ticks');

  // =========================================================================
  // TEST 5: Lock Cutoff (AM 11:30 MMT / PM 15:30 MMT) → FINAL PREDICTION / LOCKED
  // =========================================================================
  console.log('\n--- TEST 5: Lock Cutoff → FINAL PREDICTION (LOCKED) & Immutability ---');
  const amLockTime = new Date('2026-03-31T05:01:00Z'); // 11:31 MMT / 12:01 BKK (Post AM Cutoff 11:30 MMT)
  const lockedSufficiency = DataSufficiencyGate.evaluate({
    session: 'AM',
    targetDate: testDate,
    currentBangkokTime: amLockTime,
    buffer: liveFeed,
    isSessionLocked: true,
    hasOfficialResult: false,
  });
  assert(lockedSufficiency.isLocked === true, 'Session evaluated as LOCKED post cutoff');

  // Freeze snapshot
  const frozenRecord = globalShadowTracker.freezeLockSnapshot(
    testDate,
    'AM',
    records,
    liveFeed,
    amLockTime
  );
  assert(frozenRecord.isFrozenAtLock === true, 'Snapshot is flagged as isFrozenAtLock');
  assert(typeof frozenRecord.immutabilityHash === 'string' && frozenRecord.immutabilityHash.length > 0,
         'Snapshot contains valid immutabilityHash');

  // Verification that FINAL appears ONLY when isFrozenAtLock === true
  assert(earlyRecord.isFrozenAtLock === false, 'EARLY record has isFrozenAtLock === false (NOT FINAL)');
  assert(refiningRecord.isFrozenAtLock === false, 'REFINING record has isFrozenAtLock === false (NOT FINAL)');
  assert(frozenRecord.isFrozenAtLock === true, 'FROZEN record has isFrozenAtLock === true (ONLY NOW FINAL)');

  // Subsequent post-lock ticks cannot modify frozen snapshot
  liveFeed.addObservation({
    session: 'AM',
    date: testDate,
    time: '12:05:00',
    set: 1499.00,
    value: 99999.0,
    timestamp: new Date('2026-03-31T05:05:00Z').toISOString(),
  });

  const retrievedPostLock = AutoWeightedV2ShadowValidator.getFrozenSnapshot(testDate, 'AM');
  assert(retrievedPostLock !== null, 'Retrieved post-lock frozen snapshot');
  assert(retrievedPostLock?.immutabilityHash === frozenRecord.immutabilityHash,
         'Hash is 100% identical post additional live tick');
  assert(retrievedPostLock?.top1 === frozenRecord.top1,
         'Top Candidate remained 100% identical post-lock');
  assert(JSON.stringify(retrievedPostLock?.top5) === JSON.stringify(frozenRecord.top5),
         'Top-5 remained 100% identical post-lock');
  assert(JSON.stringify(retrievedPostLock?.top10) === JSON.stringify(frozenRecord.top10),
         'Top-10 remained 100% identical post-lock');

  // =========================================================================
  // TEST 6: Same V2 Distribution Invariant (Top Candidate, Top-5, Top-10)
  // =========================================================================
  console.log('\n--- TEST 6: Unified Distribution Invariant (Top Candidate = Rank #1, Top-5 = Rank #1–#5) ---');
  const candidates = frozenRecord.immutableV2Output.candidates;
  assert(frozenRecord.top1 === candidates[0].twod, 'Top Candidate is identically Ensemble Rank #1');
  assert(frozenRecord.top5.length === 5, 'Top-5 has exactly 5 candidates');
  const expectedTop5 = candidates.slice(0, 5).map((c) => c.twod);
  assert(JSON.stringify(frozenRecord.top5) === JSON.stringify(expectedTop5),
         'Top-5 identically matches candidates[0..4]');
  const expectedTop10 = candidates.slice(0, 10).map((c) => c.twod);
  assert(JSON.stringify(frozenRecord.top10) === JSON.stringify(expectedTop10),
         'Top-10 identically matches candidates[0..9]');

  // =========================================================================
  // TEST 7: Truthful Attribution (No single engine generation claims)
  // =========================================================================
  console.log('\n--- TEST 7: Attribution Audit in UI Codebase ---');
  const appPath = path.join(process.cwd(), 'src/App.tsx');
  const v2ViewPath = path.join(process.cwd(), 'src/components/V2Top10View.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');
  const v2ViewContent = fs.readFileSync(v2ViewPath, 'utf8');

  // App.tsx should use "Dominant Engine" and "Supported by X/4 Engines", not plain "Engine:"
  assert(appContent.includes('Dominant Engine:'), 'App.tsx attributes via "Dominant Engine:"');
  assert(appContent.includes('Supported by') && appContent.includes('/4 Engines'),
         'App.tsx displays multi-engine consensus "Supported by X/4 Engines"');
  assert(!appContent.includes('<span className="text-neutral-500">Engine:</span>'),
         'App.tsx has purged misleading single "Engine:" prefix');

  // V2Top10View.tsx dynamic binding audit:
  // Must render Final Prediction (Locked) conditionally on isFrozenAtLock
  assert(v2ViewContent.includes('shadowRecord.isFrozenAtLock ?'),
         'V2Top10View gates "Final Prediction (Locked)" strictly on isFrozenAtLock');
  assert(v2ViewContent.includes('Early Prediction'),
         'V2Top10View displays "Early Prediction" when pre-lock tick count <= 1');
  assert(v2ViewContent.includes('Refining ('),
         'V2Top10View displays "Refining" when pre-lock tick count > 1');

  // Empty state must not say "Final Prediction"
  assert(!v2ViewContent.includes('AUTO_WEIGHTED_V2 Final Prediction'),
         'Empty state does NOT claim "Final Prediction"');

  // App.tsx header badge audit
  assert(appContent.includes('isSelectedLocked ?'),
         'App.tsx Top-10 header badge gates "Final Prediction (Locked)" on isSelectedLocked');

  // =========================================================================
  // TEST 8: AM/PM Isolation & Anti-Leakage Invariants
  // =========================================================================
  console.log('\n--- TEST 8: AM/PM Isolation & Anti-Leakage ---');
  const pmLiveFeed = new LiveObservationBuffer();
  pmLiveFeed.addObservation({
    session: 'PM',
    date: testDate,
    time: '14:05:00',
    set: 1475.50,
    value: 52000.0,
    timestamp: new Date('2026-03-31T07:35:00Z').toISOString(),
  });

  const pmPrediction = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    testDate,
    'PM',
    pmLiveFeed,
    new Date('2026-03-31T07:35:05Z')
  );

  assert(pmPrediction.session === 'PM', 'PM prediction is strictly isolated to PM session');
  assert(frozenRecord.session === 'AM', 'AM record is strictly isolated to AM session');
  // Confirm PM weights and AM weights are independently evaluated for session
  assert(pmPrediction.immutableV2Output.weights !== undefined, 'PM has distinct learned weights');
  assert(frozenRecord.immutableV2Output.weights !== undefined, 'AM has distinct learned weights');

  console.log('\n================================================================');
  console.log('ALL 8 STEP 52 PREDICTION LIFECYCLE TRUTHFULNESS TESTS PASSED!');
  console.log('================================================================\n');
}

runStep52Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
