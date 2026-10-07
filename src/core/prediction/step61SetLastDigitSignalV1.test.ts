import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SetLastDigitSignalV1,
  extractSetLastDigit,
  SetLastDigitInput,
} from './setLastDigitSignalV1';
import { VerifiedMarketRecord } from '../../types/market';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { MarketCalendar } from '../market/marketCalendar';

describe('Step 61: SET Last Digit Signal V1 Isolated Engine (Live SET Only)', () => {
  const createMockRecord = (
    date: string,
    session: 'AM' | 'PM',
    setRaw: string,
    valueRaw: string,
    twod: string
  ): VerifiedMarketRecord => {
    const setNum = parseFloat(setRaw.replace(/,/g, ''));
    const valNum = parseFloat(valueRaw.replace(/,/g, ''));
    return {
      id: `${date}_${session}`,
      date,
      time: session === 'AM' ? '12:01:00' : '16:30:00',
      session,
      isSettlement: true,
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

  it('1. Target digit extraction from official SET value', () => {
    assert.equal(extractSetLastDigit('1571.62'), '2');
    assert.equal(extractSetLastDigit('1,571.62'), '2');
    assert.equal(extractSetLastDigit(1571.62), '2');

    assert.equal(extractSetLastDigit('1450.80'), '0');
    assert.equal(extractSetLastDigit('1,450.80'), '0');
    assert.equal(extractSetLastDigit(1450.8), '0');

    assert.equal(extractSetLastDigit(1395.05), '5');
    assert.equal(extractSetLastDigit('1,395.05'), '5');
    assert.equal(extractSetLastDigit('1600.4'), '4');
    assert.equal(extractSetLastDigit(1400.0), '0');
  });

  it('2. Output rule produces 1, 2, or maximum 3 candidates', () => {
    const records: VerifiedMarketRecord[] = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    const inputDominant: SetLastDigitInput = {
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [
        { set: 1458.25, time: '11:15:00' },
        { set: 1458.25, time: '11:20:00' },
        { set: 1458.25, time: '11:28:00' },
      ],
      currentTime: '2026-10-02T11:30:00+07:00',
    };

    const resA = SetLastDigitSignalV1.predict(inputDominant);
    assert.ok(resA.candidateCount >= 1 && resA.candidateCount <= 3);
    assert.equal(resA.candidates.length, resA.candidateCount);
    assert.ok([1, 2, 3].includes(resA.candidateCount));

    for (let i = 0; i < resA.candidates.length - 1; i++) {
      assert.ok(resA.candidates[i].probability >= resA.candidates[i + 1].probability);
      assert.equal(resA.candidates[i].rank, i + 1);
    }
  });

  // Core requirement test 1: No Live SET -> no candidates
  it('3. No Live SET -> no candidates (WAITING_FOR_LIVE_SET / WAITING_FOR_MARKET_OPEN)', () => {
    const records = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    // Case A: Before Market Open (e.g. 09:30 AM) -> WAITING_FOR_MARKET_OPEN and 0 candidates
    const preOpen = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [],
      currentTime: '2026-10-02T09:30:00+07:00',
    });
    assert.equal(preOpen.status, 'WAITING_FOR_MARKET_OPEN');
    assert.equal(preOpen.candidateCount, 0);
    assert.deepEqual(preOpen.candidates, []);

    // Case B: During Market Open (e.g. 10:30 AM) with 0 live observations -> WAITING_FOR_LIVE_SET and 0 candidates
    const openNoLive = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [],
      currentTime: '2026-10-02T10:30:00+07:00',
    });
    assert.equal(openNoLive.status, 'WAITING_FOR_LIVE_SET');
    assert.equal(openNoLive.candidateCount, 0);
    assert.deepEqual(openNoLive.candidates, []);
  });

  // Core requirement test 2: Market Open + Live SET -> candidates can appear
  it('4. Market Open + Live SET -> candidates can appear', () => {
    const records = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1458.25, time: '10:15:00' }],
      currentTime: '2026-10-02T10:30:00+07:00',
    });

    assert.equal(res.status, 'LIVE_SIGNAL');
    assert.ok(res.candidateCount >= 1 && res.candidateCount <= 3);
    assert.equal(res.candidates.length, res.candidateCount);
    assert.ok(res.candidates.every((c) => /^[0-9]$/.test(c.digit)));
  });

  // Core requirement test 3: New Live SET changes signal deterministically when evidence changes
  it('5. New Live SET changes signal deterministically when evidence changes', () => {
    const records = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    // Observation anchoring on last digit 2 (1458.22)
    const resA = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1458.22, time: '10:15:00' }],
      currentTime: '2026-10-02T10:30:00+07:00',
    });

    // New observation anchoring on last digit 7 (1458.77)
    const resB = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1458.77, time: '10:45:00' }],
      currentTime: '2026-10-02T10:50:00+07:00',
    });

    assert.equal(resA.primaryDigit, '2');
    assert.equal(resB.primaryDigit, '7');
    assert.notEqual(resA.primaryDigit, resB.primaryDigit);
  });

  // Core requirement test 4: Lock freezes final candidates
  it('6. Lock freezes final candidates and discards post-lock data', () => {
    const records = [
      createMockRecord('2026-10-01', 'AM', '1,450.11', '40,000.00', '10'),
    ];

    const input = {
      targetDate: '2026-10-02',
      session: 'AM' as const,
      historicalRecords: records,
      liveObservations: [
        { set: 1450.44, time: '11:45:00' }, // Pre-lock
        { set: 1450.77, time: '12:05:00' }, // Post-lock (after 12:00:00 AM lock cutoff)
      ],
      currentTime: '2026-10-02T12:05:00+07:00',
    };

    const res = SetLastDigitSignalV1.predict(input);
    assert.equal(res.isLocked, true);
    assert.equal(res.status, 'FINAL_SIGNAL');
    assert.equal(res.liveObservationCount, 1, 'Post-lock observation at 12:05 must be strictly excluded');
    assert.equal(res.liveSetObserved, 1450.44);
    assert.equal(res.primaryDigit, '4');
    assert.equal(res.antiLeakageAudit.zeroPostLockDataUsed, true);
  });

  // Core requirement test 5: Value cannot influence prediction
  it('7. Value cannot influence prediction (Live SET only input)', () => {
    const records = [
      createMockRecord('2026-10-01', 'AM', '1,450.15', '40,000.00', '50'),
    ];

    const resA = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1455.33, value: 100, time: '11:00:00' }],
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    const resB = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1455.33, value: 99999999, time: '11:00:00' }],
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    assert.deepEqual(resA.candidates, resB.candidates);
    assert.deepEqual(resA.distribution, resB.distribution);
    assert.equal(resA.primaryDigit, resB.primaryDigit);
  });

  // Core requirement test 6: Official settlement cannot influence prediction
  it('8. Official settlement cannot influence prediction', () => {
    const recordsWithoutToday = [
      createMockRecord('2026-10-01', 'AM', '1,450.11', '40,000.00', '10'),
    ];

    const recordsWithTargetSettlement = [
      createMockRecord('2026-10-01', 'AM', '1,450.11', '40,000.00', '10'),
      // Injected official settlement for the target session (12:01:00 official result)
      createMockRecord('2026-10-02', 'AM', '1,450.99', '40,000.00', '90'),
    ];

    const liveObs = [{ set: 1450.22, time: '11:30:00' }];

    const resWithout = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: recordsWithoutToday,
      liveObservations: liveObs,
      currentTime: '2026-10-02T11:30:00+07:00',
    });

    const resWith = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: recordsWithTargetSettlement,
      liveObservations: liveObs,
      currentTime: '2026-10-02T11:30:00+07:00',
    });

    assert.deepEqual(resWithout.candidates, resWith.candidates);
    assert.deepEqual(resWithout.distribution, resWith.distribution);
    assert.equal(resWith.primaryDigit, '2'); // From live SET, not '9' from target settlement
    assert.equal(resWith.antiLeakageAudit.zeroOfficialSettlementUsed, true);
  });

  it('9. Zero live.twod usage invariant', () => {
    const input: any = {
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: [],
      liveObservations: [
        {
          set: 1450.22,
          value: 45000,
          time: '11:00:00',
          twod: '99', // Deliberate injection of synthetic live.twod
        },
      ],
      currentTime: '2026-10-02T11:15:00+07:00',
    };

    const res = SetLastDigitSignalV1.predict(input);
    assert.equal(res.antiLeakageAudit.zeroLiveTwodUsed, true);
    assert.equal(res.primaryDigit, '2');
  });

  it('10. Strict isolation: Zero influence on AUTO_WEIGHTED_V2 engine', () => {
    const historical = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    const v2Before = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');

    SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: historical,
      liveObservations: [{ set: 1455.88, time: '11:00:00' }],
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    const v2After = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');

    assert.deepEqual(v2Before.top10, v2After.top10);
    assert.equal(v2Before.top1, v2After.top1);
    assert.equal(v2Before.entropy, v2After.entropy);
    assert.deepEqual(v2Before.weights, v2After.weights);
    assert.deepEqual(v2Before.probabilities, v2After.probabilities);
  });

  // Core requirement test 7: Existing AM/PM + weekend/holiday eligibility remains intact
  it('11. AM / PM separation is strictly enforced', () => {
    const records = [
      createMockRecord('2026-09-30', 'AM', '1,450.11', '40,000.00', '10'),
      createMockRecord('2026-09-30', 'PM', '1,452.99', '40,000.00', '90'),
      createMockRecord('2026-10-01', 'AM', '1,455.33', '40,000.00', '30'),
    ];

    const amRes = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1450.11, time: '11:00:00' }],
      currentTime: '2026-10-02T11:00:00+07:00',
    });
    assert.equal(amRes.session, 'AM');
    assert.equal(amRes.lockTime, '12:00:00');

    const pmRes = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'PM',
      historicalRecords: records,
      liveObservations: [{ set: 1452.99, time: '15:00:00' }],
      currentTime: '2026-10-02T15:00:00+07:00',
    });
    assert.equal(pmRes.session, 'PM');
    assert.equal(pmRes.lockTime, '16:00:00');

    assert.notEqual(amRes.lockTime, pmRes.lockTime);
  });

  it('12. Saturday = no prediction (Market Closed weekend gate)', () => {
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-03T10:30:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, false);
    assert.equal(eligibility.isMarketClosed, true);
    assert.equal(eligibility.targetDate, null);
    assert.equal(eligibility.eligibleSession, null);

    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-03',
      session: 'AM',
      historicalRecords: [],
      currentTime: '2026-10-03T10:30:00+07:00',
    });
    assert.equal(res.status, 'MARKET_CLOSED');
    assert.equal(res.candidateCount, 0);
    assert.deepEqual(res.candidates, []);
  });

  it('13. Sunday = no prediction (Market Closed weekend gate)', () => {
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-04T14:30:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, false);
    assert.equal(eligibility.isMarketClosed, true);
    assert.equal(eligibility.targetDate, null);
    assert.equal(eligibility.eligibleSession, null);

    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-04',
      session: 'PM',
      historicalRecords: [],
      currentTime: '2026-10-04T14:30:00+07:00',
    });
    assert.equal(res.status, 'MARKET_CLOSED');
    assert.equal(res.candidateCount, 0);
    assert.deepEqual(res.candidates, []);
  });

  it('14. Official SET holiday = no prediction (Market Closed)', () => {
    const holidayDate = '2026-10-13'; // Tuesday
    MarketCalendar.registerOfficialHoliday(holidayDate, 'King Bhumibol Memorial Day');
    try {
      const eligibility = SetLastDigitSignalV1.resolveEligibility({
        currentTime: `${holidayDate}T10:30:00+07:00`,
      });
      assert.equal(eligibility.isTradingDay, false);
      assert.equal(eligibility.isMarketClosed, true);
      assert.equal(eligibility.targetDate, null);

      const res = SetLastDigitSignalV1.predict({
        targetDate: holidayDate,
        session: 'AM',
        historicalRecords: [],
        currentTime: `${holidayDate}T10:30:00+07:00`,
      });
      assert.equal(res.status, 'MARKET_CLOSED');
      assert.equal(res.candidateCount, 0);
      assert.deepEqual(res.candidates, []);
    } finally {
      MarketCalendar.clearHolidaysForTesting();
    }
  });

  it('15. Future PM is hidden during AM', () => {
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T10:30:00+07:00',
    });
    assert.equal(eligibility.eligibleSession, 'AM');

    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'PM',
      historicalRecords: [],
      currentTime: '2026-10-02T10:30:00+07:00',
    });
    assert.equal(res.status, 'FUTURE_SESSION_NOT_ELIGIBLE');
    assert.equal(res.candidateCount, 0);
    assert.deepEqual(res.candidates, []);
  });
});
