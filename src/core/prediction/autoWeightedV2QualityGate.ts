/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ShadowSessionRecord,
  QualityGateStatus,
  QualityGateCriterion,
  QualityGateEvaluationResult,
  SessionDetailedPerformance,
  EngineAggregateMetric,
  AUTO_WEIGHTED_V2_COMPONENTS,
  AutoWeightedV2ComponentModelId,
} from '../../types/autoWeightedV2';

export class AutoWeightedV2QualityGate {
  public static readonly MIN_TOTAL_SESSIONS = 20;
  public static readonly MIN_AM_SESSIONS = 10;
  public static readonly MIN_PM_SESSIONS = 10;
  public static readonly MIN_TRADING_DAYS = 10;
  public static readonly MIN_WIN_RATE = 0.60; // 60% minimum head-to-head win rate
  public static readonly MAX_SINGLE_DAY_CONTRIBUTION_SHARE = 0.50; // Max 50% from any single session advantage
  public static readonly MAX_SIGNIFICANCE_P_VALUE = 0.05;

  /**
   * Evaluates verified out-of-sample shadow records against multi-horizon evidence,
   * session-specific consistency, statistical significance, and anti-leakage gates.
   */
  public static evaluate(records: ShadowSessionRecord[]): QualityGateEvaluationResult {
    // 1. Filter to verified settled records only
    const settledRecords = records.filter(
      (r) => r.settlementComparison !== null && Boolean(r.settlementComparison.actualSettlement2D)
    );

    const amRecords = settledRecords.filter((r) => r.session === 'AM');
    const pmRecords = settledRecords.filter((r) => r.session === 'PM');
    const distinctDates = Array.from(new Set(settledRecords.map((r) => r.targetDate))).sort();

    // 2. Compute granular session performance
    const amPerformance = this.computeSessionPerformance(amRecords);
    const pmPerformance = this.computeSessionPerformance(pmRecords);
    const overallPerformance = this.computeSessionPerformance(settledRecords);

    // 3. Statistical Safety & Significance calculations
    const pairedStats = this.computePairedTTest(settledRecords);
    const outlierStats = this.computeSingleDayOutlierCheck(settledRecords);
    const leakageStats = this.verifyAntiLeakage(settledRecords);

    const headToHeadWinRate = overallPerformance.headToHead.winRate;

    // 4. Construct Audit Criteria
    const criteria: QualityGateCriterion[] = [];

    // --- CATEGORY 1: MINIMUM EVIDENCE ---
    criteria.push({
      id: 'MIN_TOTAL_SESSIONS',
      name: 'Minimum Total Evaluated Sessions',
      category: 'MINIMUM_EVIDENCE',
      threshold: `>= ${this.MIN_TOTAL_SESSIONS} sessions`,
      actual: `${settledRecords.length} sessions`,
      passed: settledRecords.length >= this.MIN_TOTAL_SESSIONS,
      description: `Requires at least ${this.MIN_TOTAL_SESSIONS} verified out-of-sample official settlement evaluations.`,
    });

    criteria.push({
      id: 'MIN_AM_SESSIONS',
      name: 'Minimum Morning (AM) Sessions',
      category: 'MINIMUM_EVIDENCE',
      threshold: `>= ${this.MIN_AM_SESSIONS} sessions`,
      actual: `${amRecords.length} sessions`,
      passed: amRecords.length >= this.MIN_AM_SESSIONS,
      description: `Requires at least ${this.MIN_AM_SESSIONS} AM settlement evaluations.`,
    });

    criteria.push({
      id: 'MIN_PM_SESSIONS',
      name: 'Minimum Evening (PM) Sessions',
      category: 'MINIMUM_EVIDENCE',
      threshold: `>= ${this.MIN_PM_SESSIONS} sessions`,
      actual: `${pmRecords.length} sessions`,
      passed: pmRecords.length >= this.MIN_PM_SESSIONS,
      description: `Requires at least ${this.MIN_PM_SESSIONS} PM settlement evaluations.`,
    });

    criteria.push({
      id: 'MIN_TRADING_DAYS',
      name: 'Minimum Trading Days Span',
      category: 'MINIMUM_EVIDENCE',
      threshold: `>= ${this.MIN_TRADING_DAYS} days`,
      actual: `${distinctDates.length} days`,
      passed: distinctDates.length >= this.MIN_TRADING_DAYS,
      description: `Evaluations must span across at least ${this.MIN_TRADING_DAYS} distinct market trading days.`,
    });

    // --- CATEGORY 2: INDEPENDENT SESSION CONSISTENCY ---
    criteria.push({
      id: 'AM_NLL_IMPROVEMENT',
      name: 'AM Session NLL Improvement',
      category: 'SESSION_CONSISTENCY',
      threshold: 'ΔNLL < 0.0000',
      actual: amPerformance.delta.deltaNll.toFixed(4),
      passed: amPerformance.count > 0 && amPerformance.delta.deltaNll < 0,
      description: 'V2 negative log likelihood must strictly improve upon Champion in morning sessions.',
    });

    criteria.push({
      id: 'PM_NLL_IMPROVEMENT',
      name: 'PM Session NLL Improvement',
      category: 'SESSION_CONSISTENCY',
      threshold: 'ΔNLL < 0.0000',
      actual: pmPerformance.delta.deltaNll.toFixed(4),
      passed: pmPerformance.count > 0 && pmPerformance.delta.deltaNll < 0,
      description: 'V2 negative log likelihood must strictly improve upon Champion in evening sessions.',
    });

    criteria.push({
      id: 'AM_BRIER_IMPROVEMENT',
      name: 'AM Session Brier Improvement',
      category: 'SESSION_CONSISTENCY',
      threshold: 'ΔBrier < 0.0000',
      actual: amPerformance.delta.deltaBrier.toFixed(4),
      passed: amPerformance.count > 0 && amPerformance.delta.deltaBrier < 0,
      description: 'V2 Brier quadratic accuracy must strictly improve upon Champion in morning sessions.',
    });

    criteria.push({
      id: 'PM_BRIER_IMPROVEMENT',
      name: 'PM Session Brier Improvement',
      category: 'SESSION_CONSISTENCY',
      threshold: 'ΔBrier < 0.0000',
      actual: pmPerformance.delta.deltaBrier.toFixed(4),
      passed: pmPerformance.count > 0 && pmPerformance.delta.deltaBrier < 0,
      description: 'V2 Brier quadratic accuracy must strictly improve upon Champion in evening sessions.',
    });

    criteria.push({
      id: 'AM_TOP10_PRESERVATION',
      name: 'AM Session Top-10 Hit Rate',
      category: 'SESSION_CONSISTENCY',
      threshold: `>= ${(amPerformance.champion.top10Rate * 100).toFixed(1)}%`,
      actual: `${(amPerformance.v2.top10Rate * 100).toFixed(1)}%`,
      passed: amPerformance.count > 0 && amPerformance.v2.top10Rate >= amPerformance.champion.top10Rate,
      description: 'V2 Top-10 coverage in AM must meet or exceed Champion Top-10 rate.',
    });

    criteria.push({
      id: 'PM_TOP10_PRESERVATION',
      name: 'PM Session Top-10 Hit Rate',
      category: 'SESSION_CONSISTENCY',
      threshold: `>= ${(pmPerformance.champion.top10Rate * 100).toFixed(1)}%`,
      actual: `${(pmPerformance.v2.top10Rate * 100).toFixed(1)}%`,
      passed: pmPerformance.count > 0 && pmPerformance.v2.top10Rate >= pmPerformance.champion.top10Rate,
      description: 'V2 Top-10 coverage in PM must meet or exceed Champion Top-10 rate.',
    });

    criteria.push({
      id: 'AM_MRR_PRESERVATION',
      name: 'AM Session Mean Reciprocal Rank',
      category: 'SESSION_CONSISTENCY',
      threshold: `>= ${amPerformance.champion.mrr.toFixed(4)}`,
      actual: amPerformance.v2.mrr.toFixed(4),
      passed: amPerformance.count > 0 && amPerformance.v2.mrr >= amPerformance.champion.mrr,
      description: 'V2 MRR in AM must meet or exceed Champion MRR.',
    });

    criteria.push({
      id: 'PM_MRR_PRESERVATION',
      name: 'PM Session Mean Reciprocal Rank',
      category: 'SESSION_CONSISTENCY',
      threshold: `>= ${pmPerformance.champion.mrr.toFixed(4)}`,
      actual: pmPerformance.v2.mrr.toFixed(4),
      passed: pmPerformance.count > 0 && pmPerformance.v2.mrr >= pmPerformance.champion.mrr,
      description: 'V2 MRR in PM must meet or exceed Champion MRR.',
    });

    // --- CATEGORY 3: STATISTICAL SAFETY GATES ---
    criteria.push({
      id: 'PAIRED_T_TEST_SIGNIFICANCE',
      name: 'Paired NLL Significance (p < 0.05)',
      category: 'STATISTICAL_SAFETY',
      threshold: `p < ${this.MAX_SIGNIFICANCE_P_VALUE} & t < 0`,
      actual: `t = ${pairedStats.tStatistic.toFixed(3)}, p = ${pairedStats.pValue.toFixed(4)}`,
      passed: pairedStats.isSignificant && pairedStats.tStatistic < 0,
      description: 'Paired Student t-test on session-by-session log loss differences must show statistically significant reduction.',
    });

    criteria.push({
      id: 'HEAD_TO_HEAD_WIN_RATE',
      name: 'Head-to-Head Win Rate',
      category: 'STATISTICAL_SAFETY',
      threshold: `>= ${(this.MIN_WIN_RATE * 100).toFixed(0)}%`,
      actual: `${(headToHeadWinRate * 100).toFixed(1)}% (${overallPerformance.headToHead.v2Wins}W / ${overallPerformance.headToHead.champWins}L)`,
      passed: headToHeadWinRate >= this.MIN_WIN_RATE,
      description: `V2 must defeat Champion in at least ${(this.MIN_WIN_RATE * 100).toFixed(0)}% of head-to-head sessions.`,
    });

    criteria.push({
      id: 'ANTI_SINGLE_DAY_OUTLIER',
      name: 'Single-Session Outlier Guard',
      category: 'STATISTICAL_SAFETY',
      threshold: `< ${(this.MAX_SINGLE_DAY_CONTRIBUTION_SHARE * 100).toFixed(0)}% contribution`,
      actual: `${(outlierStats.maxSingleDayContributionShare * 100).toFixed(1)}%`,
      passed: outlierStats.passedSingleDayOutlierCheck,
      description: 'Guarantees that no single lucky session accounts for half or more of total cumulative NLL improvement.',
    });

    // --- CATEGORY 4: ANTI-LEAKAGE VERIFICATION ---
    criteria.push({
      id: 'ZERO_TARGET_DAY_LEAKAGE',
      name: 'Zero Target-Day / Future Leakage',
      category: 'ANTI_LEAKAGE',
      threshold: '100% verified point-in-time',
      actual: leakageStats.zeroTargetDayLeakageVerified ? 'Verified Zero Leakage' : 'LEAKAGE_DETECTED',
      passed: leakageStats.zeroTargetDayLeakageVerified,
      description: 'Ensures engine weights and predictions strictly use pre-lock historical data prior to target settlement.',
    });

    criteria.push({
      id: 'ZERO_POST_LOCK_LEAKAGE',
      name: 'Zero Post-Lock Data Usage',
      category: 'ANTI_LEAKAGE',
      threshold: '100% pre-lock ingestion only',
      actual: leakageStats.zeroPostLockLeakageVerified ? 'Verified Zero Post-Lock Ingestion' : 'POST_LOCK_DATA_DETECTED',
      passed: leakageStats.zeroPostLockLeakageVerified,
      description: 'Ensures shadow prediction strictly ingested data at publish boundary before market lock.',
    });

    criteria.push({
      id: 'STRICT_SESSION_ISOLATION',
      name: 'Strict AM/PM Session Isolation',
      category: 'ANTI_LEAKAGE',
      threshold: '100% isolated session models',
      actual: leakageStats.sessionIsolationVerified ? 'Verified Isolated' : 'CROSS_POLLUTION_DETECTED',
      passed: leakageStats.sessionIsolationVerified,
      description: 'Ensures AM and PM weights, distributions, and calibrations remain completely isolated.',
    });

    // 5. Determine Quality Gate Status
    const minEvidencePassed = criteria
      .filter((c) => c.category === 'MINIMUM_EVIDENCE')
      .every((c) => c.passed);

    const otherCriteriaPassed = criteria
      .filter((c) => c.category !== 'MINIMUM_EVIDENCE')
      .every((c) => c.passed);

    let status: QualityGateStatus = 'SHADOW';
    if (!minEvidencePassed) {
      status = 'INSUFFICIENT_EVIDENCE';
    } else if (otherCriteriaPassed) {
      status = 'PASS_CANDIDATE';
    } else {
      status = 'SHADOW';
    }

    const failedCriteria = criteria.filter((c) => !c.passed).map((c) => c.name);

    let recommendation: string;
    if (status === 'PASS_CANDIDATE') {
      recommendation =
        'V2 satisfies all minimum evidence requirements, independent AM/PM consistency gates, and statistical safety thresholds. Status: PASS_CANDIDATE. In accordance with strict governance policy, ALL_TIME_FREQUENCY_V1 remains the locked production champion and V2 remains strictly in shadow mode.';
    } else if (status === 'INSUFFICIENT_EVIDENCE') {
      recommendation = `Insufficient verified real-day OOS evidence (requires >= ${this.MIN_TOTAL_SESSIONS} total sessions, >= ${this.MIN_AM_SESSIONS} AM, >= ${this.MIN_PM_SESSIONS} PM across >= ${this.MIN_TRADING_DAYS} trading days). Status: INSUFFICIENT_EVIDENCE. AUTO_WEIGHTED_V2 remains strictly in shadow mode.`;
    } else {
      recommendation = `V2 does not satisfy all statistical safety or consistency criteria (Failed: ${failedCriteria.join(', ')}). Status: SHADOW. AUTO_WEIGHTED_V2 remains strictly in shadow mode.`;
    }

    return {
      status,
      totalEvidenceSessions: settledRecords.length,
      amEvidenceSessions: amRecords.length,
      pmEvidenceSessions: pmRecords.length,
      tradingDaysCount: distinctDates.length,
      amPerformance,
      pmPerformance,
      overallPerformance,
      statisticalSafety: {
        tStatistic: pairedStats.tStatistic,
        pValue: pairedStats.pValue,
        isSignificant: pairedStats.isSignificant,
        headToHeadWinRate,
        maxSingleDayContributionShare: outlierStats.maxSingleDayContributionShare,
        passedSingleDayOutlierCheck: outlierStats.passedSingleDayOutlierCheck,
        zeroTargetDayLeakageVerified: leakageStats.zeroTargetDayLeakageVerified,
        zeroPostLockLeakageVerified: leakageStats.zeroPostLockLeakageVerified,
      },
      criteria,
      failedCriteria,
      recommendation,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Computes comprehensive aggregate metrics across a set of shadow records.
   */
  private static computeSessionPerformance(records: ShadowSessionRecord[]): SessionDetailedPerformance {
    const count = records.length;
    if (count === 0) {
      const emptyStats = {
        nll: 0,
        brier: 0,
        top1Rate: 0,
        top3Rate: 0,
        top5Rate: 0,
        top10Rate: 0,
        mrr: 0,
        avgRank: 0,
      };
      const emptyDelta = {
        deltaNll: 0,
        deltaBrier: 0,
        deltaTop1: 0,
        deltaTop3: 0,
        deltaTop5: 0,
        deltaTop10: 0,
        deltaMrr: 0,
        deltaAvgRank: 0,
      };
      const emptyEngines: Record<AutoWeightedV2ComponentModelId, EngineAggregateMetric> = {} as any;
      for (const comp of AUTO_WEIGHTED_V2_COMPONENTS) {
        emptyEngines[comp] = {
          avgNll: 0,
          avgBrier: 0,
          top1Rate: 0,
          top3Rate: 0,
          top5Rate: 0,
          top10Rate: 0,
          mrr: 0,
          avgRank: 0,
          avgWeight: 0,
        };
      }
      return {
        count: 0,
        v2: emptyStats,
        champion: emptyStats,
        delta: emptyDelta,
        headToHead: { v2Wins: 0, champWins: 0, ties: 0, winRate: 0 },
        perEnginePerformance: emptyEngines,
      };
    }

    let v2LogLossSum = 0;
    let v2BrierSum = 0;
    let v2Top1Count = 0;
    let v2Top3Count = 0;
    let v2Top5Count = 0;
    let v2Top10Count = 0;
    let v2MrrSum = 0;
    let v2RankSum = 0;

    let champLogLossSum = 0;
    let champBrierSum = 0;
    let champTop1Count = 0;
    let champTop3Count = 0;
    let champTop5Count = 0;
    let champTop10Count = 0;
    let champMrrSum = 0;
    let champRankSum = 0;

    let v2Wins = 0;
    let champWins = 0;
    let ties = 0;

    const engineAccum: Record<
      AutoWeightedV2ComponentModelId,
      {
        logLossSum: number;
        brierSum: number;
        top1Count: number;
        top3Count: number;
        top5Count: number;
        top10Count: number;
        mrrSum: number;
        rankSum: number;
        weightSum: number;
      }
    > = {} as any;

    for (const comp of AUTO_WEIGHTED_V2_COMPONENTS) {
      engineAccum[comp] = {
        logLossSum: 0,
        brierSum: 0,
        top1Count: 0,
        top3Count: 0,
        top5Count: 0,
        top10Count: 0,
        mrrSum: 0,
        rankSum: 0,
        weightSum: 0,
      };
    }

    for (const r of records) {
      const sc = r.settlementComparison!;
      // V2
      v2LogLossSum += sc.v2.logLoss;
      v2BrierSum += sc.v2.brierScore;
      if (sc.v2.isTop1Hit) v2Top1Count++;
      if (sc.v2.isTop3Hit) v2Top3Count++;
      if (sc.v2.isTop5Hit) v2Top5Count++;
      if (sc.v2.isTop10Hit) v2Top10Count++;
      v2MrrSum += sc.v2.reciprocalRank;
      v2RankSum += sc.v2.actualRank;

      // Champion
      champLogLossSum += sc.champion.logLoss;
      champBrierSum += sc.champion.brierScore;
      if (sc.champion.isTop1Hit) champTop1Count++;
      if (sc.champion.isTop3Hit) champTop3Count++;
      if (sc.champion.isTop5Hit) champTop5Count++;
      if (sc.champion.isTop10Hit) champTop10Count++;
      champMrrSum += sc.champion.reciprocalRank;
      champRankSum += sc.champion.actualRank;

      // Head-to-head
      if (sc.v2.logLoss < sc.champion.logLoss - 1e-5) v2Wins++;
      else if (sc.v2.logLoss > sc.champion.logLoss + 1e-5) champWins++;
      else ties++;

      // Per-engine
      if (sc.perEnginePerformance && sc.engineWeights) {
        for (const comp of AUTO_WEIGHTED_V2_COMPONENTS) {
          const perf = sc.perEnginePerformance[comp];
          const w = sc.engineWeights[comp] || 0;
          if (perf) {
            engineAccum[comp].logLossSum += perf.logLoss;
            engineAccum[comp].brierSum += perf.brierScore;
            if (perf.rankInModel === 1) engineAccum[comp].top1Count++;
            if (perf.rankInModel <= 3) engineAccum[comp].top3Count++;
            if (perf.rankInModel <= 5) engineAccum[comp].top5Count++;
            if (perf.isTop10Hit) engineAccum[comp].top10Count++;
            engineAccum[comp].mrrSum += perf.reciprocalRank;
            engineAccum[comp].rankSum += perf.rankInModel;
          }
          engineAccum[comp].weightSum += w;
        }
      }
    }

    const v2Nll = v2LogLossSum / count;
    const v2Brier = v2BrierSum / count;
    const v2Top1Rate = v2Top1Count / count;
    const v2Top3Rate = v2Top3Count / count;
    const v2Top5Rate = v2Top5Count / count;
    const v2Top10Rate = v2Top10Count / count;
    const v2Mrr = v2MrrSum / count;
    const v2AvgRank = v2RankSum / count;

    const champNll = champLogLossSum / count;
    const champBrier = champBrierSum / count;
    const champTop1Rate = champTop1Count / count;
    const champTop3Rate = champTop3Count / count;
    const champTop5Rate = champTop5Count / count;
    const champTop10Rate = champTop10Count / count;
    const champMrr = champMrrSum / count;
    const champAvgRank = champRankSum / count;

    const perEnginePerformance: Record<AutoWeightedV2ComponentModelId, EngineAggregateMetric> = {} as any;
    for (const comp of AUTO_WEIGHTED_V2_COMPONENTS) {
      perEnginePerformance[comp] = {
        avgNll: Math.round((engineAccum[comp].logLossSum / count) * 10000) / 10000,
        avgBrier: Math.round((engineAccum[comp].brierSum / count) * 10000) / 10000,
        top1Rate: Math.round((engineAccum[comp].top1Count / count) * 10000) / 10000,
        top3Rate: Math.round((engineAccum[comp].top3Count / count) * 10000) / 10000,
        top5Rate: Math.round((engineAccum[comp].top5Count / count) * 10000) / 10000,
        top10Rate: Math.round((engineAccum[comp].top10Count / count) * 10000) / 10000,
        mrr: Math.round((engineAccum[comp].mrrSum / count) * 10000) / 10000,
        avgRank: Math.round((engineAccum[comp].rankSum / count) * 10) / 10,
        avgWeight: Math.round((engineAccum[comp].weightSum / count) * 10000) / 10000,
      };
    }

    return {
      count,
      v2: {
        nll: Math.round(v2Nll * 10000) / 10000,
        brier: Math.round(v2Brier * 10000) / 10000,
        top1Rate: Math.round(v2Top1Rate * 10000) / 10000,
        top3Rate: Math.round(v2Top3Rate * 10000) / 10000,
        top5Rate: Math.round(v2Top5Rate * 10000) / 10000,
        top10Rate: Math.round(v2Top10Rate * 10000) / 10000,
        mrr: Math.round(v2Mrr * 10000) / 10000,
        avgRank: Math.round(v2AvgRank * 10) / 10,
      },
      champion: {
        nll: Math.round(champNll * 10000) / 10000,
        brier: Math.round(champBrier * 10000) / 10000,
        top1Rate: Math.round(champTop1Rate * 10000) / 10000,
        top3Rate: Math.round(champTop3Rate * 10000) / 10000,
        top5Rate: Math.round(champTop5Rate * 10000) / 10000,
        top10Rate: Math.round(champTop10Rate * 10000) / 10000,
        mrr: Math.round(champMrr * 10000) / 10000,
        avgRank: Math.round(champAvgRank * 10) / 10,
      },
      delta: {
        deltaNll: Math.round((v2Nll - champNll) * 10000) / 10000,
        deltaBrier: Math.round((v2Brier - champBrier) * 10000) / 10000,
        deltaTop1: Math.round((v2Top1Rate - champTop1Rate) * 10000) / 10000,
        deltaTop3: Math.round((v2Top3Rate - champTop3Rate) * 10000) / 10000,
        deltaTop5: Math.round((v2Top5Rate - champTop5Rate) * 10000) / 10000,
        deltaTop10: Math.round((v2Top10Rate - champTop10Rate) * 10000) / 10000,
        deltaMrr: Math.round((v2Mrr - champMrr) * 10000) / 10000,
        deltaAvgRank: Math.round((v2AvgRank - champAvgRank) * 10) / 10,
      },
      headToHead: {
        v2Wins,
        champWins,
        ties,
        winRate: Math.round((v2Wins / count) * 10000) / 10000,
      },
      perEnginePerformance,
    };
  }

  /**
   * Computes paired Student t-test on session-by-session log loss differences.
   */
  private static computePairedTTest(records: ShadowSessionRecord[]): {
    tStatistic: number;
    pValue: number;
    isSignificant: boolean;
  } {
    const count = records.length;
    if (count < 2) {
      return { tStatistic: 0, pValue: 1.0, isSignificant: false };
    }

    const diffs = records.map((r) => r.settlementComparison!.v2.logLoss - r.settlementComparison!.champion.logLoss);
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / count;
    const variance = diffs.reduce((acc, d) => acc + Math.pow(d - meanDiff, 2), 0) / (count - 1);
    const stdErr = Math.sqrt(variance / count);

    if (stdErr < 1e-8) {
      return {
        tStatistic: 0,
        pValue: meanDiff < 0 ? 0.0001 : 1.0,
        isSignificant: meanDiff < 0,
      };
    }

    const tStat = meanDiff / stdErr;
    const df = count - 1;
    const pValue = this.approximateStudentTPValue(tStat, df);

    return {
      tStatistic: Math.round(tStat * 1000) / 1000,
      pValue: Math.round(pValue * 10000) / 10000,
      isSignificant: tStat < 0 && pValue < this.MAX_SIGNIFICANCE_P_VALUE,
    };
  }

  /**
   * Verifies that no single session accounts for >= 50% of total cumulative NLL improvement.
   */
  private static computeSingleDayOutlierCheck(records: ShadowSessionRecord[]): {
    maxSingleDayContributionShare: number;
    passedSingleDayOutlierCheck: boolean;
  } {
    if (records.length === 0) {
      return { maxSingleDayContributionShare: 0, passedSingleDayOutlierCheck: false };
    }

    // Advantage of V2 over Champion in each session (positive if V2 was better)
    const improvements = records.map((r) => {
      const adv = r.settlementComparison!.champion.logLoss - r.settlementComparison!.v2.logLoss;
      return Math.max(0, adv);
    });

    const totalImprovement = improvements.reduce((sum, v) => sum + v, 0);
    if (totalImprovement <= 0) {
      return { maxSingleDayContributionShare: 0, passedSingleDayOutlierCheck: false };
    }

    const maxSingleImprovement = Math.max(...improvements);
    const share = maxSingleImprovement / totalImprovement;

    return {
      maxSingleDayContributionShare: Math.round(share * 10000) / 10000,
      passedSingleDayOutlierCheck: share < this.MAX_SINGLE_DAY_CONTRIBUTION_SHARE,
    };
  }

  /**
   * Verifies anti-leakage compliance across all evaluated records.
   */
  private static verifyAntiLeakage(records: ShadowSessionRecord[]): {
    zeroTargetDayLeakageVerified: boolean;
    zeroPostLockLeakageVerified: boolean;
    sessionIsolationVerified: boolean;
  } {
    if (records.length === 0) {
      return {
        zeroTargetDayLeakageVerified: false,
        zeroPostLockLeakageVerified: false,
        sessionIsolationVerified: false,
      };
    }

    const zeroTargetDay = records.every((r) => r.antiLeakageAudit.zeroTargetSettlementLeakage && r.antiLeakageAudit.zeroFutureDatesUsed);
    const zeroPostLock = records.every((r) => r.antiLeakageAudit.zeroPostLockDataUsed);
    const sessionIso = records.every((r) => r.antiLeakageAudit.sessionIsolationEnforced);

    return {
      zeroTargetDayLeakageVerified: zeroTargetDay,
      zeroPostLockLeakageVerified: zeroPostLock,
      sessionIsolationVerified: sessionIso,
    };
  }

  /**
   * Approximation of Student's t-distribution two-tailed p-value.
   */
  private static approximateStudentTPValue(t: number, df: number): number {
    const absT = Math.abs(t);
    // Standard normal approximation with Hill/Cornish-Fisher expansion for df >= 10
    const x = df / (df + absT * absT);
    // Beta regularized approximation or Hill's formula
    const z = absT * Math.sqrt((df - 0.5) / df);
    // Error function approximation for normal distribution
    const normCdf = 0.5 * (1 + this.erf(z / Math.SQRT2));
    const twoTailed = 2 * (1 - normCdf);
    return Math.max(0.0001, Math.min(1.0, twoTailed));
  }

  private static erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    const absX = Math.abs(x);
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return sign * y;
  }
}
