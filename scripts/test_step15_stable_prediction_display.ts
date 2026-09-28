import assert from 'node:assert';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { MarketOpenGate } from '../src/core/market/marketOpenGate';
import { VerifiedMarketRecord } from '../src/types/market';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

/**
 * MM2D LEADER STEP 15 AUDIT SUITE
 * STABLE PREDICTION DISPLAY & PUBLISH TIMING VERIFICATION
 *
 * Rules:
 * AM:
 * - Before 09:30 Myanmar (10:00 Bangkok): show "--" / MARKET_NOT_OPEN.
 * - 09:30–11:25 Myanmar (10:00–11:55 Bangkok): require valid current-day Live SET + Value,
 *   but keep prediction number hidden ("--"). Status: ANALYZING_LIVE_DATA.
 * - At 11:25 Myanmar (11:55 Bangkok), calculate and publish the prediction once.
 * - From 11:25 until 11:30 Myanmar (11:55 until 12:00 Bangkok), displayed prediction must NOT change.
 * - At 11:30 Myanmar (12:00 Bangkok), lock/freeze it normally.
 *
 * PM:
 * - Before 13:30 Myanmar (14:00 Bangkok): show "--" / MARKET_NOT_OPEN.
 * - 13:30–15:25 Myanmar (14:00–15:55 Bangkok): require valid current-day Live SET + Value,
 *   but keep prediction number hidden ("--"). Status: ANALYZING_LIVE_DATA.
 * - At 15:25 Myanmar (15:55 Bangkok), calculate and publish once.
 * - From 15:25 until 15:30 Myanmar (15:55 until 16:00 Bangkok), displayed prediction must NOT change.
 * - At 15:30 Myanmar (16:00 Bangkok), lock/freeze it normally.
 */

function generateMockHistoricalRecords(count: number, lastDate: string): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const start = new Date(lastDate);

  let current = new Date(start);
  while (records.length < count) {
    current.setDate(current.getDate() - 1);
    const day = current.getDay();
    if (day === 0 || day === 6) continue;

    const dateStr = current.toISOString().split('T')[0];
    records.push({
      historyId: String(records.length + 1),
      id: `${dateStr}_AM`,
      date: dateStr,
      time: '12:01:00',
      session: 'AM',
      setNumeric: 1450.50 + (records.length % 10),
      valueNumeric: 35000.00 + (records.length * 100),
      setRaw: '1,450.50',
      valueRaw: '35,000.00',
      twod: String((records.length * 7) % 100).padStart(2, '0'),
      isSettlement: true,
      provenance: 'HISTORICAL_SETTLEMENT',
      verifiedAt: `${dateStr}T12:01:00+07:00`,
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: String((records.length * 7) % 100).padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      historyId: String(records.length + 1),
      id: `${dateStr}_PM`,
      date: dateStr,
      time: '16:30:00',
      session: 'PM',
      setNumeric: 1455.20 + (records.length % 10),
      valueNumeric: 42000.00 + (records.length * 100),
      setRaw: '1,455.20',
      valueRaw: '42,000.00',
      twod: String((records.length * 13) % 100).padStart(2, '0'),
      isSettlement: true,
      provenance: 'HISTORICAL_SETTLEMENT',
      verifiedAt: `${dateStr}T16:30:00+07:00`,
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: String((records.length * 13) % 100).padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });
  }

  return records;
}

async function runStep15Audit() {
  console.log('================================================================');
  console.log(' MM2D STEP 15: STABLE PREDICTION DISPLAY AUDIT                  ');
  console.log('================================================================');

  const targetDate = '2025-02-14'; // Friday (trading day)
  const history = generateMockHistoricalRecords(80, targetDate);

  LockEngine.clearFrozenSnapshotsForTesting();

  // =========================================================================
  // PART 1: AM SESSION TIMELINE
  // =========================================================================

  // [AM-1] Before 09:30 Myanmar (< 10:00 Bangkok)
  console.log('\n--- [AM-1] Before 09:30 Myanmar (< 10:00 Bangkok) ---');
  const amPreOpenTime = new Date(`${targetDate}T09:15:00+07:00`);
  const amPreOpenRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    undefined,
    amPreOpenTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amPreOpenRes.output.top1, '--');
  assert.strictEqual(amPreOpenRes.output.status, 'MARKET_NOT_OPEN');
  console.log('✅ PASS [AM-1]: AM before 09:30 MMT returns top1: "--" and MARKET_NOT_OPEN.');

  // [AM-2] 09:30–11:25 Myanmar (10:00–11:55 Bangkok) without live data
  console.log('\n--- [AM-2] 09:30–11:25 MMT without live data ---');
  const amOpenNoLiveTime = new Date(`${targetDate}T10:30:00+07:00`);
  const amOpenNoLiveRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    [],
    amOpenNoLiveTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amOpenNoLiveRes.output.top1, '--');
  assert.strictEqual(amOpenNoLiveRes.output.status, 'WAITING_FOR_LIVE_DATA');
  console.log('✅ PASS [AM-2]: AM during trading hours without live data shows WAITING_FOR_LIVE_DATA.');

  // [AM-3] 09:30–11:25 Myanmar (10:00–11:55 Bangkok) WITH valid live data -> ANALYZING_LIVE_DATA
  console.log('\n--- [AM-3] 09:30–11:25 MMT WITH valid live data: "Analyzing Live Market Data" ---');
  const liveTicksAM = [
    { time: '10:05:00', set: 1458.20, value: 12000.00, timestamp: `${targetDate}T10:05:00+07:00` },
    { time: '10:30:00', set: 1460.10, value: 25000.00, timestamp: `${targetDate}T10:30:00+07:00` },
    { time: '11:15:00', set: 1461.50, value: 38000.00, timestamp: `${targetDate}T11:15:00+07:00` },
  ];

  // Test at 10:35 Bangkok (10:05 MMT)
  const amAnalyzing1 = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    liveTicksAM,
    new Date(`${targetDate}T10:35:00+07:00`),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amAnalyzing1.output.top1, '--', 'Prediction number must remain hidden');
  assert.strictEqual(amAnalyzing1.output.status, 'ANALYZING_LIVE_DATA');
  assert.strictEqual(amAnalyzing1.output.candidates.length, 0);

  // Test at 11:20 Bangkok (10:50 MMT)
  const amAnalyzing2 = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    liveTicksAM,
    new Date(`${targetDate}T11:20:00+07:00`),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amAnalyzing2.output.top1, '--');
  assert.strictEqual(amAnalyzing2.output.status, 'ANALYZING_LIVE_DATA');

  // Test at 11:54:59 Bangkok (11:24:59 MMT - 1 second before publish)
  const amAnalyzing3 = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    liveTicksAM,
    new Date(`${targetDate}T11:54:59+07:00`),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amAnalyzing3.output.top1, '--');
  assert.strictEqual(amAnalyzing3.output.status, 'ANALYZING_LIVE_DATA');
  console.log('✅ PASS [AM-3]: AM 09:30–11:25 MMT with live ticks keeps number hidden ("--") with status ANALYZING_LIVE_DATA.');

  // [AM-4] At 11:25 Myanmar (11:55 Bangkok): calculate & publish once
  console.log('\n--- [AM-4] 11:25 Myanmar (11:55 Bangkok): Publish prediction ---');
  const amPublishTime = new Date(`${targetDate}T11:55:00+07:00`);
  const amPublished = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    liveTicksAM,
    amPublishTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.notStrictEqual(amPublished.output.top1, '--');
  assert.strictEqual(amPublished.output.status, 'PREDICTION_READY');
  assert.strictEqual(amPublished.output.candidates.length, 100);
  const initialPublishedTop1AM = amPublished.output.top1;
  const initialPublishedCandidatesAM = JSON.stringify(amPublished.output.candidates.slice(0, 5));
  console.log(`✅ PASS [AM-4]: AM prediction published at 11:25 MMT (top1: ${initialPublishedTop1AM}).`);

  // [AM-5] From 11:25 until 11:30 Myanmar (11:55 until 12:00 Bangkok): Display must NOT change
  console.log('\n--- [AM-5] 11:25–11:30 MMT: Stability guarantee across new live ticks ---');
  const newTicksAM = [
    ...liveTicksAM,
    { time: '11:56:00', set: 1475.99, value: 99999.00, timestamp: `${targetDate}T11:56:00+07:00` },
    { time: '11:58:30', set: 1440.11, value: 11111.00, timestamp: `${targetDate}T11:58:30+07:00` },
  ];

  for (const timeStr of ['11:56:00', '11:57:30', '11:59:00', '11:59:59']) {
    const checkRes = LockEngine.getOrFreezePrediction(
      history,
      targetDate,
      'AM',
      newTicksAM,
      new Date(`${targetDate}T${timeStr}+07:00`),
      PRODUCTION_MODEL_VERSION
    );
    assert.strictEqual(checkRes.output.top1, initialPublishedTop1AM, `Top 1 must remain identical at ${timeStr}`);
    assert.strictEqual(
      JSON.stringify(checkRes.output.candidates.slice(0, 5)),
      initialPublishedCandidatesAM,
      `Top candidates must remain identical at ${timeStr}`
    );
    assert.strictEqual(checkRes.isLocked, false);
  }
  console.log('✅ PASS [AM-5]: AM prediction remains 100% stable between 11:25 and 11:30 MMT regardless of new ticks.');

  // [AM-6] At 11:30 Myanmar (12:00 Bangkok): Lock/Freeze normally
  console.log('\n--- [AM-6] 11:30 Myanmar (12:00 Bangkok): Normal Lock ---');
  const amLockTime = new Date(`${targetDate}T12:00:00+07:00`);
  const amLockRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    newTicksAM,
    amLockTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amLockRes.isLocked, true);
  assert.strictEqual(amLockRes.output.status, 'PREDICTION_LOCKED');
  assert.strictEqual(amLockRes.output.top1, initialPublishedTop1AM, 'Frozen prediction must match published prediction');
  console.log('✅ PASS [AM-6]: AM locks at 11:30 MMT (12:00 BKK) preserving published prediction.');

  // =========================================================================
  // PART 2: PM SESSION TIMELINE
  // =========================================================================

  // [PM-1] Before 13:30 Myanmar (< 14:00 Bangkok)
  console.log('\n--- [PM-1] Before 13:30 Myanmar (< 14:00 Bangkok) ---');
  const pmPreOpenTime = new Date(`${targetDate}T13:15:00+07:00`);
  const pmPreOpenRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    undefined,
    pmPreOpenTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmPreOpenRes.output.top1, '--');
  assert.strictEqual(pmPreOpenRes.output.status, 'MARKET_NOT_OPEN');
  console.log('✅ PASS [PM-1]: PM before 13:30 MMT returns top1: "--" and MARKET_NOT_OPEN.');

  // [PM-2] 13:30–15:25 Myanmar (14:00–15:55 Bangkok) without live data
  console.log('\n--- [PM-2] 13:30–15:25 MMT without live data ---');
  const pmOpenNoLiveTime = new Date(`${targetDate}T14:30:00+07:00`);
  const pmOpenNoLiveRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    [],
    pmOpenNoLiveTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmOpenNoLiveRes.output.top1, '--');
  assert.strictEqual(pmOpenNoLiveRes.output.status, 'WAITING_FOR_LIVE_DATA');
  console.log('✅ PASS [PM-2]: PM during trading hours without live data shows WAITING_FOR_LIVE_DATA.');

  // [PM-3] 13:30–15:25 Myanmar (14:00–15:55 Bangkok) WITH valid live data -> ANALYZING_LIVE_DATA
  console.log('\n--- [PM-3] 13:30–15:25 MMT WITH valid live data: "Analyzing Live Market Data" ---');
  const liveTicksPM = [
    { time: '14:05:00', set: 1465.10, value: 45000.00, timestamp: `${targetDate}T14:05:00+07:00` },
    { time: '14:30:00', set: 1466.80, value: 55000.00, timestamp: `${targetDate}T14:30:00+07:00` },
    { time: '15:15:00', set: 1468.25, value: 68000.00, timestamp: `${targetDate}T15:15:00+07:00` },
  ];

  // Test at 14:35 Bangkok (14:05 MMT)
  const pmAnalyzing1 = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    liveTicksPM,
    new Date(`${targetDate}T14:35:00+07:00`),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmAnalyzing1.output.top1, '--');
  assert.strictEqual(pmAnalyzing1.output.status, 'ANALYZING_LIVE_DATA');

  // Test at 15:54:59 Bangkok (15:24:59 MMT - 1 second before publish)
  const pmAnalyzing2 = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    liveTicksPM,
    new Date(`${targetDate}T15:54:59+07:00`),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmAnalyzing2.output.top1, '--');
  assert.strictEqual(pmAnalyzing2.output.status, 'ANALYZING_LIVE_DATA');
  console.log('✅ PASS [PM-3]: PM 13:30–15:25 MMT with live ticks keeps number hidden ("--") with status ANALYZING_LIVE_DATA.');

  // [PM-4] At 15:25 Myanmar (15:55 Bangkok): calculate & publish once
  console.log('\n--- [PM-4] 15:25 Myanmar (15:55 Bangkok): Publish prediction ---');
  const pmPublishTime = new Date(`${targetDate}T15:55:00+07:00`);
  const pmPublished = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    liveTicksPM,
    pmPublishTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.notStrictEqual(pmPublished.output.top1, '--');
  assert.strictEqual(pmPublished.output.status, 'PREDICTION_READY');
  assert.strictEqual(pmPublished.output.candidates.length, 100);
  const initialPublishedTop1PM = pmPublished.output.top1;
  const initialPublishedCandidatesPM = JSON.stringify(pmPublished.output.candidates.slice(0, 5));
  console.log(`✅ PASS [PM-4]: PM prediction published at 15:25 MMT (top1: ${initialPublishedTop1PM}).`);

  // [PM-5] From 15:25 until 15:30 Myanmar (15:55 until 16:00 Bangkok): Display must NOT change
  console.log('\n--- [PM-5] 15:25–15:30 MMT: Stability guarantee across new live ticks ---');
  const newTicksPM = [
    ...liveTicksPM,
    { time: '15:56:00', set: 1480.00, value: 88888.00, timestamp: `${targetDate}T15:56:00+07:00` },
    { time: '15:58:00', set: 1430.50, value: 22222.00, timestamp: `${targetDate}T15:58:00+07:00` },
  ];

  for (const timeStr of ['15:56:00', '15:57:30', '15:59:00', '15:59:59']) {
    const checkRes = LockEngine.getOrFreezePrediction(
      history,
      targetDate,
      'PM',
      newTicksPM,
      new Date(`${targetDate}T${timeStr}+07:00`),
      PRODUCTION_MODEL_VERSION
    );
    assert.strictEqual(checkRes.output.top1, initialPublishedTop1PM, `PM Top 1 must remain identical at ${timeStr}`);
    assert.strictEqual(
      JSON.stringify(checkRes.output.candidates.slice(0, 5)),
      initialPublishedCandidatesPM,
      `PM Top candidates must remain identical at ${timeStr}`
    );
    assert.strictEqual(checkRes.isLocked, false);
  }
  console.log('✅ PASS [PM-5]: PM prediction remains 100% stable between 15:25 and 15:30 MMT regardless of new ticks.');

  // [PM-6] At 15:30 Myanmar (16:00 Bangkok): Lock/Freeze normally
  console.log('\n--- [PM-6] 15:30 Myanmar (16:00 Bangkok): Normal Lock ---');
  const pmLockTime = new Date(`${targetDate}T16:00:00+07:00`);
  const pmLockRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    newTicksPM,
    pmLockTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmLockRes.isLocked, true);
  assert.strictEqual(pmLockRes.output.status, 'PREDICTION_LOCKED');
  assert.strictEqual(pmLockRes.output.top1, initialPublishedTop1PM, 'Frozen PM prediction must match published prediction');
  console.log('✅ PASS [PM-6]: PM locks at 15:30 MMT (16:00 BKK) preserving published prediction.');

  console.log('\n================================================================');
  console.log(' ALL STEP 15 STABLE PREDICTION DISPLAY AUDIT TESTS PASSED!     ');
  console.log('================================================================\n');
}

runStep15Audit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
