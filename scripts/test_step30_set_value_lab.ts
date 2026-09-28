import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import {
  SetValueRelationshipLab,
  SetTo2DRelationshipEngine,
  ValueTo2DRelationshipEngine,
  SetValueJointRelationshipEngine,
  SimilarConditionsRelationshipEngine,
  RecencySetValueRelationshipEngine,
  SessionSpecificSetValueEngine,
} from '../src/core/prediction/setValueRelationshipLab';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

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

export async function runStep30SetValueLabTests() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 30: SET/VALUE RELATIONSHIP ENGINE LAB     ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${allRecords.length} verified historical records.`);

  const testDate = '2026-09-08';
  const priorHistorical = allRecords.filter((r) => r.date < testDate);

  // ---------------------------------------------------------------------------
  // SECTION 1: VERIFY 6 ENGINES OUTPUT INTEGRITY (100 PROBS + TOP 10)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] 6 Engines Output Contract & Format Invariants ---');

  const engineClasses = [
    { id: 'SET_TO_2D_RELATIONSHIP_V1', fn: SetTo2DRelationshipEngine.predict },
    { id: 'VALUE_TO_2D_RELATIONSHIP_V1', fn: ValueTo2DRelationshipEngine.predict },
    { id: 'SET_VALUE_JOINT_RELATIONSHIP_V1', fn: SetValueJointRelationshipEngine.predict },
    { id: 'SIMILAR_CONDITIONS_RELATIONSHIP_V1', fn: SimilarConditionsRelationshipEngine.predict },
    { id: 'RECENCY_SET_VALUE_RELATIONSHIP_V1', fn: RecencySetValueRelationshipEngine.predict },
    { id: 'SESSION_SPECIFIC_SET_VALUE_V1', fn: SessionSpecificSetValueEngine.predict },
  ];

  for (const eng of engineClasses) {
    const amOut = eng.fn.call(null, allRecords, testDate, 'AM');
    const pmOut = eng.fn.call(null, allRecords, testDate, 'PM');

    // 1. Array length
    assert(amOut.probabilities.length === 100, `${eng.id}: AM output has exactly 100 probabilities.`);
    assert(pmOut.probabilities.length === 100, `${eng.id}: PM output has exactly 100 probabilities.`);

    // 2. Sum to 1.0
    const amSum = amOut.probabilities.reduce((a, b) => a + b, 0);
    const pmSum = pmOut.probabilities.reduce((a, b) => a + b, 0);
    assert(Math.abs(amSum - 1.0) < 1e-5, `${eng.id}: AM probabilities sum to 1.0 (actual: ${amSum.toFixed(6)}).`);
    assert(Math.abs(pmSum - 1.0) < 1e-5, `${eng.id}: PM probabilities sum to 1.0 (actual: ${pmSum.toFixed(6)}).`);

    // 3. Candidates
    assert(amOut.candidates.length === 100, `${eng.id}: AM candidate list has 100 candidates.`);
    assert(amOut.candidates[0].rank === 1 && amOut.candidates[99].rank === 100, `${eng.id}: Ranks range from 1 to 100.`);

    // 4. Top 1, Top 5, Top 10
    assert(amOut.top1.length === 2, `${eng.id}: Top 1 is a valid 2D string (${amOut.top1}).`);
    assert(amOut.top5.length === 5, `${eng.id}: Top 5 contains exactly 5 candidates.`);
    assert(amOut.top10.length === 10, `${eng.id}: Top 10 contains exactly 10 candidates.`);

    // 5. Entropy & Confidence
    assert(amOut.entropy > 0 && amOut.entropy <= 6.6438, `${eng.id}: Shannon entropy is valid (${amOut.entropy.toFixed(3)} bits).`);
    assert(amOut.confidenceScore >= 15 && amOut.confidenceScore <= 85, `${eng.id}: Confidence score bounded in [15, 85].`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 2: POINT-IN-TIME LEAKAGE & IMMUTABILITY INVARIANTS
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] Point-in-Time Strict Anti-Leakage Invariants ---');

  // Test 2a: Target Settlement Outcome Cannot Alter Output
  const recordsModifiedTarget = allRecords.map((r) => {
    if (r.date === testDate && r.isSettlement) {
      return { ...r, twod: '99', setNumeric: 9999.99, valueNumeric: 99999.99 };
    }
    return r;
  });

  for (const eng of engineClasses) {
    const origOut = eng.fn.call(null, allRecords, testDate, 'AM');
    const modOut = eng.fn.call(null, recordsModifiedTarget, testDate, 'AM');

    let maxDiff = 0;
    for (let i = 0; i < 100; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(origOut.probabilities[i] - modOut.probabilities[i]));
    }
    assert(maxDiff < 1e-9, `${eng.id}: Target date settlement outcome modification has zero leakage into AM prediction.`);
  }

  // Test 2b: Future Records Cannot Alter Output
  const futureRecord = {
    date: '2099-12-31',
    time: '12:01:00',
    session: 'AM' as const,
    set: '2000.00',
    value: '90000.00',
    setNumeric: 2000.0,
    valueNumeric: 90000.0,
    twod: '77',
    isSettlement: true,
    historyId: 99999,
  };
  const recordsWithFuture = [...allRecords, futureRecord];

  for (const eng of engineClasses) {
    const origOut = eng.fn.call(null, allRecords, testDate, 'AM');
    const futureOut = eng.fn.call(null, recordsWithFuture, testDate, 'AM');

    let maxDiff = 0;
    for (let i = 0; i < 100; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(origOut.probabilities[i] - futureOut.probabilities[i]));
    }
    assert(maxDiff < 1e-9, `${eng.id}: Future dates strictly excluded from training (zero future leakage).`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: WALK-FORWARD POINT-IN-TIME BENCHMARK (STEP 30)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Walk-Forward Benchmark (Min 10 Training Days) ---');

  const report = SetValueRelationshipLab.runWalkForwardBenchmark(allRecords, 10);

  console.log(`Evaluated ${report.evaluationWindow.totalEvents} sessions across ${report.evaluationWindow.totalTradingDays} trading days.`);
  console.log(`Window: ${report.evaluationWindow.startDate} to ${report.evaluationWindow.endDate}`);
  console.log(`AM Events: ${report.evaluationWindow.amEvents}, PM Events: ${report.evaluationWindow.pmEvents}\n`);

  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('Model ID                             LogLoss    Brier    Top1%   Top3%   Top5%  Top10%  ΔLogLoss  Eligible');
  console.log('---------------------------------------------------------------------------------------------------------');

  const printMetricRow = (m: any) => {
    const idPad = m.modelId.padEnd(36);
    const llPad = m.avgLogLoss.toFixed(4).padStart(7);
    const brPad = m.avgBrierScore.toFixed(4).padStart(8);
    const t1Pad = (m.top1HitRate.toFixed(1) + '%').padStart(7);
    const t3Pad = (m.top3HitRate.toFixed(1) + '%').padStart(7);
    const t5Pad = (m.top5HitRate.toFixed(1) + '%').padStart(7);
    const t10Pad = (m.top10HitRate.toFixed(1) + '%').padStart(7);
    const dLL = (m.deltaLogLossVsChampion >= 0 ? '+' : '') + m.deltaLogLossVsChampion.toFixed(4);
    const dLLPad = dLL.padStart(9);
    const eligPad = (m.isEligibleForAutoWeighting ? 'YES ✅' : 'NO ❌').padStart(9);
    console.log(`${idPad} ${llPad} ${brPad} ${t1Pad} ${t3Pad} ${t5Pad} ${t10Pad} ${dLLPad} ${eligPad}`);
  };

  printMetricRow(report.championBaseline);
  for (const id of report.rankedEnginesByLogLoss) {
    printMetricRow(report.engineMetrics[id]);
  }
  console.log('---------------------------------------------------------------------------------------------------------\n');

  // Verify Champion Baseline
  assert(
    report.championBaseline.modelId === 'ALL_TIME_FREQUENCY_V1',
    '3a. ALL_TIME_FREQUENCY_V1 established as baseline benchmark champion.'
  );
  assert(
    report.championBaseline.totalEvaluations === report.evaluationWindow.totalEvents,
    '3b. Champion evaluated on all walk-forward events.'
  );

  // Verify All 6 Engines Evaluated
  assert(
    report.rankedEnginesByLogLoss.length === 6,
    '3c. Exactly 6 new relationship engines evaluated and ranked.'
  );

  for (const id of report.rankedEnginesByLogLoss) {
    const m = report.engineMetrics[id];
    assert(m.totalEvaluations === report.evaluationWindow.totalEvents, `${id}: Total evaluations match window count.`);
    assert(m.avgLogLoss > 0 && isFinite(m.avgLogLoss), `${id}: Finite average Log Loss.`);
    assert(m.avgBrierScore > 0 && isFinite(m.avgBrierScore), `${id}: Finite average Brier Score.`);
  }

  // Session Breakdown Integrity
  const simCond = report.engineMetrics.SIMILAR_CONDITIONS_RELATIONSHIP_V1;
  assert(simCond.sessionBreakdown.AM.evaluations === report.evaluationWindow.amEvents, 'AM evaluation count matches.');
  assert(simCond.sessionBreakdown.PM.evaluations === report.evaluationWindow.pmEvents, 'PM evaluation count matches.');

  // Production Champion Isolation
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    '3d. Production champion remains strictly frozen as ALL_TIME_FREQUENCY_V1.'
  );

  console.log('\n================================================================');
  console.log(`  STEP 30 BENCHMARK SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');

  console.log('Eligible engines for next Auto-Weighting stage:');
  for (const el of report.eligibleEnginesForAutoWeighting) {
    console.log(`  - ${el}: ${report.engineMetrics[el].eligibilityRationale}`);
  }

  console.log('\nIneligible engines:');
  for (const inel of report.ineligibleEnginesForAutoWeighting) {
    console.log(`  - ${inel}: ${report.engineMetrics[inel].eligibilityRationale}`);
  }
}

runStep30SetValueLabTests().catch((err) => {
  console.error('\n❌ STEP 30 TESTS FAILED:', err);
  process.exit(1);
});
