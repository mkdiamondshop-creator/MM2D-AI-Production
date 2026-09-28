import { DataSufficiencyGate } from '../market/dataSufficiencyGate';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowTracker } from './autoWeightedV2ShadowTracker';
import { FeatureEngine } from './featureEngine';
import { VerifiedMarketRecord } from '../../types/market';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ [PASS] ${msg}`);
}

function createRecord(
  date: string,
  time: string,
  session: 'AM' | 'PM',
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

console.log('=== MM2D STEP 49: RUNTIME WIRING VERIFICATION SUITE ===');

const targetDate = '2026-03-30';
const history = generateMockHistory(35, targetDate);

// TEST 1: AM and PM Session Isolation & Today Target-Date Filtering
console.log('\n--- TEST 1: AM & PM Session Isolation & Date Integrity ---');
const amBuffer = new LiveObservationBuffer();
const pmBuffer = new LiveObservationBuffer();

amBuffer.addObservation({ date: targetDate, time: '10:15:00', set: 1400.12, value: 5000.0, session: 'AM' });
pmBuffer.addObservation({ date: targetDate, time: '14:15:00', set: 1405.55, value: 15000.0, session: 'PM' });

assert(amBuffer.getObservations('AM', targetDate).length === 1, 'AM buffer has 1 observation');
assert(amBuffer.getObservations('PM', targetDate).length === 0, 'AM buffer has 0 PM observations');
assert(pmBuffer.getObservations('PM', targetDate).length === 1, 'PM buffer has 1 observation');
assert(pmBuffer.getObservations('AM', targetDate).length === 0, 'PM buffer has 0 AM observations');

// TEST 2: DataSufficiencyGate Lifecycle State Progression
console.log('\n--- TEST 2: DataSufficiencyGate Lifecycle Transitions ---');
const gateBuffer = new LiveObservationBuffer();

// 0 ticks -> AWAITING_DATA
const s0 = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: '2026-03-30T10:05:00+07:00',
  buffer: gateBuffer,
  isSessionLocked: false,
  hasOfficialResult: false,
});
console.log('s0 result:', s0);
assert(s0.state === 'AWAITING_DATA', '0 observations returns AWAITING_DATA');
assert(!s0.isPredictionPermitted, 'Prediction NOT permitted when AWAITING_DATA');

// 1 tick -> EARLY_PREDICTION_READY
gateBuffer.addObservation(
  { date: targetDate, time: '10:10:00', set: 1410.22, value: 8000.0, session: 'AM' },
  '2026-03-30T10:10:05+07:00'
);
const s1 = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: '2026-03-30T10:10:05+07:00',
  buffer: gateBuffer,
  isSessionLocked: false,
  hasOfficialResult: false,
});
assert(s1.state === 'EARLY_PREDICTION_READY', '1 observation transitions to EARLY_PREDICTION_READY');
assert(s1.isPredictionPermitted, 'Prediction permitted on EARLY_PREDICTION_READY');
assert(s1.isEarlyPredictionReady, 'isEarlyPredictionReady flag is true');

// 2 ticks -> REFINING
gateBuffer.addObservation(
  { date: targetDate, time: '10:30:00', set: 1412.50, value: 12000.0, session: 'AM' },
  '2026-03-30T10:30:05+07:00'
);
const s2 = DataSufficiencyGate.evaluate({
  session: 'AM',
  targetDate,
  currentBangkokTime: '2026-03-30T10:30:05+07:00',
  buffer: gateBuffer,
  isSessionLocked: false,
  hasOfficialResult: false,
});
assert(s2.state === 'REFINING', '2 observations transitions to REFINING');
assert(s2.isPredictionPermitted, 'Prediction permitted when REFINING');
assert(s2.isRefining, 'isRefining flag is true');
assert(s2.observationCount === 2, 'observationCount is 2');

// TEST 3: Refining Recomputes Same-Session Ensemble
console.log('\n--- TEST 3: Refining Recomputes Ensemble Before Lock ---');
const pred1 = AutoWeightedV2Engine.predict(history, targetDate, 'AM', gateBuffer.getEngineFeed('AM', targetDate).slice(0, 1));
const pred2 = AutoWeightedV2Engine.predict(history, targetDate, 'AM', gateBuffer.getEngineFeed('AM', targetDate));
assert(pred1.probabilities.length === 100, 'Pred1 has 100 probabilities');
assert(pred2.probabilities.length === 100, 'Pred2 has 100 probabilities');
assert(pred1.observedPreLockSet === 1410.22, 'Pred1 conditioned on 1st live tick');
assert(pred2.observedPreLockSet === 1412.50, 'Pred2 conditioned on 2nd live tick');

// TEST 4: Lock Engine Freezes Snapshot & Post-Lock Rejection
console.log('\n--- TEST 4: Cutoff Lock & Immutability ---');
const tracker = new AutoWeightedV2ShadowTracker();
const lockTime = '2026-03-30T12:00:00'; // 11:30 MMT = 12:00 BKK
const frozenRecord = tracker.freezeLockSnapshot(
  targetDate,
  'AM',
  history,
  gateBuffer.getEngineFeed('AM', targetDate),
  lockTime
);
assert(frozenRecord.isFrozenAtLock, 'Frozen record is marked isFrozenAtLock');
assert(frozenRecord.integrityHash.length === 8, 'Has 8-char cryptographic integrity hash');

// Post-lock tick attempt
gateBuffer.addObservation({ date: targetDate, time: '12:00:30', set: 1499.99, value: 99999.0, session: 'AM' }, '2026-03-30T12:00:30');
const postLockRecord = tracker.freezeLockSnapshot(
  targetDate,
  'AM',
  history,
  gateBuffer.getEngineFeed('AM', targetDate),
  '2026-03-30T12:01:00'
);
assert(postLockRecord.integrityHash === frozenRecord.integrityHash, 'Post-lock freeze attempt returns identical integrity hash');
assert(postLockRecord.top1 === frozenRecord.top1, 'Post-lock top1 prediction unchanged');

// TEST 5: Settlement Evaluation Uses Frozen Snapshot Only
console.log('\n--- TEST 5: Settlement Evaluation Uses Frozen Snapshot ---');
const winning2D = frozenRecord.top1 || frozenRecord.immutableV2Output.top1 || '50';
const recordsWithAmSettlement: VerifiedMarketRecord[] = [
  ...history,
  createRecord(targetDate, '12:01:00', 'AM', 1415.88, 28000.00, winning2D, true),
];
const settled = tracker.evaluateAndRecord(targetDate, 'AM', recordsWithAmSettlement, gateBuffer.getEngineFeed('AM', targetDate));
assert(Boolean(settled), 'Settlement evaluation succeeded');
assert(settled?.settlementComparison?.actualSettlement2D === winning2D, 'Official 2D matches');
assert(settled?.settlementComparison?.v2.isTop1Hit === true, 'Top-1 hit evaluated against frozen snapshot');
assert(settled?.integrityHash === frozenRecord.integrityHash, 'Settlement evaluated against original frozen hash');

// TEST 6: PM Can Use Today's AM Settlement but AM Never Sees Target Settlement
console.log('\n--- TEST 6: PM Access to AM Settlement vs AM Isolation ---');
const amRes = FeatureEngine.extractFeatures(recordsWithAmSettlement, targetDate, 'AM');
const pmRes = FeatureEngine.extractFeatures(recordsWithAmSettlement, targetDate, 'PM');

assert(amRes.featureVector?.distributions.todayAmSettlement2D === null, 'AM engine strictly sees NULL for today AM settlement (zero target leakage)');
assert(pmRes.featureVector?.distributions.todayAmSettlement2D === winning2D, 'PM engine successfully accesses verified today AM settlement');

// TEST 7: No Live 2D Ingested
console.log('\n--- TEST 7: No Live 2D in LiveObservationBuffer ---');
const feed = gateBuffer.getEngineFeed('AM', targetDate);
feed.forEach((obs) => {
  assert(!('twod' in obs), 'Feed observation contains no 2D');
  assert(typeof obs.set === 'number', 'SET is number');
  assert(typeof obs.value === 'number', 'Value is number');
});

console.log('\n========================================');
console.log('ALL STEP 49 RUNTIME WIRING TESTS PASSED!');
console.log('========================================');
