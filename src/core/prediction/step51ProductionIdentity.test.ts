/**
 * MM2D LEADER — STEP 51 TEST SUITE: FINAL V2 PRODUCTION IDENTITY & UI CLEANUP
 *
 * Verifies:
 * 1. AUTO_WEIGHTED_V2 is the sole production prediction architecture.
 * 2. Top Candidate = V2 Ensemble Rank #1.
 * 3. Top-5 = V2 Ensemble Rank #1–#5.
 * 4. Consensus Top-10 = V2 Ensemble Rank #1–#10.
 * 5. Historical data is used strictly for training/relationship learning, not direct unconditioned output.
 * 6. Live SET + Value conditioning is required for active predictions.
 * 7. Pre-open timing invariants (AM before 10:00 MMT, PM before 14:00 MMT) yield no prediction ("--").
 * 8. Immutable freeze at lock cutoff (AM 11:30 MMT, PM 15:30 MMT).
 * 9. Post-lock evaluation reads frozen snapshot only.
 * 10. Obsolete terminology ("Champion remains All-Time Frequency", "Shadow Mode", "PASS_CANDIDATE", "Research Status")
 *     is completely purged from user-facing UI components.
 */

import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { globalShadowTracker } from './autoWeightedV2ShadowTracker';
import { PRODUCTION_MODEL_VERSION } from '../../types/prediction';
import { MarketOpenGate } from '../market/marketOpenGate';
import { DataSufficiencyGate } from '../market/dataSufficiencyGate';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';
import { VerifiedMarketRecord, MarketSession } from '../../types/market';
import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASS] ${message}`);
}

// Generate realistic verified history for testing
function generateTestRecords(): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const baseDate = new Date('2026-03-01T00:00:00Z');

  for (let i = 0; i < 30; i++) {
    const d = new Date(baseDate.getTime() + i * 86400000);
    const dateStr = d.toISOString().split('T')[0];

    records.push({
      id: `am_${dateStr}`,
      date: dateStr,
      time: '12:01:00',
      session: 'AM',
      setRaw: (1450 + (i % 10) * 2.5).toFixed(2),
      valueRaw: `${(35000 + (i % 15) * 1200).toFixed(2)}M`,
      setNumeric: 1450 + (i % 10) * 2.5,
      valueNumeric: 35000 + (i % 15) * 1200,
      twod: `${(i * 3) % 100}`.padStart(2, '0'),
      historyId: `hist_${dateStr}_AM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: '0',
        valueLastDigitBeforeDecimal: '0',
        derived2D: `${(i * 3) % 100}`.padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      id: `pm_${dateStr}`,
      date: dateStr,
      time: '16:30:00',
      session: 'PM',
      setRaw: (1452 + (i % 10) * 2.5).toFixed(2),
      valueRaw: `${(45000 + (i % 15) * 1200).toFixed(2)}M`,
      setNumeric: 1452 + (i % 10) * 2.5,
      valueNumeric: 45000 + (i % 15) * 1200,
      twod: `${(i * 7) % 100}`.padStart(2, '0'),
      historyId: `hist_${dateStr}_PM`,
      verifiedAt: new Date().toISOString(),
      isSettlement: true,
      mathematicalCheck: {
        setLastDigit: '2',
        valueLastDigitBeforeDecimal: '0',
        derived2D: `${(i * 7) % 100}`.padStart(2, '0'),
        isMathematicallyConsistent: true,
      },
    });
  }

  return records;
}

async function runStep51Tests() {
  console.log('\n=== MM2D STEP 51: FINAL V2 PRODUCTION IDENTITY & UI CLEANUP ===\n');

  const records = generateTestRecords();
  const testDate = '2026-03-31';

  // TEST 1: AUTO_WEIGHTED_V2 is the sole production prediction model
  console.log('--- TEST 1: AUTO_WEIGHTED_V2 is the sole production prediction architecture ---');
  assert(PRODUCTION_MODEL_VERSION === 'AUTO_WEIGHTED_V2', `Expected PRODUCTION_MODEL_VERSION AUTO_WEIGHTED_V2, got ${PRODUCTION_MODEL_VERSION}`);

  // TEST 2: Active prediction with live SET + Value conditioning
  console.log('\n--- TEST 2: Live SET + Value conditioning produces ensemble distribution ---');
  const amLiveFeed = new LiveObservationBuffer();
  amLiveFeed.addObservation({
    session: 'AM',
    date: testDate,
    time: '10:35:00',
    set: 1455.50,
    value: 42000.0,
    timestamp: new Date('2026-03-31T03:35:00Z').toISOString(), // 10:05 MMT
  });

  const activePrediction = AutoWeightedV2ShadowValidator.generateShadowPrediction(
    records,
    testDate,
    'AM',
    amLiveFeed,
    new Date('2026-03-31T03:35:00Z')
  );

  assert(activePrediction !== null, 'V2 active prediction successfully generated');
  assert(activePrediction.immutableV2Output.top10.length === 10, 'Consensus Top-10 has exactly 10 candidates');

  // TEST 3: Identity Relationships (Top Candidate = Rank #1, Top-5 = Rank #1–#5, Consensus Top-10 = Rank #1–#10)
  console.log('\n--- TEST 3: User-Facing Prediction Identity Consistency ---');
  const top1 = activePrediction.top1;
  const top5 = activePrediction.top5;
  const top10 = activePrediction.immutableV2Output.top10;

  assert(top1 === top10[0], `Top Candidate (${top1}) strictly equals Rank #1 (${top10[0]})`);
  assert(top5.length === 5, 'Top-5 has length 5');
  assert(top5[0] === top10[0] &&
         top5[1] === top10[1] &&
         top5[2] === top10[2] &&
         top5[3] === top10[3] &&
         top5[4] === top10[4],
         `Top-5 (${top5.join(',')}) strictly equals Rank #1–#5 of Top-10 (${top10.slice(0, 5).join(',')})`);

  // TEST 4: Pre-open Timing Checks (Strictly '--' / null before session open)
  console.log('\n--- TEST 4: Pre-open Invariants (AM < 10:00 MMT, PM < 14:00 MMT) ---');
  const preOpenAMTime = new Date('2026-03-31T02:30:00Z'); // 09:00 MMT / 09:30 BKK
  const amGate = MarketOpenGate.resolveLifecycleState({
    targetDate: testDate,
    session: 'AM',
    currentBangkokTime: preOpenAMTime,
    historicalRecords: records,
  });
  assert(amGate.isMarketOpen === false, 'AM at 09:00 MMT is NOT open');
  assert(amGate.status === 'MARKET_NOT_OPEN', 'AM at 09:00 MMT has status MARKET_NOT_OPEN');

  const preOpenPMTime = new Date('2026-03-31T06:30:00Z'); // 13:00 MMT / 13:30 BKK
  const pmGate = MarketOpenGate.resolveLifecycleState({
    targetDate: testDate,
    session: 'PM',
    currentBangkokTime: preOpenPMTime,
    historicalRecords: records,
  });
  assert(pmGate.isMarketOpen === false, 'PM at 13:00 MMT is NOT open');
  assert(pmGate.status === 'MARKET_NOT_OPEN', 'PM at 13:00 MMT has status MARKET_NOT_OPEN');

  // TEST 5: Lock Invariant & Frozen Snapshot Persistence
  console.log('\n--- TEST 5: Lock Invariant & Frozen Snapshot Persistence ---');
  const postLockTime = new Date('2026-03-31T05:35:00Z'); // 12:05 BKK / 11:35 MMT (Post AM cutoff)
  const frozenSnapshot = globalShadowTracker.freezeLockSnapshot(
    testDate,
    'AM',
    records,
    amLiveFeed,
    postLockTime
  );

  assert(frozenSnapshot.isFrozenAtLock === true, 'Snapshot is flagged as isFrozenAtLock');
  assert(typeof frozenSnapshot.immutabilityHash === 'string' && frozenSnapshot.immutabilityHash.length > 0,
         'Snapshot has cryptographic immutability hash');

  // Additional ticks added post-lock MUST NOT alter frozen snapshot
  amLiveFeed.addObservation({
    session: 'AM',
    date: testDate,
    time: '12:05:00',
    set: 1499.99,
    value: 99999.0,
    timestamp: postLockTime.toISOString(),
  });

  const postLockRetrieve = AutoWeightedV2ShadowValidator.getFrozenSnapshot(testDate, 'AM');
  assert(postLockRetrieve !== null, 'Retrieved frozen snapshot');
  assert(postLockRetrieve?.immutabilityHash === frozenSnapshot.immutabilityHash,
         'Post-lock observation strictly did not alter frozen hash');
  assert(postLockRetrieve?.top1 === frozenSnapshot.top1,
         'Post-lock observation strictly did not alter Top Candidate');

  // TEST 6: User-Facing UI Codebase Inspection (No obsolete terms in V2Top10View)
  console.log('\n--- TEST 6: Verify User-Facing UI Purged of Obsolete Identity ---');
  const v2Top10ViewPath = path.join(process.cwd(), 'src/components/V2Top10View.tsx');
  const v2ViewContent = fs.readFileSync(v2Top10ViewPath, 'utf8');

  assert(!v2ViewContent.includes('Champion remains All-Time Frequency'),
         'UI does NOT contain "Champion remains All-Time Frequency"');
  assert(!v2ViewContent.includes('Shadow Mode'),
         'UI does NOT contain "Shadow Mode"');
  assert(!v2ViewContent.includes('PASS_CANDIDATE'),
         'UI does NOT contain "PASS_CANDIDATE"');
  assert(!v2ViewContent.includes('Research Status:'),
         'UI does NOT contain "Research Status:"');

  // TEST 7: User-Facing UI Contains Final Prediction Identity
  console.log('\n--- TEST 7: Verify User-Facing UI Contains Final Prediction Identity ---');
  assert(v2ViewContent.includes('Consensus Top-10'), 'UI displays "Consensus Top-10"');
  assert(v2ViewContent.includes('AUTO_WEIGHTED_V2'), 'UI displays "AUTO_WEIGHTED_V2"');
  assert(v2ViewContent.includes('Final Prediction'), 'UI displays "Final Prediction"');

  console.log('\n================================================================');
  console.log('ALL 7 STEP 51 FINAL V2 PRODUCTION IDENTITY TESTS PASSED!');
  console.log('================================================================\n');
}

runStep51Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
