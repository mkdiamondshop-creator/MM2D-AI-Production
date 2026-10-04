import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SetLastDigitObservationTracker,
  globalSetLastDigitObservationTracker,
} from './setLastDigitObservationTracker';
import { SetLastDigitSignalV1 } from './setLastDigitSignalV1';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { VerifiedMarketRecord } from '../../types/market';

describe('Step 63: SET_LAST_DIGIT_V1 Production Observation', () => {
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

  it('1. Official SET decimal last digit is among candidates -> HIT', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_1', false);

    // Official settlement: SET 1,450.72 -> last decimal digit is '2'
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

  it('2. Official SET decimal last digit is NOT among candidates -> MISS', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_2', false);

    // Official settlement: SET 1,452.88 -> last decimal digit is '8'
    const settlement = createMockSettlement('2026-10-02', 'PM', '1,452.88', '50,000.00', '80');

    // Candidates do NOT contain '8': ['0', '5']
    const result = tracker.recordSession('2026-10-02', 'PM', ['0', '5'], settlement);

    assert.ok(result !== null);
    assert.equal(result.officialSetLastDigit, '8');
    assert.equal(result.status, 'MISS');
    assert.deepEqual(result.candidateDigits, ['0', '5']);
    assert.equal(result.session, 'PM');
  });

  it('3. Does not evaluate an unfinished session without official settlement', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_3', false);

    // Incomplete session record: isSettlement is false (live intraday tick, not settlement)
    const unfinalized = createMockSettlement('2026-10-02', 'AM', '1,450.15', '20,000.00', '52', false);

    const result = tracker.recordSession('2026-10-02', 'AM', ['5'], unfinalized);
    assert.equal(result, null, 'Must reject unfinalized session');

    // Also rejects empty settlement string or invalid number
    const invalidResult = tracker.recordSession('2026-10-02', 'AM', ['5'], '');
    assert.equal(invalidResult, null, 'Must reject empty settlement input');
  });

  it('4. AM and PM performance are tracked separately', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_4', false);

    // Day 1 AM: HIT ('3' in ['3', '8'])
    tracker.recordSession('2026-10-01', 'AM', ['3', '8'], '1450.23');
    // Day 1 PM: MISS ('7' not in ['1', '6'])
    tracker.recordSession('2026-10-01', 'PM', ['1', '6'], '1455.47');
    // Day 2 AM: HIT ('0' in ['0'])
    tracker.recordSession('2026-10-02', 'AM', ['0'], '1460.80');
    // Day 2 PM: HIT ('4' in ['4', '9'])
    tracker.recordSession('2026-10-02', 'PM', ['4', '9'], '1462.14');

    const summary = tracker.getSummary();

    // AM: 2/2 hits (100%)
    assert.equal(summary.am.hitCount, 2);
    assert.equal(summary.am.total, 2);
    assert.equal(summary.am.ratioText, 'HIT 2/2');

    // PM: 1/2 hits (50%)
    assert.equal(summary.pm.hitCount, 1);
    assert.equal(summary.pm.total, 2);
    assert.equal(summary.pm.ratioText, 'HIT 1/2');

    // Overall: 3/4 hits (75%)
    assert.equal(summary.overall.hitCount, 3);
    assert.equal(summary.overall.total, 4);
    assert.equal(summary.overall.ratioText, 'HIT 3/4');
    assert.equal(summary.sessionCount, 4);
  });

  it('5. Never uses live.twod: extracts strictly from official SET index decimal', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_5', false);

    // Settlement has set 1450.39 (last digit = 9), but twod is '92' (second digit is 2 from value)
    const settlement = createMockSettlement('2026-10-02', 'AM', '1,450.39', '45,002.00', '92');

    // Candidate is '9'
    const result = tracker.recordSession('2026-10-02', 'AM', ['9'], settlement);
    assert.ok(result !== null);
    // Extracted digit is strictly '9' from SET, NOT '2' from 2D
    assert.equal(result.officialSetLastDigit, '9');
    assert.equal(result.status, 'HIT');
  });

  it('6. Does NOT generate 10-number series', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_6', false);

    const result = tracker.recordSession('2026-10-02', 'AM', ['5', '8'], '1450.25');
    assert.ok(result !== null);

    // Recorded candidates must be single digits, NOT 2D numbers (e.g. '50'-'59')
    for (const d of result.candidateDigits) {
      assert.equal(d.length, 1, `Candidate ${d} must be a single decimal digit`);
      assert.ok(/^\d$/.test(d));
    }
  });

  it('7. Enforces temporary/minimal retention policy (keeps latest 10 trading days)', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_7', false);

    // Record 15 distinct trading dates
    for (let i = 1; i <= 15; i++) {
      const dateStr = `2026-09-${i.toString().padStart(2, '0')}`;
      tracker.recordSession(dateStr, 'AM', ['1'], '1450.11');
      tracker.recordSession(dateStr, 'PM', ['2'], '1450.22');
    }

    const records = tracker.getRecords();
    const distinctDates = new Set(records.map((r) => r.date));

    // Must strictly retain at most 10 trading days
    assert.ok(distinctDates.size <= 10, `Retained dates (${distinctDates.size}) must not exceed 10`);
    // Oldest dates (01 to 05) must be automatically pruned
    assert.ok(!distinctDates.has('2026-09-01'));
    assert.ok(!distinctDates.has('2026-09-05'));
    // Latest date (15) must be retained
    assert.ok(distinctDates.has('2026-09-15'));
  });

  it('8. Zero modification to AUTO_WEIGHTED_V2 engine or SET_LAST_DIGIT_V1 algorithm', () => {
    const historical = [
      createMockSettlement('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockSettlement('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockSettlement('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    const v2Before = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');
    const setV1Before = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: historical,
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    // Record multiple observations in tracker
    globalSetLastDigitObservationTracker.recordSession('2026-10-01', 'AM', ['4'], '1455.74');
    globalSetLastDigitObservationTracker.recordSession('2026-10-01', 'PM', ['2'], '1452.32');

    const v2After = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');
    const setV1After = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: historical,
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    // AUTO_WEIGHTED_V2 must be 100% byte-for-byte identical
    assert.deepEqual(v2Before.top10, v2After.top10);
    assert.equal(v2Before.top1, v2After.top1);
    assert.equal(v2Before.entropy, v2After.entropy);

    // SET_LAST_DIGIT_V1 must be 100% identical
    assert.deepEqual(setV1Before.candidates, setV1After.candidates);
    assert.deepEqual(setV1Before.distribution, setV1After.distribution);
  });

  it('9. syncFromOfficialSettlements automatically finds frozen candidates and records HIT/MISS for AM/PM', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_SYNC_1', false);

    // Official records representing previous history and a newly completed settlement day (2026-10-02)
    const productionRecords: VerifiedMarketRecord[] = [
      createMockSettlement('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockSettlement('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockSettlement('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
      createMockSettlement('2026-10-01', 'PM', '1,458.12', '44,000.00', '20'),
      // Completed settlements for 2026-10-02:
      createMockSettlement('2026-10-02', 'AM', '1,460.55', '46,000.00', '50'), // last SET digit: 5
      createMockSettlement('2026-10-02', 'PM', '1,462.88', '48,000.00', '80'), // last SET digit: 8
    ];

    const summary = tracker.syncFromOfficialSettlements(productionRecords);

    // Records must contain evaluations for the settlements
    const records = tracker.getRecords();
    assert.ok(records.length >= 2, 'Must record at least 2 sessions');

    // Find 2026-10-02 AM and PM evaluations
    const amRec = records.find((r) => r.date === '2026-10-02' && r.session === 'AM');
    const pmRec = records.find((r) => r.date === '2026-10-02' && r.session === 'PM');

    assert.ok(amRec !== undefined, '2026-10-02 AM must be automatically evaluated');
    assert.ok(pmRec !== undefined, '2026-10-02 PM must be automatically evaluated');

    // Extracted official SET last decimal digits
    assert.equal(amRec!.officialSetLastDigit, '5');
    assert.equal(pmRec!.officialSetLastDigit, '8');

    // Verified frozen candidate digits were found (1 to 3 digits)
    assert.ok(amRec!.candidateDigits.length >= 1 && amRec!.candidateDigits.length <= 3);
    assert.ok(pmRec!.candidateDigits.length >= 1 && pmRec!.candidateDigits.length <= 3);

    // Status is strictly HIT or MISS
    assert.ok(['HIT', 'MISS'].includes(amRec!.status));
    assert.ok(['HIT', 'MISS'].includes(pmRec!.status));

    // HIT/MISS correctness
    assert.equal(amRec!.status, amRec!.candidateDigits.includes('5') ? 'HIT' : 'MISS');
    assert.equal(pmRec!.status, pmRec!.candidateDigits.includes('8') ? 'HIT' : 'MISS');

    // AM and PM correctly separated in summary
    assert.ok(summary.am.total >= 1);
    assert.ok(summary.pm.total >= 1);
  });

  it('10. syncFromOfficialSettlements ignores unfinished sessions and requires zero manual user action', () => {
    const tracker = new SetLastDigitObservationTracker('TEST_OBS_KEY_SYNC_2', false);

    const recordsWithUnfinished: VerifiedMarketRecord[] = [
      createMockSettlement('2026-10-01', 'AM', '1,455.75', '42,000.00', '54', true),
      // Unfinished intraday session (isSettlement: false)
      createMockSettlement('2026-10-01', 'PM', '1,458.12', '44,000.00', '20', false),
      // Incomplete session missing set values
      {
        id: '2026-10-02_AM',
        date: '2026-10-02',
        time: '12:01:00',
        session: 'AM',
        isSettlement: true,
        setRaw: '',
        valueRaw: '',
        setNumeric: undefined as any,
        valueNumeric: 0,
        twod: '',
        historyId: 'h_test',
        verifiedAt: '2026-10-02T12:00:00Z',
        mathematicalCheck: {
          setLastDigit: '',
          valueLastDigitBeforeDecimal: '',
          derived2D: '',
          isMathematicallyConsistent: false,
        },
      },
    ];

    tracker.syncFromOfficialSettlements(recordsWithUnfinished);
    const records = tracker.getRecords();

    // Only the finalized 2026-10-01 AM session is evaluated
    assert.equal(records.length, 1);
    assert.equal(records[0].date, '2026-10-01');
    assert.equal(records[0].session, 'AM');
  });
});
