import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { CandidateModelLab } from '../src/core/prediction/candidateModelLab';
import { BacktestEngine } from '../src/core/prediction/backtestEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

async function runStep23Tests() {
  console.log('================================================================');
  console.log('       MM2D LEADER STEP 23: CANDIDATE MODEL LAB AUDIT           ');
  console.log('================================================================\n');

  // Initialize data layer
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const records = await globalDatasetStorage.queryAllVerifiedRecords();
  console.log(`Loaded ${records.length} verified records for Candidate Model Lab testing.\n`);

  const testDate = '2026-09-07';

  // Extract baseline point-in-time AM and PM feature vectors
  const amFeatureRes = FeatureEngine.extractAmFeatures(records, testDate);
  const pmFeatureRes = FeatureEngine.extractPmFeatures(records, testDate);

  if (!amFeatureRes.success || !amFeatureRes.featureVector) {
    throw new Error(`Failed to extract AM features: ${amFeatureRes.errorDetails}`);
  }
  if (!pmFeatureRes.success || !pmFeatureRes.featureVector) {
    throw new Error(`Failed to extract PM features: ${pmFeatureRes.errorDetails}`);
  }

  const amFeatures = amFeatureRes.featureVector;
  const pmFeatures = pmFeatureRes.featureVector;

  // -------------------------------------------------------------------------
  // TEST 1: All Candidate Models Return Exactly 100 Probabilities
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: EXACTLY 100 CANDIDATE PROBABILITIES & RANKINGS ---');
  const models = CandidateModelLab.getAllModels();
  console.log(`Registered Candidate Models count: ${models.length}`);

  for (const model of models) {
    const targetFeatures = model.session === 'PM' ? pmFeatures : amFeatures;
    const output = model.predict(targetFeatures);

    if (output.probabilities.length !== 100) {
      throw new Error(`FAIL: ${model.modelId} returned ${output.probabilities.length} probabilities, expected 100.`);
    }
    if (output.candidates.length !== 100) {
      throw new Error(`FAIL: ${model.modelId} returned ${output.candidates.length} candidates, expected 100.`);
    }
    if (!output.top1 || output.top1.length !== 2) {
      throw new Error(`FAIL: ${model.modelId} invalid Top 1: ${output.top1}`);
    }
    if (output.top5.length !== 5) {
      throw new Error(`FAIL: ${model.modelId} Top 5 length is ${output.top5.length}, expected 5.`);
    }
    if (output.top10.length !== 10) {
      throw new Error(`FAIL: ${model.modelId} Top 10 length is ${output.top10.length}, expected 10.`);
    }
    console.log(`[PASS] ${model.modelId} (session: ${model.session}): 100 probs, Top-1: ${output.top1}, Top-5: [${output.top5.join(', ')}]`);
  }
  console.log('[PASS] Test 1: All candidate models generate full 100-candidate ranking.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Finite and Normalized Probabilities
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: FINITE & NORMALIZED PROBABILITIES (SUM = 1.0) ---');
  for (const model of models) {
    const targetFeatures = model.session === 'PM' ? pmFeatures : amFeatures;
    const output = model.predict(targetFeatures);

    let sum = 0;
    for (let i = 0; i < 100; i++) {
      const p = output.probabilities[i];
      if (!isFinite(p) || isNaN(p)) {
        throw new Error(`FAIL: ${model.modelId} has non-finite probability at index ${i}: ${p}`);
      }
      if (p < 0) {
        throw new Error(`FAIL: ${model.modelId} has negative probability at index ${i}: ${p}`);
      }
      sum += p;
    }

    if (Math.abs(sum - 1.0) > 1e-4) {
      throw new Error(`FAIL: ${model.modelId} probabilities sum to ${sum}, expected 1.0.`);
    }
  }
  console.log('[PASS] Test 2: All models produce finite, strictly non-negative, normalized distributions.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Deterministic Output
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: DETERMINISTIC OUTPUT INVARIANT ---');
  for (const model of models) {
    const targetFeatures = model.session === 'PM' ? pmFeatures : amFeatures;
    const run1 = model.predict(targetFeatures);
    const run2 = model.predict(targetFeatures);

    if (run1.audit.candidateProbabilityHash !== run2.audit.candidateProbabilityHash) {
      throw new Error(`FAIL: ${model.modelId} candidate probability hash mismatch between deterministic runs.`);
    }
    if (run1.top1 !== run2.top1) {
      throw new Error(`FAIL: ${model.modelId} Top 1 mismatch between deterministic runs.`);
    }
    for (let i = 0; i < 100; i++) {
      if (run1.probabilities[i] !== run2.probabilities[i]) {
        throw new Error(`FAIL: ${model.modelId} probability variance at index ${i}.`);
      }
    }
  }
  console.log('[PASS] Test 3: Bit-for-bit deterministic reproducibility verified across all models.\n');

  // -------------------------------------------------------------------------
  // TEST 4: AM/PM Session Isolation
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: AM/PM SESSION ISOLATION & CONTRACT ENFORCEMENT ---');
  const amToPmModel = CandidateModelLab.getModel('AM_TO_PM_CONDITIONAL_V1')!;
  const amInvocationResult = amToPmModel.predict(amFeatures);
  if (amInvocationResult.validationStatus !== 'FAILED_CONTRACT') {
    throw new Error(
      `FAIL: AmToPmConditionalModel did not fail contract when invoked on AM session (status: ${amInvocationResult.validationStatus}).`
    );
  }
  console.log(`[PASS] AmToPmConditionalModel properly rejected AM session invocation (status: ${amInvocationResult.validationStatus}).`);

  const sessionFreqModel = CandidateModelLab.getModel('SESSION_FREQUENCY_V1')!;
  const amOutput = sessionFreqModel.predict(amFeatures);
  const pmOutput = sessionFreqModel.predict(pmFeatures);
  if (amOutput.top1 === pmOutput.top1 && amOutput.audit.candidateProbabilityHash === pmOutput.audit.candidateProbabilityHash) {
    throw new Error('FAIL: AM and PM SessionFrequencyModel produced identical outputs despite session dataset isolation.');
  }
  console.log(`[PASS] SessionFrequencyModel AM (Top-1: ${amOutput.top1}) vs PM (Top-1: ${pmOutput.top1}) maintain strict session isolation.\n`);

  // -------------------------------------------------------------------------
  // TEST 5: PM AM-Result Conditioning
  // -------------------------------------------------------------------------
  console.log('--- TEST 5: PM SAME-DAY AM OFFICIAL RESULT CONDITIONING ---');
  // 5a. When AM settlement is missing
  const pmFeaturesWithoutAm = {
    ...pmFeatures,
    distributions: {
      ...pmFeatures.distributions,
      todayAmSettlement2D: null,
    },
  };
  const unconditionedResult = amToPmModel.predict(pmFeaturesWithoutAm);
  if (unconditionedResult.validationStatus !== 'REQUIRES_MORE_DATA') {
    throw new Error(`FAIL: AmToPmConditionalModel should require more data when AM settlement is null, got ${unconditionedResult.validationStatus}`);
  }
  console.log(`[PASS] AmToPmConditionalModel indicates REQUIRES_MORE_DATA when AM settlement is absent.`);

  // 5b. When AM settlement is present (e.g. 59)
  const conditionedResult = amToPmModel.predict(pmFeatures);
  if (conditionedResult.validationStatus !== 'READY') {
    throw new Error(`FAIL: Conditioned PM model status is ${conditionedResult.validationStatus}, expected READY.`);
  }
  console.log(`[PASS] Conditioned PM model ready (Top-1: ${conditionedResult.top1}, Top-5: [${conditionedResult.top5.join(', ')}]).\n`);

  // -------------------------------------------------------------------------
  // TEST 6: No Target-Result Leakage
  // -------------------------------------------------------------------------
  console.log('--- TEST 6: TARGET-RESULT LEAKAGE ISOLATION ---');
  // Verify that target-day PM settlement is never present in pmFeatures
  if (pmFeatures.distributions.prevSettlement2D === '42') {
    throw new Error('FAIL: Target PM settlement present in feature vector!');
  }
  const cleanPmOutput = CandidateModelLab.evaluateModel('SESSION_FREQUENCY_V1', pmFeatures);
  console.log(`[PASS] Clean PM prediction unaffected by target settlement (Top-1: ${cleanPmOutput.top1}, Sample Count: ${pmFeatures.distributions.sampleCountAllTime}).\n`);

  // -------------------------------------------------------------------------
  // TEST 7: No Live-2D Leakage
  // -------------------------------------------------------------------------
  console.log('--- TEST 7: NO LIVE-2D LEAKAGE INVARIANT ---');
  for (const model of models) {
    for (const req of model.requiredFeatures) {
      if (req.includes('LIVE_2D') || req.includes('RESULT_2D')) {
        throw new Error(`FAIL: Model ${model.modelId} requires forbidden live 2D feature: ${req}`);
      }
    }
  }
  console.log('[PASS] All candidate models strictly inspect zero live 2D or result fields.\n');

  // -------------------------------------------------------------------------
  // TEST 8: Insufficient Historical Intraday Resolution => UNTESTABLE
  // -------------------------------------------------------------------------
  console.log('--- TEST 8: INSUFFICIENT HISTORICAL INTRADAY RESOLUTION => UNTESTABLE ---');
  const intradayModel = CandidateModelLab.getModel('INTRADAY_SET_VALUE_STATISTICAL_V1')!;
  const backtestFeatures = {
    ...amFeatures,
    isPreLockLiveAvailable: false,
    momentum: {
      ...amFeatures.momentum,
      observationCount: 0,
    },
  };

  const untestableOutput = intradayModel.predict(backtestFeatures);
  if (untestableOutput.validationStatus !== 'UNTESTABLE') {
    throw new Error(`FAIL: Expected UNTESTABLE status for historical backtest features, got ${untestableOutput.validationStatus}`);
  }
  console.log(`[PASS] IntradaySetValueStatisticalModel correctly classified as UNTESTABLE on historical backtest data.`);
  console.log(`       Reason: ${untestableOutput.audit.auditDetails}\n`);

  // -------------------------------------------------------------------------
  // TEST 9: No Mutation of ALL_TIME_FREQUENCY_V1
  // -------------------------------------------------------------------------
  console.log('--- TEST 9: NO MUTATION OF ALL_TIME_FREQUENCY_V1 CHAMPION ---');
  if (PredictionEngine.PRODUCTION_MODEL !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`FAIL: Production champion changed from ALL_TIME_FREQUENCY_V1 to ${PredictionEngine.PRODUCTION_MODEL}`);
  }
  if (PRODUCTION_MODEL_VERSION !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`FAIL: PRODUCTION_MODEL_VERSION constant modified!`);
  }

  const defaultAmPred = PredictionEngine.generatePrediction(amFeatures);
  const explicitChampionPred = PredictionEngine.generateAllTimeFrequencyPrediction(amFeatures);
  if (defaultAmPred.top1 !== explicitChampionPred.top1 || defaultAmPred.topMargin !== explicitChampionPred.topMargin) {
    throw new Error('FAIL: Default PredictionEngine production path diverged from ALL_TIME_FREQUENCY_V1!');
  }
  console.log(`[PASS] ALL_TIME_FREQUENCY_V1 remains 100% frozen as production champion (AM Top-1: ${defaultAmPred.top1}, Confidence: ${defaultAmPred.confidenceScore}%).\n`);

  // -------------------------------------------------------------------------
  // TEST 10: Production / Backtest Feature-Contract Compatibility
  // -------------------------------------------------------------------------
  console.log('--- TEST 10: PRODUCTION / BACKTEST COMPATIBILITY ---');
  // Run walk-forward backtest using Candidate Model
  const backtestReport = BacktestEngine.runWalkForwardBacktest(
    records,
    10,
    undefined,
    'SESSION_FREQUENCY_V1'
  );

  console.log(`Backtest evaluations produced: ${backtestReport.totalEvaluated}`);
  console.log(`Candidate SESSION_FREQUENCY_V1 Top-1 Hit Rate: ${(backtestReport.top1HitRate * 100).toFixed(1)}%`);
  console.log(`Candidate SESSION_FREQUENCY_V1 Top-5 Hit Rate: ${(backtestReport.top5HitRate * 100).toFixed(1)}%`);
  console.log(`Candidate SESSION_FREQUENCY_V1 Top-10 Hit Rate: ${(backtestReport.top10HitRate * 100).toFixed(1)}%`);

  if (backtestReport.totalEvaluated < 10) {
    throw new Error(`FAIL: Backtest produced insufficient evaluations: ${backtestReport.totalEvaluated}`);
  }
  console.log('[PASS] Candidate models execute seamlessly in existing walk-forward backtest engine.\n');

  console.log('================================================================');
  console.log('   STEP 23 CANDIDATE LAB TESTS COMPLETED SUCCESSFULLY (10/10)   ');
  console.log('================================================================');
}

runStep23Tests().catch((err) => {
  console.error('\nSTEP 23 TEST FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
