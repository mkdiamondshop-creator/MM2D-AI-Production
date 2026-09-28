import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { AutoWeightedV2Engine } from '../src/core/prediction/autoWeightedV2Engine';
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

export async function runStep31AutoWeightedV2Tests() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 31: AUTO-WEIGHTED V2 RESEARCH ENSEMBLE    ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${allRecords.length} verified historical records.`);

  const testDate = '2026-09-08';

  // ---------------------------------------------------------------------------
  // SECTION 1: AUTO_WEIGHTED_V2 OUTPUT INTEGRITY CONTRACT (100 PROBS + TOP 10)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] Output Contract, Probabilities & Attribution Invariants ---');

  const amOut = AutoWeightedV2Engine.predict(allRecords, testDate, 'AM');
  const pmOut = AutoWeightedV2Engine.predict(allRecords, testDate, 'PM');

  // Probability length
  assert(amOut.probabilities.length === 100, 'AM output contains exactly 100 probabilities.');
  assert(pmOut.probabilities.length === 100, 'PM output contains exactly 100 probabilities.');

  // Sums to 1.0
  const amSum = amOut.probabilities.reduce((a, b) => a + b, 0);
  const pmSum = pmOut.probabilities.reduce((a, b) => a + b, 0);
  assert(Math.abs(amSum - 1.0) < 1e-5, `AM probabilities sum to 1.0 (actual: ${amSum.toFixed(6)}).`);
  assert(Math.abs(pmSum - 1.0) < 1e-5, `PM probabilities sum to 1.0 (actual: ${pmSum.toFixed(6)}).`);

  // Candidates length and ranking
  assert(amOut.candidates.length === 100, 'AM candidate list has exactly 100 candidates.');
  assert(pmOut.candidates.length === 100, 'PM candidate list has exactly 100 candidates.');
  assert(amOut.candidates[0].rank === 1 && amOut.candidates[99].rank === 100, 'AM ranks span strictly from 1 to 100.');

  // Top 1, Top 3, Top 5, Top 10
  assert(/^\d{2}$/.test(amOut.top1), `Top 1 is a valid 2D string (${amOut.top1}).`);
  assert(amOut.top3.length === 3, 'Top 3 contains exactly 3 distinct candidates.');
  assert(amOut.top5.length === 5, 'Top 5 contains exactly 5 distinct candidates.');
  assert(amOut.top10.length === 10, 'Top 10 contains exactly 10 distinct candidates.');

  // Entropy and confidence
  assert(amOut.entropy > 5.0 && amOut.entropy <= 6.644, `AM Shannon entropy is calibrated (${amOut.entropy.toFixed(3)} bits).`);
  assert(amOut.confidenceScore >= 15 && amOut.confidenceScore <= 85, `AM confidence is bounded in [15, 85] (actual: ${amOut.confidenceScore}).`);

  // Attribution matrix integrity
  for (const cand of amOut.candidates.slice(0, 10)) {
    assert(cand.consensusCount >= 0 && cand.consensusCount <= 4, `Candidate [${cand.twod}] has valid consensus count (${cand.consensusCount}/4).`);
    assert(AUTO_WEIGHTED_V2_COMPONENTS.includes(cand.dominantEngine), `Candidate [${cand.twod}] dominant engine is valid component (${cand.dominantEngine}).`);
    for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
      const sup = cand.engineSupports[compId];
      assert(sup !== undefined, `Candidate [${cand.twod}] has attribution for ${compId}.`);
      assert(sup.weight >= 0 && sup.weight <= 1.0, `Attribution weight for ${compId} is bounded [0, 1].`);
      assert(sup.rankInModel >= 1 && sup.rankInModel <= 100, `Model rank for ${compId} is in 1..100.`);
      assert(sup.contributionShare >= 0, `Contribution share for ${compId} is non-negative.`);
    }
  }

  // Model weights sum to 1.0
  const amWeightSum = Object.values(amOut.weights).reduce((a, b) => a + b, 0);
  const pmWeightSum = Object.values(pmOut.weights).reduce((a, b) => a + b, 0);
  assert(Math.abs(amWeightSum - 1.0) < 1e-4, `AM learned weights sum to 1.0 (actual: ${amWeightSum.toFixed(4)}).`);
  assert(Math.abs(pmWeightSum - 1.0) < 1e-4, `PM learned weights sum to 1.0 (actual: ${pmWeightSum.toFixed(4)}).`);

  // ---------------------------------------------------------------------------
  // SECTION 2: POINT-IN-TIME ANTI-LEAKAGE INVARIANTS
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] Strict Point-in-Time Anti-Leakage Invariants ---');

  // Test 2a: Target Date Settlement Outcome Contamination Invariance
  const baselineAmProb = amOut.probabilities.slice();
  const corruptedRecords: VerifiedMarketRecord[] = allRecords.map((r) => {
    if (r.date === testDate && r.isSettlement) {
      return { ...r, twod: '99', setNumeric: 1999.99, valueNumeric: 99999.99 };
    }
    return { ...r };
  });

  const corruptedAmOut = AutoWeightedV2Engine.predict(corruptedRecords, testDate, 'AM');
  let maxTargetLeakageDiff = 0;
  for (let i = 0; i < 100; i++) {
    const diff = Math.abs(baselineAmProb[i] - corruptedAmOut.probabilities[i]);
    if (diff > maxTargetLeakageDiff) maxTargetLeakageDiff = diff;
  }
  assert(maxTargetLeakageDiff < 1e-9, `Target date settlement modification has zero leakage into AM prediction (diff: ${maxTargetLeakageDiff}).`);

  // Test 2b: Future Dates Exclusion Invariance
  const futureDateRecords: VerifiedMarketRecord[] = [
    ...allRecords,
    {
      id: '2026-09-30_12:01:00_TEST',
      date: '2026-09-30',
      time: '12:01:00',
      session: 'AM',
      setRaw: '1,450.00',
      valueRaw: '50,000.00',
      setNumeric: 1450.0,
      valueNumeric: 50000.0,
      twod: '77',
      isSettlement: true,
      historyId: '9999901',
      verifiedAt: '2026-09-30T12:01:00Z',
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '00',
        isMathematicallyConsistent: true,
      },
    },
    {
      id: '2026-09-30_16:30:00_TEST',
      date: '2026-09-30',
      time: '16:30:00',
      session: 'PM',
      setRaw: '1,452.00',
      valueRaw: '55,000.00',
      setNumeric: 1452.0,
      valueNumeric: 55000.0,
      twod: '88',
      isSettlement: true,
      historyId: '9999902',
      verifiedAt: '2026-09-30T16:30:00Z',
      mathematicalCheck: {
        setLastDigit: '2',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '20',
        isMathematicallyConsistent: true,
      },
    },
  ];

  const futureAmOut = AutoWeightedV2Engine.predict(futureDateRecords, testDate, 'AM');
  let maxFutureLeakageDiff = 0;
  for (let i = 0; i < 100; i++) {
    const diff = Math.abs(baselineAmProb[i] - futureAmOut.probabilities[i]);
    if (diff > maxFutureLeakageDiff) maxFutureLeakageDiff = diff;
  }
  assert(maxFutureLeakageDiff < 1e-9, `Future dates are strictly excluded from prediction (diff: ${maxFutureLeakageDiff}).`);

  // Test 2c: AM and PM Session Weight Independence
  assert(
    JSON.stringify(amOut.weights) !== JSON.stringify(pmOut.weights),
    'AM and PM weights are calculated independently and differ based on session history.'
  );

  // Test 2d: Conservative Prior under Insufficient Evidence
  const minimalHistory = allRecords.filter((r) => r.date <= '2026-08-14');
  const insufficientOut = AutoWeightedV2Engine.predict(minimalHistory, '2026-08-14', 'AM');
  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    assert(
      insufficientOut.weights[compId] === 0.25,
      `Insufficient evidence assigns exact conservative uniform prior (0.25) to ${compId}.`
    );
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: WALK-FORWARD BENCHMARK VS CHAMPION (MIN 10 TRAINING DAYS)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Walk-Forward Benchmark (Min 10 Training Days) ---');

  const report = AutoWeightedV2Engine.runWalkForwardBenchmark(allRecords, 10);

  console.log(`Evaluated ${report.sampleCounts.totalEvents} sessions across ${report.sampleCounts.tradingDaysCount} trading days.`);
  console.log(`Window: ${report.sampleCounts.startDate} to ${report.sampleCounts.endDate}`);
  console.log(`AM Events: ${report.sampleCounts.amEvents}, PM Events: ${report.sampleCounts.pmEvents}\n`);

  console.log('-----------------------------------------------------------------------------------------------------------------');
  console.log('Model ID                                LogLoss    Brier    Top1%   Top3%   Top5%  Top10%     MRR  AvgRank  Entropy');
  console.log('-----------------------------------------------------------------------------------------------------------------');

  // Print Champion Baseline
  const champ = report.overallEnsembleMetrics.champion;
  console.log(
    `${'ALL_TIME_FREQUENCY_V1 (Champion)'.padEnd(36)} ` +
    `${champ.logLoss.toFixed(4).padStart(7)} ` +
    `${champ.brierScore.toFixed(4).padStart(8)} ` +
    `${(champ.top1HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(champ.top3HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(champ.top5HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(champ.top10HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${champ.mrr.toFixed(4).padStart(7)} ` +
    `${champ.avgRank.toFixed(1).padStart(8)} ` +
    `${champ.avgEntropy.toFixed(3).padStart(8)}`
  );

  // Print Component Engines
  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    if (compId === 'ALL_TIME_FREQUENCY_V1') continue;
    const m = report.componentEngineMetrics[compId];
    console.log(
      `${compId.padEnd(36)} ` +
      `${m.overallLogLoss.toFixed(4).padStart(7)} ` +
      `${m.overallBrier.toFixed(4).padStart(8)} ` +
      `${(m.overallTop1Rate.toFixed(1) + '%').padStart(7)} ` +
      `${(m.overallTop3Rate.toFixed(1) + '%').padStart(7)} ` +
      `${(m.overallTop5Rate.toFixed(1) + '%').padStart(7)} ` +
      `${(m.overallTop10Rate.toFixed(1) + '%').padStart(7)} ` +
      `${m.overallMrr.toFixed(4).padStart(7)} ` +
      `${m.overallAvgRank.toFixed(1).padStart(8)} ` +
      `${'--'.padStart(8)}`
    );
  }

  // Print V2 Ensemble
  const v2 = report.overallEnsembleMetrics.v2;
  console.log('-----------------------------------------------------------------------------------------------------------------');
  console.log(
    `${'AUTO_WEIGHTED_V2 (Step 31 Ensemble)'.padEnd(36)} ` +
    `${v2.logLoss.toFixed(4).padStart(7)} ` +
    `${v2.brierScore.toFixed(4).padStart(8)} ` +
    `${(v2.top1HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(v2.top3HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(v2.top5HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${(v2.top10HitRate.toFixed(1) + '%').padStart(7)} ` +
    `${v2.mrr.toFixed(4).padStart(7)} ` +
    `${v2.avgRank.toFixed(1).padStart(8)} ` +
    `${v2.avgEntropy.toFixed(3).padStart(8)}`
  );
  console.log('-----------------------------------------------------------------------------------------------------------------\n');

  // Benchmark Assertions
  assert(report.sampleCounts.totalEvents >= 20, 'Walk-forward evaluated at least 20 market sessions.');
  assert(v2.logLoss < champ.logLoss, `AUTO_WEIGHTED_V2 achieves lower overall Log Loss (${v2.logLoss.toFixed(4)} vs ${champ.logLoss.toFixed(4)}).`);
  assert(v2.brierScore < champ.brierScore, `AUTO_WEIGHTED_V2 achieves lower overall Brier Score (${v2.brierScore.toFixed(4)} vs ${champ.brierScore.toFixed(4)}).`);
  assert(v2.top10HitRate >= champ.top10HitRate, `AUTO_WEIGHTED_V2 matches or exceeds Champion Top-10 Hit Rate (${v2.top10HitRate.toFixed(1)}% vs ${champ.top10HitRate.toFixed(1)}%).`);
  assert(v2.mrr > champ.mrr, `AUTO_WEIGHTED_V2 achieves higher MRR (${v2.mrr.toFixed(4)} vs ${champ.mrr.toFixed(4)}).`);
  assert(v2.avgRank < champ.avgRank, `AUTO_WEIGHTED_V2 achieves better average rank (${v2.avgRank.toFixed(1)} vs ${champ.avgRank.toFixed(1)}).`);

  // Session Consistency Assertions
  assert(report.sessionBreakdown.AM.deltaLogLoss < 0, `AUTO_WEIGHTED_V2 improves Log Loss in AM session (Δ: ${report.sessionBreakdown.AM.deltaLogLoss.toFixed(4)}).`);
  assert(report.sessionBreakdown.PM.deltaLogLoss < 0, `AUTO_WEIGHTED_V2 improves Log Loss in PM session (Δ: ${report.sessionBreakdown.PM.deltaLogLoss.toFixed(4)}).`);
  assert(report.consistencyAssessment.consistentBothSessions, 'AUTO_WEIGHTED_V2 consistently improves performance in BOTH AM and PM sessions.');

  // Paired Statistical Test Assertions
  const pairedLL = report.pairedStatisticalComparison.logLoss;
  assert(pairedLL.meanDifference < 0, `Paired Log Loss difference is negative (${pairedLL.meanDifference.toFixed(4)}).`);
  assert(pairedLL.v2Wins > pairedLL.championWins, `AUTO_WEIGHTED_V2 wins majority of sessions head-to-head (${pairedLL.v2Wins} wins vs ${pairedLL.championWins} losses).`);
  assert(pairedLL.isStatisticallySignificant, `Log Loss improvement is statistically significant (p = ${pairedLL.pValueTwoTailed.toFixed(4)} < 0.05).`);

  // Production Champion Isolation Assertions
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    'Production champion remains strictly frozen as ALL_TIME_FREQUENCY_V1.'
  );

  console.log('\n================================================================');
  console.log(`  STEP 31 BENCHMARK SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');

  console.log('Learned AM Weights:');
  for (const [id, w] of Object.entries(report.learnedWeights.AM)) {
    console.log(`  - ${id.padEnd(32)}: ${(w * 100).toFixed(1)}%`);
  }

  console.log('\nLearned PM Weights:');
  for (const [id, w] of Object.entries(report.learnedWeights.PM)) {
    console.log(`  - ${id.padEnd(32)}: ${(w * 100).toFixed(1)}%`);
  }

  console.log('\nPaired Statistical Test Results:');
  console.log(`  - Log Loss Mean Δ: ${pairedLL.meanDifference.toFixed(4)} (t = ${pairedLL.tStatistic.toFixed(3)}, p = ${pairedLL.pValueTwoTailed.toFixed(4)})`);
  console.log(`  - Head-to-Head Win/Loss: ${pairedLL.v2Wins} Wins / ${pairedLL.championWins} Losses (${((pairedLL.v2Wins / (pairedLL.v2Wins + pairedLL.championWins)) * 100).toFixed(1)}% Win Rate)`);

  console.log('\nProduction Promotion Recommendation:');
  console.log(`  ${report.productionPromotionRecommendation.summary}`);
}

runStep31AutoWeightedV2Tests().catch((err) => {
  console.error('\n❌ STEP 31 TESTS FAILED:', err);
  process.exit(1);
  return;
});
