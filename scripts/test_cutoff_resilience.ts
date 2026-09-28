import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateVerifiedHistoricalSeries,
  CANDIDATE_CUTOFFS,
  evaluateCandidateCutoff,
  runLockCutoffBenchmark,
} from './run_lock_cutoff_benchmark';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { PREDICTION_CUTOFFS } from '../src/types/prediction';
import { LockEngine } from '../src/core/prediction/lockEngine';

console.log('================================================================');
console.log('       MM2D CUTOFF CANDIDATE RESILIENCE & INTEGRITY TEST        ');
console.log('================================================================');

async function runCutoffTests() {
  const dataset = generateVerifiedHistoricalSeries(200);

  // --- TEST 1: Timezone Arithmetic Verification ---
  console.log('--- [TEST 1] Timezone Arithmetic Verification (Yangon UTC+6:30 vs Bangkok UTC+7:00) ---');
  // Myanmar is UTC+6:30, Bangkok is UTC+7:00
  // Offset is exactly 30 minutes: Bangkok = Myanmar + 30m; Myanmar = Bangkok - 30m
  for (const cand of CANDIDATE_CUTOFFS) {
    const [yH, yM] = cand.yangonTime.split(':').map(Number);
    const [bH, bM] = cand.bangkokTime.split(':').map(Number);
    const yangonTotalMins = yH * 60 + yM;
    const bangkokTotalMins = bH * 60 + bM;
    const diff = bangkokTotalMins - yangonTotalMins;

    assert.strictEqual(
      diff,
      30,
      `Timezone offset for candidate ${cand.id} must be exactly 30 minutes (Bangkok = Yangon + 30m). Found diff: ${diff}m`
    );
  }
  console.log('PASS [01/08]: All candidate cutoffs adhere strictly to Myanmar (UTC+6:30) vs Bangkok (UTC+7:00) 30-minute conversion.');

  // --- TEST 2: Anti-Leakage Boundary Enforcement ---
  console.log('--- [TEST 2] Anti-Leakage Boundary Invariant ---');
  for (const cand of CANDIDATE_CUTOFFS) {
    const evalRes = evaluateCandidateCutoff(cand, dataset, PRODUCTION_MODEL_VERSION, 20);
    assert.strictEqual(
      evalRes.leakageViolationsDetected,
      0,
      `Candidate ${cand.id} must have 0 data leakage violations.`
    );
    assert.strictEqual(
      evalRes.deterministicReproducibilityPass,
      true,
      `Candidate ${cand.id} must be 100% deterministic.`
    );
  }
  console.log('PASS [02/08]: All candidate evaluations strictly prohibit same-session settlement leakage.');

  // --- TEST 3: Zero-Fabrication on Missing High-Frequency Historical Ticks ---
  console.log('--- [TEST 3] Zero-Fabrication Invariant on High-Frequency Timestamps ---');
  const lateAm = CANDIDATE_CUTOFFS.find((c) => c.id === 'AM_IMMEDIATE_1129_MM')!;
  const latePm = CANDIDATE_CUTOFFS.find((c) => c.id === 'PM_PRE_RESULT_1555_MM')!;

  const evalLateAm = evaluateCandidateCutoff(lateAm, dataset, PRODUCTION_MODEL_VERSION, 20);
  const evalLatePm = evaluateCandidateCutoff(latePm, dataset, PRODUCTION_MODEL_VERSION, 20);

  assert.strictEqual(
    evalLateAm.testabilityStatus,
    'UNTESTABLE_MISSING_HISTORICAL_RESOLUTION',
    'AM 11:59 Bangkok tick must be flagged UNTESTABLE due to missing historical archive resolution.'
  );
  assert.strictEqual(
    evalLatePm.testabilityStatus,
    'UNTESTABLE_MISSING_HISTORICAL_RESOLUTION',
    'PM 16:25 Bangkok tick must be flagged UNTESTABLE due to missing historical archive resolution.'
  );
  console.log('PASS [03/08]: Non-standard historical timestamps are classified UNTESTABLE without synthesizing fake ticks.');

  // --- TEST 4: Production Champion Invariance Across Pre-Lock Intervals ---
  console.log('--- [TEST 4] Production Champion Invariance Across Pre-Lock Intervals ---');
  const amBase = CANDIDATE_CUTOFFS.find((c) => c.id === 'AM_BASELINE_1130_MM')!;
  const amOpen = CANDIDATE_CUTOFFS.find((c) => c.id === 'AM_OPEN_CHECKPOINT_1030_MM')!;

  const evalAmBase = evaluateCandidateCutoff(amBase, dataset, PRODUCTION_MODEL_VERSION, 20);
  const evalAmOpen = evaluateCandidateCutoff(amOpen, dataset, PRODUCTION_MODEL_VERSION, 20);

  // ALL_TIME_FREQUENCY_V1 depends strictly on past settlements before target date T
  assert.strictEqual(
    evalAmBase.top1HitRatePercent,
    evalAmOpen.top1HitRatePercent,
    'ALL_TIME_FREQUENCY_V1 AM performance is identical across pre-lock intervals because historical settlement counts are identical.'
  );
  assert.strictEqual(
    evalAmBase.top10HitRatePercent,
    evalAmOpen.top10HitRatePercent,
    'ALL_TIME_FREQUENCY_V1 AM Top-10 performance is identical.'
  );
  console.log('PASS [04/08]: Production champion ALL_TIME_FREQUENCY_V1 empirical distribution is identical across valid pre-lock intervals.');

  // --- TEST 5: PM Session Point-in-Time Conditioning on Today AM Settlement ---
  console.log('--- [TEST 5] PM Session Point-in-Time Conditioning on Today AM Settlement ---');
  const pmBase = CANDIDATE_CUTOFFS.find((c) => c.id === 'PM_BASELINE_1530_MM')!;
  const pmOpen = CANDIDATE_CUTOFFS.find((c) => c.id === 'PM_OPEN_CHECKPOINT_1430_MM')!;

  const evalPmBase = evaluateCandidateCutoff(pmBase, dataset, PRODUCTION_MODEL_VERSION, 20);
  const evalPmOpen = evaluateCandidateCutoff(pmOpen, dataset, PRODUCTION_MODEL_VERSION, 20);

  assert.strictEqual(
    evalPmBase.top1HitRatePercent,
    evalPmOpen.top1HitRatePercent,
    'PM baseline and PM open checkpoints produce identical empirical frequencies from past settlements + today AM settlement.'
  );
  console.log('PASS [05/08]: PM evaluations safely incorporate morning AM settlement while strictly excluding afternoon PM settlement.');

  // --- TEST 6: Benchmark Execution & Recommendation Audit ---
  console.log('--- [TEST 6] Complete Benchmark Execution ---');
  const benchmarkResult = runLockCutoffBenchmark();
  assert.strictEqual(
    benchmarkResult.recommendation,
    'KEEP_CURRENT_LOCK',
    'Benchmark must recommend KEEP_CURRENT_LOCK under strict empirical validation rules.'
  );
  console.log('PASS [06/08]: Benchmark harness successfully executes and yields KEEP_CURRENT_LOCK.');

  // --- TEST 7: LockEngine Bangkok Cutoff Synchronization ---
  console.log('--- [TEST 7] LockEngine Cutoff Synchronization ---');
  assert.strictEqual(PREDICTION_CUTOFFS.AM.timeString, '12:00:00', 'AM Bangkok cutoff must be 12:00:00');
  assert.strictEqual(PREDICTION_CUTOFFS.PM.timeString, '16:00:00', 'PM Bangkok cutoff must be 16:00:00');
  assert.strictEqual(PREDICTION_CUTOFFS.AM.yangonTimeString, '11:30:00', 'AM Yangon cutoff must be 11:30:00');
  assert.strictEqual(PREDICTION_CUTOFFS.PM.yangonTimeString, '15:30:00', 'PM Yangon cutoff must be 15:30:00');
  console.log('PASS [07/08]: LockEngine cutoff constants match canonical specification.');

  // --- TEST 8: Monotonic Hit Rate Containment ---
  console.log('--- [TEST 8] Monotonic Hit Rate Containment ---');
  for (const res of [...benchmarkResult.amResults, ...benchmarkResult.pmResults]) {
    assert(
      res.top1Hits <= res.top3Hits,
      `Top-1 (${res.top1Hits}) must be <= Top-3 (${res.top3Hits})`
    );
    assert(
      res.top3Hits <= res.top5Hits,
      `Top-3 (${res.top3Hits}) must be <= Top-5 (${res.top5Hits})`
    );
    assert(
      res.top5Hits <= res.top10Hits,
      `Top-5 (${res.top5Hits}) must be <= Top-10 (${res.top10Hits})`
    );
  }
  console.log('PASS [08/08]: All candidate results satisfy monotonic containment: Top-1 <= Top-3 <= Top-5 <= Top-10.');

  console.log('\n================================================================');
  console.log(' AUDIT COMPLETE: 8/8 CUTOFF RESILIENCE TESTS PASSED (100%)      ');
  console.log('================================================================\n');
}

runCutoffTests();
