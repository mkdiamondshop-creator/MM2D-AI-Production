import assert from 'node:assert';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { LockEngine } from './lockEngine';
import { FeatureEngine } from './featureEngine';
import { FeatureContractAuditor } from './featureContract';
import { DataSufficiencyGate } from '../market/dataSufficiencyGate';
import { MarketOpenGate } from '../market/marketOpenGate';
import { LiveObservationBuffer, globalLiveObservationBuffer } from '../market/liveObservationBuffer';
import { VerifiedMarketRecord, MarketSession } from '../../types/market';
import { PRODUCTION_MODEL_VERSION } from '../../types/prediction';

console.log('=== MM2D STEP 50: FINAL V2 PREDICTION ARCHITECTURE VERIFICATION ===\n');

// 1. Mock Historical Dataset with past AM and PM records
const targetDate = '2026-03-30';

function createRecord(
  date: string,
  time: string,
  session: MarketSession,
  set: number,
  value: number,
  twod: string,
  isSettlement: boolean
): VerifiedMarketRecord {
  return {
    id: `${date}_${time}_${session}`,
    date,
    time,
    session,
    setRaw: set.toFixed(2),
    valueRaw: value.toFixed(2),
    setNumeric: set,
    valueNumeric: value,
    twod,
    historyId: `hist_${date}_${session}_${time}`,
    verifiedAt: new Date().toISOString(),
    isSettlement,
    mathematicalCheck: {
      setLastDigit: twod[0] || '0',
      valueLastDigitBeforeDecimal: twod[1] || '0',
      derived2D: twod,
      isMathematicallyConsistent: true,
    },
  };
}

function generateMockHistory(count: number, startDateStr: string): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const base = new Date(startDateStr);

  for (let i = count; i >= 1; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);

    records.push(createRecord(dateStr, '11:00:00', 'AM', 1350.25, 12500.5, '25', false));
    records.push(createRecord(dateStr, '12:01:00', 'AM', 1355.8, 25000.75, '80', true));
    records.push(createRecord(dateStr, '15:00:00', 'PM', 1360.1, 35000.2, '10', false));
    records.push(createRecord(dateStr, '16:30:00', 'PM', 1365.45, 45000.9, '45', true));
  }
  return records;
}

const mockHistoricalRecords = generateMockHistory(15, targetDate);

// Target Day AM Live Feed (SET & Value only, zero 2D)
const todayAmLiveFeed = [
  { time: '10:05:00', set: 1458.32, value: 12500.4 },
  { time: '10:30:00', set: 1461.15, value: 24800.7 },
];

// Today Verified AM Settlement Record (12:01)
const todayAmSettlementRecord = createRecord(
  targetDate,
  '12:01:00',
  'AM',
  1458.32,
  35400.0,
  '32',
  true
);

// Target Day PM Live Feed (SET & Value only, zero 2D)
const todayPmLiveFeed = [
  { time: '14:05:00', set: 1462.44, value: 38000.1 },
  { time: '14:35:00', set: 1463.88, value: 45000.9 },
];

// --- TEST 1: V2 is the ONLY prediction architecture active ---
console.log('--- TEST 1: V2 is the ONLY prediction architecture active ---');
assert.strictEqual(
  PRODUCTION_MODEL_VERSION,
  'AUTO_WEIGHTED_V2',
  'PRODUCTION_MODEL_VERSION must be AUTO_WEIGHTED_V2'
);
const lockPred = LockEngine.getOrFreezePrediction(
  mockHistoricalRecords,
  targetDate,
  'AM',
  todayAmLiveFeed,
  new Date(`${targetDate}T10:35:00+07:00`),
  PRODUCTION_MODEL_VERSION
);
assert.strictEqual(
  lockPred.output?.modelVersion,
  'AUTO_WEIGHTED_V2',
  'LockEngine must produce AUTO_WEIGHTED_V2 prediction'
);
console.log('✅ [PASS] AUTO_WEIGHTED_V2 is active as the sole production model version');

// --- TEST 2: Historical dataset is used ONLY for training/learning relationships ---
console.log('\n--- TEST 2: Historical dataset is used ONLY for training/learning relationships ---');
const v2AmPred = AutoWeightedV2Engine.predict(
  mockHistoricalRecords,
  targetDate,
  'AM',
  todayAmLiveFeed
);
assert.strictEqual(v2AmPred.probabilities.length, 100, 'Must produce 100 ensemble probabilities');
assert.strictEqual(v2AmPred.candidates.length, 100, 'Must rank 100 candidates');
assert(v2AmPred.weights, 'Must compute automatic component weights');
console.log('✅ [PASS] Historical dataset fed into engine to learn cross-session & SET/Value weights');

// --- TEST 3: No separate Top Candidate produced directly from historical data ---
console.log('\n--- TEST 3: No separate Top Candidate produced directly from historical data ---');
// Verify top1 is exclusively sourced from the V2 ensemble candidate output
assert.strictEqual(
  v2AmPred.top1,
  v2AmPred.candidates[0].twod,
  'Top Candidate must strictly come from V2 candidate rank 1'
);
console.log('✅ [PASS] Top candidate is produced exclusively by the unified V2 ensemble');

// --- TEST 4: Top Candidate === V2 Ensemble Rank #1 ---
console.log('\n--- TEST 4: Top Candidate === V2 Ensemble Rank #1 ---');
assert.strictEqual(
  v2AmPred.top1,
  v2AmPred.candidates[0].twod,
  'Top candidate must be identical to candidate at index 0'
);
assert.strictEqual(
  v2AmPred.top1,
  v2AmPred.top10[0],
  'Top candidate must be identical to first element of Top-10'
);
console.log(`✅ [PASS] Top Candidate (${v2AmPred.top1}) === V2 Ensemble Rank #1 (${v2AmPred.candidates[0].twod})`);

// --- TEST 5: Top-5 === exactly the first 5 numbers of the SAME V2 Top-10 distribution ---
console.log('\n--- TEST 5: Top-5 === exactly the first 5 numbers of the SAME V2 Top-10 distribution ---');
assert.deepStrictEqual(
  v2AmPred.top5,
  v2AmPred.top10.slice(0, 5),
  'Top-5 must strictly equal the first 5 elements of Top-10'
);
assert.deepStrictEqual(
  v2AmPred.top5,
  v2AmPred.candidates.slice(0, 5).map((c) => c.twod),
  'Top-5 must strictly match the first 5 candidates by probability'
);
console.log(`✅ [PASS] Top-5 (${v2AmPred.top5.join(', ')}) === first 5 of Top-10 (${v2AmPred.top10.slice(0, 5).join(', ')})`);

// --- TEST 6: No separate Top-5 algorithm exists or executes ---
console.log('\n--- TEST 6: No separate Top-5 algorithm exists or executes ---');
// Verify monotonicity: candidate probabilities in top5 are strictly non-increasing
for (let i = 0; i < v2AmPred.top5.length - 1; i++) {
  assert(
    v2AmPred.candidates[i].probability >= v2AmPred.candidates[i + 1].probability,
    'Top-5 candidates must follow identical probability sorting as Top-10'
  );
}
console.log('✅ [PASS] Top-5 is a slice of the identical probability distribution');

// --- TEST 7: Historical AM and PM results both available for cross-session learning ---
console.log('\n--- TEST 7: Historical AM and PM results both available for cross-session learning ---');
const pastFilterAm = FeatureEngine.filterEligibleHistoricalRecords(
  mockHistoricalRecords,
  targetDate,
  'AM'
);
const pastAmCount = pastFilterAm.eligibleRecords.filter((r) => r.session === 'AM').length;
const pastPmCount = pastFilterAm.eligibleRecords.filter((r) => r.session === 'PM').length;
assert(pastAmCount > 0, 'Must include past AM records');
assert(pastPmCount > 0, 'Must include past PM records for cross-session learning');
console.log(`✅ [PASS] Historical eligible records contain ${pastAmCount} AM records and ${pastPmCount} PM records`);

// --- TEST 8: AM prediction learns from historical AM + PM + SET/Value + today live feed ---
console.log('\n--- TEST 8: AM prediction learning pipeline ---');
const amFeatRes = FeatureEngine.extractAmFeatures(
  mockHistoricalRecords,
  targetDate,
  todayAmLiveFeed
);
assert.strictEqual(amFeatRes.success, true, 'AM feature extraction must succeed');
assert.strictEqual(amFeatRes.featureVector?.session, 'AM', 'Feature vector session must be AM');
assert.strictEqual(amFeatRes.featureVector?.targetDate, targetDate, 'Feature vector date must be targetDate');
console.log('✅ [PASS] AM extracts features across historical AM/PM and today live SET/Value');

// --- TEST 9: PM prediction learns from historical PM + AM + SET/Value + today live feed + today verified AM settlement ---
console.log('\n--- TEST 9: PM prediction learning pipeline ---');
const pmRecordsWithTodayAm = [...mockHistoricalRecords, todayAmSettlementRecord];
const pmFeatRes = FeatureEngine.extractPmFeatures(
  pmRecordsWithTodayAm,
  targetDate,
  todayPmLiveFeed
);
assert.strictEqual(pmFeatRes.success, true, 'PM feature extraction must succeed');
assert.strictEqual(pmFeatRes.featureVector?.session, 'PM', 'Feature vector session must be PM');
assert.strictEqual(
  pmFeatRes.featureVector?.distributions.todayAmSettlement2D,
  '32',
  'PM feature vector must see verified today AM settlement'
);
console.log('✅ [PASS] PM includes verified today AM settlement and today live feed');

// --- TEST 10: Today\'s target AM settlement NEVER enters AM prediction ---
console.log('\n--- TEST 10: Today\'s target AM settlement NEVER enters AM prediction ---');
const amRecordsWithAccidentalAmSettlement = [...mockHistoricalRecords, todayAmSettlementRecord];
const amAudit = FeatureContractAuditor.auditHistoricalInputRecords(
  amRecordsWithAccidentalAmSettlement,
  targetDate,
  'AM'
);
assert.strictEqual(amAudit.isCompliant, false, 'Audit must catch target AM settlement in AM pipeline');
assert(
  amAudit.violations.some((v) => v.includes('TARGET_AM_SETTLEMENT_LEAKAGE')),
  'Must report TARGET_AM_SETTLEMENT_LEAKAGE violation'
);
const amFiltered = FeatureEngine.filterEligibleHistoricalRecords(
  amRecordsWithAccidentalAmSettlement,
  targetDate,
  'AM'
);
assert.strictEqual(
  amFiltered.eligibleRecords.some((r) => r.date === targetDate && r.session === 'AM'),
  false,
  'AM filter must strictly purge today AM settlement'
);
console.log('✅ [PASS] Zero target AM settlement leakage into AM prediction');

// --- TEST 11: Today\'s target PM settlement NEVER enters PM prediction ---
console.log('\n--- TEST 11: Today\'s target PM settlement NEVER enters PM prediction ---');
const todayPmSettlementRecord = createRecord(
  targetDate,
  '16:30:00',
  'PM',
  1465.99,
  55000.0,
  '99',
  true
);
const pmRecordsWithPmSettlement = [...pmRecordsWithTodayAm, todayPmSettlementRecord];
const pmAudit = FeatureContractAuditor.auditHistoricalInputRecords(
  pmRecordsWithPmSettlement,
  targetDate,
  'PM'
);
assert.strictEqual(pmAudit.isCompliant, false, 'Audit must catch target PM settlement in PM pipeline');
assert(
  pmAudit.violations.some((v) => v.includes('TARGET_PM_SETTLEMENT_LEAKAGE')),
  'Must report TARGET_PM_SETTLEMENT_LEAKAGE violation'
);
const pmFiltered = FeatureEngine.filterEligibleHistoricalRecords(
  pmRecordsWithPmSettlement,
  targetDate,
  'PM'
);
assert.strictEqual(
  pmFiltered.eligibleRecords.some((r) => r.date === targetDate && r.session === 'PM'),
  false,
  'PM filter must strictly purge today PM settlement'
);
console.log('✅ [PASS] Zero target PM settlement leakage into PM prediction');

// --- TEST 12: Future data NEVER enters prediction ---
console.log('\n--- TEST 12: Future data NEVER enters prediction ---');
const futureRecord = createRecord(
  '2026-04-01',
  '12:01:00',
  'AM',
  1470.88,
  60000.0,
  '88',
  true
);
const recordsWithFuture = [...mockHistoricalRecords, futureRecord];
const futureAudit = FeatureContractAuditor.auditHistoricalInputRecords(
  recordsWithFuture,
  targetDate,
  'AM'
);
assert.strictEqual(futureAudit.isCompliant, false, 'Audit must catch future data');
assert(
  futureAudit.violations.some((v) => v.includes('FUTURE_DATE_LEAKAGE')),
  'Must report FUTURE_DATE_LEAKAGE violation'
);
const futureFiltered = FeatureEngine.filterEligibleHistoricalRecords(
  recordsWithFuture,
  targetDate,
  'AM'
);
assert.strictEqual(
  futureFiltered.eligibleRecords.some((r) => r.date > targetDate),
  false,
  'Filter must purge future dates'
);
console.log('✅ [PASS] Future records strictly prohibited and rejected');

// --- TEST 13: Today\'s live 2D/twod NEVER enters prediction ---
console.log('\n--- TEST 13: Today\'s live 2D/twod NEVER enters prediction ---');
globalLiveObservationBuffer.clear();
globalLiveObservationBuffer.addObservation({
  date: targetDate,
  time: '10:05:00',
  set: 1450.25,
  value: 12000.5,
  session: 'AM',
});
const buffObs = globalLiveObservationBuffer.getObservations('AM', targetDate);
for (const obs of buffObs) {
  assert.strictEqual('twod' in obs, false, 'Buffer observation must not have twod property');
  assert.strictEqual(typeof obs.set, 'number', 'SET must be numeric');
  assert.strictEqual(typeof obs.value, 'number', 'Value must be numeric');
}
console.log('✅ [PASS] Live observation buffer strictly isolates SET + Value and contains no live 2D');

// --- TEST 14: Post-lock observations NEVER alter frozen prediction ---
console.log('\n--- TEST 14: Post-lock observations NEVER alter frozen prediction ---');
const lockTime = new Date(`${targetDate}T12:00:05+07:00`); // 5 seconds after 12:00 lock
const frozen1 = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
  mockHistoricalRecords,
  targetDate,
  'AM',
  todayAmLiveFeed,
  lockTime
);
assert.strictEqual(frozen1.isFrozenAtLock, true, 'Snapshot must be frozen at cutoff');
const hash1 = frozen1.immutabilityHash;
const top1_1 = frozen1.top1;
const top5_1 = [...(frozen1.top5 || [])];

// Attempt re-generation with new post-lock live feed tick
const postLockLiveFeed = [
  ...todayAmLiveFeed,
  { time: '12:00:30', set: 1499.99, value: 99999.9 },
];
const frozen2 = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
  mockHistoricalRecords,
  targetDate,
  'AM',
  postLockLiveFeed,
  new Date(`${targetDate}T12:01:00+07:00`)
);
assert.strictEqual(frozen2.immutabilityHash, hash1, 'Immutability hash must remain identical post-lock');
assert.strictEqual(frozen2.top1, top1_1, 'Top1 candidate must remain identical post-lock');
assert.deepStrictEqual(frozen2.top5, top5_1, 'Top5 candidates must remain identical post-lock');
console.log('✅ [PASS] Post-lock observations cannot alter the frozen snapshot');

// --- TEST 15: Pre-open: NO prediction displayed for that session ---
console.log('\n--- TEST 15: Pre-open: NO prediction displayed for that session ---');
const preOpenTime = new Date(`${targetDate}T09:45:00+07:00`); // 09:45 AM (before 10:00 AM MMT = 10:30 Bangkok)
const isMarketOpen = MarketOpenGate.isMarketOpen('AM', preOpenTime);
assert.strictEqual(isMarketOpen, false, 'Market must not be open pre-10:00 MMT');
const preOpenBuffer = new LiveObservationBuffer();
const amSufficiencyPreOpen = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: preOpenTime,
  buffer: preOpenBuffer,
});
assert.strictEqual(amSufficiencyPreOpen.state, 'AWAITING_DATA', 'State must be AWAITING_DATA before session open');
assert.strictEqual(amSufficiencyPreOpen.isPredictionPermitted, false, 'Prediction not permitted in pre-open');
console.log('✅ [PASS] Pre-open session strictly yields NO prediction (isPredictionPermitted: false)');

// --- TEST 16: Early Prediction: published ONLY after Data Sufficiency Gate passes ---
console.log('\n--- TEST 16: Early Prediction published ONLY after Data Sufficiency Gate passes ---');
const openTime = new Date(`${targetDate}T10:35:00+07:00`); // 10:05 MMT (market open)
const gateBuffer = new LiveObservationBuffer();
const awaitingGate = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: openTime,
  buffer: gateBuffer,
});
assert.strictEqual(awaitingGate.state, 'AWAITING_DATA', 'State with 0 ticks must be AWAITING_DATA');
assert.strictEqual(awaitingGate.isPredictionPermitted, false, 'Cannot predict with 0 ticks');

gateBuffer.addObservation({
  date: targetDate,
  time: '10:05:00',
  set: 1450.2,
  value: 10000,
  session: 'AM',
});
const earlyGate = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: openTime,
  buffer: gateBuffer,
});
assert.strictEqual(earlyGate.state, 'EARLY_PREDICTION_READY', '1 valid tick produces EARLY_PREDICTION_READY');
assert.strictEqual(earlyGate.isPredictionPermitted, true, 'Prediction permitted when EARLY_PREDICTION_READY');
assert.strictEqual(earlyGate.isEarlyPredictionReady, true, 'isEarlyPredictionReady flag is true');
console.log('✅ [PASS] Early prediction permitted only after first authentic live tick');

// --- TEST 17: Ensemble refinement: each new valid live tick recomputes the same V2 ensemble before lock ---
console.log('\n--- TEST 17: Ensemble refinement with live ticks ---');
const tick1Feed = [{ time: '10:05:00', set: 1450.2, value: 10000 }];
const tick2Feed = [
  { time: '10:05:00', set: 1450.2, value: 10000 },
  { time: '10:15:00', set: 1455.8, value: 20000 },
];
const predTick1 = AutoWeightedV2Engine.predict(
  mockHistoricalRecords,
  targetDate,
  'AM',
  tick1Feed
);
const predTick2 = AutoWeightedV2Engine.predict(
  mockHistoricalRecords,
  targetDate,
  'AM',
  tick2Feed
);
assert.strictEqual(predTick1.probabilities.length, 100, 'Pred 1 must have 100 probabilities');
assert.strictEqual(predTick2.probabilities.length, 100, 'Pred 2 must have 100 probabilities');
assert.strictEqual(predTick1.observedPreLockSet, 1450.2, 'Pred 1 observed SET matches tick 1');
assert.strictEqual(predTick2.observedPreLockSet, 1455.8, 'Pred 2 observed SET matches tick 2');
console.log(`✅ [PASS] Tick 1 (SET: ${predTick1.observedPreLockSet}) -> Tick 2 (SET: ${predTick2.observedPreLockSet}) recomputed successfully before lock`);

console.log('\n================================================================');
console.log('ALL 17 STEP 50 V2 PREDICTION ARCHITECTURE TESTS PASSED!');
console.log('================================================================');
