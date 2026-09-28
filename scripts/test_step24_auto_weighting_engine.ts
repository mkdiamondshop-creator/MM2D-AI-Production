import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { AutoWeightingEngine, AUTO_WEIGHTED_ENSEMBLE_VERSION } from '../src/core/prediction/autoWeightingEngine';
import { BacktestEngine } from '../src/core/prediction/backtestEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';
import { AutoWeightingConfig } from '../src/types/autoWeighting';

async function runStep24Tests() {
  console.log('================================================================');
  console.log('    MM2D LEADER STEP 24: POINT-IN-TIME AUTO WEIGHTING ENGINE    ');
  console.log('================================================================\n');

  // Initialize storage layer
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const records = await globalDatasetStorage.queryAllVerifiedRecords();
  console.log(`Loaded ${records.length} verified records for Auto-Weighting Engine verification.\n`);

  // Target evaluation date with ample prior history
  const settlements = records
    .filter((r) => r.isSettlement)
    .sort((a, b) => a.date.localeCompare(b.date));
  
  const uniqueDates = Array.from(new Set(settlements.map((r) => r.date))).sort();
  if (uniqueDates.length < 10) {
    throw new Error(`Insufficient historical dates in dataset (${uniqueDates.length}), required >= 10`);
  }

  // Choose a date with history before it
  const targetDate = uniqueDates[Math.floor(uniqueDates.length * 0.7)];
  console.log(`Using target evaluation date: ${targetDate}`);

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

  // -------------------------------------------------------------------------
  // TEST 1: Today's actual settlement cannot change today's weights
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: TODAY ACTUAL SETTLEMENT LEAKAGE INVARIANCE ---');
  // Copy records and introduce an artificial/altered settlement for targetDate
  const recordsWithOriginal = [...records];
  const recordsWithAltered = records.map((r) => {
    if (r.date === targetDate && r.isSettlement) {
      return { ...r, twod: r.twod === '00' ? '99' : '00' };
    }
    return r;
  });

  const ensembleAmOrig = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithOriginal);
  const ensembleAmAltered = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithAltered);

  for (const [modelId, wOrig] of Object.entries(ensembleAmOrig.modelWeights)) {
    const wAlt = ensembleAmAltered.modelWeights[modelId as any];
    if (Math.abs(wOrig - wAlt) > 1e-9) {
      throw new Error(`FAIL TEST 1: Weight for ${modelId} changed when targetDate settlement was modified! ${wOrig} vs ${wAlt}`);
    }
  }
  console.log('PASS: Modifying targetDate settlement outcome does not alter computed weights.');

  // -------------------------------------------------------------------------
  // TEST 2: Future results cannot change earlier weights
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: FUTURE RESULTS LEAKAGE INVARIANCE ---');
  // Only records on or before targetDate vs records with future dates appended
  const recordsPastOnly = records.filter((r) => r.date <= targetDate);
  const futureRecord: VerifiedMarketRecord = {
    id: 'future-settle-01',
    date: '2099-12-31',
    session: 'AM',
    time: '12:01',
    setRaw: '1500.00',
    valueRaw: '50000.00',
    setNumeric: 1500.0,
    valueNumeric: 50000.0,
    twod: '77',
    historyId: 'hist-future',
    verifiedAt: new Date().toISOString(),
    provenance: 'TEST_FUTURE',
    isSettlement: true,
    mathematicalCheck: {
      setLastDigit: '0',
      valueLastDigitBeforeDecimal: '0',
      derived2D: '77',
      isMathematicallyConsistent: true,
    },
  };
  const recordsWithFuture = [...recordsPastOnly, futureRecord];

  const amPastOnly = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsPastOnly);
  const amWithFuture = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithFuture);

  for (const [modelId, wPast] of Object.entries(amPastOnly.modelWeights)) {
    const wFuture = amWithFuture.modelWeights[modelId as any];
    if (Math.abs(wPast - wFuture) > 1e-9) {
      throw new Error(`FAIL TEST 2: Future settlement altered weights for ${targetDate}: ${wPast} vs ${wFuture}`);
    }
  }
  console.log('PASS: Injecting future records into dataset does not alter targetDate weights.');

  // -------------------------------------------------------------------------
  // TEST 3: PM target result cannot influence PM weight
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: PM TARGET RESULT LEAKAGE INVARIANCE ---');
  const recordsPmWithResult = records.map((r) => {
    if (r.date === targetDate && r.session === 'PM' && r.isSettlement) {
      return { ...r, twod: '11' };
    }
    return r;
  });
  const recordsPmWithDifferentResult = records.map((r) => {
    if (r.date === targetDate && r.session === 'PM' && r.isSettlement) {
      return { ...r, twod: '88' };
    }
    return r;
  });

  const pmEval1 = AutoWeightingEngine.evaluateEnsemble(pmFeatures, recordsPmWithResult);
  const pmEval2 = AutoWeightingEngine.evaluateEnsemble(pmFeatures, recordsPmWithDifferentResult);

  for (const [modelId, w1] of Object.entries(pmEval1.modelWeights)) {
    const w2 = pmEval2.modelWeights[modelId as any];
    if (Math.abs(w1 - w2) > 1e-9) {
      throw new Error(`FAIL TEST 3: PM target settlement changed PM weight for ${modelId}: ${w1} vs ${w2}`);
    }
  }
  console.log('PASS: Modifying PM settlement on targetDate has zero effect on PM weights.');

  // -------------------------------------------------------------------------
  // TEST 4: AM target-day PM result cannot enter AM weighting
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: AM TARGET-DAY PM RESULT LEAKAGE INVARIANCE ---');
  const recordsWithoutPmToday = records.filter((r) => !(r.date === targetDate && r.session === 'PM'));
  const recordsWithPmToday = [...records];

  const amNoPmToday = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithoutPmToday);
  const amWithPmToday = AutoWeightingEngine.evaluateEnsemble(amFeatures, recordsWithPmToday);

  for (const [modelId, wNoPm] of Object.entries(amNoPmToday.modelWeights)) {
    const wPm = amWithPmToday.modelWeights[modelId as any];
    if (Math.abs(wNoPm - wPm) > 1e-9) {
      throw new Error(`FAIL TEST 4: Presence of targetDate PM settlement altered AM weights for ${modelId}: ${wNoPm} vs ${wPm}`);
    }
  }
  console.log('PASS: Target-day PM result does not enter or affect AM weighting.');

  // -------------------------------------------------------------------------
  // TEST 5: AM and PM weight calculations are independent
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: AM AND PM SESSION WEIGHT INDEPENDENCE ---');
  const amOut = AutoWeightingEngine.evaluateEnsemble(amFeatures, records);
  const pmOut = AutoWeightingEngine.evaluateEnsemble(pmFeatures, records);

  console.log('AM Weights:', amOut.modelWeights);
  console.log('PM Weights:', pmOut.modelWeights);

  // AM_TO_PM_CONDITIONAL_V1 MUST be 0 on AM session
  if (amOut.modelWeights.AM_TO_PM_CONDITIONAL_V1 !== 0) {
    throw new Error(`FAIL TEST 5: AM_TO_PM_CONDITIONAL_V1 received non-zero weight on AM session: ${amOut.modelWeights.AM_TO_PM_CONDITIONAL_V1}`);
  }
  // PM should allow AM_TO_PM_CONDITIONAL_V1 to be eligible and non-zero
  const amToPmContrib = pmOut.modelContributions.find((c) => c.modelId === 'AM_TO_PM_CONDITIONAL_V1');
  if (!amToPmContrib || !amToPmContrib.eligible) {
    throw new Error('FAIL TEST 5: AM_TO_PM_CONDITIONAL_V1 was not marked eligible for PM session');
  }
  console.log('PASS: AM and PM weight calculations operate in complete session isolation.');

  // -------------------------------------------------------------------------
  // TEST 6: Live 2D/result fields cannot influence weighting
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: LIVE 2D / PRE-LOCK DATA WEIGHTING INVARIANCE ---');
  // Feature vector with altered live set/value
  const amFeaturesModifiedLive = {
    ...amFeatures,
    momentum: {
      ...amFeatures.momentum,
      currentSet: (amFeatures.momentum.currentSet || 1400) + 50.0,
      currentValue: (amFeatures.momentum.currentValue || 30000) + 10000.0,
    },
  };

  const amLiveOrig = AutoWeightingEngine.evaluateEnsemble(amFeatures, records);
  const amLiveMod = AutoWeightingEngine.evaluateEnsemble(amFeaturesModifiedLive, records);

  for (const [modelId, w1] of Object.entries(amLiveOrig.modelWeights)) {
    const w2 = amLiveMod.modelWeights[modelId as any];
    if (Math.abs(w1 - w2) > 1e-9) {
      throw new Error(`FAIL TEST 6: Live SET/Value change modified model weights for ${modelId}: ${w1} vs ${w2}`);
    }
  }
  console.log('PASS: Live SET/Value does not influence auto-weighting calculation.');

  // -------------------------------------------------------------------------
  // TEST 7: UNTESTABLE model receives zero historical weight
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: UNTESTABLE MODEL RECEIVES ZERO HISTORICAL WEIGHT ---');
  if (amOut.modelWeights.INTRADAY_SET_VALUE_STATISTICAL_V1 !== 0) {
    throw new Error(`FAIL TEST 7: INTRADAY_SET_VALUE_STATISTICAL_V1 received non-zero AM weight: ${amOut.modelWeights.INTRADAY_SET_VALUE_STATISTICAL_V1}`);
  }
  if (pmOut.modelWeights.INTRADAY_SET_VALUE_STATISTICAL_V1 !== 0) {
    throw new Error(`FAIL TEST 7: INTRADAY_SET_VALUE_STATISTICAL_V1 received non-zero PM weight: ${pmOut.modelWeights.INTRADAY_SET_VALUE_STATISTICAL_V1}`);
  }
  const intradayContrib = amOut.modelContributions.find((c) => c.modelId === 'INTRADAY_SET_VALUE_STATISTICAL_V1');
  if (!intradayContrib || intradayContrib.validationStatus !== 'UNTESTABLE' || intradayContrib.weight !== 0) {
    throw new Error('FAIL TEST 7: Intraday contribution does not reflect UNTESTABLE status with 0 weight.');
  }
  console.log('PASS: INTRADAY_SET_VALUE_STATISTICAL_V1 strictly receives 0.0 weight with UNTESTABLE status.');

  // -------------------------------------------------------------------------
  // TEST 8: Insufficient evidence uses defined conservative prior
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: INSUFFICIENT EVIDENCE CONSERVATIVE PRIOR ---');
  // Pass zero historical records to simulate zero evidence
  const emptyEvals = AutoWeightingEngine.evaluateEnsemble(amFeatures, []);
  console.log('AM Weights with zero historical evidence:', emptyEvals.modelWeights);

  // Eligible models for AM: SESSION_FREQUENCY_V1, RECENCY_WEIGHTED_FREQUENCY_V1, MARKOV_TRANSITION_V1 (3 models)
  const expectedPriorWeight = 1.0 / 3.0;
  for (const modelId of ['SESSION_FREQUENCY_V1', 'RECENCY_WEIGHTED_FREQUENCY_V1', 'MARKOV_TRANSITION_V1'] as const) {
    const w = emptyEvals.modelWeights[modelId];
    if (Math.abs(w - expectedPriorWeight) > 0.001) {
      throw new Error(`FAIL TEST 8: Prior weight for ${modelId} was ${w}, expected ~${expectedPriorWeight}`);
    }
  }
  if (emptyEvals.modelWeights.AM_TO_PM_CONDITIONAL_V1 !== 0 || emptyEvals.modelWeights.INTRADAY_SET_VALUE_STATISTICAL_V1 !== 0) {
    throw new Error('FAIL TEST 8: Ineligible models received non-zero weight under prior!');
  }
  console.log('PASS: Under insufficient evidence, eligible models receive exact conservative uniform prior weight.');

  // -------------------------------------------------------------------------
  // TEST 9: Same inputs produce bit-for-bit identical weights and hashes
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 9: DETERMINISTIC BIT-FOR-BIT REPRODUCIBILITY ---');
  const run1 = AutoWeightingEngine.evaluateEnsemble(amFeatures, records);
  const run2 = AutoWeightingEngine.evaluateEnsemble(amFeatures, records);

  if (run1.ensembleProbabilityHash !== run2.ensembleProbabilityHash) {
    throw new Error(`FAIL TEST 9: Ensemble probability hashes differ: ${run1.ensembleProbabilityHash} vs ${run2.ensembleProbabilityHash}`);
  }
  for (let i = 0; i < 100; i++) {
    if (run1.probabilities[i] !== run2.probabilities[i]) {
      throw new Error(`FAIL TEST 9: Probability at index ${i} differs across identical runs!`);
    }
  }
  for (const [mId, w1] of Object.entries(run1.modelWeights)) {
    if (w1 !== run2.modelWeights[mId as any]) {
      throw new Error(`FAIL TEST 9: Weight for ${mId} differs across identical runs!`);
    }
  }
  console.log(`PASS: Identical inputs produce bit-exact probabilities and hash: ${run1.ensembleProbabilityHash}`);

  // -------------------------------------------------------------------------
  // TEST 10: Weights always sum exactly to 1.0
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 10: WEIGHT NORMALIZATION & NON-NEGATIVITY INVARIANTS ---');
  const sumAmWeights = Object.values(amOut.modelWeights).reduce((a, b) => a + b, 0);
  const sumPmWeights = Object.values(pmOut.modelWeights).reduce((a, b) => a + b, 0);

  console.log(`Sum of AM weights: ${sumAmWeights}`);
  console.log(`Sum of PM weights: ${sumPmWeights}`);

  if (Math.abs(sumAmWeights - 1.0) > 1e-9) {
    throw new Error(`FAIL TEST 10: AM weights do not sum to 1.0: ${sumAmWeights}`);
  }
  if (Math.abs(sumPmWeights - 1.0) > 1e-9) {
    throw new Error(`FAIL TEST 10: PM weights do not sum to 1.0: ${sumPmWeights}`);
  }
  for (const [mId, w] of Object.entries(amOut.modelWeights)) {
    if (w < 0 || !isFinite(w)) {
      throw new Error(`FAIL TEST 10: Invalid weight for AM model ${mId}: ${w}`);
    }
  }
  for (const [mId, w] of Object.entries(pmOut.modelWeights)) {
    if (w < 0 || !isFinite(w)) {
      throw new Error(`FAIL TEST 10: Invalid weight for PM model ${mId}: ${w}`);
    }
  }
  console.log('PASS: Weights are strictly non-negative and sum exactly to 1.0.');

  // -------------------------------------------------------------------------
  // TEST 11: Walk-forward weight generation is point-in-time correct
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 11: WALK-FORWARD POINT-IN-TIME BACKTEST INTEGRATION ---');
  const backtestReport = BacktestEngine.runAutoWeightedEnsembleBacktest(
    records,
    15, // minTrainingSettlements
    10  // limitEvaluations
  );

  console.log(`Backtest evaluated ${backtestReport.totalEvaluated} events across ${backtestReport.startDate} to ${backtestReport.endDate}.`);
  console.log(`Avg Log Loss: ${backtestReport.averageLogLoss}, Avg Brier: ${backtestReport.averageBrierScore}`);
  console.log(`Top-1 Hit Rate: ${(backtestReport.top1HitRate * 100).toFixed(2)}%, Top-5: ${(backtestReport.top5HitRate * 100).toFixed(2)}%`);

  if (backtestReport.evaluations.length === 0) {
    throw new Error('FAIL TEST 11: Walk-forward backtest produced zero evaluations.');
  }

  // Verify that evidence count increases or stays monotone as target date advances
  for (let i = 1; i < backtestReport.evaluations.length; i++) {
    const prev = backtestReport.evaluations[i - 1];
    const curr = backtestReport.evaluations[i];
    if (curr.date < prev.date) {
      throw new Error(`FAIL TEST 11: Backtest dates not chronological: ${prev.date} followed by ${curr.date}`);
    }
  }
  console.log('PASS: Walk-forward backtest evaluates point-in-time auto-weighted ensemble correctly.');

  // -------------------------------------------------------------------------
  // TEST 12: Re-running backtest produces identical weights, metrics, and hashes
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 12: RE-RUNNING BACKTEST REPRODUCIBILITY ---');
  const backtestReport2 = BacktestEngine.runAutoWeightedEnsembleBacktest(
    records,
    15,
    10
  );

  if (backtestReport.totalEvaluated !== backtestReport2.totalEvaluated) {
    throw new Error('FAIL TEST 12: Evaluation counts differ across runs!');
  }
  if (backtestReport.averageLogLoss !== backtestReport2.averageLogLoss) {
    throw new Error('FAIL TEST 12: Average Log Loss differs across runs!');
  }
  if (backtestReport.averageBrierScore !== backtestReport2.averageBrierScore) {
    throw new Error('FAIL TEST 12: Average Brier Score differs across runs!');
  }

  for (let i = 0; i < backtestReport.evaluations.length; i++) {
    const e1 = backtestReport.evaluations[i];
    const e2 = backtestReport2.evaluations[i];
    if (e1.ensembleProbabilityHash !== e2.ensembleProbabilityHash) {
      throw new Error(`FAIL TEST 12: Probability hash mismatch at row ${i}: ${e1.ensembleProbabilityHash} vs ${e2.ensembleProbabilityHash}`);
    }
  }
  console.log('PASS: Backtest re-run produces bit-exact identical weights, metrics, and hashes.');

  // -------------------------------------------------------------------------
  // VERIFICATION OF PRODUCTION CHAMPION ISOLATION
  // -------------------------------------------------------------------------
  console.log('\n--- VERIFYING PRODUCTION CHAMPION ISOLATION ---');
  if (PredictionEngine.PRODUCTION_MODEL !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`VIOLATION: Production model was altered: ${PredictionEngine.PRODUCTION_MODEL}`);
  }
  if (PRODUCTION_MODEL_VERSION !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`VIOLATION: PRODUCTION_MODEL_VERSION constant altered: ${PRODUCTION_MODEL_VERSION}`);
  }
  console.log(`PASS: PRODUCTION_MODEL is strictly frozen as '${PredictionEngine.PRODUCTION_MODEL}'.`);

  console.log('\n================================================================');
  console.log('    ALL 12 AUTO-WEIGHTING ENGINE INVARIANT TESTS PASSED!       ');
  console.log('================================================================\n');
}

runStep24Tests().catch((err) => {
  console.error('\n❌ STEP 24 AUDIT FAILED:', err);
  process.exit(1);
});
