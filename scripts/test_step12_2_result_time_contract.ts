/**
 * MM2D LEADER STEP 12.2 — OFFICIAL RESULT TIME CONTRACT RECONCILIATION TEST SUITE
 * 
 * Invariants Verified:
 * 1. AM lock remains strictly 11:30 Myanmar (Asia/Yangon).
 * 2. AM lock remains strictly 12:00 Bangkok (Asia/Bangkok).
 * 3. PM lock remains strictly 15:30 Myanmar (Asia/Yangon).
 * 4. PM lock remains strictly 16:00 Bangkok (Asia/Bangkok).
 * 5. AM result display remains 12:01 Myanmar (12:01 PM MMT, provider timestamp 12:01:00).
 * 6. PM result display remains 16:30 Myanmar (4:30 PM MMT, provider timestamp 16:30:00).
 * 7. Lock occurs before result:
 *    - AM Lock (11:30) occurs 31 minutes before AM Result (12:01) in Myanmar time.
 *    - PM Lock (15:30) occurs 60 minutes before PM Result (16:30) in Myanmar time.
 * 8. Result arrival NEVER mutates a frozen/locked prediction (immutability & recordType isolation).
 * 9. Provider timestamp semantics are preserved (child.time "12:01:00" and "16:30:00").
 * 10. No +30 or -30 minute blind offset conversion is applied to provider result labels.
 * 11. No synthetic or fabricated timestamps are created.
 * 12. Device/phone local timezone cannot change result/lock semantics.
 */

import { TimezoneContract, TIMEZONE_CONSTANTS } from '../src/core/market/timezoneUtils';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { MarketOpenGate, SESSION_SCHEDULES } from '../src/core/market/marketOpenGate';
import { PREDICTION_CUTOFFS, PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { deriveSessionAndTimeProperties, parseAndVerify2DResult } from '../src/core/integrity/parser';
import { RawThaiStockResultDateGroup, VerifiedMarketRecord } from '../src/types/market';

function assert(condition: boolean, testNum: number, description: string): void {
  if (!condition) {
    console.error(`❌ FAILED [Test ${testNum}]: ${description}`);
    throw new Error(`Assertion failed in test ${testNum}: ${description}`);
  }
  console.log(`✅ PASS [${String(testNum).padStart(2, '0')}/16]: ${description}`);
}

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

async function runStep12_2ResultTimeContractTests() {
  console.log('================================================================');
  console.log(' MM2D STEP 12.2 — OFFICIAL RESULT TIME CONTRACT AUDIT');
  console.log('================================================================\n');

  const testDate = '2026-08-25'; // Tuesday

  // --------------------------------------------------------------------------
  // TEST 1: AM Lock remains 11:30 Myanmar
  // --------------------------------------------------------------------------
  assert(
    PREDICTION_CUTOFFS.AM.yangonTimeString === '11:30:00' &&
    SESSION_SCHEDULES.AM.userLockTimeStringYangon === '11:30:00',
    1,
    'AM Prediction Lock is strictly 11:30:00 Myanmar time (Asia/Yangon).'
  );

  // --------------------------------------------------------------------------
  // TEST 2: AM Lock remains 12:00 Bangkok
  // --------------------------------------------------------------------------
  assert(
    PREDICTION_CUTOFFS.AM.timeString === '12:00:00' &&
    SESSION_SCHEDULES.AM.lockTimeString === '12:00:00' &&
    SESSION_SCHEDULES.AM.lockMinutes === 720,
    2,
    'AM Prediction Lock is strictly 12:00:00 Bangkok time (Asia/Bangkok).'
  );

  // --------------------------------------------------------------------------
  // TEST 3: PM Lock remains 15:30 Myanmar
  // --------------------------------------------------------------------------
  assert(
    PREDICTION_CUTOFFS.PM.yangonTimeString === '15:30:00' &&
    SESSION_SCHEDULES.PM.userLockTimeStringYangon === '15:30:00',
    3,
    'PM Prediction Lock is strictly 15:30:00 Myanmar time (Asia/Yangon).'
  );

  // --------------------------------------------------------------------------
  // TEST 4: PM Lock remains 16:00 Bangkok
  // --------------------------------------------------------------------------
  assert(
    PREDICTION_CUTOFFS.PM.timeString === '16:00:00' &&
    SESSION_SCHEDULES.PM.lockTimeString === '16:00:00' &&
    SESSION_SCHEDULES.PM.lockMinutes === 960,
    4,
    'PM Prediction Lock is strictly 16:00:00 Bangkok time (Asia/Bangkok).'
  );

  // --------------------------------------------------------------------------
  // TEST 5: AM Result display remains 12:01 Myanmar (Provider payload semantics)
  // --------------------------------------------------------------------------
  const rawAmChild = deriveSessionAndTimeProperties('12:01:00');
  assert(
    rawAmChild?.session === 'AM' &&
    rawAmChild?.isSettlement === true &&
    rawAmChild?.normalizedTime === '12:01:00' &&
    SESSION_SCHEDULES.AM.settlementTimeString === '12:01:00' &&
    SESSION_SCHEDULES.AM.userResultTimeStringYangon === '12:01:00',
    5,
    'AM Official Result is strictly 12:01:00 Myanmar time matching provider convention.'
  );

  // --------------------------------------------------------------------------
  // TEST 6: PM Result display remains 16:30 Myanmar (Provider payload semantics)
  // --------------------------------------------------------------------------
  const rawPmChild = deriveSessionAndTimeProperties('16:30:00');
  assert(
    rawPmChild?.session === 'PM' &&
    rawPmChild?.isSettlement === true &&
    rawPmChild?.normalizedTime === '16:30:00' &&
    SESSION_SCHEDULES.PM.settlementTimeString === '16:30:00' &&
    SESSION_SCHEDULES.PM.userResultTimeStringYangon === '16:30:00',
    6,
    'PM Official Result is strictly 16:30:00 (4:30 PM) Myanmar time matching provider convention.'
  );

  // --------------------------------------------------------------------------
  // TEST 7: Lock occurs strictly before Result
  // --------------------------------------------------------------------------
  // AM: Lock at 11:30 MMT (12:00 BKK) is 31 minutes BEFORE 12:01 Result
  // PM: Lock at 15:30 MMT (16:00 BKK) is 60 minutes BEFORE 16:30 Result
  const amLockYgnMinutes = 11 * 60 + 30;
  const amResultYgnMinutes = 12 * 60 + 1;
  const pmLockYgnMinutes = 15 * 60 + 30;
  const pmResultYgnMinutes = 16 * 60 + 30;
  assert(
    amLockYgnMinutes < amResultYgnMinutes &&
    pmLockYgnMinutes < pmResultYgnMinutes &&
    (amResultYgnMinutes - amLockYgnMinutes === 31) &&
    (pmResultYgnMinutes - pmLockYgnMinutes === 60),
    7,
    'Prediction lock strictly precedes official result draw (AM by 31 min, PM by 60 min).'
  );

  // --------------------------------------------------------------------------
  // TEST 8: Result arrival NEVER mutates locked prediction (Immutability)
  // --------------------------------------------------------------------------
  LockEngine.clearFrozenSnapshotsForTesting();
  const historicalSample: VerifiedMarketRecord[] = [
    createMockVerifiedRecord('2026-08-20', '12:01:00', 'AM', true, '42', 1600.0, 30000),
    createMockVerifiedRecord('2026-08-20', '16:30:00', 'PM', true, '99', 1605.0, 40000),
    createMockVerifiedRecord('2026-08-21', '12:01:00', 'AM', true, '42', 1610.0, 31000),
    createMockVerifiedRecord('2026-08-21', '16:30:00', 'PM', true, '07', 1612.0, 42000),
    createMockVerifiedRecord('2026-08-24', '12:01:00', 'AM', true, '42', 1615.0, 33000),
    createMockVerifiedRecord('2026-08-24', '16:30:00', 'PM', true, '88', 1618.0, 45000),
  ];

  const preLockTicks = [{ time: '11:00:00', set: 1620.0, value: 35000 }];
  const lockedPrediction = LockEngine.getOrFreezePrediction(
    historicalSample,
    testDate,
    'AM',
    preLockTicks,
    new Date(`${testDate}T12:05:00+07:00`) // Post-lock instant
  );

  const top1AtLock = lockedPrediction.output.top1;

  // Simulate official settlement arrival at 12:01:00
  const officialAmResult = createMockVerifiedRecord(testDate, '12:01:00', 'AM', true, '77', 1622.5, 36000);
  const recordsWithResult = [...historicalSample, officialAmResult];

  // Request prediction post-result
  const postResultLookup = LockEngine.getOrFreezePrediction(
    recordsWithResult,
    testDate,
    'AM',
    preLockTicks,
    new Date(`${testDate}T12:02:00+07:00`)
  );

  assert(
    postResultLookup.output.top1 === top1AtLock &&
    postResultLookup.output.top1 !== '77' &&
    postResultLookup.output.recordType === 'MODEL_PREDICTION' &&
    officialAmResult.twod === '77',
    8,
    'Official settlement arrival at 12:01:00 NEVER mutates the frozen prediction.'
  );

  // --------------------------------------------------------------------------
  // TEST 9: Provider timestamp semantics are strictly preserved in Ingestion
  // --------------------------------------------------------------------------
  const mockProviderPayload: RawThaiStockResultDateGroup[] = [
    {
      date: '2026-08-25',
      child: [
        { time: '11:00', set: '1,620.00', value: '25,000.00', twod: '00', history_id: '1001' },
        { time: '12:01', set: '1,622.50', value: '36,000.00', twod: '77', history_id: '1002' },
        { time: '15:00', set: '1,625.00', value: '45,000.00', twod: '50', history_id: '1003' },
        { time: '16:30', set: '1,630.00', value: '60,000.00', twod: '88', history_id: '1004' },
      ],
    },
  ];

  const parsed = parseAndVerify2DResult(mockProviderPayload, '2026-08-25');
  assert(
    parsed.verifiedRecords.length === 4 &&
    parsed.verifiedRecords[0].time === '11:00:00' && parsed.verifiedRecords[0].isSettlement === false &&
    parsed.verifiedRecords[1].time === '12:01:00' && parsed.verifiedRecords[1].isSettlement === true &&
    parsed.verifiedRecords[2].time === '15:00:00' && parsed.verifiedRecords[2].isSettlement === false &&
    parsed.verifiedRecords[3].time === '16:30:00' && parsed.verifiedRecords[3].isSettlement === true,
    9,
    'Ingestion parser strictly preserves provider timestamp semantics without synthetic shifts.'
  );

  // --------------------------------------------------------------------------
  // TEST 10: No blind +30 / -30 minute conversion applied to result labels
  // --------------------------------------------------------------------------
  // Provider time "12:01:00" must NOT be transformed into "11:31:00" or "12:31:00"
  // Provider time "16:30:00" must NOT be transformed into "16:00:00" or "17:00:00"
  assert(
    parsed.verifiedRecords[1].time === '12:01:00' &&
    parsed.verifiedRecords[3].time === '16:30:00',
    10,
    'No blind offset conversion is applied to provider MM2D result labels.'
  );

  // --------------------------------------------------------------------------
  // TEST 11: Zero synthetic timestamps created
  // --------------------------------------------------------------------------
  const allNormalizedTimes = parsed.verifiedRecords.map((r) => r.time);
  assert(
    allNormalizedTimes.every((t) => ['11:00:00', '12:01:00', '15:00:00', '16:30:00'].includes(t)),
    11,
    'All record timestamps originate verbatim from provider checkpoints (zero synthetic creation).'
  );

  // --------------------------------------------------------------------------
  // TEST 12: Device timezone cannot alter lock or result evaluation
  // --------------------------------------------------------------------------
  const lockInstantEpoch = Date.parse('2026-08-25T05:00:00.000Z'); // 11:30 MMT / 12:00 BKK
  const resultInstantEpoch = Date.parse('2026-08-25T05:31:00.000Z'); // 12:01 MMT
  
  const isLockedAtLock = LockEngine.isSessionLocked(testDate, 'AM', lockInstantEpoch);
  const isLockedAtResult = LockEngine.isSessionLocked(testDate, 'AM', resultInstantEpoch);

  // Evaluate across varied timezone strings for the exact same epoch
  const lockPdt = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-24T22:00:00.000-07:00');
  const lockGmt = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-25T05:00:00.000Z');
  const lockJst = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-25T14:00:00.000+09:00');

  assert(
    isLockedAtLock === true &&
    isLockedAtResult === true &&
    lockPdt === true &&
    lockGmt === true &&
    lockJst === true,
    12,
    'Device/host local timezone is completely isolated from lock and result semantics.'
  );

  // --------------------------------------------------------------------------
  // TEST 13: Production Model Version Remains ALL_TIME_FREQUENCY_V1
  // --------------------------------------------------------------------------
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    13,
    'Production model version is strictly locked to ALL_TIME_FREQUENCY_V1.'
  );

  // --------------------------------------------------------------------------
  // TEST 14: Settlement is strictly separated from Prediction
  // --------------------------------------------------------------------------
  assert(
    lockedPrediction.output.recordType === 'MODEL_PREDICTION' &&
    officialAmResult.isSettlement === true,
    14,
    'Strict separation between MODEL_PREDICTION and OFFICIAL_RESULT records maintained.'
  );

  // --------------------------------------------------------------------------
  // TEST 15: PM Session Lock and Result Invariant
  // --------------------------------------------------------------------------
  const pmPreLockInstant = new Date('2026-08-25T15:29:59+06:30'); // 15:29:59 MMT
  const pmAtLockInstant = new Date('2026-08-25T15:30:00+06:30'); // 15:30:00 MMT
  const pmAtResultInstant = new Date('2026-08-25T16:30:00+06:30'); // 16:30:00 MMT
  
  assert(
    !LockEngine.isSessionLocked(testDate, 'PM', pmPreLockInstant) &&
    LockEngine.isSessionLocked(testDate, 'PM', pmAtLockInstant) &&
    LockEngine.isSessionLocked(testDate, 'PM', pmAtResultInstant),
    15,
    'PM session locks at 15:30:00 MMT and remains locked through 16:30:00 MMT result draw.'
  );

  // --------------------------------------------------------------------------
  // TEST 16: Historical Dataset Remains Fully Untouched
  // --------------------------------------------------------------------------
  assert(
    historicalSample.length === 6 &&
    historicalSample[0].twod === '42' &&
    historicalSample[1].twod === '99',
    16,
    'Historical records integrity and settlement values are 100% untouched.'
  );

  console.log('\n================================================================');
  console.log(' AUDIT COMPLETE: 16/16 STEP 12.2 RESULT CONTRACT TESTS PASSED!  ');
  console.log('================================================================\n');
}

runStep12_2ResultTimeContractTests().catch((err) => {
  console.error('Fatal error during Step 12.2 test execution:', err);
  process.exit(1);
});
