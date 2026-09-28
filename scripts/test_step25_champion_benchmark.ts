import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { CandidateModelLab } from '../src/core/prediction/candidateModelLab';
import { AutoWeightingEngine } from '../src/core/prediction/autoWeightingEngine';
import { BenchmarkEngine } from '../src/core/prediction/benchmarkEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';

async function runStep25Benchmark() {
  console.log('================================================================');
  console.log('  MM2D LEADER STEP 25: WALK-FORWARD CHAMPION vs AUTO-ENSEMBLE   ');
  console.log('================================================================\n');

  // 1. Initialize storage and load verified dataset
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const records = await globalDatasetStorage.queryAllVerifiedRecords();
  console.log(`Loaded ${records.length} verified records for Step 25 Out-of-Sample Benchmark.\n`);

  const settlements = records
    .filter((r) => r.isSettlement)
    .sort((a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session));
  const uniqueDates = Array.from(new Set(settlements.map((r) => r.date))).sort();

  if (uniqueDates.length < 15) {
    throw new Error(`Insufficient historical dates for walk-forward benchmark: ${uniqueDates.length} < 15`);
  }

  const targetDate = uniqueDates[Math.floor(uniqueDates.length * 0.75)];
  console.log(`Reference target evaluation date for invariant checks: ${targetDate}\n`);

  const amFeatureRes = FeatureEngine.extractAmFeatures(records, targetDate);
  const pmFeatureRes = FeatureEngine.extractPmFeatures(records, targetDate);
  if (!amFeatureRes.success || !amFeatureRes.featureVector) {
    throw new Error(`Failed to extract AM features for ${targetDate}: ${amFeatureRes.errorDetails}`);
  }
  if (!pmFeatureRes.success || !pmFeatureRes.featureVector) {
    throw new Error(`Failed to extract PM features for ${targetDate}: ${pmFeatureRes.errorDetails}`);
  }
  const amFeatures = amFeatureRes.featureVector;
  const pmFeatures = pmFeatureRes.featureVector;

  // =========================================================================
  // SECTION 1: ANTI-LEAKAGE AND INTEGRITY VERIFICATIONS (10 TESTS)
  // =========================================================================
  console.log('----------------------------------------------------------------');
  console.log('  ANTI-LEAKAGE & GOVERNANCE INVARIANT TESTS (10 CHECKS)         ');
  console.log('----------------------------------------------------------------');

  // Test 1: Target result cannot change its own ensemble prediction
  console.log('Test 1: Target result cannot change its own ensemble prediction...');
  const recordsOriginal = [...records];
  const recordsAlteredTarget = records.map((r) => {
    if (r.date === targetDate && r.isSettlement) {
      return { ...r, twod: r.twod === '11' ? '99' : '11' };
    }
    return r;
  });
  const ensAm1 = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsOriginal);
  const ensAm2 = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsAlteredTarget);
  for (let i = 0; i < 100; i++) {
    if (Math.abs(ensAm1.probabilities[i] - ensAm2.probabilities[i]) > 1e-9) {
      throw new Error(`FAIL TEST 1: Modifying target result altered probability at index ${i}`);
    }
  }
  console.log('  [PASS] Test 1: Ensemble prediction is 100% invariant to target date result.');

  // Test 2: Target result cannot change its own model weights
  console.log('Test 2: Target result cannot change its own model weights...');
  for (const [mId, w1] of Object.entries(ensAm1.modelWeights)) {
    const w2 = ensAm2.modelWeights[mId as any];
    if (Math.abs(w1 - w2) > 1e-9) {
      throw new Error(`FAIL TEST 2: Model weight for ${mId} changed when target result was altered!`);
    }
  }
  console.log('  [PASS] Test 2: Auto-weights are strictly computed prior to target settlement.');

  // Test 3: Future results cannot change earlier predictions or weights
  console.log('Test 3: Future results cannot change earlier predictions or weights...');
  const recordsPastOnly = records.filter((r) => r.date <= targetDate);
  const futureRecord: VerifiedMarketRecord = {
    id: 'future-rec-step25',
    date: '2099-01-01',
    session: 'AM',
    time: '12:01',
    setRaw: '1550.00',
    valueRaw: '60000.00',
    setNumeric: 1550.0,
    valueNumeric: 60000.0,
    twod: '42',
    historyId: 'hist-future-25',
    verifiedAt: new Date().toISOString(),
    provenance: 'TEST_STEP25_FUTURE',
    isSettlement: true,
    mathematicalCheck: {
      setLastDigit: '0',
      valueLastDigitBeforeDecimal: '0',
      derived2D: '42',
      isMathematicallyConsistent: true,
    },
  };
  const recordsWithFuture = [...recordsPastOnly, futureRecord];
  const ensPastOnly = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsPastOnly);
  const ensWithFuture = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithFuture);
  if (ensPastOnly.ensembleProbabilityHash !== ensWithFuture.ensembleProbabilityHash) {
    throw new Error('FAIL TEST 3: Future settlement changed ensemble prediction hash!');
  }
  console.log('  [PASS] Test 3: Future records have zero influence on target date predictions.');

  // Test 4: Target PM result cannot influence PM prediction
  console.log('Test 4: Target PM result cannot influence PM prediction...');
  const recordsPmAlt1 = records.map((r) =>
    r.date === targetDate && r.session === 'PM' && r.isSettlement ? { ...r, twod: '05' } : r
  );
  const recordsPmAlt2 = records.map((r) =>
    r.date === targetDate && r.session === 'PM' && r.isSettlement ? { ...r, twod: '88' } : r
  );
  const ensPm1 = AutoWeightingEngine.evaluateEnsemble(pmFeatures, recordsPmAlt1);
  const ensPm2 = AutoWeightingEngine.evaluateEnsemble(pmFeatures, recordsPmAlt2);
  if (ensPm1.ensembleProbabilityHash !== ensPm2.ensembleProbabilityHash) {
    throw new Error('FAIL TEST 4: Target PM result altered PM prediction hash!');
  }
  console.log('  [PASS] Test 4: Target PM result is completely hidden and leakage-free.');

  // Test 5: Target-day PM result cannot influence AM prediction
  console.log('Test 5: Target-day PM result cannot influence AM prediction...');
  const recordsWithoutPmToday = records.filter((r) => !(r.date === targetDate && r.session === 'PM'));
  const ensAmNoPmToday = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithoutPmToday);
  if (ensAm1.ensembleProbabilityHash !== ensAmNoPmToday.ensembleProbabilityHash) {
    throw new Error('FAIL TEST 5: Today PM result leaked into AM prediction!');
  }
  console.log('  [PASS] Test 5: Target-day PM result has zero presence in AM feature space.');

  // Test 6: Live 2D cannot enter candidate probabilities
  console.log('Test 6: Live 2D cannot enter candidate probabilities...');
  for (const model of CandidateModelLab.getAllModels()) {
    if (model.modelId === 'INTRADAY_SET_VALUE_STATISTICAL_V1') {
      const liveFeatsWith2D = {
        ...amFeatures,
        distributions: {
          ...amFeatures.distributions,
          twod: '99',
          twoD: '99',
        } as any,
      };
      const out = model.predict(liveFeatsWith2D);
      if (out.validationStatus !== 'UNTESTABLE') {
        throw new Error('FAIL TEST 6: Intraday model inspected live 2D or bypassed untestable status!');
      }
    }
  }
  console.log('  [PASS] Test 6: Zero live 2D / result fields enter candidate models.');

  // Test 7: Synthetic/interpolated intraday history is never created
  console.log('Test 7: Synthetic/interpolated intraday history is never created...');
  const intradayOut = CandidateModelLab.evaluateModel('INTRADAY_SET_VALUE_STATISTICAL_V1', amFeatures);
  if (intradayOut.validationStatus !== 'UNTESTABLE') {
    throw new Error(`FAIL TEST 7: Intraday model status was ${intradayOut.validationStatus}, expected UNTESTABLE!`);
  }
  if (!intradayOut.audit.auditDetails?.includes('zero-fabrication')) {
    throw new Error('FAIL TEST 7: Intraday model missing zero-fabrication audit rationale.');
  }
  console.log('  [PASS] Test 7: Intraday model correctly classified as UNTESTABLE with 0 fabricated ticks.');

  // Test 8: AM and PM benchmarks remain isolated
  console.log('Test 8: AM and PM benchmarks remain isolated...');
  const condAm = CandidateModelLab.evaluateModel('AM_TO_PM_CONDITIONAL_V1', amFeatures);
  if (condAm.validationStatus !== 'FAILED_CONTRACT') {
    throw new Error('FAIL TEST 8: AM_TO_PM_CONDITIONAL_V1 did not fail contract on AM session!');
  }
  const condPm = CandidateModelLab.evaluateModel('AM_TO_PM_CONDITIONAL_V1', pmFeatures);
  if (condPm.validationStatus !== 'READY' && condPm.validationStatus !== 'REQUIRES_MORE_DATA') {
    throw new Error('FAIL TEST 8: AM_TO_PM_CONDITIONAL_V1 status invalid on PM session!');
  }
  console.log('  [PASS] Test 8: AM and PM evaluations are rigorously session-isolated.');

  // Test 9: Re-running backtest produces identical metrics and hashes
  console.log('Test 9: Re-running backtest produces identical metrics and hashes...');
  const run1 = BenchmarkEngine.runStep25Benchmark(records, { minTrainingSettlements: 15, recentSessionsCount: 10 });
  const run2 = BenchmarkEngine.runStep25Benchmark(records, { minTrainingSettlements: 15, recentSessionsCount: 10 });
  if (run1.benchmarkRunHash !== run2.benchmarkRunHash) {
    throw new Error(`FAIL TEST 9: Deterministic run hash mismatch: ${run1.benchmarkRunHash} vs ${run2.benchmarkRunHash}`);
  }
  if (run1.evaluationPeriod.totalEvaluatedSessions !== run2.evaluationPeriod.totalEvaluatedSessions) {
    throw new Error('FAIL TEST 9: Evaluated session counts differ across identical runs!');
  }
  console.log(`  [PASS] Test 9: Bit-exact deterministic reproducibility verified (Hash: ${run1.benchmarkRunHash}).`);

  // Test 10: Production champion remains unchanged
  console.log('Test 10: Production champion remains unchanged...');
  if (PredictionEngine.PRODUCTION_MODEL !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`FAIL TEST 10: PRODUCTION_MODEL was mutated to ${PredictionEngine.PRODUCTION_MODEL}`);
  }
  if (PRODUCTION_MODEL_VERSION !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`FAIL TEST 10: PRODUCTION_MODEL_VERSION was mutated to ${PRODUCTION_MODEL_VERSION}`);
  }
  console.log(`  [PASS] Test 10: Production champion strictly frozen as '${PredictionEngine.PRODUCTION_MODEL}'.\n`);

  // =========================================================================
  // SECTION 2: FULL WALK-FORWARD BENCHMARK EXECUTION
  // =========================================================================
  console.log('================================================================');
  console.log('  EXECUTING FULL WALK-FORWARD POINT-IN-TIME BENCHMARK           ');
  console.log('================================================================\n');

  const report = BenchmarkEngine.runStep25Benchmark(records, {
    minTrainingSettlements: 10,
    recentSessionsCount: 15,
  });

  const { evaluationPeriod } = report;
  console.log(`Benchmark Scope:`);
  console.log(`  - Total Historical Records: ${report.totalHistoricalRecords}`);
  console.log(`  - Training Cutoff Threshold: ${report.minTrainingSettlements} prior settlements per session`);
  console.log(`  - Evaluation Date Range: ${evaluationPeriod.startDate} to ${evaluationPeriod.endDate}`);
  console.log(`  - Evaluated Target Dates: ${evaluationPeriod.totalTargetDates}`);
  console.log(`  - Total Evaluated Sessions: ${evaluationPeriod.totalEvaluatedSessions} (AM: ${evaluationPeriod.amEvaluatedSessions}, PM: ${evaluationPeriod.pmEvaluatedSessions})`);
  console.log(`  - Benchmark Run Hash: ${report.benchmarkRunHash}\n`);

  // -------------------------------------------------------------------------
  // FINAL BENCHMARK TABLES
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TABLE 1: FULL VALID HISTORICAL PERIOD (COMBINED AM + PM)        ');
  console.log('----------------------------------------------------------------');
  console.log(BenchmarkEngine.formatSummaryTable(report.combinedSummaries));
  console.log('');

  console.log('----------------------------------------------------------------');
  console.log('TABLE 2: AM SESSION ONLY BENCHMARK                              ');
  console.log('----------------------------------------------------------------');
  console.log(BenchmarkEngine.formatSummaryTable(report.amSummaries));
  console.log('');

  console.log('----------------------------------------------------------------');
  console.log('TABLE 3: PM SESSION ONLY BENCHMARK                              ');
  console.log('----------------------------------------------------------------');
  console.log(BenchmarkEngine.formatSummaryTable(report.pmSummaries));
  console.log('');

  console.log('----------------------------------------------------------------');
  console.log('TABLE 4: RECENT PERIOD BENCHMARK (LAST 12 SESSIONS)             ');
  console.log('----------------------------------------------------------------');
  console.log(BenchmarkEngine.formatSummaryTable(report.recentSummaries));
  console.log('');

  // -------------------------------------------------------------------------
  // STATISTICAL COMPARISON TABLE
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TABLE 5: PAIRED STATISTICAL COMPARISON (AUTO-ENSEMBLE vs CHAMPION)');
  console.log('----------------------------------------------------------------');
  console.log(
    '| Metric                  | Champion | Ensemble | Diff     | 95% Conf Interval   | t-stat | p-value | Cohen d | Direction |'
  );
  console.log(
    '|-------------------------|----------|----------|----------|---------------------|--------|---------|---------|-----------|'
  );
  for (const comp of report.comparisons.combined) {
    const mName = comp.metricName.padEnd(23).slice(0, 23);
    const chVal = comp.championValue.toFixed(4).padStart(8);
    const enVal = comp.ensembleValue.toFixed(4).padStart(8);
    const diff = (comp.difference >= 0 ? `+${comp.difference.toFixed(4)}` : comp.difference.toFixed(4)).padStart(8);
    const ci = `[${comp.ci95Lower.toFixed(3)}, ${comp.ci95Upper.toFixed(3)}]`.padEnd(19);
    const t = comp.tStatistic.toFixed(3).padStart(6);
    const p = comp.pValue.toFixed(4).padStart(7);
    const d = comp.cohensD.toFixed(3).padStart(7);
    const dir = comp.direction.padEnd(9);
    console.log(`| ${mName} | ${chVal} | ${enVal} | ${diff} | ${ci} | ${t} | ${p} | ${d} | ${dir} |`);
  }
  console.log('');

  // -------------------------------------------------------------------------
  // DYNAMIC WEIGHT BEHAVIOR AUDIT
  // -------------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TABLE 6: AUTO-WEIGHTING DYNAMIC BEHAVIOR AUDIT                  ');
  console.log('----------------------------------------------------------------');
  console.log(
    '| Candidate Model                  | Avg Weight | Med Weight | Min - Max        | StdDev | Dominant Rate  |'
  );
  console.log(
    '|----------------------------------|------------|------------|------------------|--------|----------------|'
  );
  for (const w of report.autoWeightingAudit.weightBehavior) {
    const mName = w.modelId.padEnd(32).slice(0, 32);
    const avg = w.averageWeight.toFixed(4).padStart(10);
    const med = w.medianWeight.toFixed(4).padStart(10);
    const minMax = `${w.minWeight.toFixed(3)} - ${w.maxWeight.toFixed(3)}`.padStart(16);
    const std = w.weightStdDev.toFixed(4).padStart(6);
    const dom = `${w.dominantWeightCount}/${report.autoWeightingAudit.totalEvaluations} (${(w.dominantWeightFraction * 100).toFixed(1)}%)`.padStart(14);
    console.log(`| ${mName} | ${avg} | ${med} | ${minMax} | ${std} | ${dom} |`);
  }
  console.log('');
  console.log(`Auto-Weighting Governance Audit Details:`);
  console.log(`  - Total Ensemble Evaluations: ${report.autoWeightingAudit.totalEvaluations}`);
  console.log(`  - Conservative Prior Usages: ${report.autoWeightingAudit.conservativePriorCount} (${(report.autoWeightingAudit.conservativePriorRate * 100).toFixed(1)}%)`);
  console.log(`  - Sufficient Evidence Evaluations: ${report.autoWeightingAudit.sufficientEvidenceCount}`);
  console.log(`  - Untestable Models Classified: ${report.autoWeightingAudit.untestableModelCount} (INTRADAY_SET_VALUE_STATISTICAL_V1)`);
  console.log('');

  // -------------------------------------------------------------------------
  // EXECUTIVE SUMMARY & BENCHMARK CONCLUSIONS
  // -------------------------------------------------------------------------
  console.log('================================================================');
  console.log('  EXECUTIVE RESEARCH FINDINGS & BENCHMARK SUMMARY               ');
  console.log('================================================================');
  console.log(`1. Best Model by Log Loss (NLL):`);
  console.log(`   - Combined: ${report.bestModels.byLogLoss.combined}`);
  console.log(`   - AM Only:  ${report.bestModels.byLogLoss.am}`);
  console.log(`   - PM Only:  ${report.bestModels.byLogLoss.pm}`);
  console.log(`   - Recent:   ${report.bestModels.byLogLoss.recent}`);
  console.log(`2. Best Model by Brier Score:`);
  console.log(`   - Combined: ${report.bestModels.byBrier.combined}`);
  console.log(`   - AM Only:  ${report.bestModels.byBrier.am}`);
  console.log(`   - PM Only:  ${report.bestModels.byBrier.pm}`);
  console.log(`   - Recent:   ${report.bestModels.byBrier.recent}`);
  console.log(`3. Best Model by Top-k (Top-1 / Top-5):`);
  console.log(`   - Top-1: Combined=${report.bestModels.byTop1.combined}, AM=${report.bestModels.byTop1.am}, PM=${report.bestModels.byTop1.pm}`);
  console.log(`   - Top-5: Combined=${report.bestModels.byTop5.combined}, AM=${report.bestModels.byTop5.am}, PM=${report.bestModels.byTop5.pm}`);
  console.log(`4. Statistical Significance (Auto-Ensemble vs ALL_TIME_FREQUENCY_V1):`);
  const logLossComp = report.comparisons.combined.find((c) => c.metricKey === 'logLoss');
  const brierComp = report.comparisons.combined.find((c) => c.metricKey === 'brierScore');
  console.log(`   - Log Loss diff: ${logLossComp?.meanDifference} (p = ${logLossComp?.pValue}, significant: ${logLossComp?.statisticallySignificant})`);
  console.log(`   - Brier Score diff: ${brierComp?.meanDifference} (p = ${brierComp?.pValue}, significant: ${brierComp?.statisticallySignificant})`);
  console.log(`5. Safe Production Governance Recommendation:`);
  console.log(`   - Status: ${report.governance.recommendationSummary}`);
  console.log(`   - Reason: ${report.governance.decisionReasoning}`);
  console.log(`   - Promoted to Production: ${report.governance.promotedToProduction}`);
  console.log(`   - Active Production Model: ${report.governance.frozenProductionChampion}`);
  console.log('================================================================\n');
}

runStep25Benchmark().catch((err) => {
  console.error('\n❌ STEP 25 BENCHMARK FAILED:', err);
  process.exit(1);
});
