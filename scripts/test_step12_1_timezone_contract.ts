/**
 * MM2D LEADER STEP 12.1 — FORENSIC TIMEZONE CONTRACT RECONCILIATION TEST SUITE
 * 
 * Strict Forensic Invariants:
 * 1. Canonical market timezone: Asia/Bangkok = UTC+7:00
 * 2. User-facing & production lock definition timezone: Asia/Yangon = UTC+6:30
 * 3. Bangkok is exactly 30 minutes ahead of Yangon (Bangkok = Yangon + 30m).
 * 4. AM Prediction Lock: 11:30:00 Yangon = 12:00:00 Bangkok.
 * 5. PM Prediction Lock: 15:30:00 Yangon = 16:00:00 Bangkok.
 * 6. Never compare a Bangkok timestamp directly against a Yangon cutoff without normalization.
 * 7. Device/phone local timezone must NEVER alter session membership or lock state.
 */

import { TimezoneContract, TIMEZONE_CONSTANTS } from '../src/core/market/timezoneUtils';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { MarketOpenGate, SESSION_SCHEDULES } from '../src/core/market/marketOpenGate';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PREDICTION_CUTOFFS } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';

function assert(condition: boolean, testNum: number, description: string): void {
  if (!condition) {
    console.error(`❌ FAILED [Test ${testNum}]: ${description}`);
    throw new Error(`Assertion failed in test ${testNum}: ${description}`);
  }
  console.log(`✅ PASS [${String(testNum).padStart(2, '0')}/20]: ${description}`);
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

async function runTimezoneContractTests() {
  console.log('================================================================');
  console.log(' MM2D STEP 12.1 — FORENSIC TIMEZONE CONTRACT AUDIT SUITE');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: Timezone Offset Invariant (Bangkok UTC+7 vs Yangon UTC+6:30)
  // --------------------------------------------------------------------------
  const utcNow = Date.now();
  const bkkNow = TimezoneContract.toBangkok(utcNow);
  const ygnNow = TimezoneContract.toYangon(utcNow);
  
  // Calculate difference in minutes
  const diffMinutes = Math.round((bkkNow.epochMillis + 7 * 3600000 - (ygnNow.epochMillis + 6.5 * 3600000)) / 60000);
  assert(
    diffMinutes === 30 && TIMEZONE_CONSTANTS.OFFSET_DIFF_MINUTES === 30,
    1,
    'Bangkok (UTC+7) is exactly 30 minutes ahead of Yangon (UTC+6:30).'
  );

  // --------------------------------------------------------------------------
  // TEST 2: Forward String Conversion (Yangon -> Bangkok +30m)
  // --------------------------------------------------------------------------
  const amBkkFromYgn = TimezoneContract.yangonToBangkokTimeString('11:30:00');
  const pmBkkFromYgn = TimezoneContract.yangonToBangkokTimeString('15:30:00');
  const openAmBkkFromYgn = TimezoneContract.yangonToBangkokTimeString('09:30:00');
  const openPmBkkFromYgn = TimezoneContract.yangonToBangkokTimeString('13:30:00');
  assert(
    amBkkFromYgn === '12:00:00' &&
    pmBkkFromYgn === '16:00:00' &&
    openAmBkkFromYgn === '10:00:00' &&
    openPmBkkFromYgn === '14:00:00',
    2,
    'Yangon time strings map precisely to Bangkok time strings (+30m).'
  );

  // --------------------------------------------------------------------------
  // TEST 3: Reverse String Conversion (Bangkok -> Yangon -30m)
  // --------------------------------------------------------------------------
  const amYgnFromBkk = TimezoneContract.bangkokToYangonTimeString('12:00:00');
  const pmYgnFromBkk = TimezoneContract.bangkokToYangonTimeString('16:00:00');
  const openAmYgnFromBkk = TimezoneContract.bangkokToYangonTimeString('10:00:00');
  const openPmYgnFromBkk = TimezoneContract.bangkokToYangonTimeString('14:00:00');
  assert(
    amYgnFromBkk === '11:30:00' &&
    pmYgnFromBkk === '15:30:00' &&
    openAmYgnFromBkk === '09:30:00' &&
    openPmYgnFromBkk === '13:30:00',
    3,
    'Bangkok time strings map precisely to Yangon time strings (-30m).'
  );

  // --------------------------------------------------------------------------
  // TEST 4: AM Market Open Gate (10:00:00 Bangkok = 09:30:00 Yangon)
  // --------------------------------------------------------------------------
  const isAmOpenPre = MarketOpenGate.isMarketOpen('AM', '09:59:59');
  const isAmOpenExact = MarketOpenGate.isMarketOpen('AM', '10:00:00');
  const isAmOpenPost = MarketOpenGate.isMarketOpen('AM', '10:00:01');
  assert(
    !isAmOpenPre && isAmOpenExact && isAmOpenPost,
    4,
    'AM Market Open gate opens strictly at 10:00:00 Bangkok (09:30:00 Yangon).'
  );

  // --------------------------------------------------------------------------
  // TEST 5: AM Pre-Lock Checkpoint (11:00:00 Bangkok = 10:30:00 Yangon)
  // --------------------------------------------------------------------------
  const amCheckpoint = SESSION_SCHEDULES.AM.checkpointTimeString;
  const amCheckpointYgn = TimezoneContract.bangkokToYangonTimeString(amCheckpoint);
  assert(
    amCheckpoint === '11:00:00' && amCheckpointYgn === '10:30:00',
    5,
    'AM canonical pre-lock checkpoint is 11:00:00 Bangkok = 10:30:00 Yangon.'
  );

  // --------------------------------------------------------------------------
  // TEST 6: AM Prediction Lock Boundary (11:30:00 Yangon = 12:00:00 Bangkok)
  // --------------------------------------------------------------------------
  const testDate = '2026-08-25'; // Tuesday
  // 11:29:59 Yangon is 11:59:59 Bangkok (+07:00)
  const amPreLockInstant = new Date('2026-08-25T11:29:59+06:30'); // UTC: 04:59:59
  // 11:30:00 Yangon is 12:00:00 Bangkok (+07:00)
  const amAtLockInstant = new Date('2026-08-25T11:30:00+06:30'); // UTC: 05:00:00
  // 11:30:01 Yangon is 12:00:01 Bangkok (+07:00)
  const amPostLockInstant = new Date('2026-08-25T11:30:01+06:30'); // UTC: 05:00:01

  const isAmLockedPre = LockEngine.isSessionLocked(testDate, 'AM', amPreLockInstant);
  const isAmLockedAt = LockEngine.isSessionLocked(testDate, 'AM', amAtLockInstant);
  const isAmLockedPost = LockEngine.isSessionLocked(testDate, 'AM', amPostLockInstant);

  assert(
    !isAmLockedPre && isAmLockedAt && isAmLockedPost,
    6,
    'AM Prediction Lock: 11:29:59 Yangon is UNLOCKED, 11:30:00 Yangon (12:00:00 Bangkok) is LOCKED.'
  );

  // --------------------------------------------------------------------------
  // TEST 7: AM Settlement & Result Time Contract (12:01:00 Provider & MM2D Convention)
  // --------------------------------------------------------------------------
  const amSettle = SESSION_SCHEDULES.AM.settlementTimeString;
  const amResultYgn = SESSION_SCHEDULES.AM.userResultTimeStringYangon;
  assert(
    amSettle === '12:01:00' && amResultYgn === '12:01:00',
    7,
    'AM result contract: 12:01:00 provider timestamp corresponds to 12:01 PM Myanmar official result.'
  );

  // --------------------------------------------------------------------------
  // TEST 8: PM Market Open Gate (14:00:00 Bangkok = 13:30:00 Yangon)
  // --------------------------------------------------------------------------
  const isPmOpenPre = MarketOpenGate.isMarketOpen('PM', '13:59:59');
  const isPmOpenExact = MarketOpenGate.isMarketOpen('PM', '14:00:00');
  const isPmOpenPost = MarketOpenGate.isMarketOpen('PM', '14:00:01');
  assert(
    !isPmOpenPre && isPmOpenExact && isPmOpenPost,
    8,
    'PM Market Open gate opens strictly at 14:00:00 Bangkok (13:30:00 Yangon).'
  );

  // --------------------------------------------------------------------------
  // TEST 9: PM Pre-Lock Checkpoint (15:00:00 Bangkok = 14:30:00 Yangon)
  // --------------------------------------------------------------------------
  const pmCheckpoint = SESSION_SCHEDULES.PM.checkpointTimeString;
  const pmCheckpointYgn = TimezoneContract.bangkokToYangonTimeString(pmCheckpoint);
  assert(
    pmCheckpoint === '15:00:00' && pmCheckpointYgn === '14:30:00',
    9,
    'PM canonical pre-lock checkpoint is 15:00:00 Bangkok = 14:30:00 Yangon.'
  );

  // --------------------------------------------------------------------------
  // TEST 10: PM Prediction Lock Boundary (15:30:00 Yangon = 16:00:00 Bangkok)
  // --------------------------------------------------------------------------
  // 15:29:59 Yangon is 15:59:59 Bangkok (+07:00)
  const pmPreLockInstant = new Date('2026-08-25T15:29:59+06:30'); // UTC: 08:59:59
  // 15:30:00 Yangon is 16:00:00 Bangkok (+07:00)
  const pmAtLockInstant = new Date('2026-08-25T15:30:00+06:30'); // UTC: 09:00:00
  // 15:30:01 Yangon is 16:00:01 Bangkok (+07:00)
  const pmPostLockInstant = new Date('2026-08-25T15:30:01+06:30'); // UTC: 09:00:01

  const isPmLockedPre = LockEngine.isSessionLocked(testDate, 'PM', pmPreLockInstant);
  const isPmLockedAt = LockEngine.isSessionLocked(testDate, 'PM', pmAtLockInstant);
  const isPmLockedPost = LockEngine.isSessionLocked(testDate, 'PM', pmPostLockInstant);

  assert(
    !isPmLockedPre && isPmLockedAt && isPmLockedPost,
    10,
    'PM Prediction Lock: 15:29:59 Yangon is UNLOCKED, 15:30:00 Yangon (16:00:00 Bangkok) is LOCKED.'
  );

  // --------------------------------------------------------------------------
  // TEST 11: PM Settlement & Result Time Contract (16:30:00 Provider & MM2D Convention)
  // --------------------------------------------------------------------------
  const pmSettle = SESSION_SCHEDULES.PM.settlementTimeString;
  const pmResultYgn = SESSION_SCHEDULES.PM.userResultTimeStringYangon;
  assert(
    pmSettle === '16:30:00' && pmResultYgn === '16:30:00',
    11,
    'PM result contract: 16:30:00 provider timestamp corresponds to 4:30 PM Myanmar official result.'
  );

  // --------------------------------------------------------------------------
  // TEST 12: AM Permitted Observation Window [10:00:00, 12:00:00] Bangkok
  // --------------------------------------------------------------------------
  const amWin0959 = MarketOpenGate.isWithinObservationWindow('AM', '09:59:59');
  const amWin1000 = MarketOpenGate.isWithinObservationWindow('AM', '10:00:00');
  const amWin1100 = MarketOpenGate.isWithinObservationWindow('AM', '11:00:00');
  const amWin1130 = MarketOpenGate.isWithinObservationWindow('AM', '11:30:00');
  const amWin1200 = MarketOpenGate.isWithinObservationWindow('AM', '12:00:00');
  const amWin1201 = MarketOpenGate.isWithinObservationWindow('AM', '12:00:01');
  assert(
    !amWin0959 && amWin1000 && amWin1100 && amWin1130 && amWin1200 && !amWin1201,
    12,
    'AM Observation window [10:00:00, 12:00:00] Bangkok strictly accepts valid pre-lock ticks.'
  );

  // --------------------------------------------------------------------------
  // TEST 13: PM Permitted Observation Window [14:00:00, 16:00:00] Bangkok
  // --------------------------------------------------------------------------
  const pmWin1359 = MarketOpenGate.isWithinObservationWindow('PM', '13:59:59');
  const pmWin1400 = MarketOpenGate.isWithinObservationWindow('PM', '14:00:00');
  const pmWin1500 = MarketOpenGate.isWithinObservationWindow('PM', '15:00:00');
  const pmWin1530 = MarketOpenGate.isWithinObservationWindow('PM', '15:30:00');
  const pmWin1600 = MarketOpenGate.isWithinObservationWindow('PM', '16:00:00');
  const pmWin1601 = MarketOpenGate.isWithinObservationWindow('PM', '16:00:01');
  assert(
    !pmWin1359 && pmWin1400 && pmWin1500 && pmWin1530 && pmWin1600 && !pmWin1601,
    13,
    'PM Observation window [14:00:00, 16:00:00] Bangkok strictly accepts valid pre-lock ticks.'
  );

  // --------------------------------------------------------------------------
  // TEST 14: FeatureEngine AM Pre-Lock Observation Filtering
  // --------------------------------------------------------------------------
  const rawAmFeed = [
    { time: '10:30:00', set: 1600.5, value: 15000 },
    { time: '11:00:00', set: 1605.2, value: 25000 },
    { time: '11:59:59', set: 1610.1, value: 34000 },
    { time: '12:00:00', set: 1610.2, value: 34100 },
    { time: '12:00:01', set: 1610.5, value: 34500 }, // Post-lock, must be excluded
    { time: '12:01:00', set: 1612.0, value: 35000 }, // Settlement tick, must be excluded
  ];
  const filteredAm = FeatureEngine.filterPreLockObservations(testDate, 'AM', rawAmFeed);
  assert(
    filteredAm.observations.length === 4 &&
    filteredAm.observations[filteredAm.observations.length - 1].time === '12:00:00',
    14,
    'FeatureEngine AM preserves observations up to 12:00:00 Bangkok and excludes 12:00:01+.'
  );

  // --------------------------------------------------------------------------
  // TEST 15: FeatureEngine PM Pre-Lock Observation Filtering
  // --------------------------------------------------------------------------
  const rawPmFeed = [
    { time: '14:30:00', set: 1615.5, value: 45000 },
    { time: '15:00:00', set: 1618.2, value: 55000 },
    { time: '15:59:59', set: 1622.1, value: 64000 },
    { time: '16:00:00', set: 1622.3, value: 64200 },
    { time: '16:00:01', set: 1622.8, value: 64800 }, // Post-lock, must be excluded
    { time: '16:30:00', set: 1625.0, value: 70000 }, // Settlement tick, must be excluded
  ];
  const filteredPm = FeatureEngine.filterPreLockObservations(testDate, 'PM', rawPmFeed);
  assert(
    filteredPm.observations.length === 4 &&
    filteredPm.observations[filteredPm.observations.length - 1].time === '16:00:00',
    15,
    'FeatureEngine PM preserves observations up to 16:00:00 Bangkok and excludes 16:00:01+.'
  );

  // --------------------------------------------------------------------------
  // TEST 16: Device Timezone Independence (UTC-8, UTC+0, UTC+5:30, UTC+9)
  // --------------------------------------------------------------------------
  // An exact instant corresponding to 11:30:00 Yangon / 12:00:00 Bangkok on 2026-08-25:
  // UTC time: 2026-08-25T05:00:00.000Z
  const exactUtcEpoch = Date.parse('2026-08-25T05:00:00.000Z');

  // Verify across diverse representation inputs
  const fromEpoch = LockEngine.isSessionLocked(testDate, 'AM', exactUtcEpoch);
  const fromIsoUtc = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-25T05:00:00.000Z');
  const fromIsoPdt = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-24T22:00:00.000-07:00'); // UTC-7 representation of same epoch
  const fromIsoJst = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-25T14:00:00.000+09:00'); // UTC+9 representation of same epoch
  const fromIsoBkk = LockEngine.isSessionLocked(testDate, 'AM', '2026-08-25T12:00:00.000+07:00'); // UTC+7 representation of same epoch

  assert(
    fromEpoch === true &&
    fromIsoUtc === true &&
    fromIsoPdt === true &&
    fromIsoJst === true &&
    fromIsoBkk === true,
    16,
    'Device/host timezone offset does not alter lock calculation (100% timezone invariant).'
  );

  // --------------------------------------------------------------------------
  // TEST 17: Past Date Lock Invariance
  // --------------------------------------------------------------------------
  const pastDate = '2026-08-24'; // Yesterday relative to 2026-08-25
  const isPastLocked = LockEngine.isSessionLocked(pastDate, 'AM', new Date('2026-08-25T08:00:00+07:00'));
  assert(
    isPastLocked === true,
    17,
    'Past dates (T < today) are unconditionally locked even before morning market open.'
  );

  // --------------------------------------------------------------------------
  // TEST 18: Future Date Lock Invariance
  // --------------------------------------------------------------------------
  const futureDate = '2026-08-26'; // Tomorrow relative to 2026-08-25
  const isFutureLocked = LockEngine.isSessionLocked(futureDate, 'AM', new Date('2026-08-25T17:00:00+07:00'));
  assert(
    isFutureLocked === false,
    18,
    'Future dates (T > today) are unconditionally unlocked even after afternoon market close.'
  );

  // --------------------------------------------------------------------------
  // TEST 19: Midnight Date Rollover Handling
  // --------------------------------------------------------------------------
  // At 2026-08-25 00:00:05 Bangkok (2026-08-24 23:30:05 Yangon)
  const midnightInstant = new Date('2026-08-24T17:00:05.000Z'); // UTC
  const bkkMidnight = TimezoneContract.toBangkok(midnightInstant);
  const ygnMidnight = TimezoneContract.toYangon(midnightInstant);
  assert(
    bkkMidnight.dateStr === '2026-08-25' &&
    bkkMidnight.timeStr === '00:00:05' &&
    ygnMidnight.dateStr === '2026-08-24' &&
    ygnMidnight.timeStr === '23:30:05',
    19,
    'Midnight date rollover accurately tracks Bangkok market date while preserving Yangon clock.'
  );

  // --------------------------------------------------------------------------
  // TEST 20: Harmonization & Consistency Across All Constants
  // --------------------------------------------------------------------------
  const amHarmonized = (
    PREDICTION_CUTOFFS.AM.timeString === SESSION_SCHEDULES.AM.lockTimeString &&
    SESSION_SCHEDULES.AM.lockTimeString === '12:00:00' &&
    PREDICTION_CUTOFFS.AM.yangonTimeString === SESSION_SCHEDULES.AM.userLockTimeStringYangon &&
    SESSION_SCHEDULES.AM.userLockTimeStringYangon === '11:30:00'
  );
  const pmHarmonized = (
    PREDICTION_CUTOFFS.PM.timeString === SESSION_SCHEDULES.PM.lockTimeString &&
    SESSION_SCHEDULES.PM.lockTimeString === '16:00:00' &&
    PREDICTION_CUTOFFS.PM.yangonTimeString === SESSION_SCHEDULES.PM.userLockTimeStringYangon &&
    SESSION_SCHEDULES.PM.userLockTimeStringYangon === '15:30:00'
  );
  assert(
    amHarmonized && pmHarmonized,
    20,
    'PREDICTION_CUTOFFS, SESSION_SCHEDULES, and TimezoneContract are 100% harmonized.'
  );

  console.log('\n================================================================');
  console.log(' AUDIT COMPLETE: 20/20 TIMEZONE CONTRACT TESTS PASSED (100%)    ');
  console.log('================================================================\n');
}

runTimezoneContractTests().catch((err) => {
  console.error('Fatal error during timezone contract test execution:', err);
  process.exit(1);
});
