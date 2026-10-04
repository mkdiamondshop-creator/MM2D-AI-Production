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

describe('Step 61: SET Last Digit Signal V1 Isolated Engine', () => {
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
    // Example from user brief: 1571.62 -> target digit = 2
    assert.equal(extractSetLastDigit('1571.62'), '2');
    assert.equal(extractSetLastDigit('1,571.62'), '2');
    assert.equal(extractSetLastDigit(1571.62), '2');

    // Ending with zero
    assert.equal(extractSetLastDigit('1450.80'), '0');
    assert.equal(extractSetLastDigit('1,450.80'), '0');
    assert.equal(extractSetLastDigit(1450.8), '0');

    // Single decimal representation (.5 means .50 in standard 2D finance)
    assert.equal(extractSetLastDigit(1395.05), '5');
    assert.equal(extractSetLastDigit('1,395.05'), '5');
    assert.equal(extractSetLastDigit('1600.4'), '4');
    assert.equal(extractSetLastDigit(1400.0), '0');
  });

  it('2. Output rule produces 1, 2, or maximum 3 candidates', () => {
    // Valid trading day: 2026-10-02 (Friday)
    const records: VerifiedMarketRecord[] = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    // Scenario A: Strong localized live observation matching historical trend
    const inputDominant: SetLastDigitInput = {
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [
        { set: 1458.25, value: 48000, time: '11:15:00' },
        { set: 1458.25, value: 48200, time: '11:20:00' },
        { set: 1458.25, value: 48500, time: '11:28:00' },
      ],
      currentTime: '2026-10-02T11:30:00+07:00',
    };

    const resA = SetLastDigitSignalV1.predict(inputDominant);
    assert.ok(resA.candidateCount >= 1 && resA.candidateCount <= 3);
    assert.equal(resA.candidates.length, resA.candidateCount);
    assert.ok([1, 2, 3].includes(resA.candidateCount));

    // Verify ordering by probability descending
    for (let i = 0; i < resA.candidates.length - 1; i++) {
      assert.ok(resA.candidates[i].probability >= resA.candidates[i + 1].probability);
      assert.equal(resA.candidates[i].rank, i + 1);
    }
  });

  it('3. Never outputs more than 3 candidates under high dispersion', () => {
    // Generate records with scattered digits on past trading days
    const scatteredRecords: VerifiedMarketRecord[] = [];
    for (let i = 1; i <= 25; i++) {
      const day = i.toString().padStart(2, '0');
      const d = (i % 10).toString();
      scatteredRecords.push(
        createMockRecord(`2026-09-${day}`, 'AM', `1,450.0${d}`, '40,000.00', `${d}0`)
      );
    }

    const inputDispersed: SetLastDigitInput = {
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: scatteredRecords,
      liveObservations: [], // no live observations forces dispersion
      currentTime: '2026-10-02T10:30:00+07:00',
    };

    const res = SetLastDigitSignalV1.predict(inputDispersed);
    assert.ok(res.candidates.length <= 3, 'Must never exceed 3 candidates');
    assert.ok(res.candidates.length >= 1, 'Must have at least 1 candidate');
  });

  it('4. Zero live.twod usage invariant', () => {
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
    // Target digit for 1450.22 is '2', NOT '9' from live.twod
    assert.equal(res.primaryDigit, '2');
  });

  it('5. Zero future and post-lock data leakage', () => {
    const recordsWithFuture: VerifiedMarketRecord[] = [
      createMockRecord('2026-10-01', 'AM', '1,450.11', '40,000.00', '10'),
      // Future record: today's official settlement (which happens at 12:01:00)
      createMockRecord('2026-10-02', 'AM', '1,450.99', '40,000.00', '90'),
    ];

    const inputPreLock: SetLastDigitInput = {
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: recordsWithFuture,
      liveObservations: [
        { set: 1450.44, value: 45000, time: '11:45:00' },
        // Post-lock live observation (after 12:00:00)
        { set: 1450.77, value: 45000, time: '12:05:00' },
      ],
      currentTime: '2026-10-02T11:50:00+07:00',
    };

    const res = SetLastDigitSignalV1.predict(inputPreLock);

    // The post-lock observation at 12:05 must be discarded (count = 1)
    assert.equal(res.liveObservationCount, 1);
    assert.equal(res.liveSetObserved, 1450.44);

    // Today's target settlement (90 with set last digit 9) must NOT be leaked
    assert.equal(res.antiLeakageAudit.zeroOfficialSettlementUsed, true);
    assert.equal(res.antiLeakageAudit.zeroPostLockDataUsed, true);
  });

  it('6. Strict isolation: Zero influence on AUTO_WEIGHTED_V2 engine', () => {
    const historical = [
      createMockRecord('2026-09-30', 'AM', '1,450.15', '40,000.00', '50'),
      createMockRecord('2026-09-30', 'PM', '1,452.35', '45,000.00', '52'),
      createMockRecord('2026-10-01', 'AM', '1,455.75', '42,000.00', '54'),
    ];

    const v2Before = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');

    // Run SetLastDigitSignalV1 prediction multiple times
    const records = [createMockRecord('2026-10-01', 'AM', '1,450.15', '40,000.00', '50')];
    SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      liveObservations: [{ set: 1455.88, value: 40000, time: '11:00:00' }],
      currentTime: '2026-10-02T11:00:00+07:00',
    });

    const v2After = AutoWeightedV2Engine.predict(historical, '2026-10-02', 'AM');

    // Ensure V2 Top-10, Top-1, weights, and entropy are 100% byte-for-byte identical
    assert.deepEqual(v2Before.top10, v2After.top10);
    assert.equal(v2Before.top1, v2After.top1);
    assert.equal(v2Before.entropy, v2After.entropy);
    assert.deepEqual(v2Before.weights, v2After.weights);
    assert.deepEqual(v2Before.probabilities, v2After.probabilities);
  });

  it('7. AM / PM separation is strictly enforced', () => {
    const records = [
      createMockRecord('2026-09-30', 'AM', '1,450.11', '40,000.00', '10'),
      createMockRecord('2026-09-30', 'PM', '1,452.99', '40,000.00', '90'),
      createMockRecord('2026-10-01', 'AM', '1,455.33', '40,000.00', '30'),
    ];

    const amRes = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: records,
      currentTime: '2026-10-02T11:00:00+07:00',
    });
    assert.equal(amRes.session, 'AM');
    assert.equal(amRes.lockTime, '12:00:00');

    const pmRes = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'PM',
      historicalRecords: records,
      currentTime: '2026-10-02T15:00:00+07:00',
    });
    assert.equal(pmRes.session, 'PM');
    assert.equal(pmRes.lockTime, '16:00:00');

    // PM can legitimately use 2026-10-02 AM settlement as prior, whereas AM cannot
    assert.notEqual(amRes.lockTime, pmRes.lockTime);
  });

  it('8. Saturday = no prediction (Market Closed weekend gate)', () => {
    // 2026-10-03 is Saturday
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-03T10:30:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, false);
    assert.equal(eligibility.isMarketClosed, true);
    assert.equal(eligibility.targetDate, null, 'Must NOT use Saturday as prediction target date');
    assert.equal(eligibility.eligibleSession, null);
    assert.equal(eligibility.sessionLabel, null);
    assert.ok(eligibility.reason.includes('Saturday'));

    // Calling predict on Saturday returns MARKET_CLOSED with zero candidates
    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-03',
      session: 'AM',
      historicalRecords: [],
      currentTime: '2026-10-03T10:30:00+07:00',
    });
    assert.equal(res.status, 'MARKET_CLOSED');
    assert.equal(res.candidateCount, 0);
    assert.equal(res.candidates.length, 0);
  });

  it('9. Sunday = no prediction (Market Closed weekend gate)', () => {
    // 2026-10-04 is Sunday
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-04T14:30:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, false);
    assert.equal(eligibility.isMarketClosed, true);
    assert.equal(eligibility.targetDate, null, 'Must NOT use Sunday as prediction target date');
    assert.equal(eligibility.eligibleSession, null);
    assert.equal(eligibility.sessionLabel, null);
    assert.ok(eligibility.reason.includes('Sunday'));

    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-04',
      session: 'PM',
      historicalRecords: [],
      currentTime: '2026-10-04T14:30:00+07:00',
    });
    assert.equal(res.status, 'MARKET_CLOSED');
    assert.equal(res.candidateCount, 0);
    assert.equal(res.candidates.length, 0);
  });

  it('10. Valid trading-day AM = AM only (AM — 12:01 PM Target)', () => {
    // 2026-10-02 is Friday, 10:45 AM
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T10:45:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, true);
    assert.equal(eligibility.isMarketClosed, false);
    assert.equal(eligibility.targetDate, '2026-10-02');
    assert.equal(eligibility.formattedTargetDate, '2026-10-02 (Friday)');
    assert.equal(eligibility.eligibleSession, 'AM');
    assert.equal(eligibility.sessionLabel, 'AM — 12:01 PM Target');
    assert.equal(eligibility.lockTimeString, '12:00:00');
    assert.equal(eligibility.isLocked, false);

    // Predict produces active AM result
    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'AM',
      historicalRecords: [],
      currentTime: '2026-10-02T10:45:00+07:00',
    });
    assert.ok(res.candidateCount >= 1 && res.candidateCount <= 3);
  });

  it('11. Valid trading-day PM = PM only (PM — 4:30 PM Target)', () => {
    // 2026-10-02 is Friday, 13:45 PM
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T13:45:00+07:00',
    });
    assert.equal(eligibility.isTradingDay, true);
    assert.equal(eligibility.isMarketClosed, false);
    assert.equal(eligibility.targetDate, '2026-10-02');
    assert.equal(eligibility.formattedTargetDate, '2026-10-02 (Friday)');
    assert.equal(eligibility.eligibleSession, 'PM');
    assert.equal(eligibility.sessionLabel, 'PM — 4:30 PM Target');
    assert.equal(eligibility.lockTimeString, '16:00:00');

    // Predict produces active PM result
    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'PM',
      historicalRecords: [],
      currentTime: '2026-10-02T13:45:00+07:00',
    });
    assert.ok(res.candidateCount >= 1 && res.candidateCount <= 3);
  });

  it('12. Friday = Friday target only, no Saturday/Sunday predictions in advance', () => {
    // During Friday AM: targets Friday
    const amElig = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T11:00:00+07:00',
    });
    assert.equal(amElig.targetDate, '2026-10-02');
    assert.equal(amElig.formattedTargetDate, '2026-10-02 (Friday)');
    assert.equal(amElig.eligibleSession, 'AM');

    // During Friday PM: targets Friday
    const pmElig = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T14:00:00+07:00',
    });
    assert.equal(pmElig.targetDate, '2026-10-02');
    assert.equal(pmElig.formattedTargetDate, '2026-10-02 (Friday)');
    assert.equal(pmElig.eligibleSession, 'PM');

    // After Friday PM (e.g. 17:00): next prediction only on next valid SET trading day, NOT Saturday/Sunday
    const postPmElig = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T17:00:00+07:00',
    });
    assert.equal(postPmElig.isTradingDay, false);
    assert.equal(postPmElig.isMarketClosed, true);
    assert.equal(postPmElig.targetDate, null, 'Must NOT target Saturday or Sunday in advance');
    assert.equal(postPmElig.eligibleSession, null);
  });

  it('13. Official SET holiday = no prediction (Market Closed)', () => {
    const holidayDate = '2026-10-13'; // Tuesday
    MarketCalendar.registerOfficialHoliday(holidayDate, 'King Bhumibol Memorial Day');
    try {
      const eligibility = SetLastDigitSignalV1.resolveEligibility({
        currentTime: `${holidayDate}T10:30:00+07:00`,
      });
      assert.equal(eligibility.isTradingDay, false);
      assert.equal(eligibility.isMarketClosed, true);
      assert.equal(eligibility.targetDate, null, 'Must NOT have target date on official holiday');
      assert.equal(eligibility.eligibleSession, null);
      assert.equal(eligibility.holidayName, 'King Bhumibol Memorial Day');

      const res = SetLastDigitSignalV1.predict({
        targetDate: holidayDate,
        session: 'AM',
        historicalRecords: [],
        currentTime: `${holidayDate}T10:30:00+07:00`,
      });
      assert.equal(res.status, 'MARKET_CLOSED');
      assert.equal(res.candidateCount, 0);
      assert.equal(res.candidates.length, 0);
    } finally {
      MarketCalendar.clearHolidaysForTesting();
    }
  });

  it('14. Future PM is hidden during AM', () => {
    // Friday at 10:30 AM (AM phase)
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T10:30:00+07:00',
    });
    assert.equal(eligibility.eligibleSession, 'AM');
    assert.notEqual(eligibility.eligibleSession, 'PM');

    // Calling predict for PM during AM phase returns FUTURE_SESSION_NOT_ELIGIBLE and 0 candidates
    const res = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-02',
      session: 'PM',
      historicalRecords: [],
      currentTime: '2026-10-02T10:30:00+07:00',
    });
    assert.equal(res.status, 'FUTURE_SESSION_NOT_ELIGIBLE');
    assert.equal(res.candidateCount, 0);
    assert.equal(res.candidates.length, 0);
  });

  it('15. Target date is the valid trading date formatted as YYYY-MM-DD (Day)', () => {
    const eligibility = SetLastDigitSignalV1.resolveEligibility({
      currentTime: '2026-10-02T11:15:00+07:00',
    });
    assert.equal(eligibility.targetDate, '2026-10-02');
    assert.equal(eligibility.dayName, 'Friday');
    assert.equal(eligibility.formattedTargetDate, '2026-10-02 (Friday)');
  });
});
