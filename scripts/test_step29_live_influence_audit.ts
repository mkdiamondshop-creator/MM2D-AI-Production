import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { CandidateModelLab } from '../src/core/prediction/candidateModelLab';
import { AutoWeightingEngine } from '../src/core/prediction/autoWeightingEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
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

export async function runStep29LiveInfluenceAudit() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 29: LIVE SET/VALUE INFLUENCE AUDIT        ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  const testDate = '2026-09-08';
  const priorHistorical = allRecords.filter((r) => r.date < testDate);

  console.log(`Loaded ${allRecords.length} historical records (prior: ${priorHistorical.length}).`);
  console.log(`Auditing target date: ${testDate}\n`);

  // ---------------------------------------------------------------------------
  // SECTION 1: INGESTION OF LIVE SET/VALUE INTO FEATURE ENGINE
  // ---------------------------------------------------------------------------
  console.log('--- [SECTION 1] Live SET/Value Ingestion into Feature Vectors ---');

  const emptyFeed: Array<{ time: string; set: number | string; value: number | string }> = [];
  const liveFeedA = [
    { time: '11:00:00', set: '1410.25', value: '35000.00' },
  ];
  const liveFeedB = [
    { time: '11:00:00', set: '1410.25', value: '35000.00' },
    { time: '11:30:00', set: '1425.80', value: '52000.00' },
  ];
  const liveFeedC = [
    { time: '11:00:00', set: '1380.10', value: '18000.00' },
    { time: '11:30:00', set: '1370.40', value: '25000.00' },
  ];

  const amFeatNoLive = FeatureEngine.extractAmFeatures(priorHistorical, testDate, emptyFeed);
  const amFeatA = FeatureEngine.extractAmFeatures(priorHistorical, testDate, liveFeedA);
  const amFeatB = FeatureEngine.extractAmFeatures(priorHistorical, testDate, liveFeedB);
  const amFeatC = FeatureEngine.extractAmFeatures(priorHistorical, testDate, liveFeedC);

  assert(amFeatNoLive.success && amFeatNoLive.featureVector !== undefined, '1a. FeatureEngine extracts features with empty live feed.');
  assert(amFeatA.success && amFeatA.featureVector !== undefined, '1b. FeatureEngine extracts features with single live observation.');
  assert(amFeatB.success && amFeatB.featureVector !== undefined, '1c. FeatureEngine extracts features with multiple live observations.');

  assert(amFeatNoLive.featureVector!.isPreLockLiveAvailable === false, '1d. isPreLockLiveAvailable is false when no feed provided.');
  assert(amFeatA.featureVector!.isPreLockLiveAvailable === true, '1e. isPreLockLiveAvailable is true when feed A provided.');
  assert(amFeatA.featureVector!.momentum.observationCount === 1, '1f. momentum.observationCount is 1 for Feed A.');
  assert(amFeatB.featureVector!.momentum.observationCount === 2, '1g. momentum.observationCount is 2 for Feed B.');

  assert(
    amFeatA.featureVector!.momentum.currentSet === 1410.25 &&
    amFeatA.featureVector!.momentum.currentValue === 35000.0,
    '1h. Current SET and Value correctly parsed and stored in feature vector momentum.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: PRODUCTION MODEL (ALL_TIME_FREQUENCY_V1) AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] ALL_TIME_FREQUENCY_V1 Live SET/Value Influence Audit ---');

  const predNoLive = PredictionEngine.generatePrediction(amFeatNoLive.featureVector!, 'ALL_TIME_FREQUENCY_V1');
  const predA = PredictionEngine.generatePrediction(amFeatA.featureVector!, 'ALL_TIME_FREQUENCY_V1');
  const predB = PredictionEngine.generatePrediction(amFeatB.featureVector!, 'ALL_TIME_FREQUENCY_V1');
  const predC = PredictionEngine.generatePrediction(amFeatC.featureVector!, 'ALL_TIME_FREQUENCY_V1');

  // Verify whether Top-1, Top-5, and all 100 probabilities change when live SET/Value changes
  const top1Matches = predA.top1 === predB.top1 && predB.top1 === predC.top1 && predA.top1 === predNoLive.top1;
  assert(top1Matches, '2a. ALL_TIME_FREQUENCY_V1 top1 prediction is 100% invariant to live SET/Value changes.');

  let allProbsIdentical = true;
  for (let i = 0; i < 100; i++) {
    if (
      predA.candidates[i].probability !== predB.candidates[i].probability ||
      predA.candidates[i].twod !== predB.candidates[i].twod
    ) {
      allProbsIdentical = false;
      break;
    }
  }
  assert(allProbsIdentical, '2b. ALL_TIME_FREQUENCY_V1 candidate probabilities and rankings are 100% invariant to live SET/Value.');

  // Check confidenceScore: Does live availability affect confidence?
  console.log(`    Confidence without live feed: ${predNoLive.confidenceScore}%`);
  console.log(`    Confidence with live Feed A:  ${predA.confidenceScore}%`);
  console.log(`    Confidence with live Feed B:  ${predB.confidenceScore}%`);
  assert(predA.confidenceScore === predB.confidenceScore, '2c. Confidence score does not fluctuate with SET/Value numerical values.');

  // ---------------------------------------------------------------------------
  // SECTION 3: CANDIDATE MODEL LAB AUDIT (INTRADAY_SET_VALUE_STATISTICAL_V1)
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Candidate Model Lab Live SET/Value Influence Audit ---');

  const intradayModel = CandidateModelLab.getModel('INTRADAY_SET_VALUE_STATISTICAL_V1');
  assert(intradayModel !== undefined, '3a. INTRADAY_SET_VALUE_STATISTICAL_V1 registered in Candidate Model Lab.');

  // When observation count < 2 (Feed A has 1 observation):
  const statusA = intradayModel!.getValidationStatus(amFeatA.featureVector!);
  assert(statusA === 'UNTESTABLE', '3b. Intraday model validation status is UNTESTABLE when observations < 2.');

  const predIntradayA = CandidateModelLab.evaluateModel('INTRADAY_SET_VALUE_STATISTICAL_V1', amFeatA.featureVector!);
  assert(
    predIntradayA.validationStatus === 'UNTESTABLE' && predIntradayA.probabilities.every((p) => Math.abs(p - 0.01) < 0.0001),
    '3c. When observations < 2, intraday model outputs uniform distribution (0.01) and UNTESTABLE status.'
  );

  // When observation count >= 2 (Feed B has 2 observations with SET rising):
  const statusB = intradayModel!.getValidationStatus(amFeatB.featureVector!);
  assert(statusB === 'READY', '3d. Intraday model validation status is READY when observations >= 2.');

  const predIntradayB = CandidateModelLab.evaluateModel('INTRADAY_SET_VALUE_STATISTICAL_V1', amFeatB.featureVector!);
  const predIntradayC = CandidateModelLab.evaluateModel('INTRADAY_SET_VALUE_STATISTICAL_V1', amFeatC.featureVector!);

  assert(predIntradayB.validationStatus === 'READY', '3e. Intraday model produces READY output when observations >= 2.');
  assert(
    predIntradayB.top1 !== predIntradayC.top1 || predIntradayB.probabilities[55] !== predIntradayC.probabilities[55],
    '3f. When observations >= 2, live SET/Value drift directly shifts candidate probabilities and ranking!'
  );
  console.log(`    Intraday Model Feed B (Rising SET +15.55): Top-1 = ${predIntradayB.top1}, Top-5 = [${predIntradayB.top5.join(', ')}]`);
  console.log(`    Intraday Model Feed C (Falling SET -9.70): Top-1 = ${predIntradayC.top1}, Top-5 = [${predIntradayC.top5.join(', ')}]`);

  // ---------------------------------------------------------------------------
  // SECTION 4: AUTO-WEIGHTED ENSEMBLE AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 4] Auto-Weighted Ensemble Live SET/Value Influence Audit ---');

  const ensOutA = AutoWeightingEngine.evaluateEnsemble(amFeatA.featureVector!, priorHistorical);
  const ensOutB = AutoWeightingEngine.evaluateEnsemble(amFeatB.featureVector!, priorHistorical);

  const intradayContrib = ensOutA.modelContributions.find(
    (m) => m.modelId === 'INTRADAY_SET_VALUE_STATISTICAL_V1'
  );
  assert(
    intradayContrib !== undefined && intradayContrib.weight === 0.0,
    '4a. INTRADAY_SET_VALUE_STATISTICAL_V1 strictly receives 0.0 weight in Auto-Weighted Ensemble (untestable in history).'
  );

  assert(
    ensOutA.candidates[0].twod === ensOutB.candidates[0].twod &&
    ensOutA.candidates[0].probability === ensOutB.candidates[0].probability,
    '4b. Auto-Weighted Ensemble ranking and probabilities are NOT influenced by live SET/Value.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 5: RESEARCH ENSEMBLE V1 AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 5] Research Multi-Component Ensemble Live Influence Audit ---');

  const resPredA = PredictionEngine.generatePrediction(amFeatA.featureVector!, 'RESEARCH_ENSEMBLE_V1');
  const resPredB = PredictionEngine.generatePrediction(amFeatB.featureVector!, 'RESEARCH_ENSEMBLE_V1');

  console.log(`    Research Ensemble Feed A: Top-1 = ${resPredA.top1}, Top-5 = [${resPredA.top5.join(', ')}]`);
  console.log(`    Research Ensemble Feed B: Top-1 = ${resPredB.top1}, Top-5 = [${resPredB.top5.join(', ')}]`);

  const resProbDifference = Math.abs(resPredA.candidates[0].probability - resPredB.candidates[0].probability);
  assert(
    resPredA.featureIntegrityHash !== resPredB.featureIntegrityHash,
    '5a. Research Ensemble featureIntegrityHash changes with live feed.'
  );
  assert(
    resProbDifference > 0.0001,
    '5b. Research Ensemble candidate probabilities directly change when live SET/Value changes (via momentumIntraday weight 0.08).'
  );

  // ---------------------------------------------------------------------------
  // SECTION 6: LOCK ENGINE GATING & AM vs PM BEHAVIOR AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 6] LockEngine Gating & AM vs PM Lifecycle Audit ---');

  LockEngine.clearFrozenSnapshotsForTesting();

  // Test AM Pre-Market Gate (< 10:00 BKK)
  const amPreMarket = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'AM',
    liveFeedA,
    new Date(`${testDate}T09:30:00+07:00`)
  );
  assert(amPreMarket.output.status === 'MARKET_NOT_OPEN', '6a. AM before 10:00 BKK is MARKET_NOT_OPEN.');

  // Test AM Live Intake Gate (10:00-11:55 BKK)
  const amIntake = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'AM',
    liveFeedA,
    new Date(`${testDate}T10:30:00+07:00`)
  );
  assert(amIntake.output.status === 'ANALYZING_LIVE_DATA' && amIntake.output.top1 === '--', '6b. AM during active intake (10:30 BKK) is ANALYZING_LIVE_DATA with top1="--".');

  // Test AM Publish Gate (11:55 BKK)
  const amPublish = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'AM',
    liveFeedA,
    new Date(`${testDate}T11:55:00+07:00`)
  );
  assert(amPublish.output.status === 'PREDICTION_READY' && amPublish.output.top1 !== '--', '6c. AM at publish time (11:55 BKK) is PREDICTION_READY with published top1.');

  // Test PM Pre-Market Gate (< 14:00 BKK)
  const pmPreMarket = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'PM',
    liveFeedA,
    new Date(`${testDate}T13:30:00+07:00`)
  );
  assert(pmPreMarket.output.status === 'MARKET_NOT_OPEN', '6d. PM before 14:00 BKK is MARKET_NOT_OPEN.');

  // Test PM Live Intake Gate (14:00-15:55 BKK)
  const pmIntake = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'PM',
    [{ time: '15:00:00', set: '1415.00', value: '45000.00' }],
    new Date(`${testDate}T15:00:00+07:00`)
  );
  assert(pmIntake.output.status === 'ANALYZING_LIVE_DATA' && pmIntake.output.top1 === '--', '6e. PM during active intake (15:00 BKK) is ANALYZING_LIVE_DATA with top1="--".');

  // Test PM Publish Gate (15:55 BKK)
  const pmPublish = LockEngine.getOrFreezePrediction(
    priorHistorical,
    testDate,
    'PM',
    [{ time: '15:00:00', set: '1415.00', value: '45000.00' }],
    new Date(`${testDate}T15:55:00+07:00`)
  );
  assert(pmPublish.output.status === 'PREDICTION_READY' && pmPublish.output.top1 !== '--', '6f. PM at publish time (15:55 BKK) is PREDICTION_READY with published top1.');

  // Upstream Resolution Audit
  console.log('\n--- [SECTION 7] Upstream Provider Real Data Resolution Audit ---');
  const realDateRecords = allRecords.filter((r) => r.date === testDate);
  const amPreLockRecords = realDateRecords.filter((r) => r.time < '12:00:00');
  const pmPreLockRecords = realDateRecords.filter((r) => r.time >= '12:01:00' && r.time < '16:00:00');

  console.log(`    Upstream AM pre-lock observations on ${testDate}: ${amPreLockRecords.length} record (${amPreLockRecords.map((r) => r.time).join(', ')})`);
  console.log(`    Upstream PM pre-lock observations on ${testDate}: ${pmPreLockRecords.length} record (${pmPreLockRecords.map((r) => r.time).join(', ')})`);
  assert(amPreLockRecords.length === 1, '7a. Upstream ThaiStock2D daily history contains exactly 1 pre-lock AM observation (11:00:00).');
  assert(pmPreLockRecords.length === 2, '7b. Upstream ThaiStock2D daily history contains exactly 2 pre-lock PM observations (12:01:00 AM settlement + 15:00:00 PM checkpoint).');

  console.log('\n================================================================');
  console.log(`  STEP 29 AUDIT SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');
}

runStep29LiveInfluenceAudit().catch((err) => {
  console.error('\n❌ STEP 29 AUDIT FAILED:', err);
  process.exit(1);
});
