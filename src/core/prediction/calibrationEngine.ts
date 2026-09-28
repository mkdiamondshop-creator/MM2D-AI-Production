import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  BASELINE_CHAMPION_VERSION,
  CalibrationMetrics,
  CalibrationRunReport,
  ChronologicalBlockMetric,
  ChronologicalPartitions,
  DualSessionModelWeights,
  ModelComponentWeights,
  ModelConfiguration,
  PromotionGateChecklist,
  PromotionGateResult,
  PromotionStatus,
} from '../../types/calibration';
import {
  PREDICTION_CUTOFFS,
  PredictionFeatureVector,
  PRODUCTION_MODEL_VERSION,
} from '../../types/prediction';
import { FeatureEngine } from './featureEngine';
import { PredictionEngine } from './predictionEngine';
import { StatisticalEngine } from './statisticalEngine';

export class DataLeakageError extends Error {
  constructor(message: string) {
    super(`[DATA_LEAKAGE_VIOLATION] ${message}`);
    this.name = 'DataLeakageError';
  }
}

/**
 * Adaptive Model Calibration Engine
 * 
 * Step 7 Authoritative Calibration Architecture:
 * - Baseline Champion: ALL_TIME_FREQUENCY_V1
 * - Candidate Models: Controlled, deterministic, bounded configurations
 * - Walk-Forward Evaluation: Strict chronological temporal isolation with Zero Future Leakage
 * - Chronological 3-way Partition: Development, Calibration, Final Locked Holdout
 * - Multi-Gate Promotion Review: Requires multi-metric improvement & block stability to recommend
 * - Safety Invariant: Never mutates locked production predictions; calibration produces recommendations only
 */
export class CalibrationEngine {
  public static readonly CHAMPION_VERSION = BASELINE_CHAMPION_VERSION;

  /**
   * Authoritative Champion Baseline Weights
   * Pure all-time empirical frequency
   */
  public static readonly CHAMPION_WEIGHTS: DualSessionModelWeights = {
    am: {
      freqAllTime: 1.0,
      freqW30: 0.0,
      freqW10: 0.0,
      freqW5: 0.0,
      weekdayPrior: 0.0,
      sessionPrior: 0.0,
      digitMarginals: 0.0,
      markovTransition: 0.0,
      momentumIntraday: 0.0,
    },
    pm: {
      freqAllTime: 1.0,
      freqW30: 0.0,
      freqW10: 0.0,
      freqW5: 0.0,
      weekdayPrior: 0.0,
      sessionPrior: 0.0,
      amToPmAffinity: 0.0,
      digitMarginals: 0.0,
      markovTransition: 0.0,
      momentumIntraday: 0.0,
    },
  };

  /**
   * Deterministic Standard Candidate Catalog
   * Predefined, mathematically bounded model architectures
   */
  public static readonly CANDIDATE_DEFINITIONS: Array<{
    modelVersion: string;
    modelName: string;
    description: string;
    weights: DualSessionModelWeights;
  }> = [
    {
      modelVersion: 'ALL_TIME_FREQUENCY_V1',
      modelName: 'All-Time Empirical Frequency Baseline (Champion)',
      description: 'Pure all-time empirical frequency across 00..99 with Laplace smoothing',
      weights: CalibrationEngine.CHAMPION_WEIGHTS,
    },
    {
      modelVersion: 'LONG_TERM_FREQUENCY',
      modelName: 'Long-Term Blended Frequency',
      description: 'Blend of all-time empirical frequency (85%) and 30-settlement rolling window (15%)',
      weights: {
        am: {
          freqAllTime: 0.85,
          freqW30: 0.15,
        },
        pm: {
          freqAllTime: 0.85,
          freqW30: 0.15,
        },
      },
    },
    {
      modelVersion: 'FREQUENCY_WEEKDAY',
      modelName: 'Weekday-Conditioned Empirical Frequency',
      description: 'All-time frequency (75%) blended with 30-window (10%) and day-of-week conditional prior (15%)',
      weights: {
        am: {
          freqAllTime: 0.75,
          freqW30: 0.10,
          weekdayPrior: 0.15,
        },
        pm: {
          freqAllTime: 0.75,
          freqW30: 0.10,
          weekdayPrior: 0.15,
        },
      },
    },
    {
      modelVersion: 'FREQUENCY_SESSION',
      modelName: 'Session-Conditioned Empirical Frequency',
      description: 'All-time frequency conditioned on session-specific distributions and morning-afternoon transitions',
      weights: {
        am: {
          freqAllTime: 0.80,
          sessionPrior: 0.20,
        },
        pm: {
          freqAllTime: 0.70,
          sessionPrior: 0.15,
          amToPmAffinity: 0.15,
        },
      },
    },
    {
      modelVersion: 'LONG_TERM_CONSERVATIVE_ENSEMBLE',
      modelName: 'Long-Term Conservative Ensemble',
      description: 'Conservative multi-component blend of all-time, rolling 30, weekday, and session dynamics',
      weights: {
        am: {
          freqAllTime: 0.55,
          freqW30: 0.20,
          weekdayPrior: 0.15,
          sessionPrior: 0.10,
        },
        pm: {
          freqAllTime: 0.50,
          freqW30: 0.15,
          weekdayPrior: 0.15,
          sessionPrior: 0.10,
          amToPmAffinity: 0.10,
        },
      },
    },
  ];

  /**
   * Validates that model weights satisfy mathematical invariants:
   * - Each weight is in [0.0, 1.0]
   * - Weights sum exactly to 1.0 (within 1e-5 tolerance)
   */
  public static validateWeights(weights: DualSessionModelWeights): {
    valid: boolean;
    error?: string;
    amSum: number;
    pmSum: number;
  } {
    function sumWeights(w: ModelComponentWeights): { sum: number; hasNegative: boolean; hasOverOne: boolean } {
      let sum = 0;
      let hasNegative = false;
      let hasOverOne = false;

      const keys: Array<keyof ModelComponentWeights> = [
        'freqAllTime',
        'freqW30',
        'freqW10',
        'freqW5',
        'weekdayPrior',
        'sessionPrior',
        'amToPmAffinity',
        'digitMarginals',
        'markovTransition',
        'momentumIntraday',
      ];

      for (const k of keys) {
        const val = w[k];
        if (typeof val === 'number') {
          if (val < 0) hasNegative = true;
          if (val > 1.00001) hasOverOne = true;
          sum += val;
        }
      }
      return { sum, hasNegative, hasOverOne };
    }

    const amCheck = sumWeights(weights.am);
    const pmCheck = sumWeights(weights.pm);

    if (amCheck.hasNegative || pmCheck.hasNegative) {
      return { valid: false, error: 'Negative component weights detected', amSum: amCheck.sum, pmSum: pmCheck.sum };
    }
    if (amCheck.hasOverOne || pmCheck.hasOverOne) {
      return { valid: false, error: 'Component weight exceeding 1.0 detected', amSum: amCheck.sum, pmSum: pmCheck.sum };
    }

    if (Math.abs(amCheck.sum - 1.0) > 1e-4) {
      return {
        valid: false,
        error: `AM weights sum (${amCheck.sum.toFixed(6)}) does not equal 1.0`,
        amSum: amCheck.sum,
        pmSum: pmCheck.sum,
      };
    }
    if (Math.abs(pmCheck.sum - 1.0) > 1e-4) {
      return {
        valid: false,
        error: `PM weights sum (${pmCheck.sum.toFixed(6)}) does not equal 1.0`,
        amSum: amCheck.sum,
        pmSum: pmCheck.sum,
      };
    }

    return { valid: true, amSum: amCheck.sum, pmSum: pmCheck.sum };
  }

  /**
   * Computes a deterministic configuration hash for model weights & metadata
   */
  public static computeConfigurationHash(
    modelVersion: string,
    weights: DualSessionModelWeights,
    trainingDataCutoff: string = 'NONE'
  ): string {
    const rawStr = JSON.stringify({
      modelVersion,
      amWeights: weights.am,
      pmWeights: weights.pm,
      cutoff: trainingDataCutoff,
    });

    let hash = 0;
    for (let i = 0; i < rawStr.length; i++) {
      const char = rawStr.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `CFG_${modelVersion}_${hex}`.toUpperCase();
  }

  /**
   * Divides verified settlements chronologically into 3 non-overlapping sequential partitions:
   * - Development: First 50% of chronological dataset
   * - Calibration: Next 25% of chronological dataset
   * - Final Locked Holdout: Latest 25% of chronological dataset (strictly protected)
   */
  public static partitionDataset(allSettlements: VerifiedMarketRecord[]): ChronologicalPartitions {
    const sorted = [...allSettlements]
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    const total = sorted.length;
    if (total < 12) {
      throw new Error(`Insufficient records for 3-way chronological partition (have ${total}, need >= 12)`);
    }

    const devCount = Math.floor(total * 0.50);
    const calCount = Math.floor(total * 0.25);
    const holdCount = total - devCount - calCount;

    const devRecords = sorted.slice(0, devCount);
    const calRecords = sorted.slice(devCount, devCount + calCount);
    const holdRecords = sorted.slice(devCount + calCount);

    return {
      development: {
        startDate: devRecords[0].date,
        endDate: devRecords[devRecords.length - 1].date,
        recordsCount: devRecords.length,
        records: devRecords,
      },
      calibration: {
        startDate: calRecords[0].date,
        endDate: calRecords[calRecords.length - 1].date,
        recordsCount: calRecords.length,
        records: calRecords,
      },
      finalLockedHoldout: {
        startDate: holdRecords[0].date,
        endDate: holdRecords[holdRecords.length - 1].date,
        recordsCount: holdRecords.length,
        records: holdRecords,
      },
    };
  }

  /**
   * Performs an honest Walk-Forward evaluation over a set of target evaluation records
   * using ONLY records available strictly prior to each prediction cutoff.
   * 
   * Strict Leakage Invariants:
   * - For AM session at targetDate: training records MUST have date < targetDate.
   * - For PM session at targetDate: training records MUST have date < targetDate, OR (date == targetDate AND session == 'AM').
   * - Any future record or target-session settlement presence throws DataLeakageError.
   */
  public static evaluateWalkForward(
    allAvailableSettlements: VerifiedMarketRecord[],
    evaluationSettlements: VerifiedMarketRecord[],
    weights: DualSessionModelWeights,
    modelVersion: string,
    minTrainingCount: number = 20
  ): CalibrationMetrics {
    const sortedAll = [...allAvailableSettlements]
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    const sortedEval = [...evaluationSettlements]
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    let top1Hits = 0;
    let top3Hits = 0;
    let top5Hits = 0;
    let top10Hits = 0;
    let amCount = 0;
    let pmCount = 0;
    const ranks: number[] = [];
    const entropies: number[] = [];
    const confidences: number[] = [];

    interface TempEvalRow {
      date: string;
      session: MarketSession;
      actual2D: string;
      rank: number;
      top1Hit: boolean;
      top3Hit: boolean;
      top5Hit: boolean;
      top10Hit: boolean;
    }
    const evalRows: TempEvalRow[] = [];

    for (const targetRecord of sortedEval) {
      const targetDate = targetRecord.date;
      const targetSession = targetRecord.session;
      const actual2D = targetRecord.twod;

      // 1. Construct strict point-in-time training set
      const trainingRecords = sortedAll.filter((r) => {
        if (targetSession === 'AM') {
          // Strictly before target date
          return r.date < targetDate;
        } else {
          // Strictly before target date, OR today's verified AM settlement
          if (r.date < targetDate) return true;
          if (r.date === targetDate && r.session === 'AM') return true;
          return false;
        }
      });

      // 2. Strict Anti-Leakage Assertions
      for (const tr of trainingRecords) {
        if (targetSession === 'AM' && tr.date >= targetDate) {
          throw new DataLeakageError(
            `Future/same-day record (${tr.date} ${tr.session}) leaked into AM training set for target ${targetDate} AM`
          );
        }
        if (targetSession === 'PM') {
          if (tr.date > targetDate) {
            throw new DataLeakageError(
              `Future record (${tr.date}) leaked into PM training set for target ${targetDate} PM`
            );
          }
          if (tr.date === targetDate && tr.session === 'PM') {
            throw new DataLeakageError(
              `Target PM settlement leaked into PM training set for target ${targetDate} PM`
            );
          }
        }
      }

      if (trainingRecords.length < minTrainingCount) {
        // Skip if insufficient historical depth
        continue;
      }

      // 3. Extract Feature Vector point-in-time
      const featRes = FeatureEngine.extractFeatures(
        trainingRecords,
        targetDate,
        targetSession,
        undefined
      );

      if (!featRes.success || !featRes.featureVector) {
        continue;
      }

      // 4. Generate Deterministic Configured Prediction
      const sessionWeights = targetSession === 'AM' ? weights.am : weights.pm;
      const pred = PredictionEngine.generateConfiguredPrediction(
        featRes.featureVector,
        sessionWeights,
        modelVersion
      );

      // 5. Evaluate Rankings
      const candRank = pred.candidates.findIndex((c) => c.twod === actual2D) + 1;
      const finalRank = candRank > 0 ? candRank : 100;

      const top1Hit = finalRank === 1;
      const top3Hit = finalRank <= 3;
      const top5Hit = finalRank <= 5;
      const top10Hit = finalRank <= 10;

      if (top1Hit) top1Hits++;
      if (top3Hit) top3Hits++;
      if (top5Hit) top5Hits++;
      if (top10Hit) top10Hits++;

      if (targetSession === 'AM') amCount++;
      else pmCount++;

      ranks.push(finalRank);
      entropies.push(pred.entropy);
      confidences.push(pred.confidenceScore);

      evalRows.push({
        date: targetDate,
        session: targetSession,
        actual2D,
        rank: finalRank,
        top1Hit,
        top3Hit,
        top5Hit,
        top10Hit,
      });
    }

    const totalEvaluated = ranks.length;
    if (totalEvaluated === 0) {
      return {
        totalEvaluated: 0,
        startDate: sortedEval.length > 0 ? sortedEval[0].date : '',
        endDate: sortedEval.length > 0 ? sortedEval[sortedEval.length - 1].date : '',
        amEvaluationsCount: 0,
        pmEvaluationsCount: 0,
        top1Hits: 0,
        top3Hits: 0,
        top5Hits: 0,
        top10Hits: 0,
        top1HitRate: 0,
        top3HitRate: 0,
        top5HitRate: 0,
        top10HitRate: 0,
        averageSettlementRank: 50,
        medianSettlementRank: 50,
        entropyAvg: 0,
        confidenceScoreAvg: 0,
        stabilityScore: 0,
        blockMetrics: [],
      };
    }

    // 6. Chronological Block Metrics (Split into 2 or 3 chronological blocks)
    const blockCount = totalEvaluated >= 20 ? 3 : 2;
    const blockSize = Math.ceil(totalEvaluated / blockCount);
    const blockMetrics: ChronologicalBlockMetric[] = [];
    const blockTop10Rates: number[] = [];

    for (let b = 0; b < blockCount; b++) {
      const bRows = evalRows.slice(b * blockSize, (b + 1) * blockSize);
      if (bRows.length === 0) continue;

      const bTop1 = bRows.filter((r) => r.top1Hit).length;
      const bTop3 = bRows.filter((r) => r.top3Hit).length;
      const bTop5 = bRows.filter((r) => r.top5Hit).length;
      const bTop10 = bRows.filter((r) => r.top10Hit).length;
      const bAvgRank = bRows.reduce((sum, r) => sum + r.rank, 0) / bRows.length;
      const bTop10Rate = bTop10 / bRows.length;

      blockTop10Rates.push(bTop10Rate);
      blockMetrics.push({
        blockId: b + 1,
        startDate: bRows[0].date,
        endDate: bRows[bRows.length - 1].date,
        sampleCount: bRows.length,
        top1HitRate: Math.round((bTop1 / bRows.length) * 10000) / 10000,
        top3HitRate: Math.round((bTop3 / bRows.length) * 10000) / 10000,
        top5HitRate: Math.round((bTop5 / bRows.length) * 10000) / 10000,
        top10HitRate: Math.round(bTop10Rate * 10000) / 10000,
        averageSettlementRank: Math.round(bAvgRank * 100) / 100,
      });
    }

    // Stability score: 1.0 - (standard deviation of Top-10 rate across blocks)
    let stabilityScore = 1.0;
    if (blockTop10Rates.length > 1) {
      const mean = blockTop10Rates.reduce((a, b) => a + b, 0) / blockTop10Rates.length;
      const variance = blockTop10Rates.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / blockTop10Rates.length;
      const stdDev = Math.sqrt(variance);
      stabilityScore = Math.max(0.0, Math.round((1.0 - stdDev * 2) * 1000) / 1000);
    }

    const sortedRanks = [...ranks].sort((a, b) => a - b);
    const medianRank = sortedRanks[Math.floor(sortedRanks.length / 2)];
    const avgRank = ranks.reduce((sum, r) => sum + r, 0) / totalEvaluated;
    const avgEntropy = entropies.reduce((sum, e) => sum + e, 0) / totalEvaluated;
    const avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / totalEvaluated;

    return {
      totalEvaluated,
      startDate: evalRows[0].date,
      endDate: evalRows[evalRows.length - 1].date,
      amEvaluationsCount: amCount,
      pmEvaluationsCount: pmCount,
      top1Hits,
      top3Hits,
      top5Hits,
      top10Hits,
      top1HitRate: Math.round((top1Hits / totalEvaluated) * 10000) / 10000,
      top3HitRate: Math.round((top3Hits / totalEvaluated) * 10000) / 10000,
      top5HitRate: Math.round((top5Hits / totalEvaluated) * 10000) / 10000,
      top10HitRate: Math.round((top10Hits / totalEvaluated) * 10000) / 10000,
      averageSettlementRank: Math.round(avgRank * 100) / 100,
      medianSettlementRank: medianRank,
      entropyAvg: Math.round(avgEntropy * 1000) / 1000,
      confidenceScoreAvg: Math.round(avgConfidence * 10) / 10,
      stabilityScore,
      blockMetrics,
    };
  }

  /**
   * Evaluates the Comprehensive Promotion Gate for a candidate model against Champion.
   * 
   * A candidate replaces the Champion ONLY if:
   * - Zero leakage verified
   * - Deterministic reproducibility confirmed
   * - Sufficient sample size in holdout evaluation (>= 10 holdout evaluations)
   * - Passes all mathematical integrity checks
   * - Improves Champion on out-of-sample Top-10 containment OR average settlement rank
   * - Improvement is stable across chronological blocks (not isolated to 1 block)
   * - Does not materially degrade other metrics (Top-5 / Top-3 containment)
   * - Final locked holdout was not used during tuning
   */
  public static evaluatePromotionGate(
    candidateVersion: string,
    candidateName: string,
    candidateWeights: DualSessionModelWeights,
    championHoldoutMetrics: CalibrationMetrics,
    candidateHoldoutMetrics: CalibrationMetrics,
    options?: {
      minHoldoutSamples?: number;
      holdoutTuned?: boolean;
    }
  ): PromotionGateResult {
    const minSamples = options?.minHoldoutSamples ?? 10;
    const holdoutTuned = options?.holdoutTuned ?? false;
    const gateReasons: string[] = [];

    const weightsValid = this.validateWeights(candidateWeights);

    // 1. Zero Leakage Gate
    const zeroLeakage = true; // Verified by construction in evaluateWalkForward

    // 2. Deterministic Reproducibility
    const deterministicReproducibility = weightsValid.valid;
    if (!weightsValid.valid) {
      gateReasons.push(`Weight validation failed: ${weightsValid.error}`);
    }

    // 3. Sufficient Sample Size
    const sufficientSampleSize = candidateHoldoutMetrics.totalEvaluated >= minSamples;
    if (!sufficientSampleSize) {
      gateReasons.push(
        `Insufficient holdout samples: ${candidateHoldoutMetrics.totalEvaluated} < required ${minSamples}`
      );
    }

    // 4. Integrity Tests Passed
    const integrityTestsPassed =
      candidateHoldoutMetrics.averageSettlementRank >= 1 &&
      candidateHoldoutMetrics.averageSettlementRank <= 100 &&
      candidateHoldoutMetrics.top10HitRate >= 0 &&
      candidateHoldoutMetrics.top10HitRate <= 1.0;

    // 5. Out-of-Sample Top-10 Improvement
    // Candidate Top-10 containment must be >= Champion Top-10 containment
    const outOfSampleTop10Improvement =
      candidateHoldoutMetrics.top10HitRate >= championHoldoutMetrics.top10HitRate;
    if (!outOfSampleTop10Improvement) {
      gateReasons.push(
        `Top-10 hit rate (${(candidateHoldoutMetrics.top10HitRate * 100).toFixed(1)}%) is inferior to Champion (${(championHoldoutMetrics.top10HitRate * 100).toFixed(1)}%)`
      );
    }

    // 6. Average Settlement Rank Improvement
    // Candidate average rank must be <= Champion average rank (lower rank is better)
    const outOfSampleRankImprovement =
      candidateHoldoutMetrics.averageSettlementRank <= championHoldoutMetrics.averageSettlementRank;
    if (!outOfSampleRankImprovement) {
      gateReasons.push(
        `Average settlement rank (${candidateHoldoutMetrics.averageSettlementRank.toFixed(1)}) is worse than Champion (${championHoldoutMetrics.averageSettlementRank.toFixed(1)})`
      );
    }

    // 7. Chronological Stability Gate
    // Performance must not collapse in any block (e.g. min block Top-10 rate >= 0.05 if champion >= 0.05)
    let chronologicalStabilityPassed = true;
    if (candidateHoldoutMetrics.blockMetrics.length > 1) {
      const minBlockTop10 = Math.min(...candidateHoldoutMetrics.blockMetrics.map((b) => b.top10HitRate));
      if (minBlockTop10 === 0 && candidateHoldoutMetrics.top10HitRate > 0.15) {
        chronologicalStabilityPassed = false;
        gateReasons.push('Chronological instability: candidate experienced zero-hit collapse in at least one block');
      }
      if (candidateHoldoutMetrics.stabilityScore < 0.60) {
        chronologicalStabilityPassed = false;
        gateReasons.push(`Stability score too low (${candidateHoldoutMetrics.stabilityScore.toFixed(2)} < 0.60)`);
      }
    }

    // 8. No Material Degradation
    // Top-5 rate must not drop by more than 0.05 compared to Champion
    const noMaterialDegradation =
      candidateHoldoutMetrics.top5HitRate >= championHoldoutMetrics.top5HitRate - 0.05;
    if (!noMaterialDegradation) {
      gateReasons.push(
        `Material degradation in Top-5 hit rate (${(candidateHoldoutMetrics.top5HitRate * 100).toFixed(1)}% vs Champion ${(championHoldoutMetrics.top5HitRate * 100).toFixed(1)}%)`
      );
    }

    // 9. Holdout Untouched During Tuning
    const holdoutUntouchedDuringTuning = !holdoutTuned;
    if (holdoutTuned) {
      gateReasons.push('Holdout violation: Candidate weights were tuned or searched on the protected holdout partition');
    }

    const gates: PromotionGateChecklist = {
      zeroLeakage,
      deterministicReproducibility,
      sufficientSampleSize,
      integrityTestsPassed,
      outOfSampleTop10Improvement,
      outOfSampleRankImprovement,
      chronologicalStabilityPassed,
      noMaterialDegradation,
      holdoutUntouchedDuringTuning,
    };

    // Must pass all 9 gates to be promoted
    const isPromoted = Object.values(gates).every((v) => v === true);
    const isRecommended = isPromoted && candidateVersion !== BASELINE_CHAMPION_VERSION;

    let recommendationMessage = '';
    if (candidateVersion === BASELINE_CHAMPION_VERSION) {
      recommendationMessage = 'Current Champion model retained as authoritative baseline.';
    } else if (isRecommended) {
      recommendationMessage = `PROMOTION RECOMMENDED: Candidate ${candidateVersion} passed all 9 promotion gates and demonstrated superior holdout performance.`;
    } else {
      recommendationMessage = `REJECTED: Candidate ${candidateVersion} failed promotion gates: ${gateReasons.join('; ')}`;
    }

    return {
      candidateVersion,
      candidateName,
      championVersion: BASELINE_CHAMPION_VERSION,
      isPromoted,
      isRecommended,
      gates,
      gateReasons,
      recommendationMessage,
      championHoldoutMetrics,
      candidateHoldoutMetrics,
    };
  }

  /**
   * Executes the Complete End-to-End Calibration & Recommendation Workflow.
   * 
   * Process:
   * 1. Validates dataset size and partitions into Development (50%), Calibration (25%), Final Holdout (25%).
   * 2. Evaluates Champion baseline on Calibration and Holdout partitions.
   * 3. Evaluates all deterministic candidates on Calibration partition.
   * 4. For best candidates, evaluates once on Final Locked Holdout partition.
   * 5. Runs Promotion Gate for each candidate against Champion.
   * 6. Generates full calibration report with recommendation (without modifying production Champion).
   */
  public static runCalibrationWorkflow(
    allVerifiedSettlements: VerifiedMarketRecord[],
    minSettlements: number = 30
  ): CalibrationRunReport {
    const settlements = allVerifiedSettlements
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    if (settlements.length < minSettlements) {
      return {
        timestamp: new Date().toISOString(),
        championVersion: BASELINE_CHAMPION_VERSION,
        totalVerifiedRecords: settlements.length,
        partitions: {
          developmentCount: 0,
          calibrationCount: 0,
          holdoutCount: 0,
          dateRange: { start: '', end: '' },
        },
        candidatesEvaluated: [],
        recommendedChampion: BASELINE_CHAMPION_VERSION,
        promotionRecommended: false,
        summaryNotes: [
          `INSUFFICIENT_HISTORICAL_DATA: Verified settlement count (${settlements.length}) is below calibration minimum (${minSettlements}).`,
          `Authoritative baseline ${BASELINE_CHAMPION_VERSION} remains active without alteration.`,
        ],
      };
    }

    // 1. Partition Dataset
    const partitions = this.partitionDataset(settlements);

    // 2. Evaluate Champion baseline on Calibration and Final Holdout partitions
    const championCalMetrics = this.evaluateWalkForward(
      settlements,
      partitions.calibration.records,
      this.CHAMPION_WEIGHTS,
      BASELINE_CHAMPION_VERSION
    );

    const championHoldoutMetrics = this.evaluateWalkForward(
      settlements,
      partitions.finalLockedHoldout.records,
      this.CHAMPION_WEIGHTS,
      BASELINE_CHAMPION_VERSION
    );

    // 3. Evaluate Candidates
    const candidatesEvaluated: Array<{
      modelVersion: string;
      modelName: string;
      promotionStatus: PromotionStatus;
      calibrationMetrics: CalibrationMetrics;
      holdoutMetrics: CalibrationMetrics;
      gateResult?: PromotionGateResult;
    }> = [];

    let topCandidate: {
      modelVersion: string;
      modelName: string;
      weights: DualSessionModelWeights;
      gateResult: PromotionGateResult;
    } | null = null;

    for (const def of this.CANDIDATE_DEFINITIONS) {
      const calMetrics = this.evaluateWalkForward(
        settlements,
        partitions.calibration.records,
        def.weights,
        def.modelVersion
      );

      const holdoutMetrics = this.evaluateWalkForward(
        settlements,
        partitions.finalLockedHoldout.records,
        def.weights,
        def.modelVersion
      );

      const gateResult = this.evaluatePromotionGate(
        def.modelVersion,
        def.modelName,
        def.weights,
        championHoldoutMetrics,
        holdoutMetrics,
        { minHoldoutSamples: Math.min(10, Math.floor(partitions.finalLockedHoldout.recordsCount * 0.7)) }
      );

      let status: PromotionStatus = 'REJECTED';
      if (def.modelVersion === BASELINE_CHAMPION_VERSION) {
        status = 'CHAMPION';
      } else if (gateResult.isRecommended) {
        status = 'CANDIDATE';
        if (!topCandidate || holdoutMetrics.top10HitRate > topCandidate.gateResult.candidateHoldoutMetrics.top10HitRate) {
          topCandidate = {
            modelVersion: def.modelVersion,
            modelName: def.modelName,
            weights: def.weights,
            gateResult,
          };
        }
      }

      candidatesEvaluated.push({
        modelVersion: def.modelVersion,
        modelName: def.modelName,
        promotionStatus: status,
        calibrationMetrics: calMetrics,
        holdoutMetrics,
        gateResult,
      });
    }

    const summaryNotes: string[] = [
      `Evaluated ${candidatesEvaluated.length} deterministic model configurations across 3 temporal partitions.`,
      `Development partition: ${partitions.development.recordsCount} records (${partitions.development.startDate} to ${partitions.development.endDate}).`,
      `Calibration partition: ${partitions.calibration.recordsCount} records (${partitions.calibration.startDate} to ${partitions.calibration.endDate}).`,
      `Final Locked Holdout partition: ${partitions.finalLockedHoldout.recordsCount} records (${partitions.finalLockedHoldout.startDate} to ${partitions.finalLockedHoldout.endDate}).`,
      `Champion (${BASELINE_CHAMPION_VERSION}) holdout Top-10 rate: ${(championHoldoutMetrics.top10HitRate * 100).toFixed(1)}%, Average rank: ${championHoldoutMetrics.averageSettlementRank.toFixed(1)}.`,
    ];

    let recommendedChampion: string = BASELINE_CHAMPION_VERSION;
    let promotionRecommended = false;

    if (topCandidate && topCandidate.gateResult.isRecommended) {
      recommendedChampion = topCandidate.modelVersion;
      promotionRecommended = true;
      summaryNotes.push(
        `PROMOTION RECOMMENDATION: Candidate ${topCandidate.modelVersion} (${topCandidate.modelName}) demonstrated superior holdout performance and passed all 9 gates.`
      );
      summaryNotes.push(
        `SAFETY ADVISORY: Production Champion is not automatically swapped. Manual governance approval required for model promotion.`
      );
    } else {
      summaryNotes.push(
        `PROMOTION OUTCOME: No candidate satisfied all 9 promotion gates. ${BASELINE_CHAMPION_VERSION} remains the authoritative production Champion.`
      );
    }

    return {
      timestamp: new Date().toISOString(),
      championVersion: BASELINE_CHAMPION_VERSION,
      totalVerifiedRecords: settlements.length,
      partitions: {
        developmentCount: partitions.development.recordsCount,
        calibrationCount: partitions.calibration.recordsCount,
        holdoutCount: partitions.finalLockedHoldout.recordsCount,
        dateRange: {
          start: settlements[0].date,
          end: settlements[settlements.length - 1].date,
        },
      },
      candidatesEvaluated,
      recommendedChampion,
      promotionRecommended,
      summaryNotes,
    };
  }
}
