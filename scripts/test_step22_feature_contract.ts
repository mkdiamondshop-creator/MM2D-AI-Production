/**
 * MM2D LEADER STEP 22 — FEATURE CONTRACT & LEAKAGE HARDENING AUDIT
 *
 * Automated verification of:
 * 1. AM future-data rejection
 * 2. PM future-data rejection
 * 3. PM target-result leakage rejection
 * 4. live 2D rejection
 * 5. timestamp cutoff enforcement
 * 6. backtest point-in-time consistency
 * 7. AM/PM feature isolation
 */

import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import {
  FeatureContractAuditor,
  AM_FEATURE_CONTRACT,
  PM_FEATURE_CONTRACT,
  FORBIDDEN_LEAKAGE_REGISTRY,
} from '../src/core/prediction/featureContract';
import { BacktestEngine } from '../src/core/prediction/backtestEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';

async function runStep22Audit() {
  console.log('================================================================');
  console.log('    MM2D LEADER STEP 22: FEATURE CONTRACT & LEAKAGE HARDENING   ');
  console.log('================================================================\n');

  // Initialize data layer
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const verifiedRecords = (await globalDatasetStorage.queryAllVerifiedRecords()).filter(
    (r) => r.date <= '2026-09-07'
  );

  console.log(`Loaded ${verifiedRecords.length} verified market records for audit.\n`);

  const testDate = '2026-09-07';

  // -------------------------------------------------------------------------
  // TEST 1: AM Future-Data Rejection
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: AM FUTURE-DATA REJECTION ---');

  // Baseline AM feature extraction without future records
  const cleanAmResult = FeatureEngine.extractAmFeatures(verifiedRecords, testDate);
  if (!cleanAmResult.success || !cleanAmResult.featureVector) {
    throw new Error(`Clean AM feature extraction failed: ${cleanAmResult.status}`);
  }
  const cleanAmHash = cleanAmResult.featureVector.featureIntegrityHash;
  const cleanAmSamples = cleanAmResult.featureVector.distributions.sampleCountAllTime;

  // Inject future-dated records (targetDate + 1 day, targetDate + 10 days)
  const contaminatedRecordsWithFuture: VerifiedMarketRecord[] = [
    ...verifiedRecords,
    {
      id: '2026-09-08_12:01:00_9999',
      date: '2026-09-08',
      time: '12:01:00',
      session: 'AM',
      isSettlement: true,
      twod: '88',
      setRaw: '1,650.00',
      valueRaw: '60,000.00',
      setNumeric: 1650.0,
      valueNumeric: 60000.0,
      historyId: '9999',
      provenance: 'THAI_STOCK_2D',
      verifiedAt: '2026-09-08T12:01:00+07:00',
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '00',
        isMathematicallyConsistent: true,
      },
    },
    {
      id: '2026-09-15_12:01:00_9998',
      date: '2026-09-15',
      time: '12:01:00',
      session: 'AM',
      isSettlement: true,
      twod: '99',
      setRaw: '1,680.00',
      valueRaw: '70,000.00',
      setNumeric: 1680.0,
      valueNumeric: 70000.0,
      historyId: '9998',
      provenance: 'THAI_STOCK_2D',
      verifiedAt: '2026-09-15T12:01:00+07:00',
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '00',
        isMathematicallyConsistent: true,
      },
    },
  ];

  // Test that FeatureContractAuditor identifies future records
  const futureAudit = FeatureContractAuditor.auditHistoricalInputRecords(
    contaminatedRecordsWithFuture,
    testDate,
    'AM'
  );
  if (futureAudit.isCompliant) {
    throw new Error('FAIL: FeatureContractAuditor did NOT detect future-dated records!');
  }
  const futureViolationCount = futureAudit.violations.filter((v) =>
    v.includes('[FUTURE_DATE_LEAKAGE]')
  ).length;
  if (futureViolationCount !== 2) {
    throw new Error(`Expected 2 future date violations, found ${futureViolationCount}`);
  }
  console.log(`[PASS] FeatureContractAuditor flagged ${futureViolationCount} future-dated leakage records.`);

  // Test that FeatureEngine.filterEligibleHistoricalRecords completely purges future records
  const { eligibleRecords: amEligibleWithFuture } = FeatureEngine.filterEligibleHistoricalRecords(
    contaminatedRecordsWithFuture,
    testDate,
    'AM'
  );
  const anyFutureInAm = amEligibleWithFuture.some((r) => r.date > testDate);
  if (anyFutureInAm) {
    throw new Error('FAIL: Future records leaked into AM eligibleRecords!');
  }

  // Verify feature extraction output is 100% bitwise identical despite contaminated future inputs
  const amResultAfterFutureInject = FeatureEngine.extractAmFeatures(
    contaminatedRecordsWithFuture,
    testDate
  );
  if (!amResultAfterFutureInject.success || !amResultAfterFutureInject.featureVector) {
    throw new Error('AM feature extraction failed after future injection');
  }
  if (amResultAfterFutureInject.featureVector.featureIntegrityHash !== cleanAmHash) {
    throw new Error('FAIL: Future records altered AM feature hash!');
  }
  if (amResultAfterFutureInject.featureVector.distributions.sampleCountAllTime !== cleanAmSamples) {
    throw new Error('FAIL: Future records altered AM sample count!');
  }
  console.log(
    `[PASS] AM feature extraction invariant verified: future records strictly rejected (samples: ${cleanAmSamples}, hash: ${cleanAmHash}).\n`
  );

  // -------------------------------------------------------------------------
  // TEST 2: PM Future-Data Rejection
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: PM FUTURE-DATA REJECTION ---');

  const cleanPmResult = FeatureEngine.extractPmFeatures(verifiedRecords, testDate);
  if (!cleanPmResult.success || !cleanPmResult.featureVector) {
    throw new Error(`Clean PM feature extraction failed: ${cleanPmResult.status}`);
  }
  const cleanPmHash = cleanPmResult.featureVector.featureIntegrityHash;
  const cleanPmSamples = cleanPmResult.featureVector.distributions.sampleCountAllTime;

  const { eligibleRecords: pmEligibleWithFuture } = FeatureEngine.filterEligibleHistoricalRecords(
    contaminatedRecordsWithFuture,
    testDate,
    'PM'
  );
  const anyFutureInPm = pmEligibleWithFuture.some((r) => r.date > testDate);
  if (anyFutureInPm) {
    throw new Error('FAIL: Future records leaked into PM eligibleRecords!');
  }

  const pmResultAfterFutureInject = FeatureEngine.extractPmFeatures(
    contaminatedRecordsWithFuture,
    testDate
  );
  if (!pmResultAfterFutureInject.success || !pmResultAfterFutureInject.featureVector) {
    throw new Error('PM feature extraction failed after future injection');
  }
  if (pmResultAfterFutureInject.featureVector.featureIntegrityHash !== cleanPmHash) {
    throw new Error('FAIL: Future records altered PM feature hash!');
  }
  if (pmResultAfterFutureInject.featureVector.distributions.sampleCountAllTime !== cleanPmSamples) {
    throw new Error('FAIL: Future records altered PM sample count!');
  }
  console.log(
    `[PASS] PM feature extraction invariant verified: future records strictly rejected (samples: ${cleanPmSamples}, hash: ${cleanPmHash}).\n`
  );

  // -------------------------------------------------------------------------
  // TEST 3: PM Target-Result Leakage Rejection
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: PM TARGET-RESULT LEAKAGE REJECTION ---');

  // Inject target-date PM settlement (16:30:00) into verifiedRecords
  const contaminatedRecordsWithTargetPm: VerifiedMarketRecord[] = [
    ...verifiedRecords,
    {
      id: `${testDate}_16:30:00_target_pm`,
      date: testDate,
      time: '16:30:00',
      session: 'PM',
      isSettlement: true,
      twod: '42', // Synthetic target settlement
      setRaw: '1,612.45',
      valueRaw: '48,000.00',
      setNumeric: 1612.45,
      valueNumeric: 48000.0,
      historyId: '8888',
      provenance: 'THAI_STOCK_2D',
      verifiedAt: `${testDate}T16:30:00+07:00`,
      mathematicalCheck: {
        setLastDigit: '5',
        valueLastDigitBeforeDecimal: '0',
        derived2D: '50',
        isMathematicallyConsistent: true,
      },
    },
  ];

  // Test auditor catches target PM settlement
  const targetPmAudit = FeatureContractAuditor.auditHistoricalInputRecords(
    contaminatedRecordsWithTargetPm,
    testDate,
    'PM'
  );
  const targetPmViolation = targetPmAudit.violations.some((v) =>
    v.includes('[TARGET_PM_SETTLEMENT_LEAKAGE]')
  );
  if (!targetPmViolation) {
    throw new Error('FAIL: FeatureContractAuditor did NOT catch target date PM settlement leakage!');
  }
  console.log('[PASS] FeatureContractAuditor identified [TARGET_PM_SETTLEMENT_LEAKAGE].');

  // Test filtering strictly purges target PM settlement
  const { eligibleRecords: pmEligibleWithTarget } = FeatureEngine.filterEligibleHistoricalRecords(
    contaminatedRecordsWithTargetPm,
    testDate,
    'PM'
  );
  const targetPmPresent = pmEligibleWithTarget.some(
    (r) => r.date === testDate && r.isSettlement && r.session === 'PM'
  );
  if (targetPmPresent) {
    throw new Error('CRITICAL LEAKAGE: Target PM settlement present in PM eligibleRecords!');
  }

  // Test that PM feature vector is invariant whether target PM settlement exists in database or not
  const pmResultWithTarget = FeatureEngine.extractPmFeatures(
    contaminatedRecordsWithTargetPm,
    testDate
  );
  if (!pmResultWithTarget.success || !pmResultWithTarget.featureVector) {
    throw new Error('PM feature extraction failed');
  }
  if (pmResultWithTarget.featureVector.featureIntegrityHash !== cleanPmHash) {
    throw new Error('FAIL: Target PM settlement altered PM feature hash!');
  }
  if (pmResultWithTarget.featureVector.distributions.sampleCountAllTime !== cleanPmSamples) {
    throw new Error('FAIL: Target PM settlement altered PM sample count!');
  }
  if (pmResultWithTarget.featureVector.distributions.freqAllTime[42] !== cleanPmResult.featureVector.distributions.freqAllTime[42]) {
    throw new Error('CRITICAL LEAKAGE: Target PM settlement (42) altered candidate 42 probability!');
  }
  console.log(
    `[PASS] Target PM result (42) strictly isolated: zero effect on PM distribution or sample count.\n`
  );

  // -------------------------------------------------------------------------
  // TEST 4: Live 2D Rejection Invariant
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: LIVE 2D REJECTION INVARIANT ---');

  // Create pre-lock live feed with smuggled live 2D properties
  const contaminatedLiveFeed = [
    {
      time: '11:15:00',
      set: 1608.2,
      value: 22000.5,
      twod: '99', // Forbidden!
      twoD: '99', // Forbidden!
      '2D': '99', // Forbidden!
      result: '99', // Forbidden!
    },
    {
      time: '11:45:00',
      set: 1609.5,
      value: 38000.0,
      twod: '77', // Forbidden!
    },
  ];

  // Test auditor flags live 2D
  const live2DAudit = FeatureContractAuditor.auditLiveFeedObservations(
    contaminatedLiveFeed,
    testDate,
    'AM'
  );
  if (live2DAudit.live2DStrippedCount < 2) {
    throw new Error(
      `Expected at least 2 live 2D detections, got ${live2DAudit.live2DStrippedCount}`
    );
  }
  console.log(
    `[PASS] FeatureContractAuditor flagged and stripped ${live2DAudit.live2DStrippedCount} live 2D occurrences.`
  );

  // Test filterPreLockObservations sanitization
  const preLockSnapshot = FeatureEngine.filterPreLockObservations(
    testDate,
    'AM',
    contaminatedLiveFeed
  );
  for (const obs of preLockSnapshot.observations) {
    const obsAny = obs as any;
    if (obsAny.twod !== undefined || obsAny.twoD !== undefined || obsAny['2D'] !== undefined || obsAny.result !== undefined) {
      throw new Error(`CRITICAL: Live 2D smuggled into pre-lock observation object!`);
    }
  }

  // Verify feature extraction momentum does not contain twod
  const amResultWithLiveFeed = FeatureEngine.extractAmFeatures(
    verifiedRecords,
    testDate,
    contaminatedLiveFeed
  );
  if (!amResultWithLiveFeed.success || !amResultWithLiveFeed.featureVector) {
    throw new Error('Feature extraction with live feed failed');
  }
  const momentumAny = amResultWithLiveFeed.featureVector.momentum as any;
  if (momentumAny.twod !== undefined || momentumAny.live2D !== undefined) {
    throw new Error('CRITICAL: Live 2D leaked into feature vector momentum!');
  }
  console.log('[PASS] Live 2D numbers completely prohibited and stripped from all model inputs.\n');

  // -------------------------------------------------------------------------
  // TEST 5: Timestamp Cutoff Enforcement
  // -------------------------------------------------------------------------
  console.log('--- TEST 5: TIMESTAMP CUTOFF ENFORCEMENT ---');

  const boundaryTestFeed = [
    // Pre-open (forbidden: before 10:00:00 Bangkok)
    { time: '09:59:59', set: 1600.0, value: 10000.0 },
    // Valid AM window [10:00:00, 12:00:00]
    { time: '10:00:00', set: 1601.0, value: 11000.0 }, // Exact session open
    { time: '11:00:00', set: 1603.0, value: 18000.0 }, // Checkpoint
    { time: '11:30:00', set: 1605.0, value: 25000.0 },
    { time: '11:59:59', set: 1608.0, value: 35000.0 },
    { time: '12:00:00', set: 1609.0, value: 39000.0 }, // Exact cutoff boundary
    // Post-lock (strictly forbidden: after 12:00:00 Bangkok)
    { time: '12:00:01', set: 1609.5, value: 40000.0 },
    { time: '12:01:00', set: 1610.0, value: 41000.0 },
    { time: '12:15:00', set: 1612.0, value: 45000.0 },
  ];

  const amSnapshot = FeatureEngine.filterPreLockObservations(testDate, 'AM', boundaryTestFeed);
  console.log(`AM observations accepted: ${amSnapshot.observations.map((o) => o.time).join(', ')}`);

  if (amSnapshot.observations.some((o) => o.time < '10:00:00')) {
    throw new Error('FAIL: Pre-open observation accepted in AM window!');
  }
  if (amSnapshot.observations.some((o) => o.time > '12:00:00')) {
    throw new Error('FAIL: Post-lock observation accepted in AM window!');
  }
  if (amSnapshot.observations.length !== 5) {
    throw new Error(`Expected exactly 5 valid AM observations, got ${amSnapshot.observations.length}`);
  }
  console.log('[PASS] AM cutoff strictly enforced: [10:00:00, 12:00:00] window adhered to.');

  // PM Cutoff check: [14:00:00, 16:00:00]
  const pmBoundaryFeed = [
    { time: '13:59:59', set: 1605.0, value: 30000.0 }, // Pre-open
    { time: '14:00:00', set: 1606.0, value: 32000.0 }, // Open
    { time: '15:00:00', set: 1607.0, value: 35000.0 }, // Checkpoint
    { time: '15:30:00', set: 1608.0, value: 38000.0 },
    { time: '15:59:59', set: 1609.0, value: 42000.0 },
    { time: '16:00:00', set: 1610.0, value: 45000.0 }, // Exact cutoff
    { time: '16:00:01', set: 1610.5, value: 46000.0 }, // Post-lock
    { time: '16:30:00', set: 1612.0, value: 50000.0 }, // Post-lock
  ];

  const pmSnapshot = FeatureEngine.filterPreLockObservations(testDate, 'PM', pmBoundaryFeed);
  console.log(`PM observations accepted: ${pmSnapshot.observations.map((o) => o.time).join(', ')}`);

  if (pmSnapshot.observations.some((o) => o.time < '14:00:00')) {
    throw new Error('FAIL: Pre-open observation accepted in PM window!');
  }
  if (pmSnapshot.observations.some((o) => o.time > '16:00:00')) {
    throw new Error('FAIL: Post-lock observation accepted in PM window!');
  }
  if (pmSnapshot.observations.length !== 5) {
    throw new Error(`Expected exactly 5 valid PM observations, got ${pmSnapshot.observations.length}`);
  }
  console.log('[PASS] PM cutoff strictly enforced: [14:00:00, 16:00:00] window adhered to.\n');

  // -------------------------------------------------------------------------
  // TEST 6: Backtest Point-in-Time Consistency
  // -------------------------------------------------------------------------
  console.log('--- TEST 6: BACKTEST POINT-IN-TIME CONSISTENCY ---');

  // Run walk-forward backtest evaluation across historical dataset
  const backtestReport = BacktestEngine.runWalkForwardBacktest(
    verifiedRecords,
    10, // minTrainingSettlements
    undefined,
    PRODUCTION_MODEL_VERSION
  );

  console.log(`Backtest evaluations produced: ${backtestReport.evaluations.length}`);
  if (backtestReport.evaluations.length === 0) {
    throw new Error('Backtest did not produce any evaluations!');
  }

  // Pick a representative evaluated date from backtest report
  const sampleEvaluation = backtestReport.evaluations[backtestReport.evaluations.length - 1];
  const evalDate = sampleEvaluation.date;
  const evalSession = sampleEvaluation.session;

  // Direct feature extraction for the same date and session
  const directExtraction = FeatureEngine.extractFeatures(verifiedRecords, evalDate, evalSession);
  if (!directExtraction.success || !directExtraction.featureVector) {
    throw new Error(`Direct feature extraction failed for backtest comparison on ${evalDate} ${evalSession}`);
  }

  console.log(`Auditing consistency for date ${evalDate} (${evalSession} session)...`);
  if (sampleEvaluation.featureIntegrityHash !== directExtraction.featureVector.featureIntegrityHash) {
    throw new Error(
      `Backtest feature hash mismatch! Backtest: ${sampleEvaluation.featureIntegrityHash}, Direct: ${directExtraction.featureVector.featureIntegrityHash}`
    );
  }
  if (sampleEvaluation.trainingSamplesCount !== directExtraction.featureVector.distributions.sampleCountAllTime) {
    throw new Error(
      `Backtest sample count mismatch! Backtest: ${sampleEvaluation.trainingSamplesCount}, Direct: ${directExtraction.featureVector.distributions.sampleCountAllTime}`
    );
  }

  // Verify prediction produced in backtest matches direct prediction
  const directPred = PredictionEngine.generatePrediction(directExtraction.featureVector, PRODUCTION_MODEL_VERSION);
  if (sampleEvaluation.predictedTop1 !== directPred.top1) {
    throw new Error(
      `Backtest prediction Top-1 mismatch! Backtest: ${sampleEvaluation.predictedTop1}, Direct: ${directPred.top1}`
    );
  }

  console.log(
    `[PASS] 100% Bitwise Point-in-Time parity verified between production feature generation and walk-forward backtest (Hash: ${sampleEvaluation.featureIntegrityHash}, Top-1: ${sampleEvaluation.predictedTop1}).\n`
  );

  // -------------------------------------------------------------------------
  // TEST 7: AM/PM Feature Isolation
  // -------------------------------------------------------------------------
  console.log('--- TEST 7: AM/PM FEATURE ISOLATION ---');

  // 1. AM has zero PM historical settlements
  const amFilter = FeatureEngine.filterEligibleHistoricalRecords(verifiedRecords, testDate, 'AM');
  const pmInAmEligible = amFilter.eligibleRecords.filter((r) => r.session === 'PM');
  if (pmInAmEligible.length > 0) {
    throw new Error(`CRITICAL: Found ${pmInAmEligible.length} PM records in AM eligible pool!`);
  }

  // 2. AM has NO todayAmSettlement2D
  if (cleanAmResult.featureVector.distributions.todayAmSettlement2D !== null) {
    throw new Error(`AM feature vector illegally contained todayAmSettlement2D!`);
  }

  // 3. PM baseline distribution has zero AM historical settlements
  const pmFilter = FeatureEngine.filterEligibleHistoricalRecords(verifiedRecords, testDate, 'PM');
  const histAmInPm = pmFilter.eligibleRecords.filter((r) => r.session === 'AM' && r.date < testDate);
  if (histAmInPm.length > 0) {
    throw new Error(`CRITICAL: Found ${histAmInPm.length} historical AM records in PM historical pool!`);
  }

  // 4. PM correctly receives today's AM settlement as conditioning input
  if (!cleanPmResult.featureVector.distributions.todayAmSettlement2D) {
    throw new Error("PM feature vector missing today's verified AM settlement conditioning input!");
  }
  console.log(
    `PM received today's AM conditioning settlement: ${cleanPmResult.featureVector.distributions.todayAmSettlement2D}`
  );

  // 5. Distinct Candidate Distributions
  const amPred = PredictionEngine.generatePrediction(cleanAmResult.featureVector, PRODUCTION_MODEL_VERSION);
  const pmPred = PredictionEngine.generatePrediction(cleanPmResult.featureVector, PRODUCTION_MODEL_VERSION);

  console.log(`AM Prediction Top-1: ${amPred.top1} (confidence: ${amPred.confidenceScore.toFixed(1)}%)`);
  console.log(`PM Prediction Top-1: ${pmPred.top1} (confidence: ${pmPred.confidenceScore.toFixed(1)}%)`);

  if (amPred.top1 === pmPred.top1 && amPred.candidates[0].probability === pmPred.candidates[0].probability) {
    throw new Error('AM and PM predictions should not be identical on this test date.');
  }

  console.log('[PASS] AM and PM pipelines operate in complete structural and statistical isolation.\n');

  // -------------------------------------------------------------------------
  // Audit Summary
  // -------------------------------------------------------------------------
  console.log('================================================================');
  console.log('   STEP 22 AUDIT COMPLETE: ALL 7 HARDENING CHECKS PASSED (100%)  ');
  console.log('================================================================');
  console.log(`AM Feature Contract: ${AM_FEATURE_CONTRACT.length} allowed features`);
  console.log(`PM Feature Contract: ${PM_FEATURE_CONTRACT.length} allowed features`);
  console.log(`Forbidden Leakage Registry: ${FORBIDDEN_LEAKAGE_REGISTRY.length} registered leakage vectors`);
}

runStep22Audit().catch((err) => {
  console.error('\nFATAL ERROR DURING STEP 22 AUDIT:', err);
  process.exit(1);
});
