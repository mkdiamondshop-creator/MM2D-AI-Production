import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHotAndUnseen } from './hotUnseenCalculator';
import { VerifiedMarketRecord } from '../../types/market';

describe('Hot & Unseen Numbers Calculator', () => {
  const createRecord = (
    date: string,
    session: 'AM' | 'PM',
    twod: string
  ): VerifiedMarketRecord => ({
    id: `${date}_${session}`,
    date,
    time: session === 'AM' ? '12:01:00' : '16:30:00',
    session,
    isSettlement: true,
    twod,
    setRaw: '1,400.00',
    valueRaw: '50,000.00',
    setNumeric: 1400.0,
    valueNumeric: 50000.0,
    historyId: 'h_' + date + '_' + session,
    verifiedAt: `${date}T12:00:00Z`,
    mathematicalCheck: {
      setLastDigit: '0',
      valueLastDigitBeforeDecimal: '0',
      derived2D: twod,
      isMathematicallyConsistent: true,
    },
  });

  it('correctly ranks hot numbers and identifies unseen numbers in 30 trading days', () => {
    const records: VerifiedMarketRecord[] = [];

    // Create 35 trading days of settlement records
    for (let i = 1; i <= 35; i++) {
      const dayStr = i.toString().padStart(2, '0');
      const date = `2026-08-${dayStr}`;

      // '42' appears frequently in the latest days
      const amTwod = i > 30 ? '42' : '10';
      const pmTwod = i > 30 ? '42' : '20';

      records.push(createRecord(date, 'AM', amTwod));
      records.push(createRecord(date, 'PM', pmTwod));
    }

    // Run for ALL sessions (30 days window)
    const resultAll = calculateHotAndUnseen(records, 'ALL', 30);
    assert.equal(resultAll.windowTradingDays, 30);
    assert.equal(resultAll.totalSessionsInWindow, 60);

    // Number 42 appeared 10 times in days 31-35 (5 days * 2 sessions = 10)
    // While '10' and '20' appeared 25 times each, so '10' is rank 1, '20' is rank 2, '42' is rank 3
    const num42 = resultAll.hotNumbers.find((n) => n.twod === '42');
    assert.ok(num42);
    assert.equal(num42.count, 10);
    assert.equal(num42.rank, 3);

    const num10 = resultAll.hotNumbers.find((n) => n.twod === '10');
    assert.ok(num10);
    assert.equal(num10.count, 25);
    assert.equal(num10.rank, 1);

    // Total hot + unseen must always equal 100 (00 through 99)
    assert.equal(resultAll.hotNumbers.length + resultAll.unseenNumbers.length, 100);
  });

  it('correctly isolates AM vs PM sessions', () => {
    const records: VerifiedMarketRecord[] = [
      createRecord('2026-10-01', 'AM', '77'),
      createRecord('2026-10-01', 'PM', '88'),
      createRecord('2026-10-02', 'AM', '77'),
      createRecord('2026-10-02', 'PM', '99'),
    ];

    const amResult = calculateHotAndUnseen(records, 'AM', 30);
    assert.equal(amResult.totalSessionsInWindow, 2);
    const hot77Am = amResult.hotNumbers.find((h) => h.twod === '77');
    assert.ok(hot77Am);
    assert.equal(hot77Am.count, 2);
    // 88 and 99 should NOT be in AM hot numbers
    assert.equal(amResult.hotNumbers.some((h) => h.twod === '88'), false);

    const pmResult = calculateHotAndUnseen(records, 'PM', 30);
    assert.equal(pmResult.totalSessionsInWindow, 2);
    const hot88Pm = pmResult.hotNumbers.find((h) => h.twod === '88');
    assert.ok(hot88Pm);
    assert.equal(hot88Pm.count, 1);
    // 77 should NOT be in PM hot numbers
    assert.equal(pmResult.hotNumbers.some((h) => h.twod === '77'), false);
  });
});
