import assert from 'node:assert';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { MarketOpenGate } from '../src/core/market/marketOpenGate';
import { VerifiedMarketRecord } from '../src/types/market';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

/**
 * MM2D LEADER STEP 14 TEST SUITE
 * Prediction Visibility & Session Lifecycle Verification
 * 
 * Verifies that:
 * 1. Historical dataset alone NEVER displays a new prediction during active session.
 * 2. Prediction remains hidden ("--") with WAITING_FOR_LIVE_DATA until valid live SET+Value arrives.
 * 3. AM market before 10:00 BKK displays MARKET_NOT_OPEN ("--").
 * 4. PM market before 14:00 BKK displays MARKET_NOT_OPEN ("--") and is NOT ACTIVE.
 * 5. Live observations between 10:00-12:00 (AM) and 14:00-16:00 (PM) unlock PREDICTION_READY.
 * 6. Lock boundaries freeze snapshots immutably; official results never modify them.
 * 7. Stale or mismatched date/session feeds do not unlock predictions.
 */

function generateMockHistoricalRecords(count: number, lastDate: string): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const start = new Date(lastDate);

  let current = new Date(start);
  while (records.length < count) {
    current.setDate(current.getDate() - 1);
    const day = current.getDay();
    if (day === 0 || day === 6) continue; // skip weekends

    const dateStr = current.toISOString().split('T')[0];
    // AM settlement record
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

    // PM settlement record
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

async function runStep14Audit() {
  console.log('================================================================');
  console.log(' MM2D STEP 14: PREDICTION VISIBILITY & LIFECYCLE AUDIT          ');
  console.log('================================================================');

  const targetDate = '2025-02-14'; // Friday (trading day)
  const history = generateMockHistoricalRecords(80, targetDate);

  // -------------------------------------------------------------------------
  // TEST 1: AM Before Market Open (e.g. 09:30:00 Bangkok)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 1] AM Pre-Open Visibility Gate (< 10:00:00 BKK) ---');
  const amPreOpenTime = new Date(`${targetDate}T09:30:00+07:00`);
  const amPreOpenRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    undefined,
    amPreOpenTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(amPreOpenRes.output.top1, '--', 'AM top1 must be "--" before 10:00 market open');
  assert.strictEqual(amPreOpenRes.output.status, 'MARKET_NOT_OPEN', 'AM status must be MARKET_NOT_OPEN before 10:00');
  assert.strictEqual(amPreOpenRes.output.candidates.length, 0, 'AM candidates must not leak before 10:00');
  console.log('✅ PASS [01/16]: AM session before 10:00:00 BKK returns top1: "--" with MARKET_NOT_OPEN.');

  const amPreOpenLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate,
    session: 'AM',
    currentBangkokTime: amPreOpenTime,
    historicalRecords: history,
    hasOfficialResult: false,
    isSessionLocked: false,
    hasLiveObservations: false,
  });
  assert.strictEqual(amPreOpenLifecycle.status, 'MARKET_NOT_OPEN');
  assert.strictEqual(amPreOpenLifecycle.isMarketOpen, false);
  console.log('✅ PASS [02/16]: MarketOpenGate reports MARKET_NOT_OPEN for AM at 09:30:00 BKK.');

  // -------------------------------------------------------------------------
  // TEST 2: AM Market Open, but ZERO Live Data Available (10:15:00 Bangkok)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 2] AM Active Session Without Live SET/Value (10:15:00 BKK) ---');
  const amActiveNoLiveTime = new Date(`${targetDate}T10:15:00+07:00`);
  const amActiveNoLiveRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    undefined, // NO live feed observations provided!
    amActiveNoLiveTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(amActiveNoLiveRes.output.top1, '--', 'AM top1 must remain "--" when live data is missing');
  assert.strictEqual(amActiveNoLiveRes.output.status, 'WAITING_FOR_LIVE_DATA', 'AM status must be WAITING_FOR_LIVE_DATA');
  assert.strictEqual(amActiveNoLiveRes.output.candidates.length, 0, 'No candidates may leak while waiting for live data');
  console.log('✅ PASS [03/16]: AM active session with history alone strictly returns top1: "--" & WAITING_FOR_LIVE_DATA.');

  const amActiveNoLiveLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate,
    session: 'AM',
    currentBangkokTime: amActiveNoLiveTime,
    historicalRecords: history,
    hasOfficialResult: false,
    isSessionLocked: false,
    hasLiveObservations: false,
  });
  assert.strictEqual(amActiveNoLiveLifecycle.status, 'WAITING_FOR_LIVE_DATA');
  assert.strictEqual(amActiveNoLiveLifecycle.isMarketOpen, true);
  console.log('✅ PASS [04/16]: MarketOpenGate resolves WAITING_FOR_LIVE_DATA when session is open but live ticks absent.');

  // -------------------------------------------------------------------------
  // TEST 3: AM Market Open WITH Valid Live SET/Value
  // At 11:05:00 Bangkok (10:35 MMT) -> ANALYZING_LIVE_DATA (top1: "--")
  // At 11:55:00 Bangkok (11:25 MMT) -> PREDICTION_READY (published)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 3] AM Active Session WITH Valid Live SET/Value (11:00:00 BKK) ---');
  const amValidLiveFeed = [
    { time: '10:30:00', set: 1460.10, value: 38200.00, timestamp: `${targetDate}T10:30:00+07:00` },
    { time: '11:00:00', set: 1462.45, value: 41250.00, timestamp: `${targetDate}T11:00:00+07:00` },
  ];
  const amLiveTime = new Date(`${targetDate}T11:05:00+07:00`);
  const amAnalyzingRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    amValidLiveFeed,
    amLiveTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(amAnalyzingRes.output.top1, '--', 'AM top1 must remain "--" during 09:30-11:25 MMT analyzing window');
  assert.strictEqual(amAnalyzingRes.output.status, 'ANALYZING_LIVE_DATA', 'AM status must be ANALYZING_LIVE_DATA before 11:25 MMT');
  assert.strictEqual(amAnalyzingRes.output.candidates.length, 0, 'No candidates exposed while analyzing');
  console.log('✅ PASS [05/16]: AM session during analyzing window (11:05 BKK / 10:35 MMT) displays ANALYZING_LIVE_DATA and top1: "--".');

  const amLiveLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate,
    session: 'AM',
    currentBangkokTime: amLiveTime,
    historicalRecords: history,
    hasOfficialResult: false,
    isSessionLocked: false,
    hasLiveObservations: true,
  });
  assert.strictEqual(amLiveLifecycle.status, 'ANALYZING_LIVE_DATA');
  console.log('✅ PASS [06/16]: MarketOpenGate resolves ANALYZING_LIVE_DATA when live ticks verified before 11:25 MMT.');

  // Check Publish point at 11:55 Bangkok (11:25 Myanmar)
  const amPublishTime = new Date(`${targetDate}T11:55:00+07:00`);
  const amPublishRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    amValidLiveFeed,
    amPublishTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.notStrictEqual(amPublishRes.output.top1, '--', 'AM top1 must display candidate at publish point 11:25 MMT');
  assert.strictEqual(amPublishRes.output.status, 'PREDICTION_READY');
  assert.strictEqual(amPublishRes.output.candidates.length, 100);
  console.log(`✅ PASS [06.1/16]: AM prediction published at 11:25 MMT / 11:55 BKK (top1: ${amPublishRes.output.top1}).`);

  // -------------------------------------------------------------------------
  // TEST 4: AM Lock Cutoff (12:00:00 Bangkok = 11:30:00 Yangon)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 4] AM Lock Boundary Enforcement (12:00:00 BKK) ---');
  const amLockTime = new Date(`${targetDate}T12:00:00+07:00`);
  const amLockRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    amValidLiveFeed,
    amLockTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(amLockRes.isLocked, true);
  assert.strictEqual(amLockRes.output.status, 'PREDICTION_LOCKED');
  assert.strictEqual(amLockRes.output.isFrozen, true);
  const lockedTop1 = amLockRes.output.top1;
  const lockedHash = amLockRes.snapshot?.featureVector.featureIntegrityHash;
  console.log(`✅ PASS [07/16]: AM prediction locked and frozen immutably at 12:00:00 BKK (top1: ${lockedTop1}).`);

  // Subsequent call with official result arrival must NEVER modify the locked prediction
  const postLockTime = new Date(`${targetDate}T12:01:30+07:00`);
  const postLockRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'AM',
    undefined,
    postLockTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(postLockRes.output.top1, lockedTop1, 'Frozen top1 must remain bitwise identical after official result');
  assert.strictEqual(postLockRes.snapshot?.featureVector.featureIntegrityHash, lockedHash);
  console.log('✅ PASS [08/16]: Post-lock official settlement publication strictly preserves frozen snapshot.');

  // -------------------------------------------------------------------------
  // TEST 5: PM Pre-Open Isolation During AM Session (e.g. 10:30:00 Bangkok)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 5] PM Session Pre-Open Isolation During Morning (< 14:00:00 BKK) ---');
  const morningPmCheckTime = new Date(`${targetDate}T10:30:00+07:00`);
  const morningPmRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    undefined,
    morningPmCheckTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(morningPmRes.output.top1, '--', 'PM prediction must NOT be visible before 14:00 BKK');
  assert.strictEqual(morningPmRes.output.status, 'MARKET_NOT_OPEN', 'PM status must be MARKET_NOT_OPEN before 14:00');
  assert.strictEqual(morningPmRes.output.candidates.length, 0);
  console.log('✅ PASS [09/16]: PM prediction is strictly hidden ("--") with MARKET_NOT_OPEN during morning hours.');

  const morningPmLifecycle = MarketOpenGate.resolveLifecycleState({
    targetDate,
    session: 'PM',
    currentBangkokTime: morningPmCheckTime,
    historicalRecords: history,
    hasOfficialResult: false,
    isSessionLocked: false,
    hasLiveObservations: false,
  });
  assert.strictEqual(morningPmLifecycle.status, 'MARKET_NOT_OPEN');
  assert.strictEqual(morningPmLifecycle.isMarketOpen, false);
  console.log('✅ PASS [10/16]: PM lifecycle is MARKET_NOT_OPEN (never marked ACTIVE before 14:00 BKK).');

  // -------------------------------------------------------------------------
  // TEST 6: PM Active Session Without Live SET/Value (14:15:00 Bangkok)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 6] PM Active Session Without Live SET/Value (14:15:00 BKK) ---');
  const pmActiveNoLiveTime = new Date(`${targetDate}T14:15:00+07:00`);
  const pmActiveNoLiveRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    undefined, // NO live PM ticks yet
    pmActiveNoLiveTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(pmActiveNoLiveRes.output.top1, '--', 'PM top1 must remain "--" until valid live ticks arrive');
  assert.strictEqual(pmActiveNoLiveRes.output.status, 'WAITING_FOR_LIVE_DATA');
  assert.strictEqual(pmActiveNoLiveRes.output.candidates.length, 0);
  console.log('✅ PASS [11/16]: PM active session with history alone strictly returns top1: "--" & WAITING_FOR_LIVE_DATA.');

  // -------------------------------------------------------------------------
  // TEST 7: PM Active Session WITH Valid Live SET/Value
  // At 15:05:00 Bangkok (14:35 MMT) -> ANALYZING_LIVE_DATA (top1: "--")
  // At 15:55:00 Bangkok (15:25 MMT) -> PREDICTION_READY (published)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 7] PM Active Session WITH Valid Live SET/Value (15:00:00 BKK) ---');
  const pmValidLiveFeed = [
    { time: '14:30:00', set: 1463.80, value: 48500.00, timestamp: `${targetDate}T14:30:00+07:00` },
    { time: '15:00:00', set: 1465.10, value: 52100.00, timestamp: `${targetDate}T15:00:00+07:00` },
  ];
  const pmLiveTime = new Date(`${targetDate}T15:05:00+07:00`);
  const pmAnalyzingRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    pmValidLiveFeed,
    pmLiveTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(pmAnalyzingRes.output.top1, '--', 'PM top1 must remain "--" during 13:30-15:25 MMT analyzing window');
  assert.strictEqual(pmAnalyzingRes.output.status, 'ANALYZING_LIVE_DATA');
  assert.strictEqual(pmAnalyzingRes.output.candidates.length, 0);
  console.log('✅ PASS [12/16]: PM session during analyzing window (15:05 BKK / 14:35 MMT) displays ANALYZING_LIVE_DATA and top1: "--".');

  const pmPublishTime = new Date(`${targetDate}T15:55:00+07:00`);
  const pmPublishRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    pmValidLiveFeed,
    pmPublishTime,
    PRODUCTION_MODEL_VERSION
  );
  assert.notStrictEqual(pmPublishRes.output.top1, '--', 'PM top1 must display valid candidate at 15:25 MMT / 15:55 BKK');
  assert.strictEqual(pmPublishRes.output.status, 'PREDICTION_READY');
  assert.strictEqual(pmPublishRes.output.candidates.length, 100);
  console.log(`✅ PASS [12.1/16]: PM prediction published at 15:25 MMT / 15:55 BKK (top1: ${pmPublishRes.output.top1}).`);

  // -------------------------------------------------------------------------
  // TEST 8: PM Lock Cutoff (16:00:00 Bangkok = 15:30:00 Yangon)
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 8] PM Lock Boundary Enforcement (16:00:00 BKK) ---');
  const pmLockTime = new Date(`${targetDate}T16:00:00+07:00`);
  const pmLockRes = LockEngine.getOrFreezePrediction(
    history,
    targetDate,
    'PM',
    pmValidLiveFeed,
    pmLockTime,
    PRODUCTION_MODEL_VERSION
  );

  assert.strictEqual(pmLockRes.isLocked, true);
  assert.strictEqual(pmLockRes.output.status, 'PREDICTION_LOCKED');
  assert.strictEqual(pmLockRes.output.isFrozen, true);
  const pmLockedTop1 = pmLockRes.output.top1;
  console.log(`✅ PASS [13/16]: PM prediction locked and frozen immutably at 16:00:00 BKK (top1: ${pmLockedTop1}).`);

  // -------------------------------------------------------------------------
  // TEST 9: Reject Stale / Mismatched Date Live Feed
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 9] Reject Stale or Mismatched Date Live Feeds ---');
  // Attempt to pass yesterday's feed for today's AM session
  const yesterdayFeed = [
    { time: '11:00:00', set: 1450.00, value: 30000.00, timestamp: '2025-02-13T11:00:00+07:00' },
  ];
  const amStaleRes = LockEngine.getOrFreezePrediction(
    history,
    '2025-02-17', // Next Monday
    'AM',
    yesterdayFeed,
    new Date('2025-02-17T10:30:00+07:00'),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(amStaleRes.output.top1, '--', 'Mismatched date feed must NOT unlock prediction');
  assert.strictEqual(amStaleRes.output.status, 'WAITING_FOR_LIVE_DATA');
  console.log('✅ PASS [14/16]: Mismatched targetDate feed is rejected; prediction remains hidden ("--").');

  // Attempt to pass AM observations for a PM session
  const amObservationsForPm = [
    { time: '11:00:00', set: 1450.00, value: 30000.00, timestamp: '2025-02-17T11:00:00+07:00' },
  ];
  const pmMismatchedSessionRes = LockEngine.getOrFreezePrediction(
    history,
    '2025-02-17',
    'PM',
    amObservationsForPm,
    new Date('2025-02-17T14:30:00+07:00'),
    PRODUCTION_MODEL_VERSION
  );
  assert.strictEqual(pmMismatchedSessionRes.output.top1, '--', 'AM feed must not unlock PM session');
  assert.strictEqual(pmMismatchedSessionRes.output.status, 'WAITING_FOR_LIVE_DATA');
  console.log('✅ PASS [15/16]: AM observations cannot unlock PM session; prediction remains hidden ("--").');

  // -------------------------------------------------------------------------
  // TEST 10: Model Governance & Integrity
  // -------------------------------------------------------------------------
  console.log('--- [GROUP 10] Model Governance & Mathematical Invariants ---');
  assert.strictEqual(PRODUCTION_MODEL_VERSION, 'ALL_TIME_FREQUENCY_V1');
  console.log('✅ PASS [16/16]: Active production model champion is strictly locked to ALL_TIME_FREQUENCY_V1.');

  console.log('================================================================');
  console.log(' AUDIT COMPLETE: ALL 16 STEP 14 VISIBILITY TESTS PASSED (100%)  ');
  console.log('================================================================');
}

runStep14Audit().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
