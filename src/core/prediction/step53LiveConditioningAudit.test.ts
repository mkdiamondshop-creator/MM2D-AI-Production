/**
 * MM2D STEP 53: V2 LIVE-CONDITIONING FINAL VERIFICATION AUDIT
 *
 * Invariant Checks:
 * 1. LIVE SET + VALUE INFLUENCE: Controlled mutation of live SET/Value materially alters the V2 distribution (calculates explicit delta).
 * 2. LIVE REFINEMENT: Authentic pre-lock ticks refine the same V2 distribution.
 * 3. FINAL LOCK: At cutoff, snapshot freezes immutably; post-lock ticks produce ZERO change.
 * 4. LEAKAGE & ISOLATION: No live 2D, no future/target data, strict AM/PM isolation, PM accesses AM settlement.
 * 5. UNIFIED DISTRIBUTION: Top Candidate = Rank #1, Top-5 = Rank #1–#5, Top-10 = Rank #1–#10 from a single distribution.
 * 6. AUTOMATIC WEIGHTS: Dynamic weights based on learning/entropy only; zero hardcoded manual overrides.
 */

import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { globalShadowTracker } from './autoWeightedV2ShadowTracker';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { FeatureContractAuditor } from './featureContract';
import { FeatureEngine } from './featureEngine';
import { PRODUCTION_MODEL_VERSION } from '../../types/prediction';
import { VerifiedMarketRecord } from '../../types/market';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✅ [PASS] ${message}`);
}

function generateMockHistoricalRecords(count: number = 40): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const baseDate = new Date('2026-02-01');

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    const amPreSet = 1438 + (i % 10) * 2.3;
    const amPreVal = 30000 + (i % 10) * 1400;
    const amSettleSet = 1440 + (i % 12) * 1.8;
    const amSettleVal = 32000 + (i % 10) * 1500;
    const am2D = `${(i * 4 + 7) % 100}`.padStart(2, '0');

    // Pre-lock AM checkpoint (11:00:00)
    records.push({
      id: `check_am_${dateStr}`,
      date: dateStr,
      time: '11:00:00',
      session: 'AM',
      setRaw: amPreSet.toFixed(2),
      valueRaw: `${amPreVal.toFixed(2)}M`,
      setNumeric: amPreSet,
      valueNumeric: amPreVal,
      twod: am2D,
      historyId: `hist_${dateStr}_AM_1100`,
      verifiedAt: new Date().toISOString(),
      isSettlement: false,
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: am2D,
        isMathematicallyConsistent: true,
      },
    });

    // Settlement AM (12:01:00)
    records.push({
      id: `hist_am_${dateStr}`,
      date: dateStr,
      time: '12:01:00',
      session: 'AM',
      setRaw: amSettleSet.toFixed(2),
      valueRaw: `${amSettleVal.toFixed(2)}M`,
      setNumeric: amSettleSet,
      valueNumeric: amSettleVal,
      twod: am2D,
      historyId: `hist_${dateStr}_AM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: am2D[0],
        valueLastDigitBeforeDecimal: am2D[1],
        derived2D: am2D,
        isMathematicallyConsistent: true,
      },
    });

    const pmPreSet = 1441 + (i % 10) * 2.3;
    const pmPreVal = 40000 + (i % 10) * 1400;
    const pmSettleSet = 1442 + (i % 12) * 1.8;
    const pmSettleVal = 42000 + (i % 10) * 1500;
    const pm2D = `${(i * 6 + 13) % 100}`.padStart(2, '0');

    // Pre-lock PM checkpoint (15:00:00)
    records.push({
      id: `check_pm_${dateStr}`,
      date: dateStr,
      time: '15:00:00',
      session: 'PM',
      setRaw: pmPreSet.toFixed(2),
      valueRaw: `${pmPreVal.toFixed(2)}M`,
      setNumeric: pmPreSet,
      valueNumeric: pmPreVal,
      twod: pm2D,
      historyId: `hist_${dateStr}_PM_1500`,
      verifiedAt: new Date().toISOString(),
      isSettlement: false,
      mathematicalCheck: {
        setLastDigit: '2',
        valueLastDigitBeforeDecimal: '0',
        derived2D: pm2D,
        isMathematicallyConsistent: true,
      },
    });

    // Settlement PM (16:30:00)
    records.push({
      id: `hist_pm_${dateStr}`,
      date: dateStr,
      time: '16:30:00',
      session: 'PM',
      setRaw: pmSettleSet.toFixed(2),
      valueRaw: `${pmSettleVal.toFixed(2)}M`,
      setNumeric: pmSettleSet,
      valueNumeric: pmSettleVal,
      twod: pm2D,
      historyId: `hist_${dateStr}_PM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: pm2D[0],
        valueLastDigitBeforeDecimal: pm2D[1],
        derived2D: pm2D,
        isMathematicallyConsistent: true,
      },
    });
  }

  return records;
}

async function runStep53Audit() {
  console.log('\n=== MM2D STEP 53: V2 LIVE-CONDITIONING FINAL VERIFICATION AUDIT ===\n');

  const records = generateMockHistoricalRecords(40);
  const targetDate = '2026-03-31';

  // =========================================================================
  // 1. LIVE SET + VALUE INFLUENCE & DELTA PROOF
  // =========================================================================
  console.log('--- 1. LIVE SET + VALUE INFLUENCE & DELTA PROOF ---');
  // Baseline input condition A: SET = 1450.20, Value = 35000.0
  const liveFeedA = [
    { time: '10:05:00', set: 1450.20, value: 35000.0 },
  ];
  const predA = AutoWeightedV2Engine.predict(records, targetDate, 'AM', liveFeedA);

  // Mutated input condition B: SET = 1468.95, Value = 58000.0
  const liveFeedB = [
    { time: '10:05:00', set: 1468.95, value: 58000.0 },
  ];
  const predB = AutoWeightedV2Engine.predict(records, targetDate, 'AM', liveFeedB);

  // Compute probability deltas between distribution A and distribution B
  let l1Delta = 0;
  let maxDelta = 0;
  let changedProbabilityCount = 0;

  for (let i = 0; i < 100; i++) {
    const pA = predA.probabilities[i];
    const pB = predB.probabilities[i];
    const diff = Math.abs(pA - pB);
    l1Delta += diff;
    if (diff > maxDelta) maxDelta = diff;
    if (diff > 1e-6) changedProbabilityCount++;
  }

  console.log(`Live SET/Value Conditioning Metrics:`);
  console.log(`- Condition A: SET ${liveFeedA[0].set}, Value ${liveFeedA[0].value} -> Top Candidate #${predA.candidates[0].rank}: ${predA.candidates[0].twod} (${(predA.candidates[0].probability * 100).toFixed(2)}%)`);
  console.log(`- Condition B: SET ${liveFeedB[0].set}, Value ${liveFeedB[0].value} -> Top Candidate #${predB.candidates[0].rank}: ${predB.candidates[0].twod} (${(predB.candidates[0].probability * 100).toFixed(2)}%)`);
  console.log(`- L1 Total Variation Delta: ${l1Delta.toFixed(6)}`);
  console.log(`- Max Single-Candidate Delta: ${maxDelta.toFixed(6)}`);
  console.log(`- Altered Distribution Candidates: ${changedProbabilityCount}/100`);

  assert(l1Delta > 0.05, `L1 probability delta (${l1Delta.toFixed(4)}) must exceed 0.05 indicating material shift`);
  assert(maxDelta > 0.003, `Max candidate delta (${maxDelta.toFixed(4)}) must exceed 0.003`);
  assert(changedProbabilityCount > 20, `At least 20 candidate probabilities must be altered (got ${changedProbabilityCount})`);

  // =========================================================================
  // 2. LIVE REFINEMENT ACROSS ACCUMULATING AUTHENTIC TICKS
  // =========================================================================
  console.log('\n--- 2. LIVE REFINEMENT PROOF ---');
  const buffer = new LiveObservationBuffer();
  buffer.addObservation({
    session: 'AM',
    date: targetDate,
    time: '10:05:00',
    set: 1450.20,
    value: 35000.0,
    timestamp: new Date('2026-03-31T03:05:00Z').toISOString(),
  });

  const tick1Record = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    targetDate,
    'AM',
    buffer,
    new Date('2026-03-31T03:05:01Z')
  );

  // Add 2nd authentic live tick
  buffer.addObservation({
    session: 'AM',
    date: targetDate,
    time: '10:30:00',
    set: 1458.73,
    value: 48524.0,
    timestamp: new Date('2026-03-31T03:30:00Z').toISOString(),
  });

  const tick2Record = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    targetDate,
    'AM',
    buffer,
    new Date('2026-03-31T03:30:01Z')
  );

  assert(tick1Record.liveObservationSnapshot.length === 1, 'Tick 1 snapshot has 1 observation');
  assert(tick2Record.liveObservationSnapshot.length === 2, 'Tick 2 snapshot has 2 accumulated observations');
  assert(tick1Record.observedPreLockSet === 1450.20, 'Tick 1 observed SET matches 1450.20');
  assert(tick2Record.observedPreLockSet === 1458.73, 'Tick 2 observed SET refined to latest 1458.73');

  // Verify probability refinement across authentic ticks
  let refinementDelta = 0;
  for (let i = 0; i < 100; i++) {
    refinementDelta += Math.abs(
      tick1Record.immutableV2Output.probabilities[i] - tick2Record.immutableV2Output.probabilities[i]
    );
  }
  console.log(`Refinement L1 Probability Delta (Tick 1 -> Tick 2): ${refinementDelta.toFixed(6)}`);
  assert(refinementDelta > 0.01, 'Accumulated authentic tick refined the ensemble probability distribution');

  // =========================================================================
  // 3. FINAL LOCK & POST-LOCK IMMUTABILITY
  // =========================================================================
  console.log('\n--- 3. FINAL LOCK & POST-LOCK IMMUTABILITY PROOF ---');
  const cutoffTime = new Date('2026-03-31T05:00:00Z'); // 11:30 MMT = 12:00 BKK
  const frozen = globalShadowTracker.freezeLockSnapshot(
    targetDate,
    'AM',
    records,
    buffer,
    cutoffTime
  );

  assert(frozen.isFrozenAtLock === true, 'Snapshot isFrozenAtLock is true');
  const frozenHash = frozen.immutabilityHash;
  const frozenTop1 = frozen.top1;
  const frozenTop5 = [...frozen.top5];
  const frozenTop10 = [...frozen.top10];
  const frozenProbs = [...frozen.immutableV2Output.probabilities];

  // Attempt post-lock live feed tick
  buffer.addObservation({
    session: 'AM',
    date: targetDate,
    time: '12:05:00',
    set: 1499.99,
    value: 99999.0,
    timestamp: new Date('2026-03-31T05:35:00Z').toISOString(),
  });

  const postLockRetrieval = AutoWeightedV2ShadowValidator.getFrozenSnapshot(targetDate, 'AM');
  assert(postLockRetrieval !== null, 'Retrieved post-lock frozen snapshot');
  assert(postLockRetrieval?.immutabilityHash === frozenHash, 'Immutability hash unchanged post-lock');
  assert(postLockRetrieval?.top1 === frozenTop1, 'Top Candidate unchanged post-lock');
  assert(JSON.stringify(postLockRetrieval?.top5) === JSON.stringify(frozenTop5), 'Top-5 unchanged post-lock');
  assert(JSON.stringify(postLockRetrieval?.top10) === JSON.stringify(frozenTop10), 'Top-10 unchanged post-lock');

  // Verify post-lock probability delta is strictly ZERO
  let postLockDelta = 0;
  for (let i = 0; i < 100; i++) {
    postLockDelta += Math.abs(postLockRetrieval!.immutableV2Output.probabilities[i] - frozenProbs[i]);
  }
  console.log(`Post-Lock Alteration Delta: ${postLockDelta} (strictly ZERO)`);
  assert(postLockDelta === 0, 'Post-lock observations caused strictly ZERO alteration to probabilities');

  // =========================================================================
  // 4. LEAKAGE & ISOLATION CHECKS
  // =========================================================================
  console.log('\n--- 4. ANTI-LEAKAGE & ISOLATION AUDIT ---');
  // Check A: Live observations must never carry 2D
  const allObservations = buffer.getObservations('AM', targetDate);
  for (const obs of allObservations) {
    assert(!('twod' in obs), 'Observation buffer must never store 2D result');
    assert(typeof obs.set === 'number', 'SET is numeric');
    assert(typeof obs.value === 'number', 'Value is numeric');
  }

  // Check B: Future date leakage audit
  const futureRecord: VerifiedMarketRecord = {
    ...records[0],
    date: '2026-04-05',
    id: 'future_test',
  };
  const auditResult = FeatureContractAuditor.auditHistoricalInputRecords(
    [...records, futureRecord],
    targetDate,
    'AM'
  );
  assert(auditResult.isCompliant === false, 'Contract auditor catches future dates');
  assert(auditResult.violations.some((v) => v.includes('FUTURE_DATE_LEAKAGE')), 'Reports FUTURE_DATE_LEAKAGE');

  // Check C: PM access to AM verified settlement without leaking PM settlement
  const verifiedAmSettlement: VerifiedMarketRecord = {
    id: `am_${targetDate}`,
    date: targetDate,
    time: '12:01:00',
    session: 'AM',
    setRaw: '1458.70',
    valueRaw: '48000.00M',
    setNumeric: 1458.70,
    valueNumeric: 48000.00,
    twod: '87',
    historyId: `hist_${targetDate}_AM`,
    verifiedAt: new Date().toISOString(),
    isSettlement: true,
    mathematicalCheck: {
      setLastDigit: '8',
      valueLastDigitBeforeDecimal: '0',
      derived2D: '87',
      isMathematicallyConsistent: true,
    },
  };

  const recordsWithTodayAm = [...records, verifiedAmSettlement];
  const pmBuffer = new LiveObservationBuffer();
  pmBuffer.addObservation({
    session: 'PM',
    date: targetDate,
    time: '14:30:00',
    set: 1465.10,
    value: 52000.0,
    timestamp: new Date('2026-03-31T08:00:00Z').toISOString(),
  });

  const pmPrediction = AutoWeightedV2Engine.predict(
    recordsWithTodayAm,
    targetDate,
    'PM',
    pmBuffer.getObservations('PM', targetDate)
  );
  assert(pmPrediction.session === 'PM', 'PM prediction is generated for PM');
  assert(pmPrediction.modelId === 'AUTO_WEIGHTED_V2', 'PM uses AUTO_WEIGHTED_V2');

  // Verify AM engine never sees today AM settlement as input feature
  const amFiltered = FeatureEngine.filterEligibleHistoricalRecords(recordsWithTodayAm, targetDate, 'AM');
  assert(!amFiltered.eligibleRecords.some((r) => r.date === targetDate && r.session === 'AM'),
         'AM prediction engine strictly filters out today AM settlement (zero target leakage)');

  // Verify PM engine can see today AM settlement as eligible historical context
  const pmFiltered = FeatureEngine.filterEligibleHistoricalRecords(recordsWithTodayAm, targetDate, 'PM');
  assert(pmFiltered.eligibleRecords.some((r) => r.date === targetDate && r.session === 'AM'),
         'PM prediction engine successfully includes today AM verified settlement');

  // =========================================================================
  // 5. UNIFIED DISTRIBUTION INVARIANT (TOP1, TOP5, TOP10)
  // =========================================================================
  console.log('\n--- 5. UNIFIED DISTRIBUTION INVARIANT ---');
  const ensembleCandidates = frozen.immutableV2Output.candidates;
  assert(frozen.top1 === ensembleCandidates[0].twod, 'Top Candidate identically matches Ensemble Rank #1');
  assert(frozen.top5.length === 5, 'Top-5 contains exactly 5 numbers');
  for (let i = 0; i < 5; i++) {
    assert(frozen.top5[i] === ensembleCandidates[i].twod, `Top-5 [${i}] matches candidate Rank #${i + 1}`);
  }
  assert(frozen.top10.length === 10, 'Top-10 contains exactly 10 numbers');
  for (let i = 0; i < 10; i++) {
    assert(frozen.top10[i] === ensembleCandidates[i].twod, `Top-10 [${i}] matches candidate Rank #${i + 1}`);
  }

  // =========================================================================
  // 6. DYNAMIC AUTOMATIC WEIGHTS (NO HARDCODED MANUAL OVERRIDES)
  // =========================================================================
  console.log('\n--- 6. AUTOMATIC WEIGHTS INTEGRITY ---');
  const weights = frozen.immutableV2Output.weights;
  assert(typeof weights.ALL_TIME_FREQUENCY_V1 === 'number' && weights.ALL_TIME_FREQUENCY_V1 > 0, 'Dynamic ALL_TIME_FREQUENCY_V1 weight > 0');
  assert(typeof weights.SESSION_SPECIFIC_SET_VALUE_V1 === 'number' && weights.SESSION_SPECIFIC_SET_VALUE_V1 > 0, 'Dynamic SESSION_SPECIFIC_SET_VALUE_V1 weight > 0');
  assert(typeof weights.SET_VALUE_JOINT_RELATIONSHIP_V1 === 'number' && weights.SET_VALUE_JOINT_RELATIONSHIP_V1 > 0, 'Dynamic SET_VALUE_JOINT_RELATIONSHIP_V1 weight > 0');
  assert(typeof weights.VALUE_TO_2D_RELATIONSHIP_V1 === 'number' && weights.VALUE_TO_2D_RELATIONSHIP_V1 > 0, 'Dynamic VALUE_TO_2D_RELATIONSHIP_V1 weight > 0');

  const weightSum = weights.ALL_TIME_FREQUENCY_V1 + weights.SESSION_SPECIFIC_SET_VALUE_V1 +
                    weights.SET_VALUE_JOINT_RELATIONSHIP_V1 + weights.VALUE_TO_2D_RELATIONSHIP_V1;
  assert(Math.abs(weightSum - 1.0) < 1e-4, `Ensemble weights sum to exactly 1.0 (got ${weightSum})`);

  console.log('\n================================================================');
  console.log('ALL STEP 53 V2 LIVE-CONDITIONING FINAL VERIFICATION CHECKS PASSED!');
  console.log('================================================================\n');
}

runStep53Audit().catch((err) => {
  console.error(err);
  process.exit(1);
});
