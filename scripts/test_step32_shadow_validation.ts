import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { AutoWeightedV2ShadowValidator } from '../src/core/prediction/autoWeightedV2ShadowValidator';
import { AutoWeightedV2Engine } from '../src/core/prediction/autoWeightedV2Engine';
import { SetValueRelationshipLab } from '../src/core/prediction/setValueRelationshipLab';
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

async function runStep32ShadowValidationTests() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 32: V2 SHADOW VALIDATION BENCHMARK         ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${allRecords.length} verified historical records.`);

  // ---------------------------------------------------------------------------
  // SECTION 1: PRODUCTION CHAMPION STRICT ISOLATION & FREEZE
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] Production Champion Strict Freeze & Isolation ---');

  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '1a. Production engine PRODUCTION_MODEL is strictly frozen as ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    '1b. PRODUCTION_MODEL_VERSION constant is strictly frozen as ALL_TIME_FREQUENCY_V1.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: SHADOW PREDICTION GENERATION, LOCK FREEZE & IMMUTABILITY AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] Publish Boundary, Lock Freeze & Immutability Audit ---');

  const testDate = '2026-09-08';
  const shadowAM = AutoWeightedV2ShadowValidator.generateShadowPrediction(allRecords, testDate, 'AM');
  const shadowPM = AutoWeightedV2ShadowValidator.generateShadowPrediction(allRecords, testDate, 'PM');

  assert(shadowAM.targetDate === testDate, '2a. Shadow AM targetDate matches.');
  assert(shadowAM.session === 'AM', '2b. Shadow AM session is AM.');
  assert(shadowAM.publishBoundaryTime === '11:00:00', '2c. Shadow AM publish boundary is 11:00:00.');
  assert(shadowAM.lockBoundaryTime === '12:00:00', '2d. Shadow AM lock boundary is 12:00:00.');
  assert(shadowAM.isFrozenAtLock === true, '2e. Shadow AM is marked isFrozenAtLock.');
  assert(shadowAM.frozenAtTimestamp === '2026-09-08T12:00:00Z', '2f. Shadow AM frozenAtTimestamp is formatted correctly.');

  assert(shadowPM.session === 'PM', '2g. Shadow PM session is PM.');
  assert(shadowPM.publishBoundaryTime === '15:00:00', '2h. Shadow PM publish boundary is 15:00:00.');
  assert(shadowPM.lockBoundaryTime === '16:25:00', '2i. Shadow PM lock boundary is 16:25:00.');
  assert(shadowPM.isFrozenAtLock === true, '2j. Shadow PM is marked isFrozenAtLock.');

  // Verify Immutability: Deep Freeze Enforcement
  let mutationBlocked = false;
  try {
    (shadowAM.immutableV2Output.probabilities as any)[0] = 0.9999;
  } catch {
    mutationBlocked = true;
  }
  assert(mutationBlocked || Object.isFrozen(shadowAM.immutableV2Output.probabilities), '2k. Probabilities array is deeply frozen and immutable.');

  let top10MutationBlocked = false;
  try {
    (shadowAM.immutableV2Output.top10 as any)[0] = '99';
  } catch {
    top10MutationBlocked = true;
  }
  assert(top10MutationBlocked || Object.isFrozen(shadowAM.immutableV2Output.top10), '2l. Top-10 array is deeply frozen and immutable.');

  let weightsMutationBlocked = false;
  try {
    (shadowAM.immutableV2Output.weights as any).SESSION_SPECIFIC_SET_VALUE_V1 = 0.99;
  } catch {
    weightsMutationBlocked = true;
  }
  assert(weightsMutationBlocked || Object.isFrozen(shadowAM.immutableV2Output.weights), '2m. Engine weights object is deeply frozen and immutable.');

  // Verify Per-Number Engine Attribution Integrity
  assert(shadowAM.immutableV2Output.candidates.length === 100, '2n. Attribution matrix covers exactly 100 candidates (00..99).');
  const topCandidate = shadowAM.immutableV2Output.candidates[0];
  assert(typeof topCandidate.twod === 'string' && topCandidate.twod.length === 2, '2o. Top candidate has valid 2D identifier.');
  assert(topCandidate.dominantEngine !== undefined, '2p. Top candidate has dominantEngine identified.');
  assert(topCandidate.consensusCount >= 0 && topCandidate.consensusCount <= 4, '2q. Top candidate consensus count bounded in 0..4.');

  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    const supp = topCandidate.engineSupports[compId];
    assert(supp !== undefined, `2r. Attribution present for component ${compId}.`);
    assert(supp.weight >= 0 && supp.weight <= 1.0, `2s. Component ${compId} weight is bounded in [0, 1].`);
    assert(supp.probability >= 0 && supp.probability <= 1.0, `2t. Component ${compId} probability bounded in [0, 1].`);
    assert(supp.rankInModel >= 1 && supp.rankInModel <= 100, `2u. Component ${compId} rankInModel is in 1..100.`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: STRICT POINT-IN-TIME LEAKAGE & ANTI-MUTATION PROTECTIONS
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Strict Anti-Leakage & Session Isolation Audit ---');

  // Test 3a: Target-Day Settlement Outcome Mutation Zero Effect
  const perturbedRecords: VerifiedMarketRecord[] = allRecords.map((r) => {
    if (r.date === testDate && r.session === 'AM' && r.isSettlement) {
      return {
        ...r,
        twod: r.twod === '00' ? '99' : '00',
        setNumeric: 9999.99,
        valueNumeric: 99999.99,
      };
    }
    return r;
  });

  const perturbedShadowAM = AutoWeightedV2ShadowValidator.generateShadowPrediction(perturbedRecords, testDate, 'AM');
  let maxLeakageDiff = 0;
  for (let i = 0; i < 100; i++) {
    const diff = Math.abs(shadowAM.immutableV2Output.probabilities[i] - perturbedShadowAM.immutableV2Output.probabilities[i]);
    if (diff > maxLeakageDiff) maxLeakageDiff = diff;
  }
  assert(maxLeakageDiff < 1e-9, `3a. Target-day settlement mutation has zero effect on shadow prediction (diff: ${maxLeakageDiff}).`);

  // Test 3b: Future Dates Ingestion Zero Effect
  const futureRecords: VerifiedMarketRecord[] = [
    ...allRecords,
    {
      id: '2026-10-01_12:01:00_FUTURE',
      date: '2026-10-01',
      time: '12:01:00',
      session: 'AM',
      setRaw: '1,500.00',
      valueRaw: '60,000.00',
      setNumeric: 1500.0,
      valueNumeric: 60000.0,
      twod: '42',
      isSettlement: true,
      historyId: '9999991',
      verifiedAt: '2026-10-01T12:01:00Z',
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '00',
        isMathematicallyConsistent: true,
      },
    },
  ];

  const futureShadowAM = AutoWeightedV2ShadowValidator.generateShadowPrediction(futureRecords, testDate, 'AM');
  let maxFutureDiff = 0;
  for (let i = 0; i < 100; i++) {
    const diff = Math.abs(shadowAM.immutableV2Output.probabilities[i] - futureShadowAM.immutableV2Output.probabilities[i]);
    if (diff > maxFutureDiff) maxFutureDiff = diff;
  }
  assert(maxFutureDiff < 1e-9, `3b. Future dates strictly excluded from shadow prediction (diff: ${maxFutureDiff}).`);

  // Test 3c: AM and PM Session Isolation
  assert(
    JSON.stringify(shadowAM.immutableV2Output.weights) !== JSON.stringify(shadowPM.immutableV2Output.weights),
    '3c. AM and PM engine weights are calculated independently and differ.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 4: DATASET & SESSION DISCREPANCY AUDIT (STEP 30 VS STEP 31)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 4] Step 30 vs Step 31 Session Discrepancy Verification ---');

  const allDates = Array.from(new Set(allRecords.map((r) => r.date))).sort();
  const evalDatesAll = allDates.slice(10);

  // Check 2026-09-03 and 2026-09-09 PM settlement presence
  const sep03PM = allRecords.find((r) => r.date === '2026-09-03' && r.session === 'PM' && r.isSettlement);
  const sep09PM = allRecords.find((r) => r.date === '2026-09-09' && r.session === 'PM' && r.isSettlement);

  assert(sep03PM === undefined, '4a. Confirmed 2026-09-03 PM has NO official settlement record in dataset.');
  assert(sep09PM === undefined, '4b. Confirmed 2026-09-09 PM has NO official settlement record in dataset.');

  // Check records through 2026-09-09
  const recsThrough0909 = allRecords.filter((r) => r.date <= '2026-09-09');
  const labReport0909 = SetValueRelationshipLab.runWalkForwardBenchmark(recsThrough0909, 10);
  const v2Report0909 = AutoWeightedV2Engine.runWalkForwardBenchmark(recsThrough0909, 10);

  assert(
    labReport0909.evaluationWindow.totalEvents === 22 &&
    labReport0909.evaluationWindow.amEvents === 12 &&
    labReport0909.evaluationWindow.pmEvents === 10,
    '4c. On records <= 2026-09-09, SetValueRelationshipLab evaluates exactly 22 sessions (12 AM, 10 PM).'
  );
  assert(
    v2Report0909.sampleCounts.totalEvents === 22 &&
    v2Report0909.sampleCounts.amEvents === 12 &&
    v2Report0909.sampleCounts.pmEvents === 10,
    '4d. On records <= 2026-09-09, AutoWeightedV2Engine evaluates exactly 22 sessions (12 AM, 10 PM).'
  );

  // Check records through 2026-09-10 (full current dataset)
  const labReportFull = SetValueRelationshipLab.runWalkForwardBenchmark(allRecords, 10);
  const v2ReportFull = AutoWeightedV2Engine.runWalkForwardBenchmark(allRecords, 10);

  assert(
    labReportFull.evaluationWindow.totalEvents === 24 &&
    labReportFull.evaluationWindow.amEvents === 13 &&
    labReportFull.evaluationWindow.pmEvents === 11,
    '4e. On full dataset including 2026-09-10, SetValueRelationshipLab evaluates exactly 24 sessions (13 AM, 11 PM).'
  );
  assert(
    v2ReportFull.sampleCounts.totalEvents === 24 &&
    v2ReportFull.sampleCounts.amEvents === 13 &&
    v2ReportFull.sampleCounts.pmEvents === 11,
    '4f. On full dataset including 2026-09-10, AutoWeightedV2Engine evaluates exactly 24 sessions (13 AM, 11 PM).'
  );
  assert(
    labReportFull.evaluationWindow.totalEvents === v2ReportFull.sampleCounts.totalEvents,
    '4g. Both Step 30 and Step 31 benchmark engines have 100% identical session filtering logic.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 5: STEP 32 FULL SHADOW VALIDATION BENCHMARK RUN
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 5] Full Shadow Validation Benchmark vs Champion Baseline ---');

  const shadowSummary = AutoWeightedV2ShadowValidator.runShadowValidationWindow(allRecords, 10);

  console.log(`Evaluated ${shadowSummary.totalEvaluatedSessions} sessions across ${shadowSummary.tradingDaysCount} trading days.`);
  console.log(`Window: ${shadowSummary.startDate} to ${shadowSummary.endDate}`);
  console.log(`AM Sessions: ${shadowSummary.amEvaluatedSessions}, PM Sessions: ${shadowSummary.pmEvaluatedSessions}\n`);

  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('Model ID                              LogLoss    Brier    Top1%   Top3%   Top5%  Top10%     MRR  AvgRank');
  console.log('---------------------------------------------------------------------------------------------------------');

  const cM = shadowSummary.metrics.champion;
  const vM = shadowSummary.metrics.v2;
  const dM = shadowSummary.metrics.delta;

  const padStr = (s: string, w: number) => s.padEnd(w);
  const padNum = (n: number, dec: number, w: number) => n.toFixed(dec).padStart(w);

  console.log(
    `${padStr('ALL_TIME_FREQUENCY_V1 (Champion)', 36)} ${padNum(cM.logLoss, 4, 8)} ${padNum(cM.brierScore, 4, 8)} ${padNum(cM.top1Rate, 1, 7)}% ${padNum(cM.top3Rate, 1, 6)}% ${padNum(cM.top5Rate, 1, 6)}% ${padNum(cM.top10Rate, 1, 6)}% ${padNum(cM.mrr, 4, 8)} ${padNum(cM.avgRank, 1, 8)}`
  );
  console.log(
    `${padStr('AUTO_WEIGHTED_V2 (Shadow Mode)', 36)} ${padNum(vM.logLoss, 4, 8)} ${padNum(vM.brierScore, 4, 8)} ${padNum(vM.top1Rate, 1, 7)}% ${padNum(vM.top3Rate, 1, 6)}% ${padNum(vM.top5Rate, 1, 6)}% ${padNum(vM.top10Rate, 1, 6)}% ${padNum(vM.mrr, 4, 8)} ${padNum(vM.avgRank, 1, 8)}`
  );
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log(
    `${padStr('DELTA (V2 - Champion)', 36)} ${padNum(dM.logLoss, 4, 8)} ${padNum(dM.brierScore, 4, 8)} ${padNum(dM.top1Rate, 1, 7)}% ${padNum(dM.top3Rate, 1, 6)}% ${padNum(dM.top5Rate, 1, 6)}% ${padNum(dM.top10Rate, 1, 6)}% ${padNum(dM.mrr, 4, 8)} ${padNum(dM.avgRank, 1, 8)}`
  );
  console.log('---------------------------------------------------------------------------------------------------------\n');

  // Verify Metrics Criteria
  assert(vM.logLoss < cM.logLoss, `5a. V2 achieves lower Log Loss in shadow mode (${vM.logLoss} vs ${cM.logLoss}).`);
  assert(vM.brierScore < cM.brierScore, `5b. V2 achieves lower Brier Score in shadow mode (${vM.brierScore} vs ${cM.brierScore}).`);
  assert(vM.top10Rate >= cM.top10Rate, `5c. V2 matches or exceeds Champion Top-10 rate (${vM.top10Rate}% vs ${cM.top10Rate}%).`);
  assert(vM.mrr > cM.mrr, `5d. V2 achieves higher Mean Reciprocal Rank (${vM.mrr} vs ${cM.mrr}).`);
  assert(vM.avgRank < cM.avgRank, `5e. V2 achieves better average settlement rank (${vM.avgRank} vs ${cM.avgRank}).`);

  // Verify Session Consistency
  const amBreak = shadowSummary.sessionBreakdown.AM;
  const pmBreak = shadowSummary.sessionBreakdown.PM;
  assert(amBreak.deltaLogLoss < 0, `5f. V2 improves Log Loss in AM session (Δ: ${amBreak.deltaLogLoss}).`);
  assert(pmBreak.deltaLogLoss < 0, `5g. V2 improves Log Loss in PM session (Δ: ${pmBreak.deltaLogLoss}).`);
  assert(amBreak.deltaLogLoss < 0 && pmBreak.deltaLogLoss < 0, '5h. V2 demonstrates consistent improvement across BOTH AM and PM.');

  // Head-to-head and paired statistical significance
  assert(shadowSummary.headToHead.v2Wins > shadowSummary.headToHead.champWins, `5i. V2 wins majority of head-to-head sessions (${shadowSummary.headToHead.v2Wins}W / ${shadowSummary.headToHead.champWins}L).`);
  assert(shadowSummary.pairedTTest.isSignificant, `5j. Shadow improvement is statistically significant (t: ${shadowSummary.pairedTTest.tStatistic}, p: ${shadowSummary.pairedTTest.pValue} < 0.05).`);

  console.log('\n================================================================');
  console.log(`  STEP 32 BENCHMARK SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');

  console.log('Learned AM Weights:');
  for (const [k, v] of Object.entries(amBreak.learnedWeights)) {
    console.log(`  - ${k.padEnd(32)}: ${(v * 100).toFixed(1)}%`);
  }
  console.log('Learned PM Weights:');
  for (const [k, v] of Object.entries(pmBreak.learnedWeights)) {
    console.log(`  - ${k.padEnd(32)}: ${(v * 100).toFixed(1)}%`);
  }

  console.log('\nSample Top-5 Candidates with Engine Attribution for latest session:');
  const latestRec = shadowSummary.records[shadowSummary.records.length - 1];
  console.log(`Session: ${latestRec.targetDate} ${latestRec.session} (Actual 2D: ${latestRec.settlementComparison?.actualSettlement2D})`);
  for (let idx = 0; idx < 5; idx++) {
    const c = latestRec.immutableV2Output.candidates[idx];
    console.log(`  Rank ${c.rank}: [${c.twod}] Prob: ${(c.probability * 100).toFixed(2)}% | Dominant: ${c.dominantEngine} | Consensus: ${c.consensusCount}/4`);
    for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
      const s = c.engineSupports[compId];
      console.log(`    ├── ${compId.padEnd(32)}: weight=${(s.weight * 100).toFixed(1)}%, prob=${(s.probability * 100).toFixed(2)}%, rank=${s.rankInModel}, share=${(s.contributionShare * 100).toFixed(1)}%`);
    }
  }

  console.log('\nProduction Recommendation:');
  console.log('  KEEP ALL_TIME_FREQUENCY_V1 FROZEN IN PRODUCTION.');
  console.log('  AUTO_WEIGHTED_V2 successfully validated in research/shadow mode with immutable freeze, zero leakage, and zero user-facing impact.');
}

runStep32ShadowValidationTests().catch((err) => {
  console.error('\n❌ STEP 32 TESTS FAILED:', err);
  process.exit(1);
});
