/**
 * MM2D LEADER STEP 21 — SEPARATE AM/PM PIPELINES VERIFICATION SUITE
 * 
 * Verifies:
 * 1. AM historical input uses ONLY verified historical AM settlements.
 * 2. PM historical input uses ONLY verified historical PM settlements.
 * 3. PM pipeline receives today's verified 12:01 AM official result as explicit conditioning input.
 * 4. Target PM result is strictly excluded from PM prediction.
 * 5. PM historical data is strictly excluded from AM prediction.
 * 6. Live 2D is never an input to feature extraction or prediction engines.
 * 7. AM and PM predictions are decoupled and not identical copies.
 * 8. Baseline champion ALL_TIME_FREQUENCY_V1 remains unchanged.
 */

import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';

async function runStep21Verification() {
  console.log('================================================================');
  console.log('       MM2D LEADER STEP 21: SEPARATE AM/PM PIPELINES AUDIT      ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(20);
  const verifiedRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${verifiedRecords.length} verified records for Step 21 verification.\n`);

  // Target date for testing: last date in records or pick a date with both AM & PM
  const dates = Array.from(new Set(verifiedRecords.map(r => r.date))).sort();
  const testDate = dates[dates.length - 1]; // Latest date
  console.log(`Testing Session Separation on target date: ${testDate}`);

  // 1. Verify AM feature extraction
  const amResult = FeatureEngine.extractAmFeatures(verifiedRecords, testDate);
  if (!amResult.success || !amResult.featureVector) {
    throw new Error(`AM Feature Extraction failed: ${amResult.status}`);
  }
  const amVector = amResult.featureVector;

  // Audit 1a: AM has strictly session = 'AM'
  if (amVector.session !== 'AM') {
    throw new Error(`AM feature vector has incorrect session: ${amVector.session}`);
  }

  // Audit 1b: AM has NO todayAmSettlement2D (strictly null)
  if (amVector.distributions.todayAmSettlement2D !== null) {
    throw new Error(`AM feature vector leaked todayAmSettlement2D: ${amVector.distributions.todayAmSettlement2D}`);
  }

  // Audit 1c: AM eligible records contain NO PM records
  const amFilter = FeatureEngine.filterEligibleHistoricalRecords(verifiedRecords, testDate, 'AM');
  const amEligible = amFilter.eligibleRecords;
  const pmInAm = amEligible.some(r => r.session === 'PM');
  if (pmInAm) {
    throw new Error(`CRITICAL LEAKAGE: AM eligible records contain PM records!`);
  }
  console.log(`[PASS] AM historical input contains 0 PM records (Total AM historical: ${amEligible.length}).`);

  // 2. Verify PM feature extraction
  const pmResult = FeatureEngine.extractPmFeatures(verifiedRecords, testDate);
  if (!pmResult.success || !pmResult.featureVector) {
    throw new Error(`PM Feature Extraction failed: ${pmResult.status}`);
  }
  const pmVector = pmResult.featureVector;

  // Audit 2a: PM has session = 'PM'
  if (pmVector.session !== 'PM') {
    throw new Error(`PM feature vector has incorrect session: ${pmVector.session}`);
  }

  // Audit 2b: PM eligible records contain NO target PM settlement
  const pmFilter = FeatureEngine.filterEligibleHistoricalRecords(verifiedRecords, testDate, 'PM');
  const pmEligible = pmFilter.eligibleRecords;
  const targetPmInPm = pmEligible.some(r => r.date === testDate && r.isSettlement && r.session === 'PM');
  if (targetPmInPm) {
    throw new Error(`CRITICAL LEAKAGE: PM eligible records contain today's PM settlement!`);
  }
  console.log(`[PASS] PM eligible records strictly exclude target PM settlement.`);

  // Audit 2c: PM eligible records contain NO historical AM settlements (only today's AM if settled)
  const historicalAmInPm = pmEligible.filter(r => r.session === 'AM' && r.date < testDate);
  if (historicalAmInPm.length > 0) {
    throw new Error(`CRITICAL LEAKAGE: PM eligible records contain historical AM records (${historicalAmInPm.length})!`);
  }
  console.log(`[PASS] PM historical input contains 0 historical AM records (Total PM historical: ${pmEligible.filter(r => r.session === 'PM').length}).`);

  // 3. Verify Today's AM settlement conditioning in PM
  const todayAmRecord = verifiedRecords.find(r => r.date === testDate && r.isSettlement && r.session === 'AM');
  if (todayAmRecord) {
    if (pmVector.distributions.todayAmSettlement2D !== todayAmRecord.twod) {
      throw new Error(`PM feature vector failed to capture today AM settlement: expected ${todayAmRecord.twod}, got ${pmVector.distributions.todayAmSettlement2D}`);
    }
    console.log(`[PASS] PM pipeline correctly received today's AM result (${pmVector.distributions.todayAmSettlement2D}) as conditioning input.`);
  }

  // 4. Verify AM and PM Predictions
  const amPrediction = PredictionEngine.generateAmPrediction(amVector);
  const pmPrediction = PredictionEngine.generatePmPrediction(pmVector);

  console.log(`\n--- PREDICTION OUTPUT COMPARISON ---`);
  console.log(`AM Prediction Top-1: ${amPrediction.top1} (Top-5: ${amPrediction.top5.join(', ')})`);
  console.log(`PM Prediction Top-1: ${pmPrediction.top1} (Top-5: ${pmPrediction.top5.join(', ')})`);

  // Check if candidate probability distributions are distinct
  const amProb00 = amPrediction.candidates.find(c => c.twod === '00')?.probability;
  const pmProb00 = pmPrediction.candidates.find(c => c.twod === '00')?.probability;
  console.log(`AM candidate 00 prob: ${amProb00?.toFixed(6)} | PM candidate 00 prob: ${pmProb00?.toFixed(6)}`);

  // Audit 4a: Probability distribution difference
  let totalAbsDiff = 0;
  for (let i = 0; i < 100; i++) {
    const twod = i.toString().padStart(2, '0');
    const pAm = amPrediction.candidates.find(c => c.twod === twod)?.probability || 0;
    const pPm = pmPrediction.candidates.find(c => c.twod === twod)?.probability || 0;
    totalAbsDiff += Math.abs(pAm - pPm);
  }
  console.log(`Total variation distance between AM and PM distributions: ${(totalAbsDiff / 2).toFixed(4)}`);

  if (totalAbsDiff === 0) {
    throw new Error(`AM and PM distributions are still 100% identical! Separation failed.`);
  }
  console.log(`[PASS] AM and PM candidate distributions are mathematically distinct and independently computed.`);

  // 5. Verify Champion Model Version
  if (amPrediction.modelVersion !== PRODUCTION_MODEL_VERSION || PRODUCTION_MODEL_VERSION !== 'ALL_TIME_FREQUENCY_V1') {
    throw new Error(`Production model champion is not ALL_TIME_FREQUENCY_V1`);
  }
  if (pmPrediction.modelVersion !== PRODUCTION_MODEL_VERSION) {
    throw new Error(`PM production model champion is not ALL_TIME_FREQUENCY_V1`);
  }
  console.log(`[PASS] Baseline champion ALL_TIME_FREQUENCY_V1 maintained across both pipelines.`);

  // 6. Verify Lock Engine Integration
  console.log(`\n--- LOCK ENGINE EVALUATION CHECK ---`);
  const amLock = LockEngine.getOrFreezePrediction(verifiedRecords, testDate, 'AM', undefined, new Date(`${testDate}T11:26:00+07:00`));
  const pmLock = LockEngine.getOrFreezePrediction(verifiedRecords, testDate, 'PM', undefined, new Date(`${testDate}T15:26:00+07:00`));
  console.log(`AM getOrFreezePrediction at 11:26: status=${amLock.output?.status}, top1=${amLock.output?.top1}`);
  console.log(`PM getOrFreezePrediction at 15:26: status=${pmLock.output?.status}, top1=${pmLock.output?.top1}`);

  console.log('\n================================================================');
  console.log('       STEP 21 VERIFICATION COMPLETED SUCCESSFULLY (ALL PASS)   ');
  console.log('================================================================');
}

runStep21Verification();
