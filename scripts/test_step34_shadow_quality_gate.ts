import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { globalShadowTracker } from '../src/core/prediction/autoWeightedV2ShadowTracker';
import { AutoWeightedV2QualityGate } from '../src/core/prediction/autoWeightedV2QualityGate';
import { AutoWeightedV2ShadowValidator } from '../src/core/prediction/autoWeightedV2ShadowValidator';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { AUTO_WEIGHTED_V2_COMPONENTS } from '../src/types/autoWeightedV2';
import { VerifiedMarketRecord } from '../src/types/market';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${description}`);
  } else {
    console.error(`  ❌ [FAIL] ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runStep34Tests() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 34: V2 SHADOW QUALITY GATE BENCHMARK       ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${allRecords.length} verified historical records from ThaiStock2D.`);

  // ---------------------------------------------------------------------------
  // SECTION 1: PRODUCTION CHAMPION RIGID ISOLATION & ZERO PROMOTION
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] Strict Champion Freeze & Shadow Enforcement ---');

  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '1a. Production engine PRODUCTION_MODEL strictly remains ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    '1b. PRODUCTION_MODEL_VERSION constant strictly remains ALL_TIME_FREQUENCY_V1.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: REAL-DAY OOS QUALITY GATE EVALUATION (OFFICIAL SETTLEMENTS ONLY)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] Real-Day OOS Quality Gate Evaluation ---');

  const shadowRecords = globalShadowTracker.getAllRecordedSessions();
  assert(shadowRecords.length >= 20, `2a. Sufficient official auto-synced shadow evaluations (${shadowRecords.length} sessions).`);

  const qgResult = AutoWeightedV2QualityGate.evaluate(shadowRecords);

  // Verification of Evidence Counts
  assert(qgResult.totalEvidenceSessions === shadowRecords.length, `2b. Evaluated session count matches (${qgResult.totalEvidenceSessions}).`);
  assert(qgResult.amEvidenceSessions >= 10, `2c. AM evidence sessions (${qgResult.amEvidenceSessions}) >= 10.`);
  assert(qgResult.pmEvidenceSessions >= 10, `2d. PM evidence sessions (${qgResult.pmEvidenceSessions}) >= 10.`);
  assert(qgResult.tradingDaysCount >= 10, `2e. Trading days span (${qgResult.tradingDaysCount}) >= 10.`);

  // Verification of Status Enum
  assert(
    qgResult.status === 'SHADOW' || qgResult.status === 'INSUFFICIENT_EVIDENCE' || qgResult.status === 'PASS_CANDIDATE',
    `2f. Quality Gate status is valid enum value: ${qgResult.status}.`
  );

  // ---------------------------------------------------------------------------
  // SECTION 3: SEPARATE AM AND PM COMPREHENSIVE METRICS
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Granular AM vs PM Performance Metrics ---');

  for (const session of ['AM', 'PM'] as const) {
    const perf = session === 'AM' ? qgResult.amPerformance : qgResult.pmPerformance;
    console.log(`\n  Checking ${session} Session Metrics (N = ${perf.count}):`);

    // 1. NLL / Log Loss
    assert(perf.v2.nll > 0 && perf.champion.nll > 0, `3a.${session}. NLL computed (V2: ${perf.v2.nll.toFixed(4)}, Champ: ${perf.champion.nll.toFixed(4)}).`);
    assert(perf.delta.deltaNll < 0, `3b.${session}. V2 strictly beats Champion NLL (Δ: ${perf.delta.deltaNll.toFixed(4)}).`);

    // 2. Brier Score
    assert(perf.v2.brier > 0 && perf.champion.brier > 0, `3c.${session}. Brier computed (V2: ${perf.v2.brier.toFixed(4)}, Champ: ${perf.champion.brier.toFixed(4)}).`);
    assert(perf.delta.deltaBrier < 0, `3d.${session}. V2 strictly beats Champion Brier (Δ: ${perf.delta.deltaBrier.toFixed(4)}).`);

    // 3. Top-1, 3, 5, 10
    assert(perf.v2.top1Rate >= 0 && perf.v2.top1Rate <= 1, `3e.${session}. Top-1 hit rate valid (${(perf.v2.top1Rate * 100).toFixed(1)}%).`);
    assert(perf.v2.top3Rate >= 0 && perf.v2.top3Rate <= 1, `3f.${session}. Top-3 hit rate valid (${(perf.v2.top3Rate * 100).toFixed(1)}%).`);
    assert(perf.v2.top5Rate >= 0 && perf.v2.top5Rate <= 1, `3g.${session}. Top-5 hit rate valid (${(perf.v2.top5Rate * 100).toFixed(1)}%).`);
    assert(perf.v2.top10Rate >= perf.champion.top10Rate, `3h.${session}. V2 Top-10 rate (${(perf.v2.top10Rate * 100).toFixed(1)}%) >= Champion (${(perf.champion.top10Rate * 100).toFixed(1)}%).`);

    // 4. MRR & Average Rank
    assert(perf.v2.mrr > 0 && perf.v2.mrr <= 1, `3i.${session}. V2 MRR valid (${perf.v2.mrr.toFixed(4)}).`);
    assert(perf.v2.avgRank >= 1 && perf.v2.avgRank <= 100, `3j.${session}. V2 average rank valid (#${perf.v2.avgRank.toFixed(1)}).`);
    assert(perf.v2.mrr >= perf.champion.mrr, `3k.${session}. V2 MRR (${perf.v2.mrr.toFixed(4)}) >= Champion MRR (${perf.champion.mrr.toFixed(4)}).`);
    assert(perf.v2.avgRank <= perf.champion.avgRank, `3l.${session}. V2 average rank (#${perf.v2.avgRank.toFixed(1)}) better than Champion (#${perf.champion.avgRank.toFixed(1)}).`);

    // 5. Win / Loss Count
    assert(perf.headToHead.v2Wins > perf.headToHead.champWins, `3m.${session}. V2 wins head-to-head (${perf.headToHead.v2Wins}W vs ${perf.headToHead.champWins}L).`);
    assert(perf.headToHead.winRate >= 0.60, `3n.${session}. V2 win rate >= 60% (${(perf.headToHead.winRate * 100).toFixed(1)}%).`);

    // 6. Per-Engine Performance
    for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
      const eng = perf.perEnginePerformance[compId];
      assert(eng !== undefined, `3o.${session}.${compId}. Per-engine metrics computed.`);
      assert(eng.avgNll > 0, `3p.${session}.${compId}. Engine avg NLL valid (${eng.avgNll.toFixed(3)}).`);
      assert(eng.avgBrier > 0, `3q.${session}.${compId}. Engine avg Brier valid (${eng.avgBrier.toFixed(3)}).`);
      assert(eng.top10Rate >= 0 && eng.top10Rate <= 1, `3r.${session}.${compId}. Engine Top-10 rate valid (${(eng.top10Rate * 100).toFixed(1)}%).`);
      assert(eng.mrr > 0 && eng.mrr <= 1, `3s.${session}.${compId}. Engine MRR valid (${eng.mrr.toFixed(4)}).`);
      assert(eng.avgRank >= 1 && eng.avgRank <= 100, `3t.${session}.${compId}. Engine average rank valid (#${eng.avgRank.toFixed(1)}).`);
      assert(eng.avgWeight >= 0 && eng.avgWeight <= 1, `3u.${session}.${compId}. Engine average weight valid (${(eng.avgWeight * 100).toFixed(1)}%).`);
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: STATISTICAL-SAFETY & ANTI-OUTLIER GATES
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 4] Statistical Safety & Anti-Outlier Verification ---');

  // 1. Paired Student's t-test
  assert(qgResult.statisticalSafety.tStatistic < 0, `4a. t-statistic is negative (${qgResult.statisticalSafety.tStatistic.toFixed(3)}).`);
  assert(qgResult.statisticalSafety.pValue < 0.05, `4b. p-value < 0.05 (${qgResult.statisticalSafety.pValue.toFixed(4)}).`);
  assert(qgResult.statisticalSafety.isSignificant, '4c. Paired difference is marked statistically significant.');

  // 2. Minimum Evidence Gate Enforcement: Testing small-sample rejection
  console.log('  Testing small-sample rejection with truncated 5-session sample:');
  const smallSample = shadowRecords.slice(0, 5);
  const smallResult = AutoWeightedV2QualityGate.evaluate(smallSample);
  assert(
    smallResult.status === 'INSUFFICIENT_EVIDENCE',
    `4d. Truncated sample (N=5) correctly triggers INSUFFICIENT_EVIDENCE (status: ${smallResult.status}).`
  );
  assert(
    smallResult.failedCriteria.includes('Minimum Total Evaluated Sessions'),
    '4e. Small sample explicitly identifies failed Minimum Total Evaluated Sessions criterion.'
  );

  // 3. Single-Day Outlier Check
  assert(
    qgResult.statisticalSafety.maxSingleDayContributionShare < 0.50,
    `4f. Single best session advantage is strictly < 50% of total NLL delta (${(qgResult.statisticalSafety.maxSingleDayContributionShare * 100).toFixed(1)}%).`
  );
  assert(
    qgResult.statisticalSafety.passedSingleDayOutlierCheck,
    '4g. Passed single-day outlier safety check.'
  );

  // Test artificial outlier failure detection
  console.log('  Testing single-day outlier rejection harness:');
  const artificialOutlierSample = JSON.parse(JSON.stringify(shadowRecords));
  // Make 1 session have massive 100.0 advantage over champion, while others have 0 advantage
  artificialOutlierSample[0].settlementComparison.champion.logLoss = 100.0;
  artificialOutlierSample[0].settlementComparison.v2.logLoss = 1.0;
  for (let i = 1; i < artificialOutlierSample.length; i++) {
    artificialOutlierSample[i].settlementComparison.champion.logLoss = 5.0;
    artificialOutlierSample[i].settlementComparison.v2.logLoss = 5.0;
  }
  const outlierResult = AutoWeightedV2QualityGate.evaluate(artificialOutlierSample);
  assert(
    !outlierResult.statisticalSafety.passedSingleDayOutlierCheck,
    `4h. Artificial single-day outlier properly caught (share: ${(outlierResult.statisticalSafety.maxSingleDayContributionShare * 100).toFixed(1)}% >= 50%).`
  );
  assert(
    outlierResult.status === 'SHADOW',
    `4i. Artificial outlier triggers fallback to SHADOW mode (status: ${outlierResult.status}).`
  );

  // ---------------------------------------------------------------------------
  // SECTION 5: STRICT POINT-IN-TIME ENGINE WEIGHTS & ANTI-LEAKAGE AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 5] Engine Weights Strict Point-in-Time OOS Audit ---');

  const testTargetDate = '2026-09-08';
  const amShadowOriginal = AutoWeightedV2ShadowValidator.generateShadowPrediction(allRecords, testTargetDate, 'AM');

  // Verify weights are strictly based on prior OOS records
  assert(
    amShadowOriginal.antiLeakageAudit.zeroTargetSettlementLeakage,
    '5a. Shadow AM enforces zero target settlement leakage.'
  );
  assert(
    amShadowOriginal.antiLeakageAudit.zeroFutureDatesUsed,
    '5b. Shadow AM enforces zero future dates used.'
  );
  assert(
    amShadowOriginal.antiLeakageAudit.zeroPostLockDataUsed,
    '5c. Shadow AM enforces zero post-lock data used.'
  );
  assert(
    amShadowOriginal.antiLeakageAudit.sessionIsolationEnforced,
    '5d. Shadow AM enforces complete session isolation.'
  );

  // Mutate target date settlement in test record copy and verify zero effect on engine weights
  const mutatedRecords: VerifiedMarketRecord[] = JSON.parse(JSON.stringify(allRecords));
  for (const r of mutatedRecords) {
    if (r.date === testTargetDate && r.isSettlement) {
      r.twod = '99';
      r.setNumeric = 9999.99;
      r.valueNumeric = 99999.99;
    }
  }

  const amShadowMutated = AutoWeightedV2ShadowValidator.generateShadowPrediction(mutatedRecords, testTargetDate, 'AM');

  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    const originalWeight = amShadowOriginal.immutableV2Output.weights[compId];
    const mutatedWeight = amShadowMutated.immutableV2Output.weights[compId];
    assert(
      Math.abs(originalWeight - mutatedWeight) < 1e-12,
      `5e.${compId}. Target-date settlement mutation has exactly 0.000000000000 effect on engine weight.`
    );
  }

  // ---------------------------------------------------------------------------
  // SECTION 6: NO PROMOTION IN PASS_CANDIDATE STATUS
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 6] Policy Verification: Zero Promotion Even Under PASS_CANDIDATE ---');

  assert(
    qgResult.status === 'PASS_CANDIDATE',
    `6a. Quality gate accurately awards PASS_CANDIDATE based on 24 real-day sessions.`
  );
  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '6b. Production model remains 100% frozen as ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    qgResult.recommendation.includes('ALL_TIME_FREQUENCY_V1 remains the locked production champion'),
    '6c. Quality gate explicitly issues mandatory production champion lock directive.'
  );

  console.log('\n================================================================');
  console.log(`  STEP 34 BENCHMARK SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');
}

runStep34Tests().catch((err) => {
  console.error('\n❌ STEP 34 TESTS FAILED:', err);
  process.exit(1);
});
