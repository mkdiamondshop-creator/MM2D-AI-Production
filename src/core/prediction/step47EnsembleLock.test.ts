import { VerifiedMarketRecord, MarketSession } from '../../types/market';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { AutoWeightedV2ShadowTracker } from './autoWeightedV2ShadowTracker';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { LockEngine } from './lockEngine';

function createMockHistoricalRecords(count: number, startDateStr = '2025-01-01'): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const baseDate = new Date(startDateStr);

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + Math.floor(i / 2) * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const isAm = i % 2 === 0;
    const session: MarketSession = isAm ? 'AM' : 'PM';
    const time = isAm ? '12:01:00' : '16:30:00';
    const twodVal = ((i * 13 + 7) % 100).toString().padStart(2, '0');
    const setNum = 1420.0 + (i % 30);
    const valNum = 38000.0 + (i % 50);

    records.push({
      id: `rec_${dateStr}_${session}`,
      date: dateStr,
      session,
      time,
      isSettlement: true,
      setRaw: setNum.toFixed(2),
      valueRaw: valNum.toFixed(2),
      setNumeric: setNum,
      valueNumeric: valNum,
      twod: twodVal,
      historyId: `hist_${i}`,
      verifiedAt: `${dateStr}T${time}+07:00`,
      mathematicalCheck: {
        setLastDigit: setNum.toFixed(2).slice(-1),
        valueLastDigitBeforeDecimal: valNum.toFixed(0).slice(-1),
        derived2D: twodVal,
        isMathematicallyConsistent: true,
      },
    });
  }
  return records;
}

export async function runStep47Tests(): Promise<boolean> {
  console.log('=== MM2D STEP 47: IMMUTABLE ENSEMBLE LOCK TEST SUITE ===\n');
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}: ${detail || 'Assertion failed'}`);
      throw new Error(`Test failed: ${testName} - ${detail}`);
    }
  }

  const dataset = createMockHistoricalRecords(60, '2025-01-01');
  const targetDate = '2025-02-15';

  // --- TEST 1: Exact Final Cutoff Timing (AM 11:30 MMT / 12:00 BKK, PM 15:30 MMT / 16:00 BKK) ---
  console.log('--- TEST 1: Lock Cutoff Invariant ---');
  // 11:59:59 BKK (UTC 04:59:59) -> AM Unlocked
  const amBefore = new Date('2025-02-15T04:59:59Z');
  assert(!LockEngine.isSessionLocked(targetDate, 'AM', amBefore), 'AM is unlocked at 11:59:59 BKK (11:29:59 MMT)');

  // 12:00:00 BKK (UTC 05:00:00) -> AM Locked
  const amLock = new Date('2025-02-15T05:00:00Z');
  assert(LockEngine.isSessionLocked(targetDate, 'AM', amLock), 'AM is locked at 12:00:00 BKK (11:30:00 MMT)');

  // 15:59:59 BKK (UTC 08:59:59) -> PM Unlocked
  const pmBefore = new Date('2025-02-15T08:59:59Z');
  assert(!LockEngine.isSessionLocked(targetDate, 'PM', pmBefore), 'PM is unlocked at 15:59:59 BKK (15:29:59 MMT)');

  // 16:00:00 BKK (UTC 09:00:00) -> PM Locked
  const pmLock = new Date('2025-02-15T09:00:00Z');
  assert(LockEngine.isSessionLocked(targetDate, 'PM', pmLock), 'PM is locked at 16:00:00 BKK (15:30:00 MMT)');

  // --- TEST 2: Freezing and Persistence of All Required Ensemble Fields ---
  console.log('\n--- TEST 2: Ensemble State Persistence ---');
  AutoWeightedV2ShadowValidator.clearFrozenSnapshotsForTesting();

  const liveBuffer = new LiveObservationBuffer();
  liveBuffer.addObservation({
    date: targetDate,
    time: '11:20:00',
    set: 1450.55,
    value: 42000.12,
    session: 'AM',
  });

  const snapshot = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
    dataset,
    targetDate,
    'AM',
    liveBuffer,
    amLock
  );

  assert(snapshot.isFrozenAtLock === true, 'Snapshot is flagged as frozen at lock');
  assert(snapshot.immutableV2Output.probabilities.length === 100, 'Persists exact 100 probabilities');
  assert(snapshot.top10 !== undefined && snapshot.top10.length === 10, 'Persists Top-10 candidates');
  assert(snapshot.top1 !== undefined && snapshot.top1 === snapshot.top10[0], 'Persists Top Candidate (#1) matching Top-10 Rank 1');
  assert(snapshot.liveObservationSnapshot !== undefined && snapshot.liveObservationSnapshot.length === 1, 'Persists live observation snapshot');
  assert(snapshot.engineWeights !== undefined && Object.keys(snapshot.engineWeights).length === 4, 'Persists 4 component engine weights');
  assert(Boolean(snapshot.integrityHash && snapshot.integrityHash.length === 8), 'Persists valid 8-char integrity hash');

  // --- TEST 3: Immutability: Post-Lock Live Ticks Do NOT Change Frozen Prediction ---
  console.log('\n--- TEST 3: Post-Lock Immutability Invariant ---');
  const originalTop1 = snapshot.top1;
  const originalHash = snapshot.integrityHash;
  const originalProb0 = snapshot.immutableV2Output.probabilities[0];

  // Try to add a post-lock observation with a radically shifted SET/Value
  const mutatedFeed = [
    { time: '11:20:00', set: 1450.55, value: 42000.12 },
    { time: '12:00:05', set: 1999.99, value: 99999.99 },
  ];

  // Request prediction after lock with the mutated feed
  const postLockTime = new Date('2025-02-15T05:00:05Z'); // 12:00:05 BKK
  const postLockSnapshot = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
    dataset,
    targetDate,
    'AM',
    mutatedFeed,
    postLockTime
  );

  assert(postLockSnapshot.top1 === originalTop1, 'Top Candidate #1 remains strictly unchanged after lock');
  assert(postLockSnapshot.integrityHash === originalHash, 'Integrity hash remains strictly identical after lock');
  assert(postLockSnapshot.immutableV2Output.probabilities[0] === originalProb0, 'Distribution probabilities are completely immutable');
  assert(postLockSnapshot.liveObservationSnapshot?.length === 1, 'Post-lock ticks are rejected from frozen observation snapshot');

  // --- TEST 4: Settlement Evaluation Reads ONLY Frozen Snapshot (Zero Recalculation) ---
  console.log('\n--- TEST 4: Settlement Evaluation Reads Frozen Snapshot ---');
  const tracker = new AutoWeightedV2ShadowTracker();
  tracker.reset();

  // Freeze the snapshot before settlement arrives
  const frozenRecord = tracker.freezeLockSnapshot(targetDate, 'AM', dataset, liveBuffer, amLock);
  assert(frozenRecord.isFrozenAtLock === true, 'Tracker froze snapshot at cutoff');

  // Now create dataset that includes the official AM settlement record for targetDate
  const settledRecord: VerifiedMarketRecord = {
    id: `rec_${targetDate}_AM_settle`,
    date: targetDate,
    session: 'AM',
    time: '12:01:00',
    isSettlement: true,
    setRaw: '1452.18',
    valueRaw: '42500.00',
    setNumeric: 1452.18,
    valueNumeric: 42500.0,
    twod: frozenRecord.top10[0], // Settle as Top-1 hit
    historyId: 'hist_target_am',
    verifiedAt: `${targetDate}T12:01:00+07:00`,
    mathematicalCheck: {
      setLastDigit: '2',
      valueLastDigitBeforeDecimal: '0',
      derived2D: frozenRecord.top10[0],
      isMathematicallyConsistent: true,
    },
  };

  const settlementDataset = [...dataset, settledRecord];

  // Evaluate settlement
  const evaluated = tracker.evaluateAndRecord(targetDate, 'AM', settlementDataset);
  assert(evaluated !== null, 'Settlement evaluation succeeded');
  assert(evaluated?.settlementComparison !== null, 'Settlement comparison generated');
  assert(evaluated?.settlementComparison?.actualSettlement2D === frozenRecord.top10[0], 'Settlement matches actual 2D');
  assert(evaluated?.settlementComparison?.v2.isTop1Hit === true, 'Evaluated against frozen prediction produces Top-1 hit');
  assert(evaluated?.immutableV2Output.distributionHash === frozenRecord.immutableV2Output.distributionHash, 'Prediction distribution was NOT recalculated');
  assert(evaluated?.integrityHash === frozenRecord.integrityHash, 'Integrity hash matches frozen snapshot hash');

  // --- TEST 5: AM and PM Session Isolation ---
  console.log('\n--- TEST 5: AM and PM Pipeline Isolation ---');
  // At AM lock time (12:00:00 BKK), PM must remain unlocked
  assert(!LockEngine.isSessionLocked(targetDate, 'PM', amLock), 'PM is not locked when AM locks');

  // PM freeze at PM lock time (16:00:00 BKK)
  const pmBuffer = new LiveObservationBuffer();
  pmBuffer.addObservation({
    date: targetDate,
    time: '15:15:00',
    set: 1455.10,
    value: 46000.50,
    session: 'PM',
  });

  const pmSnapshot = tracker.freezeLockSnapshot(targetDate, 'PM', settlementDataset, pmBuffer, pmLock);
  assert(pmSnapshot.isFrozenAtLock === true, 'PM is frozen at PM lock');
  assert(pmSnapshot.session === 'PM', 'PM session is isolated from AM');
  assert(pmSnapshot.integrityHash !== frozenRecord.integrityHash, 'PM hash is completely distinct from AM hash');

  // Check that AM frozen snapshot remains intact and unaffected by PM freeze
  const amRetrieved = tracker.getEvaluation(targetDate, 'AM');
  assert(amRetrieved?.session === 'AM', 'AM record remains AM');
  assert(amRetrieved?.integrityHash === frozenRecord.integrityHash, 'AM hash unmodified by PM freeze');

  console.log(`\n========================================`);
  console.log(`ALL ${passedCount}/${totalCount} TESTS PASSED PERFECTLY!`);
  console.log(`========================================\n`);
  return true;
}

// Run test if invoked directly
runStep47Tests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
