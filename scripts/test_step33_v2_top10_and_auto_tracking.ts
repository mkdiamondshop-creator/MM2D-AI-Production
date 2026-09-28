import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { AutoWeightedV2ShadowValidator } from '../src/core/prediction/autoWeightedV2ShadowValidator';
import { globalShadowTracker, AutoWeightedV2ShadowTracker } from '../src/core/prediction/autoWeightedV2ShadowTracker';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { AUTO_WEIGHTED_V2_COMPONENTS } from '../src/types/autoWeightedV2';
import { VerifiedMarketRecord } from '../src/types/market';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${description}`);
  } else {
    console.error(`  ❌ [FAIL] ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runStep33Tests() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 33: V2 TOP-10 UI & AUTO TRACKING BENCHMARK ');
  console.log('================================================================\n');

  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Loaded ${allRecords.length} verified historical records.`);

  // ---------------------------------------------------------------------------
  // SECTION 1: PRODUCTION CHAMPION ISOLATION & ZERO PROMOTION OF V2
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] Strict Champion Freeze & Zero Promotion ---');

  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '1a. Production engine PRODUCTION_MODEL strictly remains ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    '1b. PRODUCTION_MODEL_VERSION constant strictly remains ALL_TIME_FREQUENCY_V1.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: V2 TOP-10 CANDIDATE FIELDS & ENGINE ATTRIBUTION INTEGRITY
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] V2 Top-10 Candidate Contract & Engine Attribution ---');

  const testDate = '2026-09-08';
  const shadowAM = AutoWeightedV2ShadowValidator.generateShadowPrediction(allRecords, testDate, 'AM');
  const shadowPM = AutoWeightedV2ShadowValidator.generateShadowPrediction(allRecords, testDate, 'PM');

  const top10AM = shadowAM.immutableV2Output.candidates.slice(0, 10);
  assert(top10AM.length === 10, '2a. Exactly 10 candidates in Top-10 list.');

  for (let idx = 0; idx < top10AM.length; idx++) {
    const cand = top10AM[idx];
    const rank = idx + 1;

    // 1. Rank
    assert(cand.rank === rank, `2b.${rank}. Candidate rank matches position (#${cand.rank}).`);
    // 2. 2D Number
    assert(typeof cand.twod === 'string' && /^\d{2}$/.test(cand.twod), `2c.${rank}. Candidate 2D number is valid string [${cand.twod}].`);
    // 3. Probability %
    assert(cand.probability > 0 && cand.probability <= 1.0, `2d.${rank}. Candidate probability is strictly valid (${(cand.probability * 100).toFixed(2)}%).`);
    // 4. Supporting Engine Count
    assert(cand.consensusCount >= 0 && cand.consensusCount <= 4, `2e.${rank}. Supporting engine count is bounded in 0..4 (${cand.consensusCount}).`);
    // 5. Dominant Engine
    assert(
      AUTO_WEIGHTED_V2_COMPONENTS.includes(cand.dominantEngine as any),
      `2f.${rank}. Dominant engine is a valid recognized engine (${cand.dominantEngine}).`
    );

    // Verify Expandable Detail View Attributes for all 4 engines
    for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
      const supp = cand.engineSupports[compId];
      assert(supp !== undefined, `2g.${rank}. Component support defined for ${compId}.`);
      // Each engine's weight
      assert(supp.weight >= 0 && supp.weight <= 1.0, `2h.${rank}.${compId}. Weight bounded in [0, 1] (${(supp.weight * 100).toFixed(1)}%).`);
      // Per-engine probability
      assert(supp.probability >= 0 && supp.probability <= 1.0, `2i.${rank}.${compId}. Per-engine probability bounded in [0, 1].`);
      // Per-engine rank
      assert(supp.rankInModel >= 1 && supp.rankInModel <= 100, `2j.${rank}.${compId}. Per-engine rank in 1..100 (#${supp.rankInModel}).`);
      // Contribution share
      assert(supp.contributionShare >= 0 && supp.contributionShare <= 1.0, `2k.${rank}.${compId}. Contribution share bounded in [0, 1] (${(supp.contributionShare * 100).toFixed(1)}%).`);
    }

    // Verify contribution share sum equals approx 1.0
    const totalShare = AUTO_WEIGHTED_V2_COMPONENTS.reduce((sum, id) => sum + cand.engineSupports[id].contributionShare, 0);
    assert(Math.abs(totalShare - 1.0) < 0.05, `2l.${rank}. Sum of engine contribution shares equals 100% (sum: ${(totalShare * 100).toFixed(1)}%).`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: OFFICIAL THAISTOCK2D AUTO-SYNC CONNECTION TO V2 EVALUATION
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Official Result Auto-Sync Connection to V2 Shadow Evaluation ---');

  // Verify that globalShadowTracker has been populated via official result auto-sync
  const trackedSessions = globalShadowTracker.getAllRecordedSessions();
  assert(trackedSessions.length > 0, `3a. globalShadowTracker recorded ${trackedSessions.length} settled sessions.`);

  // Verify evaluation on a specific known settled date (e.g. 2026-09-08 AM)
  const evalAM = globalShadowTracker.getEvaluation('2026-09-08', 'AM');
  assert(evalAM !== null, '3b. 2026-09-08 AM recorded settlement evaluation exists.');
  assert(evalAM?.settlementComparison !== null, '3c. Settlement comparison is non-null for settled session.');

  const sc = evalAM!.settlementComparison!;
  assert(sc.actualSettlement2D.length === 2, `3d. Actual settlement 2D recorded (${sc.actualSettlement2D}).`);

  // Requirement 1: V2 vs Champion Result
  assert(
    sc.delta.winner === 'V2' || sc.delta.winner === 'CHAMPION' || sc.delta.winner === 'TIE',
    `3e. V2 vs Champion winner determined: ${sc.delta.winner}.`
  );
  assert(typeof sc.delta.deltaLogLoss === 'number', `3f. deltaLogLoss computed: ${sc.delta.deltaLogLoss}.`);
  assert(typeof sc.delta.deltaBrier === 'number', `3g. deltaBrier computed: ${sc.delta.deltaBrier}.`);
  assert(typeof sc.delta.rankDifference === 'number', `3h. rankDifference computed: ${sc.delta.rankDifference}.`);

  // Requirement 2: Top-1/3/5/10 Hit Tracking
  assert(typeof sc.v2.isTop1Hit === 'boolean', '3i. V2 Top-1 hit tracked.');
  assert(typeof sc.v2.isTop3Hit === 'boolean', '3j. V2 Top-3 hit tracked.');
  assert(typeof sc.v2.isTop5Hit === 'boolean', '3k. V2 Top-5 hit tracked.');
  assert(typeof sc.v2.isTop10Hit === 'boolean', '3l. V2 Top-10 hit tracked.');

  // Requirement 3: Rank & MRR
  assert(sc.v2.actualRank >= 1 && sc.v2.actualRank <= 100, `3m. V2 rank tracked: #${sc.v2.actualRank}.`);
  assert(sc.v2.reciprocalRank > 0 && sc.v2.reciprocalRank <= 1.0, `3n. V2 MRR (reciprocal rank) tracked: ${sc.v2.reciprocalRank.toFixed(4)}.`);
  assert(sc.champion.actualRank >= 1 && sc.champion.actualRank <= 100, `3o. Champion rank tracked: #${sc.champion.actualRank}.`);
  assert(sc.champion.reciprocalRank > 0 && sc.champion.reciprocalRank <= 1.0, `3p. Champion MRR tracked: ${sc.champion.reciprocalRank.toFixed(4)}.`);

  // Requirement 4: Engine Weights
  assert(sc.engineWeights !== undefined, '3q. Engine weights recorded in settlement comparison.');
  let weightSum = 0;
  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    const w = sc.engineWeights![compId];
    assert(w >= 0 && w <= 1.0, `3r. Engine weight for ${compId} valid: ${(w * 100).toFixed(1)}%.`);
    weightSum += w;
  }
  assert(Math.abs(weightSum - 1.0) < 1e-4, `3s. Engine weights sum to 1.0 (sum: ${(weightSum * 100).toFixed(2)}%).`);

  // Requirement 5: Per-Engine Performance
  assert(sc.perEnginePerformance !== undefined, '3t. Per-engine performance recorded in settlement comparison.');
  for (const compId of AUTO_WEIGHTED_V2_COMPONENTS) {
    const perf = sc.perEnginePerformance![compId];
    assert(perf !== undefined, `3u. Performance recorded for engine ${compId}.`);
    assert(perf.rankInModel >= 1 && perf.rankInModel <= 100, `3v. Engine ${compId} rankInModel: #${perf.rankInModel}.`);
    assert(perf.probability > 0, `3w. Engine ${compId} probability: ${(perf.probability * 100).toFixed(2)}%.`);
    assert(typeof perf.logLoss === 'number' && perf.logLoss > 0, `3x. Engine ${compId} logLoss: ${perf.logLoss}.`);
    assert(typeof perf.brierScore === 'number' && perf.brierScore >= 0, `3y. Engine ${compId} brierScore: ${perf.brierScore}.`);
    assert(perf.reciprocalRank === Math.round((1.0 / perf.rankInModel) * 10000) / 10000, `3z. Engine ${compId} reciprocalRank consistent with rank.`);
    assert(typeof perf.isTop10Hit === 'boolean', `3aa. Engine ${compId} isTop10Hit boolean present.`);
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: STRICT AM / PM SEPARATION & NO FUTURE LEAKAGE
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 4] Strict AM/PM Separation & Leakage Audit ---');

  const evalPM = globalShadowTracker.getEvaluation('2026-09-08', 'PM');
  assert(evalPM !== null, '4a. 2026-09-08 PM recorded settlement evaluation exists.');
  assert(
    JSON.stringify(evalAM!.settlementComparison!.engineWeights) !== JSON.stringify(evalPM!.settlementComparison!.engineWeights),
    '4b. AM and PM engine weights are completely independent.'
  );

  // Anti-Leakage Audit
  assert(shadowAM.antiLeakageAudit.zeroPostLockDataUsed, '4c. Shadow AM enforces zero post-lock data.');
  assert(shadowAM.antiLeakageAudit.zeroFutureDatesUsed, '4d. Shadow AM enforces zero future dates.');
  assert(shadowAM.antiLeakageAudit.zeroTargetSettlementLeakage, '4e. Shadow AM enforces zero target settlement leakage.');
  assert(shadowAM.antiLeakageAudit.sessionIsolationEnforced, '4f. Shadow AM enforces session isolation.');

  console.log('\n================================================================');
  console.log(`  STEP 33 TESTS PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');
}

runStep33Tests().catch((err) => {
  console.error('\n❌ STEP 33 TESTS FAILED:', err);
  process.exit(1);
});
