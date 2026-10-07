import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SetLastDigitObservationTracker,
  SetLastDigitObservationRecord,
} from './setLastDigitObservationTracker';
import { SetLastDigitSignalV1 } from './setLastDigitSignalV1';
import { MarketCalendar } from '../market/marketCalendar';
import { VerifiedMarketRecord } from '../../types/market';

describe('Step 66: SET Last Digit Observation — Previous Sessions Verification (Monday / Tuesday)', () => {
  const createMockSettlement = (
    date: string,
    session: 'AM' | 'PM',
    setRaw: string,
    twod: string,
    isSettlement = true
  ): VerifiedMarketRecord => {
    const setNum = parseFloat(setRaw.replace(/,/g, ''));
    return {
      id: `${date}_${session}`,
      date,
      time: session === 'AM' ? '12:01:00' : '16:30:00',
      session,
      isSettlement,
      setRaw,
      valueRaw: '50,000.00',
      setNumeric: setNum,
      valueNumeric: 50000,
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

  it('1. Checks persisted state: returns null / not recorded if frozen candidates do not exist', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_EMPTY', false);

    // Initial state with no previous recordings
    const records = tracker.getRecords();
    const mondayAm = records.find((r) => r.date === '2026-10-05' && r.session === 'AM');
    const tuesdayAm = records.find((r) => r.date === '2026-10-06' && r.session === 'AM');

    assert.equal(mondayAm, undefined, 'Monday AM should not have unrecorded prediction');
    assert.equal(tuesdayAm, undefined, 'Tuesday AM should not have unrecorded prediction');
  });

  it('2. Auto-compares when frozen candidates exist: HIT when candidate contains official last digit, MISS when not', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_COMPARE', false);

    // Monday 2026-10-05 AM: SET 1,450.72 -> last digit is '2'
    const monSettlement = createMockSettlement('2026-10-05', 'AM', '1,450.72', '25');
    // Frozen candidates: ['2', '7'] -> contains '2' -> HIT
    const hitRecord = tracker.recordSession('2026-10-05', 'AM', ['2', '7'], monSettlement);
    assert.ok(hitRecord !== null);
    assert.equal(hitRecord.status, 'HIT');
    assert.equal(hitRecord.officialSetLastDigit, '2');

    // Tuesday 2026-10-06 AM: SET 1,455.39 -> last digit is '9'
    const tueSettlement = createMockSettlement('2026-10-06', 'AM', '1,455.39', '94');
    // Frozen candidates: ['1', '3'] -> does NOT contain '9' -> MISS
    const missRecord = tracker.recordSession('2026-10-06', 'AM', ['1', '3'], tueSettlement);
    assert.ok(missRecord !== null);
    assert.equal(missRecord.status, 'MISS');
    assert.equal(missRecord.officialSetLastDigit, '9');
  });

  it('3. Saturday / Sunday / official holiday are strictly excluded from observation count', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_HOLIDAY', false);

    // Saturday 2026-10-03
    const sat = tracker.recordSession('2026-10-03', 'AM', ['1', '2'], '1450.12');
    assert.equal(sat, null, 'Saturday must be rejected');

    // Sunday 2026-10-04
    const sun = tracker.recordSession('2026-10-04', 'PM', ['1', '2'], '1450.12');
    assert.equal(sun, null, 'Sunday must be rejected');

    // Official SET holiday
    MarketCalendar.registerOfficialHoliday('2026-10-13', 'Official Memorial Day');
    try {
      const hol = tracker.recordSession('2026-10-13', 'AM', ['1', '2'], '1450.12');
      assert.equal(hol, null, 'Official holiday must be rejected');
    } finally {
      MarketCalendar.clearHolidaysForTesting();
    }
  });

  it('4. Retains strictly latest 5 trading days / maximum 10 sessions and auto cleans up oldest', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_RETENTION', false);

    // 5 initial trading days (Monday 2026-09-28 to Friday 2026-10-02)
    const initialDays = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    for (const d of initialDays) {
      tracker.recordSession(d, 'AM', ['0'], '1450.00');
      tracker.recordSession(d, 'PM', ['1'], '1450.11');
    }

    assert.equal(tracker.getRecords().length, 10, 'Initially 10 sessions');

    // 6th trading day arrives: Monday 2026-10-05
    tracker.recordSession('2026-10-05', 'AM', ['2'], '1450.22');

    const recordsAfterMon = tracker.getRecords();
    const datesAfterMon = Array.from(new Set(recordsAfterMon.map((r) => r.date)));
    assert.equal(datesAfterMon.length, 5, 'Must strictly retain at most 5 trading days');
    assert.ok(!datesAfterMon.includes('2026-09-28'), 'Oldest trading day (2026-09-28) must be cleaned up');
    assert.ok(datesAfterMon.includes('2026-10-05'), 'Monday (2026-10-05) must be present');

    // 7th trading day arrives: Tuesday 2026-10-06
    tracker.recordSession('2026-10-06', 'AM', ['3'], '1450.33');
    const recordsAfterTue = tracker.getRecords();
    const datesAfterTue = Array.from(new Set(recordsAfterTue.map((r) => r.date)));
    assert.equal(datesAfterTue.length, 5, 'Must still retain at most 5 trading days');
    assert.ok(!datesAfterTue.includes('2026-09-29'), 'Next oldest trading day (2026-09-29) must be cleaned up');
    assert.ok(datesAfterTue.includes('2026-10-06'), 'Tuesday (2026-10-06) must be present');
  });

  it('5. Summary counts AM HIT: x/5, PM HIT: x/5, TOTAL HIT: x/10 properly', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_METRICS', false);

    tracker.recordSession('2026-10-05', 'AM', ['2'], '1450.72'); // AM HIT ('2')
    tracker.recordSession('2026-10-05', 'PM', ['5'], '1450.88'); // PM MISS ('8' != '5')
    tracker.recordSession('2026-10-06', 'AM', ['3'], '1450.33'); // AM HIT ('3')

    const summary = tracker.getSummary();
    assert.equal(summary.am.hitCount, 2);
    assert.equal(summary.am.total, 2);
    assert.equal(summary.am.ratioText, 'AM HIT: 2/5');

    assert.equal(summary.pm.hitCount, 0);
    assert.equal(summary.pm.total, 1);
    assert.equal(summary.pm.ratioText, 'PM HIT: 0/5');

    assert.equal(summary.overall.hitCount, 2);
    assert.equal(summary.overall.total, 3);
    assert.equal(summary.overall.ratioText, 'TOTAL HIT: 2/10');
  });

  it('6. Does NOT synthesize fake/backfilled prediction numbers if candidates array is empty', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_STEP66_NO_FAKE', false);

    // Passing empty candidates -> must return null, NOT invent numbers
    const res = tracker.recordSession('2026-10-05', 'AM', [], '1450.72');
    assert.equal(res, null, 'Must reject empty candidates and never fake a prediction');
    assert.equal(tracker.getRecords().length, 0);
  });
});
