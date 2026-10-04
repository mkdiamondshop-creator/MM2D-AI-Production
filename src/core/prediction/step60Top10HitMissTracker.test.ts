import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Top10HitMissTracker, HitMissRecord, RollingPerformanceSummary } from './top10HitMissTracker';
import { VerifiedMarketRecord } from '../../types/market';

describe('Step 60: Top-10 HIT/MISS Tracking System (1-Week Observation)', () => {
  let tracker: Top10HitMissTracker;

  beforeEach(() => {
    // Non-persistent instance for isolated tests
    tracker = new Top10HitMissTracker('TEST_HIT_MISS_STORE', false);
    tracker.clear();
  });

  it('1. Top-10 contains official result → HIT', () => {
    const finalTop10 = ['45', '12', '78', '90', '23', '34', '56', '67', '89', '01'];
    
    // Official 2D is at the beginning of Top-10
    const res1 = tracker.recordSession('2026-10-01', 'AM', finalTop10, '45');
    assert.equal(res1.record.status, 'HIT');
    assert.equal(res1.record.officialTwod, '45');
    assert.equal(res1.record.date, '2026-10-01');
    assert.equal(res1.record.session, 'AM');

    // Official 2D is at index 9 (last element of Top-10)
    const res2 = tracker.recordSession('2026-10-01', 'PM', finalTop10, '01');
    assert.equal(res2.record.status, 'HIT');
    assert.equal(res2.record.officialTwod, '01');

    // Middle element
    const res3 = tracker.recordSession('2026-10-02', 'AM', finalTop10, '34');
    assert.equal(res3.record.status, 'HIT');
  });

  it('2. Top-10 does not contain official result → MISS', () => {
    const finalTop10 = ['45', '12', '78', '90', '23', '34', '56', '67', '89', '01'];
    
    // Official 2D is not in Top-10
    const res1 = tracker.recordSession('2026-10-01', 'AM', finalTop10, '99');
    assert.equal(res1.record.status, 'MISS');
    assert.equal(res1.record.officialTwod, '99');

    // Another non-present number
    const res2 = tracker.recordSession('2026-10-01', 'PM', finalTop10, '77');
    assert.equal(res2.record.status, 'MISS');
    assert.equal(res2.record.officialTwod, '77');

    // Candidate at index >= 10 if provided does not count as Top-10 HIT
    const extendedList = [...finalTop10, '99']; // 99 is at index 10 (11th item)
    const res3 = tracker.recordSession('2026-10-02', 'AM', extendedList, '99');
    assert.equal(res3.record.status, 'MISS');
  });

  it('3. Only latest 5 trading days are retained', () => {
    const dummyTop10 = ['10', '20', '30', '40', '50', '60', '70', '80', '90', '00'];

    // Insert 7 sequential trading days
    const dates = [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-28',
      '2026-09-29',
    ];

    for (const d of dates) {
      tracker.recordSession(d, 'AM', dummyTop10, '10');
      tracker.recordSession(d, 'PM', dummyTop10, '20');
    }

    const retainedDays = tracker.getDistinctTradingDays();
    assert.equal(retainedDays.length, 5, 'Must keep strictly 5 trading days');

    // Retained days must be the latest 5
    assert.deepEqual(retainedDays, [
      '2026-09-29',
      '2026-09-28',
      '2026-09-25',
      '2026-09-24',
      '2026-09-23',
    ]);

    // Older days must not be retained
    assert.equal(retainedDays.includes('2026-09-21'), false);
    assert.equal(retainedDays.includes('2026-09-22'), false);

    // Maximum 10 session records stored
    const records = tracker.getRecords();
    assert.equal(records.length, 10);
  });

  it('4. Oldest records are automatically removed when a new trading day enters', () => {
    const dummyTop10 = ['11', '22', '33', '44', '55', '66', '77', '88', '99', '00'];

    // Initial 5 trading days
    tracker.recordSession('2026-10-01', 'AM', dummyTop10, '11');
    tracker.recordSession('2026-10-01', 'PM', dummyTop10, '22');
    tracker.recordSession('2026-10-02', 'AM', dummyTop10, '33');
    tracker.recordSession('2026-10-02', 'PM', dummyTop10, '44');
    tracker.recordSession('2026-10-03', 'AM', dummyTop10, '55');
    tracker.recordSession('2026-10-03', 'PM', dummyTop10, '66');
    tracker.recordSession('2026-10-04', 'AM', dummyTop10, '77');
    tracker.recordSession('2026-10-04', 'PM', dummyTop10, '88');
    tracker.recordSession('2026-10-05', 'AM', dummyTop10, '99');
    tracker.recordSession('2026-10-05', 'PM', dummyTop10, '00');

    // Verify 2026-10-01 is present initially
    assert.ok(tracker.getDistinctTradingDays().includes('2026-10-01'));
    assert.equal(tracker.getRecords().length, 10);

    // Enter a new trading day (Day 6)
    const { prunedDates } = tracker.recordSession('2026-10-06', 'AM', dummyTop10, '11');

    // Oldest day (2026-10-01) must be automatically pruned
    assert.ok(prunedDates.includes('2026-10-01'), 'Oldest day 2026-10-01 must be pruned');
    assert.equal(tracker.getDistinctTradingDays().includes('2026-10-01'), false);

    // Remaining days must be 10-02 through 10-06
    assert.deepEqual(tracker.getDistinctTradingDays(), [
      '2026-10-06',
      '2026-10-05',
      '2026-10-04',
      '2026-10-03',
      '2026-10-02',
    ]);

    // Record PM for Day 6
    tracker.recordSession('2026-10-06', 'PM', dummyTop10, '22');

    // Now enter Day 7
    const resultDay7 = tracker.recordSession('2026-10-07', 'AM', dummyTop10, '33');
    assert.ok(resultDay7.prunedDates.includes('2026-10-02'), 'Next oldest day 2026-10-02 must be pruned');
    assert.equal(tracker.getDistinctTradingDays().includes('2026-10-02'), false);
    assert.equal(tracker.getDistinctTradingDays().length, 5);
  });

  it('5. AM/PM and overall counts are correct', () => {
    const top10 = ['10', '20', '30', '40', '50', '60', '70', '80', '90', '00'];

    // Day 1: AM HIT, PM MISS
    tracker.recordSession('2026-10-01', 'AM', top10, '10'); // HIT
    tracker.recordSession('2026-10-01', 'PM', top10, '99'); // MISS

    // Day 2: AM HIT, PM HIT
    tracker.recordSession('2026-10-02', 'AM', top10, '20'); // HIT
    tracker.recordSession('2026-10-02', 'PM', top10, '30'); // HIT

    // Day 3: AM MISS, PM HIT
    tracker.recordSession('2026-10-03', 'AM', top10, '88'); // MISS
    tracker.recordSession('2026-10-03', 'PM', top10, '40'); // HIT

    // Day 4: AM HIT, PM MISS
    tracker.recordSession('2026-10-04', 'AM', top10, '50'); // HIT
    tracker.recordSession('2026-10-04', 'PM', top10, '77'); // MISS

    // Day 5: AM MISS, PM MISS
    tracker.recordSession('2026-10-05', 'AM', top10, '66'); // MISS
    tracker.recordSession('2026-10-05', 'PM', top10, '55'); // MISS (wait, 55 is not in top10: [10,20,30,40,50,60,70,80,90,00])

    const summary = tracker.getRollingSummary();

    // AM: Day 1 (HIT), Day 2 (HIT), Day 3 (MISS), Day 4 (HIT), Day 5 (MISS) = 3 HITs
    assert.equal(summary.am.hitCount, 3);
    assert.equal(summary.am.total, 5);
    assert.equal(summary.am.ratioText, 'HIT 3/5');

    // PM: Day 1 (MISS), Day 2 (HIT), Day 3 (HIT), Day 4 (MISS), Day 5 (MISS) = 2 HITs
    assert.equal(summary.pm.hitCount, 2);
    assert.equal(summary.pm.total, 5);
    assert.equal(summary.pm.ratioText, 'HIT 2/5');

    // Overall: 3 + 2 = 5 HITs out of 10
    assert.equal(summary.overall.hitCount, 5);
    assert.equal(summary.overall.total, 10);
    assert.equal(summary.overall.ratioText, 'HIT 5/10');

    // Trading days details count
    assert.equal(summary.tradingDays.length, 5);
    
    // Check Day 2 detail
    const day2 = summary.tradingDays.find((d) => d.date === '2026-10-02');
    assert.ok(day2);
    assert.equal(day2.am?.status, 'HIT');
    assert.equal(day2.am?.officialTwod, '20');
    assert.equal(day2.pm?.status, 'HIT');
    assert.equal(day2.pm?.officialTwod, '30');

    // Check Day 5 detail
    const day5 = summary.tradingDays.find((d) => d.date === '2026-10-05');
    assert.ok(day5);
    assert.equal(day5.am?.status, 'MISS');
    assert.equal(day5.pm?.status, 'MISS');
  });

  it('6. Does not duplicate prediction data or store live SET/Value', () => {
    const top10 = ['10', '20', '30', '40', '50', '60', '70', '80', '90', '00'];
    const { record } = tracker.recordSession('2026-10-05', 'AM', top10, '10');

    // Assert strictly minimal record fields
    assert.deepEqual(Object.keys(record).sort(), ['date', 'evaluatedAt', 'id', 'officialTwod', 'session', 'status'].sort());
    assert.equal((record as any).set, undefined);
    assert.equal((record as any).value, undefined);
    assert.equal((record as any).candidates, undefined);
    assert.equal((record as any).probabilities, undefined);
    assert.equal((record as any).top10, undefined);
    assert.equal((record as any).rank, undefined);
  });

  it('7. syncFromExistingData correctly reconciles predictions with verified settlement records', () => {
    const predictions = [
      { date: '2026-10-01', session: 'AM' as const, top10: ['12', '34', '56'] },
      { date: '2026-10-01', session: 'PM' as const, top10: ['78', '90', '11'] },
      { date: '2026-10-02', session: 'AM' as const, top10: ['22', '33', '44'] },
    ];

    const officialRecords: VerifiedMarketRecord[] = [
      {
        id: 'rec_1',
        date: '2026-10-01',
        time: '12:01:00',
        session: 'AM',
        isSettlement: true,
        twod: '12', // HIT
        setRaw: '1,450.12',
        valueRaw: '50,123.45',
        setNumeric: 1450.12,
        valueNumeric: 50123.45,
        historyId: 'h1',
        verifiedAt: '2026-10-01T12:01:00Z',
        mathematicalCheck: {
          setLastDigit: '0',
          valueLastDigitBeforeDecimal: '3',
          derived2D: '12',
          isMathematicallyConsistent: true,
        },
      },
      {
        id: 'rec_2',
        date: '2026-10-01',
        time: '16:30:00',
        session: 'PM',
        isSettlement: true,
        twod: '99', // MISS (not in [78, 90, 11])
        setRaw: '1,452.89',
        valueRaw: '60,456.78',
        setNumeric: 1452.89,
        valueNumeric: 60456.78,
        historyId: 'h2',
        verifiedAt: '2026-10-01T16:30:00Z',
        mathematicalCheck: {
          setLastDigit: '2',
          valueLastDigitBeforeDecimal: '6',
          derived2D: '99',
          isMathematicallyConsistent: true,
        },
      },
      {
        id: 'rec_3',
        date: '2026-10-02',
        time: '12:01:00',
        session: 'AM',
        isSettlement: true,
        twod: '33', // HIT
        setRaw: '1,455.33',
        valueRaw: '45,678.90',
        setNumeric: 1455.33,
        valueNumeric: 45678.90,
        historyId: 'h3',
        verifiedAt: '2026-10-02T12:01:00Z',
        mathematicalCheck: {
          setLastDigit: '5',
          valueLastDigitBeforeDecimal: '8',
          derived2D: '33',
          isMathematicallyConsistent: true,
        },
      },
    ];

    const summary = tracker.syncFromExistingData(predictions, officialRecords);
    assert.equal(summary.am.hitCount, 2);
    assert.equal(summary.pm.hitCount, 0);
    assert.equal(summary.overall.hitCount, 2);
  });
});
