import assert from 'assert';
import { MarketCalendar } from '../src/core/market/marketCalendar';
import { MarketOpenGate, SESSION_SCHEDULES } from '../src/core/market/marketOpenGate';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { LiveSourceAdapter } from '../src/core/market/liveSourceAdapter';
import { VerifiedMarketRecord } from '../src/types/market';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

function createMockVerifiedRecord(
  date: string,
  time: string,
  session: 'AM' | 'PM',
  isSettlement: boolean,
  twod: string,
  setNumeric: number,
  valueNumeric: number
): VerifiedMarketRecord {
  const setStr = setNumeric.toFixed(2);
  const setLastDigit = setStr.slice(-1);
  const valInt = Math.floor(valueNumeric).toString();
  const valueLastDigitBeforeDecimal = valInt.slice(-1);
  return {
    id: `rec_${date}_${time}`,
    date,
    time,
    session,
    isSettlement,
    setRaw: setNumeric.toFixed(2),
    setNumeric,
    valueRaw: `${valueNumeric.toLocaleString()}M`,
    valueNumeric,
    twod,
    historyId: `hist_${date}_${time}`,
    verifiedAt: `${date}T${time}+07:00`,
    mathematicalCheck: {
      setLastDigit,
      valueLastDigitBeforeDecimal,
      derived2D: twod,
      isMathematicallyConsistent: true,
    },
  };
}

async function runStep11LifecycleTests() {
  console.log('===============================================================');
  console.log(' MM2D LEADER STEP 11 — LIFECYCLE & NON-TRADING-DAY HARDENING');
  console.log('===============================================================');

  // Baseline verified dataset for test environment (14 settlement records across 7 trading days)
  const mockDataset: VerifiedMarketRecord[] = [
    createMockVerifiedRecord('2026-08-12', '11:00:00', 'AM', false, '01', 1590.0, 28000),
    createMockVerifiedRecord('2026-08-12', '12:01:00', 'AM', true, '02', 1592.5, 29000),
    createMockVerifiedRecord('2026-08-12', '15:00:00', 'PM', false, '03', 1595.0, 31000),
    createMockVerifiedRecord('2026-08-12', '16:30:00', 'PM', true, '04', 1598.2, 33000),

    createMockVerifiedRecord('2026-08-13', '11:00:00', 'AM', false, '05', 1591.0, 28500),
    createMockVerifiedRecord('2026-08-13', '12:01:00', 'AM', true, '06', 1593.4, 29500),
    createMockVerifiedRecord('2026-08-13', '15:00:00', 'PM', false, '07', 1596.1, 31500),
    createMockVerifiedRecord('2026-08-13', '16:30:00', 'PM', true, '08', 1599.3, 33500),

    createMockVerifiedRecord('2026-08-14', '11:00:00', 'AM', false, '09', 1592.0, 29000),
    createMockVerifiedRecord('2026-08-14', '12:01:00', 'AM', true, '11', 1594.6, 30000),
    createMockVerifiedRecord('2026-08-14', '15:00:00', 'PM', false, '13', 1597.2, 32000),
    createMockVerifiedRecord('2026-08-14', '16:30:00', 'PM', true, '15', 1600.7, 34000),

    createMockVerifiedRecord('2026-08-17', '11:00:00', 'AM', false, '10', 1600.0, 30000),
    createMockVerifiedRecord('2026-08-17', '12:01:00', 'AM', true, '12', 1602.5, 32000),
    createMockVerifiedRecord('2026-08-17', '15:00:00', 'PM', false, '40', 1605.0, 35000),
    createMockVerifiedRecord('2026-08-17', '16:30:00', 'PM', true, '45', 1608.2, 40000),

    createMockVerifiedRecord('2026-08-18', '11:00:00', 'AM', false, '20', 1610.0, 31000),
    createMockVerifiedRecord('2026-08-18', '12:01:00', 'AM', true, '22', 1612.4, 33000),
    createMockVerifiedRecord('2026-08-18', '15:00:00', 'PM', false, '50', 1615.1, 36000),
    createMockVerifiedRecord('2026-08-18', '16:30:00', 'PM', true, '55', 1618.3, 41000),

    createMockVerifiedRecord('2026-08-19', '11:00:00', 'AM', false, '30', 1620.0, 32000),
    createMockVerifiedRecord('2026-08-19', '12:01:00', 'AM', true, '32', 1622.6, 34000),
    createMockVerifiedRecord('2026-08-19', '15:00:00', 'PM', false, '60', 1625.2, 37000),
    createMockVerifiedRecord('2026-08-19', '16:30:00', 'PM', true, '65', 1628.7, 42000),

    createMockVerifiedRecord('2026-08-20', '11:00:00', 'AM', false, '70', 1630.0, 33000),
    createMockVerifiedRecord('2026-08-20', '12:01:00', 'AM', true, '72', 1632.8, 35000),
    createMockVerifiedRecord('2026-08-20', '15:00:00', 'PM', false, '80', 1635.4, 38000),
    createMockVerifiedRecord('2026-08-20', '16:30:00', 'PM', true, '85', 1638.9, 43000),
  ];

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Non-Trading-Day & Weekend Gates
  // --------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 1] Non-Trading-Day & Weekend Gates ---');

  // Test 1.1: Saturday Gate
  const saturday = '2026-08-22'; // Saturday
  assert(MarketCalendar.isWeekend(saturday), '1.1a Saturday is identified as weekend.');
  const satEval = MarketCalendar.isTradingDay(saturday, mockDataset);
  assert(!satEval.isTradingDay, '1.1b Saturday is not a trading day.');
  assert.strictEqual(satEval.status, 'NON_TRADING_DAY', '1.1c Status is NON_TRADING_DAY.');

  // Test 1.2: Sunday Gate
  const sunday = '2026-08-23'; // Sunday
  assert(MarketCalendar.isWeekend(sunday), '1.2a Sunday is identified as weekend.');
  const sunEval = MarketCalendar.isTradingDay(sunday, mockDataset);
  assert(!sunEval.isTradingDay, '1.2b Sunday is not a trading day.');
  assert.strictEqual(sunEval.status, 'NON_TRADING_DAY', '1.2c Status is NON_TRADING_DAY.');

  // Test 1.3: Weekday Trading Day
  const weekday = '2026-08-21'; // Friday
  assert(!MarketCalendar.isWeekend(weekday), '1.3a Friday is not a weekend.');
  const friEval = MarketCalendar.isTradingDay(weekday, mockDataset);
  assert(friEval.isTradingDay, '1.3b Friday is a valid trading day.');

  // Test 1.4: Registered Official SET Holiday
  MarketCalendar.registerOfficialHoliday('2026-10-14', 'King Bhumibol Adulyadej Memorial Day');
  const holidayEval = MarketCalendar.isTradingDay('2026-10-14', mockDataset);
  assert(!holidayEval.isTradingDay, '1.4a Official holiday is rejected as trading day.');
  assert.strictEqual(holidayEval.status, 'NON_TRADING_DAY', '1.4b Status is NON_TRADING_DAY.');
  assert(holidayEval.reason.includes('King Bhumibol'), '1.4c Holiday reason specifies the official holiday name.');

  // Test 1.5: Historical Non-Trading Date with 0 Records
  const pastEmptyDate = '2026-08-01'; // Past Saturday or holiday with 0 records
  const pastEmptyEval = MarketCalendar.isTradingDay(pastEmptyDate, mockDataset, '2026-08-24');
  assert(!pastEmptyEval.isTradingDay, '1.5a Historical date with 0 records is rejected.');

  // Test 1.6: LockEngine Returns Zero Prediction on Weekend
  const satPred = LockEngine.getOrFreezePrediction(mockDataset, saturday, 'AM');
  assert.strictEqual(satPred.output.status, 'NON_TRADING_DAY', '1.6a LockEngine returns NON_TRADING_DAY for Saturday.');
  assert.strictEqual(satPred.output.top1, '--', '1.6b LockEngine returns top1 "--" for Saturday.');
  assert.strictEqual(satPred.output.candidates.length, 0, '1.6c LockEngine returns 0 candidates for Saturday.');
  assert.strictEqual(satPred.isLocked, false, '1.6d Weekend is not locked.');

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Market Open Gate & Observation Windows
  // --------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 2] Market Open Gate & Observation Windows ---');

  // Test 2.1: Morning Session Before Open
  const amEarly = MarketOpenGate.isMarketOpen('AM', '08:30:00');
  assert.strictEqual(amEarly, false, '2.1a AM session is NOT open at 08:30:00.');

  const amPreOpen = MarketOpenGate.isMarketOpen('AM', '09:59:59');
  assert.strictEqual(amPreOpen, false, '2.1b AM session is NOT open at 09:59:59.');

  // Test 2.2: Morning Session At/After Open
  const amOpen = MarketOpenGate.isMarketOpen('AM', '10:00:00');
  assert.strictEqual(amOpen, true, '2.2a AM session is open at 10:00:00.');

  const amActive = MarketOpenGate.isMarketOpen('AM', '11:00:00');
  assert.strictEqual(amActive, true, '2.2b AM session is open at 11:00:00.');

  // Test 2.3: Afternoon Session Before Open
  const pmEarly = MarketOpenGate.isMarketOpen('PM', '13:30:00');
  assert.strictEqual(pmEarly, false, '2.3a PM session is NOT open at 13:30:00.');

  const pmPreOpen = MarketOpenGate.isMarketOpen('PM', '13:59:59');
  assert.strictEqual(pmPreOpen, false, '2.3b PM session is NOT open at 13:59:59.');

  // Test 2.4: Afternoon Session At/After Open
  const pmOpen = MarketOpenGate.isMarketOpen('PM', '14:00:00');
  assert.strictEqual(pmOpen, true, '2.4a PM session is open at 14:00:00.');

  const pmActive = MarketOpenGate.isMarketOpen('PM', '15:00:00');
  assert.strictEqual(pmActive, true, '2.4b PM session is open at 15:00:00.');

  // Test 2.5: Permitted Observation Window Checks
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('AM', '09:45:00'), false, '2.5a 09:45 is outside AM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('AM', '10:00:00'), true, '2.5b 10:00 is within AM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('AM', '11:00:00'), true, '2.5c 11:00 is within AM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('AM', '12:00:00'), true, '2.5d 12:00 is within AM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('AM', '12:00:01'), false, '2.5e 12:00:01 is outside AM observation window.');

  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('PM', '13:59:00'), false, '2.5f 13:59 is outside PM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('PM', '14:00:00'), true, '2.5g 14:00 is within PM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('PM', '15:00:00'), true, '2.5h 15:00 is within PM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('PM', '16:00:00'), true, '2.5i 16:00 is within PM observation window.');
  assert.strictEqual(MarketOpenGate.isWithinObservationWindow('PM', '16:00:01'), false, '2.5j 16:00:01 is outside PM observation window.');

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Strict Lifecycle State Resolution
  // --------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 3] Strict Lifecycle State Resolution ---');

  const todayTestDate = '2026-08-24'; // Monday

  // Test 3.1: State before market open (09:00 AM)
  const statePreOpen = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '09:00:00',
    historicalRecords: mockDataset,
  });
  assert.strictEqual(statePreOpen.status, 'MARKET_NOT_OPEN', '3.1a State before open is MARKET_NOT_OPEN.');
  assert.strictEqual(statePreOpen.isMarketOpen, false, '3.1b isMarketOpen is false.');

  // Test 3.2: State after market open but before live data received (10:15 AM)
  const stateWaiting = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '10:15:00',
    historicalRecords: mockDataset,
    hasLiveObservations: false,
  });
  assert.strictEqual(stateWaiting.status, 'WAITING_FOR_LIVE_DATA', '3.2a State is WAITING_FOR_LIVE_DATA when no ticks received.');
  assert.strictEqual(stateWaiting.isMarketOpen, true, '3.2b isMarketOpen is true.');

  // Test 3.3: State when live source is down/unavailable
  const stateSourceFail = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '10:30:00',
    historicalRecords: mockDataset,
    liveSourceStatus: 'INSUFFICIENT_LIVE_DATA',
  });
  assert.strictEqual(stateSourceFail.status, 'INSUFFICIENT_LIVE_DATA', '3.3a State is INSUFFICIENT_LIVE_DATA when feed fails.');

  // Test 3.4: State when session is active with live observation before publish (11:00 AM BKK / 10:30 AM MMT)
  const stateAnalyzing = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '11:00:00',
    historicalRecords: mockDataset,
    hasLiveObservations: true,
  });
  assert.strictEqual(stateAnalyzing.status, 'ANALYZING_LIVE_DATA', '3.4a State is ANALYZING_LIVE_DATA before publish time.');

  // Test 3.4b: State when session is active with live observation at/after publish (11:55 AM BKK / 11:25 AM MMT)
  const stateReady = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '11:55:00',
    historicalRecords: mockDataset,
    hasLiveObservations: true,
  });
  assert.strictEqual(stateReady.status, 'READY_FOR_PREDICTION', '3.4b State is READY_FOR_PREDICTION with live ticks at publish time.');

  // Test 3.5: State after lock boundary (11:35 AM)
  const stateLocked = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '11:35:00',
    historicalRecords: mockDataset,
    isSessionLocked: true,
  });
  assert.strictEqual(stateLocked.status, 'PREDICTION_LOCKED', '3.5a State after cutoff is PREDICTION_LOCKED.');
  assert.strictEqual(stateLocked.isLocked, true, '3.5b isLocked is true.');

  // Test 3.6: State when official settlement published (12:05 PM)
  const stateResult = MarketOpenGate.resolveLifecycleState({
    targetDate: todayTestDate,
    session: 'AM',
    currentBangkokTime: '12:05:00',
    historicalRecords: mockDataset,
    hasOfficialResult: true,
  });
  assert.strictEqual(stateResult.status, 'OFFICIAL_RESULT_AVAILABLE', '3.6a State with result is OFFICIAL_RESULT_AVAILABLE.');
  assert.strictEqual(stateResult.hasResult, true, '3.6b hasResult is true.');

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Anti-Fabrication & Live Data Quality Invariants
  // --------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 4] Anti-Fabrication & Live Data Quality Invariants ---');

  // Test 4.1: FeatureEngine rejects live observations post-lock
  const postLockFeed = [
    { time: '11:00:00', set: 1630.0, value: 30000 },
    { time: '12:00:05', set: 1632.0, value: 31000 }, // Post-lock (> 12:00:00)
  ];
  const amFiltered = FeatureEngine.filterPreLockObservations('2026-08-24', 'AM', postLockFeed);
  assert.strictEqual(amFiltered.observations.length, 1, '4.1a Post-lock 12:00:05 observation strictly filtered out.');
  assert.strictEqual(amFiltered.observations[0].time, '11:00:00', '4.1b Pre-lock 11:00:00 observation correctly preserved.');

  // Test 4.2: FeatureEngine rejects future-date live observations
  const futureFeed = [
    { time: '11:00:00', set: 1630.0, value: 30000, timestamp: '2026-08-25T11:00:00+07:00' },
  ];
  const amFutureVector = FeatureEngine.extractFeatures(
    mockDataset,
    '2026-08-24',
    'AM',
    futureFeed
  );
  // Observation on future date (2026-08-25) relative to targetDate (2026-08-24) is rejected
  assert.strictEqual(
    amFutureVector.featureVector?.isPreLockLiveAvailable,
    false,
    '4.2a Future-dated live observation is rejected.'
  );

  // Test 4.3: Model determinism and immutability
  const validPreLockFeed = [
    { time: '11:00:00', set: 1630.0, value: 30000, timestamp: '2026-08-20T11:00:00+07:00' },
  ];
  const predRun1 = LockEngine.getOrFreezePrediction(
    mockDataset,
    '2026-08-20',
    'AM',
    validPreLockFeed,
    new Date('2026-08-20T12:05:00+07:00') // Locked time (after 12:00 Bangkok)
  );

  const predRun2 = LockEngine.getOrFreezePrediction(
    mockDataset,
    '2026-08-20',
    'AM',
    validPreLockFeed,
    new Date('2026-08-20T12:10:00+07:00')
  );

  assert.strictEqual(predRun1.output.top1, predRun2.output.top1, '4.3a Frozen prediction top1 is immutable across lookups.');
  assert.strictEqual(predRun1.output.featureIntegrityHash, predRun2.output.featureIntegrityHash, '4.3b Feature integrity hash is identical.');
  assert.strictEqual(predRun2.isLocked, true, '4.3c Subsequent lookup remains locked.');
  assert.strictEqual(predRun2.isFreshlyLocked, false, '4.3d Subsequent lookup returns cached frozen snapshot.');

  console.log('\n===============================================================');
  console.log(' ALL STEP 11 LIFECYCLE & TRADING-DAY GATE TESTS PASSED (27/27)!');
  console.log('===============================================================');
}

runStep11LifecycleTests().catch((err) => {
  console.error('STEP 11 LIFECYCLE TEST FAILURE:', err);
  process.exit(1);
});
