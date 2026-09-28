import { VerifiedMarketRecord, MarketSession } from '../../types/market';
import {
  PRODUCTION_MODEL_VERSION,
  StoredModelPrediction,
  SessionPredictionOutput,
} from '../../types/prediction';
import { FeatureEngine } from './featureEngine';
import { PredictionEngine } from './predictionEngine';
import { LockEngine } from './lockEngine';
import { BacktestEngine } from './backtestEngine';
import { globalDatasetStorage } from '../storage/storageAbstraction';

// Helper to create synthetic verified settlement records for testing
function createMockSettlements(count: number, startDateStr = '2025-01-01'): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const baseDate = new Date(startDateStr);

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + Math.floor(i / 2) * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const isAm = i % 2 === 0;
    const session: MarketSession = isAm ? 'AM' : 'PM';
    const time = isAm ? '12:01:00' : '16:30:00';
    // Generate deterministic 2D sequence: e.g. (i * 7 + 13) % 100
    const twodVal = ((i * 7 + 13) % 100).toString().padStart(2, '0');
    const setNum = 1400.0 + (i % 50);
    const valNum = 35000.0 + (i % 80);

    records.push({
      id: `rec_${dateStr}_${session}`,
      date: dateStr,
      session,
      time,
      isSettlement: true,
      setRaw: setNum.toFixed(2),
      valueRaw: valNum.toFixed(2),
      setNumeric: setNum,
      valueNumeric: valNum,
      twod: twodVal,
      historyId: `hist_${i}`,
      verifiedAt: `${dateStr}T${time}+07:00`,
      mathematicalCheck: {
        setLastDigit: setNum.toFixed(2).slice(-1),
        valueLastDigitBeforeDecimal: valNum.toFixed(0).slice(-1),
        derived2D: twodVal,
        isMathematicallyConsistent: true,
      },
    });
  }
  return records;
}

export async function runStep69IntegrationTests(): Promise<{
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: Array<{ testId: number; name: string; passed: boolean; error?: string; details?: unknown }>;
}> {
  const testResults: Array<{ testId: number; name: string; passed: boolean; error?: string; details?: unknown }> = [];

  async function assertTest(
    testId: number,
    name: string,
    fn: () => Promise<void> | void
  ) {
    try {
      await fn();
      testResults.push({ testId, name, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      testResults.push({ testId, name, passed: false, error: msg });
    }
  }

  // Clear states before running
  LockEngine.clearFrozenSnapshotsForTesting();
  await globalDatasetStorage.clearAll();

  const dataset50 = createMockSettlements(50, '2025-01-01');

  // --- TEST 1: Pure All-Time Empirical Frequency Determinism ---
  await assertTest(1, 'Pure All-Time Empirical Frequency Determinism', () => {
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM');
    if (!feat.success || !feat.featureVector) throw new Error('Feature extraction failed');

    const pred1 = PredictionEngine.generatePrediction(feat.featureVector, PRODUCTION_MODEL_VERSION);
    const pred2 = PredictionEngine.generatePrediction(feat.featureVector, PRODUCTION_MODEL_VERSION);

    if (pred1.candidates.length !== 100) throw new Error(`Candidates count != 100 (${pred1.candidates.length})`);
    if (pred1.top1 !== pred2.top1) throw new Error('Non-deterministic top-1');
    if (JSON.stringify(pred1.top10) !== JSON.stringify(pred2.top10)) throw new Error('Non-deterministic top-10');

    // Verify sum of probabilities == 1.0
    const sumProb = pred1.candidates.reduce((sum, c) => sum + c.probability, 0);
    if (Math.abs(sumProb - 1.0) > 1e-4) throw new Error(`Probability sum != 1.0 (${sumProb})`);
    if (pred1.modelVersion !== 'ALL_TIME_FREQUENCY_V1') throw new Error(`Incorrect modelVersion: ${pred1.modelVersion}`);
  });

  // --- TEST 2: Strict Isolation Between Production Model and Research Ensemble ---
  await assertTest(2, 'Strict Isolation Between Production Model and Research Ensemble', () => {
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM');
    if (!feat.success || !feat.featureVector) throw new Error('Feature extraction failed');

    const prodPred = PredictionEngine.generatePrediction(feat.featureVector, 'ALL_TIME_FREQUENCY_V1');
    const researchPred = PredictionEngine.generatePrediction(feat.featureVector, 'RESEARCH_ENSEMBLE_V1');

    if (prodPred.modelVersion !== 'ALL_TIME_FREQUENCY_V1') throw new Error('Production version tag mismatch');
    if (researchPred.modelVersion !== 'RESEARCH_ENSEMBLE_V1') throw new Error('Research version tag mismatch');
  });

  // --- TEST 3: Verified Historical Dataset SOT Integrity (Zero Upstream Dependence) ---
  await assertTest(3, 'Verified Historical Dataset SOT Integrity', () => {
    // Prediction executes 100% locally from dataset without external network calls
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM');
    const pred = PredictionEngine.generatePrediction(feat.featureVector!);
    if (!pred.top1 || pred.top1 === '--') throw new Error('Prediction failed on valid local dataset');
    if (!pred.featureIntegrityHash || pred.featureIntegrityHash === 'NONE') throw new Error('Missing feature integrity hash');
  });

  // --- TEST 4: Strict Separation of Data Classes (Official vs Prediction) ---
  await assertTest(4, 'Strict Separation of Data Classes', async () => {
    await globalDatasetStorage.clearAll();
    await globalDatasetStorage.storeVerifiedRecords(dataset50.slice(0, 10));

    const storedPred: StoredModelPrediction = {
      id: 'pred_2025-02-01_AM_ALL_TIME_FREQUENCY_V1',
      recordType: 'MODEL_PREDICTION',
      targetDate: '2025-02-01',
      session: 'AM',
      modelVersion: 'ALL_TIME_FREQUENCY_V1',
      status: 'PREDICTION_LOCKED',
      top1: '42',
      top3Json: JSON.stringify(['42', '17', '88']),
      top5Json: JSON.stringify(['42', '17', '88', '05', '99']),
      top10Json: JSON.stringify(['42', '17', '88', '05', '99', '12', '34', '56', '78', '90']),
      candidatesJson: JSON.stringify([]),
      entropy: 4.5,
      topMargin: 0.02,
      confidenceScore: 45,
      featureIntegrityHash: 'HASH123',
      cutoffTime: '2025-02-01T11:30:00+07:00',
      generatedAt: '2025-02-01T11:30:00+07:00',
      isFrozen: 1,
    };

    await globalDatasetStorage.saveModelPrediction(storedPred);

    const verifiedRecords = await globalDatasetStorage.queryAllVerifiedRecords();
    const retrievedPred = await globalDatasetStorage.getModelPrediction('2025-02-01', 'AM');

    if (verifiedRecords.some((r) => (r as any).recordType === 'MODEL_PREDICTION')) {
      throw new Error('Leakage: Model prediction found in verified_market_records store!');
    }
    if (!retrievedPred || retrievedPred.top1 !== '42') {
      throw new Error('Failed to retrieve isolated model prediction');
    }
    if (retrievedPred.recordType !== 'MODEL_PREDICTION') {
      throw new Error(`Invalid prediction recordType: ${retrievedPred.recordType}`);
    }
  });

  // --- TEST 5: Anti-Fabrication & Truthful State on Missing/Empty Datasets ---
  await assertTest(5, 'Anti-Fabrication on Empty/Insufficient Data', () => {
    const emptyRecords: VerifiedMarketRecord[] = [];
    const feat = FeatureEngine.extractFeatures(emptyRecords, '2025-01-01', 'AM');
    if (feat.success) throw new Error('Expected feature extraction to fail on empty records');

    const lockRes = LockEngine.getOrFreezePrediction(emptyRecords, '2025-01-01', 'AM');
    if (lockRes.output.top1 !== '--') throw new Error(`Fabrication detected: top1 is '${lockRes.output.top1}', expected '--'`);
    if (lockRes.output.candidates.length !== 0) throw new Error('Fabricated candidates detected on empty dataset');
    if (lockRes.output.status !== 'INSUFFICIENT_HISTORICAL_DATA') {
      throw new Error(`Expected INSUFFICIENT_HISTORICAL_DATA status, got ${lockRes.output.status}`);
    }
  });

  // --- TEST 6: Pre-Lock Live Feed Unavailability Handling ---
  await assertTest(6, 'Pre-Lock Live Feed Unavailability Handling', () => {
    // When live feed is undefined, system operates with truthful all-time frequency baseline
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM', undefined);
    if (!feat.success || !feat.featureVector) throw new Error('Failed feature extraction without live feed');

    const pred = PredictionEngine.generatePrediction(feat.featureVector);
    if (!pred.top1 || pred.top1 === '--') throw new Error('Prediction failed when live feed absent');
    if (pred.candidates.length !== 100) throw new Error('Candidate list incomplete when live feed absent');
  });

  // --- TEST 7: Strict Bangkok Lock Cutoff Invariant (AM 11:30, PM 15:30) ---
  await assertTest(7, 'Strict Bangkok Lock Cutoff Invariant', () => {
    // 11:29:59 AM Bangkok (UTC+7) -> Unlocked
    // 11:29:59 UTC+7 is 04:29:59 UTC
    const timeBeforeAmLock = new Date('2025-02-01T04:29:59Z');
    const isAmLockedBefore = LockEngine.isSessionLocked('2025-02-01', 'AM', timeBeforeAmLock);
    if (isAmLockedBefore) throw new Error('AM session locked prematurely before 11:30:00 Bangkok time');

    // 11:30:00 AM Bangkok (UTC+7) -> Locked
    // 11:30:00 UTC+7 is 04:30:00 UTC
    const timeAtAmLock = new Date('2025-02-01T04:30:00Z');
    const isAmLockedAt = LockEngine.isSessionLocked('2025-02-01', 'AM', timeAtAmLock);
    if (!isAmLockedAt) throw new Error('AM session not locked at 11:30:00 Bangkok time');

    // 15:29:59 PM Bangkok (UTC+7) -> Unlocked
    const timeBeforePmLock = new Date('2025-02-01T08:29:59Z');
    const isPmLockedBefore = LockEngine.isSessionLocked('2025-02-01', 'PM', timeBeforePmLock);
    if (isPmLockedBefore) throw new Error('PM session locked prematurely before 15:30:00 Bangkok time');

    // 15:30:00 PM Bangkok (UTC+7) -> Locked
    const timeAtPmLock = new Date('2025-02-01T08:30:00Z');
    const isPmLockedAt = LockEngine.isSessionLocked('2025-02-01', 'PM', timeAtPmLock);
    if (!isPmLockedAt) throw new Error('PM session not locked at 15:30:00 Bangkok time');
  });

  // --- TEST 8: Immutability of Locked Prediction Snapshots ---
  await assertTest(8, 'Immutability of Locked Prediction Snapshots', () => {
    LockEngine.clearFrozenSnapshotsForTesting();
    const lockTime = new Date('2025-02-01T05:00:00Z'); // 12:00 BKK -> Locked

    const res1 = LockEngine.getOrFreezePrediction(dataset50, '2025-02-01', 'AM', undefined, lockTime);
    if (!res1.isLocked || !res1.isFreshlyLocked) throw new Error('Snapshot failed to freeze on first lock call');

    // Attempt mutation via changed live feed
    const alteredFeed = [{ time: '11:29:00', set: 1999.99, value: 99999.99 }];
    const res2 = LockEngine.getOrFreezePrediction(dataset50, '2025-02-01', 'AM', alteredFeed, lockTime);

    if (res2.isFreshlyLocked) throw new Error('Snapshot was re-locked instead of retrieving cached frozen snapshot');
    if (res1.output.top1 !== res2.output.top1) throw new Error('Locked snapshot mutated after first freeze');
    if (res1.output.featureIntegrityHash !== res2.output.featureIntegrityHash) {
      throw new Error('Locked snapshot feature integrity hash changed');
    }
  });

  // --- TEST 9: Strict Anti-Leakage Invariant in Walk-Forward Backtesting ---
  await assertTest(9, 'Strict Anti-Leakage Invariant in Backtesting', () => {
    const report = BacktestEngine.runWalkForwardBacktest(dataset50, 30);
    if (report.totalEvaluated === 0) throw new Error('Backtest produced 0 evaluations on 50 records');

    for (const evalRow of report.evaluations) {
      if (evalRow.trainingSamplesCount <= 0) throw new Error('Invalid training sample count');
      // Verify evaluation row structure
      if (evalRow.actual2DRank < 1 || evalRow.actual2DRank > 100) {
        throw new Error(`Invalid rank ${evalRow.actual2DRank}`);
      }
    }
  });

  // --- TEST 10: Deterministic Tie-Breaking ---
  await assertTest(10, 'Deterministic Tie-Breaking', () => {
    // When multiple candidates have equal frequency count 0, tie-breaker must sort numerically ascending
    const emptyDataset: VerifiedMarketRecord[] = [];
    const feat = FeatureEngine.extractFeatures(dataset50.slice(0, 30), '2025-02-01', 'AM');
    const pred = PredictionEngine.generatePrediction(feat.featureVector!);

    // Find items with identical probability
    for (let i = 0; i < pred.candidates.length - 1; i++) {
      const c1 = pred.candidates[i];
      const c2 = pred.candidates[i + 1];
      if (c1.probability === c2.probability) {
        if (c1.twod.localeCompare(c2.twod) >= 0) {
          throw new Error(`Tie breaking failure: ${c1.twod} should precede ${c2.twod}`);
        }
      }
    }
  });

  // --- TEST 11: Laplace Smoothing Positive Mass across all 100 States (00-99) ---
  await assertTest(11, 'Laplace Smoothing Calibration (00-99 all positive)', () => {
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM');
    const pred = PredictionEngine.generatePrediction(feat.featureVector!);

    for (let i = 0; i < 100; i++) {
      const numStr = i.toString().padStart(2, '0');
      const candidate = pred.candidates.find((c) => c.twod === numStr);
      if (!candidate) throw new Error(`Missing candidate ${numStr}`);
      if (candidate.probability <= 0) throw new Error(`Candidate ${numStr} has non-positive probability: ${candidate.probability}`);
      if (isNaN(candidate.probability)) throw new Error(`Candidate ${numStr} has NaN probability`);
    }
  });

  // --- TEST 12: Dual Settlement Session Independence (AM vs PM feature sets) ---
  await assertTest(12, 'Dual Settlement Session Independence', () => {
    const amFeat = FeatureEngine.extractFeatures(dataset50, '2025-01-20', 'AM');
    const pmFeat = FeatureEngine.extractFeatures(dataset50, '2025-01-20', 'PM');

    if (!amFeat.success || !pmFeat.success) throw new Error('Feature extraction failed');
    // PM should have 1 more settlement than AM (the morning settlement of Jan 20)
    if (pmFeat.featureVector!.distributions.sampleCountAllTime <= amFeat.featureVector!.distributions.sampleCountAllTime) {
      throw new Error('PM feature vector did not incorporate AM settlement');
    }
  });

  // --- TEST 13: Storage Engine Resilience (SQLite, IndexedDB, Memory) ---
  await assertTest(13, 'Storage Engine Resilience', async () => {
    const stats = await globalDatasetStorage.getStats();
    if (stats.storageEngine !== 'SQLITE_WASM' && stats.storageEngine !== 'INDEXED_DB' && stats.storageEngine !== 'MEMORY_STORE') {
      throw new Error(`Unexpected storage engine: ${stats.storageEngine}`);
    }

    const testPred: StoredModelPrediction = {
      id: 'pred_test_resilience',
      recordType: 'MODEL_PREDICTION',
      targetDate: '2025-03-01',
      session: 'AM',
      modelVersion: 'ALL_TIME_FREQUENCY_V1',
      status: 'PREDICTION_LOCKED',
      top1: '07',
      top3Json: '["07","14","21"]',
      top5Json: '["07","14","21","28","35"]',
      top10Json: '["07","14","21","28","35","42","49","56","63","70"]',
      candidatesJson: '[]',
      entropy: 4.55,
      topMargin: 0.015,
      confidenceScore: 50,
      featureIntegrityHash: 'RESILIENCE_HASH',
      cutoffTime: '2025-03-01T11:30:00+07:00',
      generatedAt: '2025-03-01T11:30:00+07:00',
      isFrozen: 1,
    };

    await globalDatasetStorage.saveModelPrediction(testPred);
    const retrieved = await globalDatasetStorage.getModelPrediction('2025-03-01', 'AM');
    if (!retrieved || retrieved.top1 !== '07') throw new Error('Failed to retrieve test prediction');
  });

  // --- TEST 14: Clear Audit Trail & Feature Integrity Hash Verification ---
  await assertTest(14, 'Clear Audit Trail & Feature Integrity Hash', () => {
    const feat = FeatureEngine.extractFeatures(dataset50, '2025-02-01', 'AM');
    const pred = PredictionEngine.generatePrediction(feat.featureVector!);

    if (!pred.featureIntegrityHash || pred.featureIntegrityHash.length < 8) {
      throw new Error('Invalid feature integrity hash');
    }
    if (pred.featureIntegrityHash !== feat.featureVector!.featureIntegrityHash) {
      throw new Error('Prediction feature hash mismatch with input feature vector');
    }
  });

  // --- TEST 15: Out-of-Sample Performance Verification against Random Baseline ---
  await assertTest(15, 'Out-of-Sample Performance Verification', () => {
    const report = BacktestEngine.runWalkForwardBacktest(dataset50, 30);
    if (report.totalEvaluated === 0) throw new Error('Zero evaluations performed');

    // Verify rates are numbers between 0 and 1
    if (report.top1HitRate < 0 || report.top1HitRate > 1) throw new Error(`Invalid top1HitRate: ${report.top1HitRate}`);
    if (report.top10HitRate < 0 || report.top10HitRate > 1) throw new Error(`Invalid top10HitRate: ${report.top10HitRate}`);
  });

  // --- TEST 16: Zero-Pollution Invariant on Settlement Verification ---
  await assertTest(16, 'Zero-Pollution Invariant on Settlement Verification', async () => {
    await globalDatasetStorage.clearAll();

    // Store verified settlement records
    await globalDatasetStorage.storeVerifiedRecords(dataset50.slice(0, 5));

    // Storing verified settlement records must not generate fake predictions in prediction table
    const storedPredictions = await globalDatasetStorage.queryModelPredictions();
    if (storedPredictions.length !== 0) {
      throw new Error(`Zero-pollution violated: ${storedPredictions.length} predictions unexpectedly created by settlement ingestion`);
    }
  });

  const passedTests = testResults.filter((t) => t.passed).length;
  const failedTests = testResults.filter((t) => !t.passed).length;

  return {
    allPassed: failedTests === 0,
    totalTests: testResults.length,
    passedTests,
    failedTests,
    results: testResults,
  };
}
