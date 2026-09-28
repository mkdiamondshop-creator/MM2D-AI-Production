/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutoWeightedV2QualityGate } from '../src/core/prediction/autoWeightedV2QualityGate';
import { AutoWeightedV2ShadowValidator } from '../src/core/prediction/autoWeightedV2ShadowValidator';
import { AutoWeightedV2Engine } from '../src/core/prediction/autoWeightedV2Engine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { ShadowSessionRecord, QualityGateStatus } from '../src/types/autoWeightedV2';

let totalAssertions = 0;
let passedAssertions = 0;

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runStep35Audit() {
  console.log('================================================================');
  console.log('MM2D LEADER — STEP 35: QUALITY GATE THRESHOLD AUDIT');
  console.log('================================================================\n');

  // --- SECTION 1: Exact Numeric Threshold Constant Audit ---
  console.log('--- [SECTION 1] Explicit Numeric Threshold Constant Audit ---');
  
  assert(
    AutoWeightedV2QualityGate.MIN_TOTAL_SESSIONS === 20,
    `1a. MIN_TOTAL_SESSIONS is explicitly 20 (actual: ${AutoWeightedV2QualityGate.MIN_TOTAL_SESSIONS})`
  );
  assert(
    AutoWeightedV2QualityGate.MIN_AM_SESSIONS === 10,
    `1b. MIN_AM_SESSIONS is explicitly 10 (actual: ${AutoWeightedV2QualityGate.MIN_AM_SESSIONS})`
  );
  assert(
    AutoWeightedV2QualityGate.MIN_PM_SESSIONS === 10,
    `1c. MIN_PM_SESSIONS is explicitly 10 (actual: ${AutoWeightedV2QualityGate.MIN_PM_SESSIONS})`
  );
  assert(
    AutoWeightedV2QualityGate.MIN_TRADING_DAYS === 10,
    `1d. MIN_TRADING_DAYS is explicitly 10 (actual: ${AutoWeightedV2QualityGate.MIN_TRADING_DAYS})`
  );
  assert(
    AutoWeightedV2QualityGate.MAX_SINGLE_DAY_CONTRIBUTION_SHARE === 0.50,
    `1e. MAX_SINGLE_DAY_CONTRIBUTION_SHARE is explicitly 0.50 (50%) (actual: ${AutoWeightedV2QualityGate.MAX_SINGLE_DAY_CONTRIBUTION_SHARE})`
  );
  assert(
    AutoWeightedV2QualityGate.MAX_SIGNIFICANCE_P_VALUE === 0.05,
    `1f. MAX_SIGNIFICANCE_P_VALUE is explicitly 0.05 (actual: ${AutoWeightedV2QualityGate.MAX_SIGNIFICANCE_P_VALUE})`
  );
  assert(
    AutoWeightedV2QualityGate.MIN_WIN_RATE === 0.60,
    `1g. MIN_WIN_RATE is explicitly 0.60 (60%) (actual: ${AutoWeightedV2QualityGate.MIN_WIN_RATE})`
  );

  // Load real market records
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allRecords = await globalDatasetStorage.queryAllVerifiedRecords();
  console.log(`Loaded ${allRecords.length} historical records.`);

  // Build full set of verified OOS shadow records
  const evalDates = Array.from(
    new Set(allRecords.filter((r) => r.isSettlement && r.twod).map((r) => r.date))
  ).sort().slice(-13); // Last 13 trading days

  const realShadowRecords: ShadowSessionRecord[] = [];
  for (const date of evalDates) {
    for (const session of ['AM', 'PM'] as const) {
      const settleRec = allRecords.find(
        (r) => r.date === date && r.session === session && r.isSettlement && r.twod
      );
      if (!settleRec || !settleRec.twod) continue;

      const shadowRec = AutoWeightedV2ShadowValidator.generateShadowPrediction(
        allRecords,
        date,
        session
      );
      const evaluatedRec = AutoWeightedV2ShadowValidator.evaluateSettlement(
        shadowRec,
        allRecords
      );
      realShadowRecords.push(evaluatedRec);
    }
  }
  console.log(`Generated ${realShadowRecords.length} real out-of-sample shadow records.`);

  // Evaluate base real records
  const baseEval = AutoWeightedV2QualityGate.evaluate(realShadowRecords);
  assert(
    baseEval.status === 'PASS_CANDIDATE',
    `Real baseline evaluation achieves PASS_CANDIDATE (actual: ${baseEval.status})`
  );
  assert(
    baseEval.totalEvidenceSessions >= 20,
    `Real baseline has >= 20 total sessions (actual: ${baseEval.totalEvidenceSessions})`
  );

  // --- SECTION 2: Threshold Bypass Prevention Audit ---
  console.log('\n--- [SECTION 2] Threshold Bypass Prevention (Negative Tests) ---');

  // 2a. Insufficient total sessions (< 20)
  const shortRecords = realShadowRecords.slice(0, 19);
  const shortEval = AutoWeightedV2QualityGate.evaluate(shortRecords);
  assert(
    shortEval.status === 'INSUFFICIENT_EVIDENCE',
    `2a. < 20 sessions cannot bypass gate (19 sessions -> INSUFFICIENT_EVIDENCE)`
  );
  assert(
    shortEval.criteria.find((c) => c.id === 'MIN_TOTAL_SESSIONS')?.passed === false,
    `2a. MIN_TOTAL_SESSIONS criterion fails`
  );

  // 2b. Insufficient AM sessions (< 10)
  const fewAmRecords = [
    ...realShadowRecords.filter((r) => r.session === 'AM').slice(0, 9),
    ...realShadowRecords.filter((r) => r.session === 'PM'),
  ];
  const fewAmEval = AutoWeightedV2QualityGate.evaluate(fewAmRecords);
  assert(
    fewAmEval.status === 'INSUFFICIENT_EVIDENCE',
    `2b. < 10 AM sessions cannot bypass gate (9 AM -> INSUFFICIENT_EVIDENCE)`
  );
  assert(
    fewAmEval.criteria.find((c) => c.id === 'MIN_AM_SESSIONS')?.passed === false,
    `2b. MIN_AM_SESSIONS criterion fails`
  );

  // 2c. Insufficient PM sessions (< 10)
  const fewPmRecords = [
    ...realShadowRecords.filter((r) => r.session === 'AM'),
    ...realShadowRecords.filter((r) => r.session === 'PM').slice(0, 9),
  ];
  const fewPmEval = AutoWeightedV2QualityGate.evaluate(fewPmRecords);
  assert(
    fewPmEval.status === 'INSUFFICIENT_EVIDENCE',
    `2c. < 10 PM sessions cannot bypass gate (9 PM -> INSUFFICIENT_EVIDENCE)`
  );
  assert(
    fewPmEval.criteria.find((c) => c.id === 'MIN_PM_SESSIONS')?.passed === false,
    `2c. MIN_PM_SESSIONS criterion fails`
  );

  // 2d. Insufficient unique trading days (< 10)
  const fakeCompressedDates = realShadowRecords.map((r, i) => ({
    ...r,
    targetDate: `2026-09-${String((i % 8) + 1).padStart(2, '0')}`, // Only 8 days
  }));
  const compressedEval = AutoWeightedV2QualityGate.evaluate(fakeCompressedDates);
  assert(
    compressedEval.status === 'INSUFFICIENT_EVIDENCE',
    `2d. < 10 trading days cannot bypass gate (8 days -> INSUFFICIENT_EVIDENCE)`
  );
  assert(
    compressedEval.criteria.find((c) => c.id === 'MIN_TRADING_DAYS')?.passed === false,
    `2d. MIN_TRADING_DAYS criterion fails`
  );

  // 2e. Low win rate (< 60%)
  const lowWinRateRecords = realShadowRecords.map((r, i) => {
    if (i < 12) {
      // Degrade V2 so Champion wins
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          winner: 'CHAMPION' as const,
          v2: { ...r.settlementComparison!.v2, logLoss: 6.0 },
          champion: { ...r.settlementComparison!.champion, logLoss: 4.5 },
        },
      };
    }
    return r;
  });
  const lowWinEval = AutoWeightedV2QualityGate.evaluate(lowWinRateRecords);
  assert(
    lowWinEval.status === 'SHADOW',
    `2e. Low win rate (< 60%) cannot bypass gate (status: SHADOW)`
  );
  assert(
    lowWinEval.criteria.find((c) => c.id === 'HEAD_TO_HEAD_WIN_RATE')?.passed === false,
    `2e. HEAD_TO_HEAD_WIN_RATE criterion fails`
  );

  // 2f. Insignificant t-test (p >= 0.05)
  const insignificantRecords = realShadowRecords.map((r) => ({
    ...r,
    settlementComparison: {
      ...r.settlementComparison!,
      v2: { ...r.settlementComparison!.v2, logLoss: 5.001 },
      champion: { ...r.settlementComparison!.champion, logLoss: 5.000 },
    },
  }));
  const insigEval = AutoWeightedV2QualityGate.evaluate(insignificantRecords);
  assert(
    insigEval.status === 'SHADOW',
    `2f. Insignificant t-test cannot bypass gate (status: SHADOW)`
  );
  assert(
    insigEval.criteria.find((c) => c.id === 'PAIRED_T_TEST_SIGNIFICANCE')?.passed === false,
    `2f. PAIRED_T_TEST_SIGNIFICANCE criterion fails`
  );

  // 2g. Post-lock data leakage detected
  const postLockLeakRecords = realShadowRecords.map((r, i) =>
    i === 0
      ? {
          ...r,
          antiLeakageAudit: {
            ...r.antiLeakageAudit,
            zeroPostLockDataUsed: false,
          },
        }
      : r
  );
  const postLockEval = AutoWeightedV2QualityGate.evaluate(postLockLeakRecords);
  assert(
    postLockEval.status === 'SHADOW',
    `2g. Post-lock data violation fails gate (status: SHADOW)`
  );
  assert(
    postLockEval.criteria.find((c) => c.id === 'ZERO_POST_LOCK_LEAKAGE')?.passed === false,
    `2g. ZERO_POST_LOCK_LEAKAGE criterion fails`
  );

  // 2h. Target-day leakage detected
  const targetLeakRecords = realShadowRecords.map((r, i) =>
    i === 0
      ? {
          ...r,
          antiLeakageAudit: {
            ...r.antiLeakageAudit,
            zeroTargetSettlementLeakage: false,
          },
        }
      : r
  );
  const targetLeakEval = AutoWeightedV2QualityGate.evaluate(targetLeakRecords);
  assert(
    targetLeakEval.status === 'SHADOW',
    `2h. Target-day leakage violation fails gate (status: SHADOW)`
  );
  assert(
    targetLeakEval.criteria.find((c) => c.id === 'ZERO_TARGET_DAY_LEAKAGE')?.passed === false,
    `2h. ZERO_TARGET_DAY_LEAKAGE criterion fails`
  );

  // 2i. Session isolation violation
  const crossPollutionRecords = realShadowRecords.map((r, i) =>
    i === 0
      ? {
          ...r,
          antiLeakageAudit: {
            ...r.antiLeakageAudit,
            sessionIsolationEnforced: false,
          },
        }
      : r
  );
  const crossEval = AutoWeightedV2QualityGate.evaluate(crossPollutionRecords);
  assert(
    crossEval.status === 'SHADOW',
    `2i. Cross-session pollution fails gate (status: SHADOW)`
  );
  assert(
    crossEval.criteria.find((c) => c.id === 'STRICT_SESSION_ISOLATION')?.passed === false,
    `2i. STRICT_SESSION_ISOLATION criterion fails`
  );

  // --- SECTION 3: Independent AM/PM Enforcement Audit ---
  console.log('\n--- [SECTION 3] Independent AM/PM Enforcement Audit ---');

  // 3a. AM passes all, PM fails ΔNLL (PM degraded)
  const pmFailedNllRecords = realShadowRecords.map((r) => {
    if (r.session === 'PM') {
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          v2: { ...r.settlementComparison!.v2, logLoss: 6.5 },
          champion: { ...r.settlementComparison!.champion, logLoss: 5.0 },
          deltaLogLoss: 1.5,
        },
      };
    }
    return r;
  });
  const pmFailEval = AutoWeightedV2QualityGate.evaluate(pmFailedNllRecords);
  assert(
    pmFailEval.status === 'SHADOW',
    `3a. PM ΔNLL failure prevents PASS_CANDIDATE even when AM is superior (status: SHADOW)`
  );
  assert(
    pmFailEval.criteria.find((c) => c.id === 'AM_NLL_IMPROVEMENT')?.passed === true,
    `3a. AM_NLL_IMPROVEMENT passed`
  );
  assert(
    pmFailEval.criteria.find((c) => c.id === 'PM_NLL_IMPROVEMENT')?.passed === false,
    `3a. PM_NLL_IMPROVEMENT failed`
  );

  // 3b. PM passes all, AM fails ΔNLL (AM degraded)
  const amFailedNllRecords = realShadowRecords.map((r) => {
    if (r.session === 'AM') {
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          v2: { ...r.settlementComparison!.v2, logLoss: 6.5 },
          champion: { ...r.settlementComparison!.champion, logLoss: 5.0 },
          deltaLogLoss: 1.5,
        },
      };
    }
    return r;
  });
  const amFailEval = AutoWeightedV2QualityGate.evaluate(amFailedNllRecords);
  assert(
    amFailEval.status === 'SHADOW',
    `3b. AM ΔNLL failure prevents PASS_CANDIDATE even when PM is superior (status: SHADOW)`
  );
  assert(
    amFailEval.criteria.find((c) => c.id === 'PM_NLL_IMPROVEMENT')?.passed === true,
    `3b. PM_NLL_IMPROVEMENT passed`
  );
  assert(
    amFailEval.criteria.find((c) => c.id === 'AM_NLL_IMPROVEMENT')?.passed === false,
    `3b. AM_NLL_IMPROVEMENT failed`
  );

  // 3c. PM fails Top-10 preservation
  const pmFailedTop10Records = realShadowRecords.map((r) => {
    if (r.session === 'PM') {
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          v2: { ...r.settlementComparison!.v2, isTop10Hit: false },
          champion: { ...r.settlementComparison!.champion, isTop10Hit: true },
        },
      };
    }
    return r;
  });
  const pmTop10Eval = AutoWeightedV2QualityGate.evaluate(pmFailedTop10Records);
  assert(
    pmTop10Eval.status === 'SHADOW',
    `3c. PM Top-10 preservation failure prevents PASS_CANDIDATE (status: SHADOW)`
  );
  assert(
    pmTop10Eval.criteria.find((c) => c.id === 'PM_TOP10_PRESERVATION')?.passed === false,
    `3c. PM_TOP10_PRESERVATION failed`
  );

  // --- SECTION 4: Prior-OOS-Only Weight Determination & Anti-Leakage ---
  console.log('\n--- [SECTION 4] Prior-OOS-Only Weights & Anti-Leakage Audit ---');

  const testTargetDate = '2026-09-08';
  const testSession = 'AM';

  // Generate baseline prediction
  const predBase = AutoWeightedV2Engine.predict(allRecords, testTargetDate, testSession);

  // Mutate target date settlement record
  const recordsWithMutatedTarget = allRecords.map((r) => {
    if (r.date === testTargetDate && r.isSettlement) {
      return { ...r, twod: '99', valueNumeric: 999999 };
    }
    return r;
  });
  const predAfterTargetMutation = AutoWeightedV2Engine.predict(
    recordsWithMutatedTarget,
    testTargetDate,
    testSession
  );

  let targetDiff = 0;
  for (let i = 0; i < 100; i++) {
    targetDiff += Math.abs(predBase.probabilities[i] - predAfterTargetMutation.probabilities[i]);
  }
  assert(
    targetDiff === 0,
    `4a. Target-day settlement has zero impact on prediction weights or distributions (diff: ${targetDiff})`
  );

  // Mutate future date settlement record
  const recordsWithMutatedFuture = allRecords.map((r) => {
    if (r.date > testTargetDate) {
      return { ...r, twod: '00', valueNumeric: 123456 };
    }
    return r;
  });
  const predAfterFutureMutation = AutoWeightedV2Engine.predict(
    recordsWithMutatedFuture,
    testTargetDate,
    testSession
  );

  let futureDiff = 0;
  for (let i = 0; i < 100; i++) {
    futureDiff += Math.abs(predBase.probabilities[i] - predAfterFutureMutation.probabilities[i]);
  }
  assert(
    futureDiff === 0,
    `4b. Future settlements have zero impact on prediction weights or distributions (diff: ${futureDiff})`
  );

  // --- SECTION 5: Single Lucky Session Outlier Guard Audit ---
  console.log('\n--- [SECTION 5] Single Lucky Session Outlier Guard Audit ---');

  // Construct a dataset where 1 single session provides 70% of total cumulative improvement
  // Sessions 1..23 have tiny improvement (0.01 each = 0.23 total), Session 0 has 0.70 improvement (total = 0.93 -> 0.70 / 0.93 = 75.2% > 50%)
  const luckySessionRecords = realShadowRecords.map((r, i) => {
    if (i === 0) {
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          winner: 'V2' as const,
          v2: { ...r.settlementComparison!.v2, logLoss: 3.5 },
          champion: { ...r.settlementComparison!.champion, logLoss: 5.5 }, // adv = 2.0
          deltaLogLoss: -2.0,
        },
      };
    } else {
      return {
        ...r,
        settlementComparison: {
          ...r.settlementComparison!,
          winner: 'V2' as const,
          v2: { ...r.settlementComparison!.v2, logLoss: 4.98 },
          champion: { ...r.settlementComparison!.champion, logLoss: 5.00 }, // adv = 0.02
          deltaLogLoss: -0.02,
        },
      };
    }
  });

  const luckyEval = AutoWeightedV2QualityGate.evaluate(luckySessionRecords);
  const outlierCriterion = luckyEval.criteria.find((c) => c.id === 'ANTI_SINGLE_DAY_OUTLIER');
  
  assert(
    luckyEval.status === 'SHADOW',
    `5a. Single lucky session (> 50% contribution share) fails gate (status: SHADOW)`
  );
  assert(
    outlierCriterion?.passed === false,
    `5b. ANTI_SINGLE_DAY_OUTLIER criterion fails (share: ${luckyEval.statisticalSafety.maxSingleDayContributionShare * 100}%)`
  );
  assert(
    luckyEval.statisticalSafety.passedSingleDayOutlierCheck === false,
    `5c. passedSingleDayOutlierCheck is false`
  );

  // --- SECTION 6: PASS_CANDIDATE Automatic Promotion Protection ---
  console.log('\n--- [SECTION 6] Automatic Promotion Protection Audit ---');

  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    `6a. PredictionEngine.PRODUCTION_MODEL is strictly frozen to ALL_TIME_FREQUENCY_V1`
  );
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    `6b. PRODUCTION_MODEL_VERSION is compile-time locked to ALL_TIME_FREQUENCY_V1`
  );
  assert(
    baseEval.recommendation.includes('ALL_TIME_FREQUENCY_V1 remains the locked production champion'),
    `6c. QualityGate recommendation strictly enforces champion freeze`
  );
  assert(
    baseEval.recommendation.includes('V2 remains strictly in shadow mode'),
    `6d. QualityGate recommendation strictly enforces shadow mode retention`
  );

  console.log('\n================================================================');
  console.log(`  STEP 35 AUDIT PASSED: ${passedAssertions} / ${totalAssertions} ASSERTIONS OK`);
  console.log('================================================================\n');

  console.log('Explicit Gate Thresholds:');
  console.log(`  - Minimum Total OOS Sessions: ${AutoWeightedV2QualityGate.MIN_TOTAL_SESSIONS}`);
  console.log(`  - Minimum AM Sessions: ${AutoWeightedV2QualityGate.MIN_AM_SESSIONS}`);
  console.log(`  - Minimum PM Sessions: ${AutoWeightedV2QualityGate.MIN_PM_SESSIONS}`);
  console.log(`  - Minimum Unique Trading Days: ${AutoWeightedV2QualityGate.MIN_TRADING_DAYS}`);
  console.log(`  - Max Allowed Single-Session Contribution: ${AutoWeightedV2QualityGate.MAX_SINGLE_DAY_CONTRIBUTION_SHARE * 100}%`);
  console.log(`  - Required Paired t-Test p-Value: < ${AutoWeightedV2QualityGate.MAX_SIGNIFICANCE_P_VALUE}`);
  console.log(`  - Required Head-to-Head Win Rate: >= ${AutoWeightedV2QualityGate.MIN_WIN_RATE * 100}%`);
}

runStep35Audit().catch((err) => {
  console.error('Fatal error in Step 35 Audit:', err);
  process.exit(1);
});
