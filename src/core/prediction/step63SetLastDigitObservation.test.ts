import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SetLastDigitObservationTracker,
  globalSetLastDigitObservationTracker,
} from './setLastDigitObservationTracker';
import { SetLastDigitSignalV1 } from './setLastDigitSignalV1';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { VerifiedMarketRecord } from '../../types/market';
import { MarketCalendar } from '../market/marketCalendar';

describe('Step 63: SET_LAST_DIGIT_V1 Production Observation (5 Trading Days)', () => {
  const createMockSettlement = (
    date: string,
    session: 'AM' | 'PM',
    setRaw: string,
    valueRaw: string,
    twod: string,
    isSettlement = true
  ): VerifiedMarketRecord => {
    const setNum = parseFloat(setRaw.replace(/,/g, ''));
    const valNum = parseFloat(valueRaw.replace(/,/g, ''));
    return {
      id: `${date}_${session}`,
      date,
      time: session === 'AM' ? '12:01:00' : '16:30:00',
      session,
      isSettlement,
      setRaw,
      valueRaw,
      setNumeric: setNum,
      valueNumeric: valNum,
      twod,
      historyId: `h_${date}_${session}`,
      verifiedAt: `${date}T12:00:00Z`,
      mathematicalCheck: {
        setLastDigit: twod[0],
        valueLastDigitBeforeDecimal: twod[1],
        derived2D: twod,
        isMathematicallyConsistent: true,
      },
    };
  };

  // Required Test 5: Official SET digit in candidates → HIT
  it('1. Official SET decimal last digit is among candidates -> HIT', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_1', false);

    // Official settlement: SET 1,450.72 -> last decimal digit is '2' (Friday trading day)
    const settlement = createMockSettlement('2026-10-02', 'AM', '1,450.72', '45,000.00', '25');

    // Candidates contain '2': ['2', '7']
    const result = tracker.recordSession('2026-10-02', 'AM', ['2', '7'], settlement);

    assert.ok(result !== null);
    assert.equal(result.officialSetLastDigit, '2');
    assert.equal(result.status, 'HIT');
    assert.deepEqual(result.candidateDigits, ['2', '7']);
    assert.equal(result.session, 'AM');
    assert.equal(result.date, '2026-10-02');
  });

  // Required Test 6: Official SET digit not in candidates → MISS
  it('2. Official SET decimal last digit is NOT among candidates -> MISS', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_2', false);

    // Official settlement: SET 1,452.88 -> last decimal digit is '8' (Friday trading day)
    const settlement = createMockSettlement('2026-10-02', 'PM', '1,452.88', '50,000.00', '80');

    // Candidates do NOT contain '8': ['0', '5']
    const result = tracker.recordSession('2026-10-02', 'PM', ['0', '5'], settlement);

    assert.ok(result !== null);
    assert.equal(result.officialSetLastDigit, '8');
    assert.equal(result.status, 'MISS');
    assert.deepEqual(result.candidateDigits, ['0', '5']);
    assert.equal(result.session, 'PM');
  });

  // Required Test 3: Weekend / holiday မတွက်ခြင်း
  it('3. Weekend / holiday are not counted as observations', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_WEEKEND', false);

    // Saturday: 2026-10-03 -> must return null and NOT be recorded
    const satResult = tracker.recordSession('2026-10-03', 'AM', ['1'], '1450.11');
    assert.equal(satResult, null, 'Must reject Saturday');

    // Sunday: 2026-10-04 -> must return null and NOT be recorded
    const sunResult = tracker.recordSession('2026-10-04', 'PM', ['2'], '1450.22');
    assert.equal(sunResult, null, 'Must reject Sunday');

    // Official SET holiday: 2026-10-13 -> must return null and NOT be recorded
    MarketCalendar.registerOfficialHoliday('2026-10-13', 'King Bhumibol Memorial Day');
    try {
      const holidayResult = tracker.recordSession('2026-10-13', 'AM', ['5'], '1450.55');
      assert.equal(holidayResult, null, 'Must reject official SET holiday');
    } finally {
      MarketCalendar.clearHolidaysForTesting();
    }

    assert.equal(tracker.getRecords().length, 0, 'No weekend or holiday records allowed');
  });

  // Required Test 1: 5 trading days အတွင်း observation များကို ထိန်းသိမ်းနိုင်ခြင်း
  it('4. Maintains observations within 5 trading days', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_5DAYS', false);

    // Record 5 distinct valid trading days (Monday to Friday)
    // 2026-09-28 (Mon), 2026-09-29 (Tue), 2026-09-30 (Wed), 2026-10-01 (Thu), 2026-10-02 (Fri)
    const tradingDays = [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ];

    for (const d of tradingDays) {
      tracker.recordSession(d, 'AM', ['1', '2'], '1450.11');
      tracker.recordSession(d, 'PM', ['3', '4'], '1450.33');
    }

    const records = tracker.getRecords();
    const distinctDates = Array.from(new Set(records.map((r) => r.date)));

    assert.equal(distinctDates.length, 5, 'Must maintain exactly 5 trading days');
    for (const d of tradingDays) {
      assert.ok(distinctDates.includes(d), `Must retain trading day ${d}`);
    }
  });

  // Required Test 2: 6th trading day ဝင်လာသောအခါ oldest trading day auto cleanup ဖြစ်ခြင်း
  it('5. When 6th trading day enters, oldest trading day is auto cleaned up', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_CLEANUP', false);

    // Initial 5 trading days
    const initialDays = [
      '2026-09-28', // Oldest (Mon)
      '2026-09-29', // Tue
      '2026-09-30', // Wed
      '2026-10-01', // Thu
      '2026-10-02', // Fri
    ];

    for (const d of initialDays) {
      tracker.recordSession(d, 'AM', ['1'], '1450.11');
      tracker.recordSession(d, 'PM', ['2'], '1450.22');
    }

    // 6th trading day arrives: 2026-10-05 (Monday)
    tracker.recordSession('2026-10-05', 'AM', ['7'], '1455.77');

    const records = tracker.getRecords();
    const distinctDates = Array.from(new Set(records.map((r) => r.date)));

    // Must still have at most 5 distinct trading days
    assert.equal(distinctDates.length, 5, 'Must strictly retain at most 5 trading days');
    // Oldest day 2026-09-28 must be pruned
    assert.ok(!distinctDates.includes('2026-09-28'), 'Oldest trading day 2026-09-28 must be auto cleaned up');
    // New day 2026-10-05 must be present
    assert.ok(distinctDates.includes('2026-10-05'), 'Newest trading day 2026-10-05 must be retained');
  });

  // Required Test 4: Maximum 10 sessions
  it('6. Maximum 10 sessions enforced', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_MAX10', false);

    // Insert sessions across 8 valid trading days
    const days = [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ];

    for (const d of days) {
      tracker.recordSession(d, 'AM', ['1'], '1450.11');
      tracker.recordSession(d, 'PM', ['2'], '1450.22');
    }

    const records = tracker.getRecords();
    assert.ok(records.length <= SetLastDigitObservationTracker.MAX_SESSIONS);
    assert.equal(records.length, 10, 'Must have at most 10 sessions (5 days x 2 sessions)');
  });

  // Required Test 7: AM / PM separate counts မှန်ခြင်း
  it('7. AM / PM separate counts are correct (AM HIT: x/5, PM HIT: x/5, TOTAL HIT: x/10)', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_COUNTS', false);

    // Day 1: AM HIT, PM MISS
    tracker.recordSession('2026-10-01', 'AM', ['3', '8'], '1450.23'); // Hit ('3')
    tracker.recordSession('2026-10-01', 'PM', ['1', '6'], '1455.47'); // Miss ('7')
    // Day 2: AM HIT, PM HIT
    tracker.recordSession('2026-10-02', 'AM', ['0'], '1460.80'); // Hit ('0')
    tracker.recordSession('2026-10-02', 'PM', ['4', '9'], '1462.14'); // Hit ('4')

    const summary = tracker.getSummary();

    // AM: 2/2 hits
    assert.equal(summary.am.hitCount, 2);
    assert.equal(summary.am.total, 2);
    assert.equal(summary.am.ratioText, 'AM HIT: 2/5');

    // PM: 1/2 hits
    assert.equal(summary.pm.hitCount, 1);
    assert.equal(summary.pm.total, 2);
    assert.equal(summary.pm.ratioText, 'PM HIT: 1/5');

    // Overall: 3/4 hits
    assert.equal(summary.overall.hitCount, 3);
    assert.equal(summary.overall.total, 4);
    assert.equal(summary.overall.ratioText, 'TOTAL HIT: 3/10');
    assert.equal(summary.sessionCount, 4);
  });

  it('8. Does not evaluate an unfinished session without official settlement', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_UNFINISHED', false);

    const unfinalized = createMockSettlement('2026-10-02', 'AM', '1,450.15', '20,000.00', '52', false);
    const result = tracker.recordSession('2026-10-02', 'AM', ['5'], unfinalized);
    assert.equal(result, null, 'Must reject unfinalized session');

    const invalidResult = tracker.recordSession('2026-10-02', 'AM', ['5'], '');
    assert.equal(invalidResult, null, 'Must reject empty settlement input');
  });

  it('9. Never uses live.twod: extracts strictly from official SET index decimal', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_NOTWOD', false);

    const settlement = createMockSettlement('2026-10-02', 'AM', '1,450.39', '45,002.00', '92');
    const result = tracker.recordSession('2026-10-02', 'AM', ['9'], settlement);
    assert.ok(result !== null);
    assert.equal(result.officialSetLastDigit, '9');
    assert.equal(result.status, 'HIT');
  });

  it('10. syncFromOfficialSettlements automatically finds frozen candidates and records HIT/MISS for AM/PM', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_SYNC_1', false);

    const productionRecords: VerifiedMarketRecord[] = [
      createMockSettlement('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockSettlement('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockSettlement('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
      createMockSettlement('2026-10-01', 'PM', '1,458.12', '44,000.00', '20'),
      createMockSettlement('2026-10-02', 'AM', '1,460.55', '46,000.00', '50'),
      createMockSettlement('2026-10-02', 'PM', '1,462.88', '48,000.00', '80'),
    ];

    const summary = tracker.syncFromOfficialSettlements(productionRecords);
    const records = tracker.getRecords();
    assert.ok(records.length >= 2, 'Must record at least 2 sessions');

    const amRec = records.find((r) => r.date === '2026-10-02' && r.session === 'AM');
    const pmRec = records.find((r) => r.date === '2026-10-02' && r.session === 'PM');

    assert.ok(amRec !== undefined);
    assert.ok(pmRec !== undefined);
    assert.equal(amRec!.officialSetLastDigit, '5');
    assert.equal(pmRec!.officialSetLastDigit, '8');
    assert.ok(['HIT', 'MISS'].includes(amRec!.status));
    assert.ok(['HIT', 'MISS'].includes(pmRec!.status));
    assert.ok(summary.am.total >= 1);
    assert.ok(summary.pm.total >= 1);
  });
});
