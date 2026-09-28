import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  PREDICTION_CUTOFFS,
  BacktestEvaluationRow,
  BacktestSummaryReport,
  PRODUCTION_MODEL_VERSION,
  PredictionModelVersion,
} from '../../types/prediction';
import {
  AutoWeightingConfig,
  DEFAULT_AUTO_WEIGHTING_CONFIG,
  EnsembleBacktestEvaluationRow,
  EnsembleBacktestSummaryReport,
} from '../../types/autoWeighting';
import { FeatureEngine } from './featureEngine';
import { PredictionEngine } from './predictionEngine';
import { AutoWeightingEngine, AUTO_WEIGHTED_ENSEMBLE_VERSION } from './autoWeightingEngine';

export class DataLeakageError extends Error {
  constructor(message: string) {
    super(`[DATA_LEAKAGE_VIOLATION] ${message}`);
    this.name = 'DataLeakageError';
  }
}

/**
 * Walk-Forward Backtesting Engine
 * Performs honest out-of-sample temporal evaluation on historical datasets.
 * 
 * Strict Invariant: For every evaluation at target date T and session S,
 * feature extraction ONLY has access to records strictly before T (for AM)
 * or records before T + today's AM settlement (for PM).
 */
export class BacktestEngine {
  /**
   * Runs a complete Walk-Forward Temporal Backtest across a verified historical dataset.
   * @param allVerifiedRecords All verified historical market records
   * @param minTrainingSettlements Minimum historical settlement records required before first evaluation (default 30)
   * @param limitEvaluations Optional cap on evaluations for fast diagnostics
   * @param modelVersion Model identifier (defaults to PRODUCTION_MODEL_VERSION = ALL_TIME_FREQUENCY_V1)
   */
  public static runWalkForwardBacktest(
    allVerifiedRecords: VerifiedMarketRecord[],
    minTrainingSettlements: number = 30,
    limitEvaluations?: number,
    modelVersion: PredictionModelVersion = PRODUCTION_MODEL_VERSION
  ): BacktestSummaryReport {
    // 1. Group verified settlement records chronologically
    const allSettlements = allVerifiedRecords
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    if (allSettlements.length < minTrainingSettlements + 1) {
      return {
        modelVersion,
        totalEvaluated: 0,
        startDate: '',
        endDate: '',
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
        averageEntropy: 0,
        averageConfidence: 0,
        evaluations: [],
      };
    }

    const evaluations: BacktestEvaluationRow[] = [];

    // Identify unique target dates starting after min training samples
    const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();

    let evaluatedCount = 0;

    for (const targetDate of uniqueDates) {
      if (limitEvaluations && evaluatedCount >= limitEvaluations) break;

      const dateSettlements = allSettlements.filter((r) => r.date === targetDate);
      const amSettle = dateSettlements.find((r) => r.session === 'AM');
      const pmSettle = dateSettlements.find((r) => r.session === 'PM');

      // Check available history prior to this date for session-isolated training
      const priorAmSettlements = allSettlements.filter((r) => r.date < targetDate && r.session === 'AM');
      const priorPmSettlements = allSettlements.filter((r) => r.date < targetDate && r.session === 'PM');
      if (priorAmSettlements.length < minTrainingSettlements && priorPmSettlements.length < minTrainingSettlements) {
        continue; // Accumulate historical training context
      }

      // --- EVALUATE AM SESSION ---
      if (amSettle && priorAmSettlements.length >= minTrainingSettlements) {
        // LEAKAGE CHECK: AM feature extraction MUST NOT contain amSettle or PM historical data
        const amFeatureRes = FeatureEngine.extractFeatures(allVerifiedRecords, targetDate, 'AM');

        if (amFeatureRes.success && amFeatureRes.featureVector) {
          // Double verify no future, same-day AM settlement, or PM settlements leaked into feature vector
          if (amFeatureRes.featureVector.distributions.sampleCountAllTime !== priorAmSettlements.length) {
            throw new DataLeakageError(
              `AM Backtest sample count mismatch on ${targetDate}. Expected strictly ${priorAmSettlements.length} prior settlements, found ${amFeatureRes.featureVector.distributions.sampleCountAllTime}.`
            );
          }

          const amPred = PredictionEngine.generatePrediction(amFeatureRes.featureVector, modelVersion, allVerifiedRecords);
          const actual2D = amSettle.twod;
          const candidateRank = amPred.candidates.findIndex((c) => c.twod === actual2D) + 1;
          const candidateProb = amPred.candidates.find((c) => c.twod === actual2D)?.probability || 0;

          evaluations.push({
            date: targetDate,
            session: 'AM',
            modelVersion,
            actualSettlement2D: actual2D,
            predictedTop1: amPred.top1,
            predictedTop3: amPred.top3,
            predictedTop5: amPred.top5,
            predictedTop10: amPred.top10,
            isTop1Hit: amPred.top1 === actual2D,
            isTop3Hit: amPred.top3.includes(actual2D),
            isTop5Hit: amPred.top5.includes(actual2D),
            isTop10Hit: amPred.top10.includes(actual2D),
            actual2DRank: candidateRank,
            actual2DProbability: candidateProb,
            entropy: amPred.entropy,
            confidenceScore: amPred.confidenceScore,
            featureIntegrityHash: amPred.featureIntegrityHash,
            trainingSamplesCount: priorAmSettlements.length,
          });

          evaluatedCount++;
          if (limitEvaluations && evaluatedCount >= limitEvaluations) break;
        }
      }

      // --- EVALUATE PM SESSION ---
      if (pmSettle && priorPmSettlements.length >= minTrainingSettlements) {
        // LEAKAGE CHECK: PM feature extraction may include AM settle, but NEVER pmSettle
        const pmFeatureRes = FeatureEngine.extractFeatures(allVerifiedRecords, targetDate, 'PM');

        if (pmFeatureRes.success && pmFeatureRes.featureVector) {
          if (pmFeatureRes.featureVector.distributions.sampleCountAllTime !== priorPmSettlements.length) {
            throw new DataLeakageError(
              `PM Backtest sample count mismatch on ${targetDate}. Expected ${priorPmSettlements.length} prior settlements, found ${pmFeatureRes.featureVector.distributions.sampleCountAllTime}.`
            );
          }

          const pmPred = PredictionEngine.generatePrediction(pmFeatureRes.featureVector, modelVersion, allVerifiedRecords);
          const actual2D = pmSettle.twod;
          const candidateRank = pmPred.candidates.findIndex((c) => c.twod === actual2D) + 1;
          const candidateProb = pmPred.candidates.find((c) => c.twod === actual2D)?.probability || 0;

          evaluations.push({
            date: targetDate,
            session: 'PM',
            modelVersion,
            actualSettlement2D: actual2D,
            predictedTop1: pmPred.top1,
            predictedTop3: pmPred.top3,
            predictedTop5: pmPred.top5,
            predictedTop10: pmPred.top10,
            isTop1Hit: pmPred.top1 === actual2D,
            isTop3Hit: pmPred.top3.includes(actual2D),
            isTop5Hit: pmPred.top5.includes(actual2D),
            isTop10Hit: pmPred.top10.includes(actual2D),
            actual2DRank: candidateRank,
            actual2DProbability: candidateProb,
            entropy: pmPred.entropy,
            confidenceScore: pmPred.confidenceScore,
            featureIntegrityHash: pmPred.featureIntegrityHash,
            trainingSamplesCount: priorPmSettlements.length,
          });

          evaluatedCount++;
        }
      }
    }

    if (evaluations.length === 0) {
      return {
        modelVersion,
        totalEvaluated: 0,
        startDate: '',
        endDate: '',
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
        averageEntropy: 0,
        averageConfidence: 0,
        evaluations: [],
      };
    }

    const totalEvaluated = evaluations.length;
    const amCount = evaluations.filter((e) => e.session === 'AM').length;
    const pmCount = evaluations.filter((e) => e.session === 'PM').length;

    const top1Hits = evaluations.filter((e) => e.isTop1Hit).length;
    const top3Hits = evaluations.filter((e) => e.isTop3Hit).length;
    const top5Hits = evaluations.filter((e) => e.isTop5Hit).length;
    const top10Hits = evaluations.filter((e) => e.isTop10Hit).length;

    const top1HitRate = Math.round((top1Hits / totalEvaluated) * 10000) / 10000;
    const top3HitRate = Math.round((top3Hits / totalEvaluated) * 10000) / 10000;
    const top5HitRate = Math.round((top5Hits / totalEvaluated) * 10000) / 10000;
    const top10HitRate = Math.round((top10Hits / totalEvaluated) * 10000) / 10000;

    const avgEntropy = Math.round((evaluations.reduce((acc, e) => acc + e.entropy, 0) / totalEvaluated) * 1000) / 1000;
    const avgConfidence = Math.round((evaluations.reduce((acc, e) => acc + e.confidenceScore, 0) / totalEvaluated) * 10) / 10;

    return {
      modelVersion,
      totalEvaluated,
      startDate: evaluations[0].date,
      endDate: evaluations[evaluations.length - 1].date,
      amEvaluationsCount: amCount,
      pmEvaluationsCount: pmCount,
      top1Hits,
      top3Hits,
      top5Hits,
      top10Hits,
      top1HitRate,
      top3HitRate,
      top5HitRate,
      top10HitRate,
      averageEntropy: avgEntropy,
      averageConfidence: avgConfidence,
      evaluations,
    };
  }

  /**
   * Runs an honest Walk-Forward Backtest for AUTO_WEIGHTED_ENSEMBLE_V1.
   * 
   * For every historical evaluation date D:
   * 1. Reconstructs point-in-time model weights using only out-of-sample evaluations strictly before D.
   * 2. Evaluates candidate models on point-in-time features.
   * 3. Blends candidate models using frozen weights.
   * 4. Evaluates ensemble against actual settlement only after prediction generation.
   * 5. Preserves complete candidate distributions, weights, actual result, and loss metrics.
   */
  public static runAutoWeightedEnsembleBacktest(
    allVerifiedRecords: VerifiedMarketRecord[],
    minTrainingSettlements: number = 30,
    limitEvaluations?: number,
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): EnsembleBacktestSummaryReport {
    const allSettlements = allVerifiedRecords
      .filter((r) => r.isSettlement)
      .sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });

    if (allSettlements.length < minTrainingSettlements + 1) {
      return {
        ensembleVersion: AUTO_WEIGHTED_ENSEMBLE_VERSION,
        totalEvaluated: 0,
        startDate: '',
        endDate: '',
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
        averageLogLoss: 0,
        averageBrierScore: 0,
        averageEntropy: 0,
        averageConfidence: 0,
        evaluations: [],
      };
    }

    const evaluations: EnsembleBacktestEvaluationRow[] = [];
    const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();
    let evaluatedCount = 0;

    for (const targetDate of uniqueDates) {
      if (limitEvaluations && evaluatedCount >= limitEvaluations) break;

      const priorAmSettlements = allSettlements.filter((r) => r.session === 'AM' && r.date < targetDate);
      const priorPmSettlements = allSettlements.filter((r) => r.session === 'PM' && r.date < targetDate);

      const amSettle = allSettlements.find((r) => r.session === 'AM' && r.date === targetDate);
      const pmSettle = allSettlements.find((r) => r.session === 'PM' && r.date === targetDate);

      // --- EVALUATE AM SESSION ---
      if (amSettle && priorAmSettlements.length >= minTrainingSettlements) {
        const amFeatureRes = FeatureEngine.extractFeatures(allVerifiedRecords, targetDate, 'AM');

        if (amFeatureRes.success && amFeatureRes.featureVector) {
          if (amFeatureRes.featureVector.distributions.sampleCountAllTime !== priorAmSettlements.length) {
            throw new DataLeakageError(
              `AM Backtest sample count mismatch on ${targetDate}. Expected ${priorAmSettlements.length}, found ${amFeatureRes.featureVector.distributions.sampleCountAllTime}.`
            );
          }

          const ensembleOut = AutoWeightingEngine.evaluateEnsemble(
            amFeatureRes.featureVector,
            allVerifiedRecords,
            config
          );

          const actual2D = amSettle.twod;
          const candidateRank = ensembleOut.candidates.findIndex((c) => c.twod === actual2D) + 1;
          const candidateProb = ensembleOut.candidates.find((c) => c.twod === actual2D)?.probability || 0;
          const logLoss = AutoWeightingEngine.computeLogLoss(ensembleOut.probabilities, actual2D, config.epsilon);
          const brierScore = AutoWeightingEngine.computeBrierScore(ensembleOut.probabilities, actual2D);

          const modelDistributions: Record<string, { top1: string; top5: string[]; actualProb: number }> = {};
          for (const contrib of ensembleOut.modelContributions) {
            const actualIdx = parseInt(actual2D, 10);
            modelDistributions[contrib.modelId] = {
              top1: contrib.top1,
              top5: contrib.top5,
              actualProb: contrib.probabilities[actualIdx] || 0,
            };
          }

          evaluations.push({
            date: targetDate,
            session: 'AM',
            actualSettlement2D: actual2D,
            predictedTop1: ensembleOut.top1,
            predictedTop3: ensembleOut.top3,
            predictedTop5: ensembleOut.top5,
            predictedTop10: ensembleOut.top10,
            isTop1Hit: ensembleOut.top1 === actual2D,
            isTop3Hit: ensembleOut.top3.includes(actual2D),
            isTop5Hit: ensembleOut.top5.includes(actual2D),
            isTop10Hit: ensembleOut.top10.includes(actual2D),
            actual2DRank: candidateRank,
            actual2DProbability: candidateProb,
            logLoss,
            brierScore,
            entropy: ensembleOut.entropy,
            confidenceScore: ensembleOut.confidenceScore,
            modelWeights: ensembleOut.modelWeights,
            modelDistributions,
            historicalEvidenceCount: ensembleOut.performanceEvidenceCount,
            featureIntegrityHash: ensembleOut.inputIntegrityHash,
            ensembleProbabilityHash: ensembleOut.ensembleProbabilityHash,
          });

          evaluatedCount++;
          if (limitEvaluations && evaluatedCount >= limitEvaluations) break;
        }
      }

      // --- EVALUATE PM SESSION ---
      if (pmSettle && priorPmSettlements.length >= minTrainingSettlements) {
        const pmFeatureRes = FeatureEngine.extractFeatures(allVerifiedRecords, targetDate, 'PM');

        if (pmFeatureRes.success && pmFeatureRes.featureVector) {
          if (pmFeatureRes.featureVector.distributions.sampleCountAllTime !== priorPmSettlements.length) {
            throw new DataLeakageError(
              `PM Backtest sample count mismatch on ${targetDate}. Expected ${priorPmSettlements.length}, found ${pmFeatureRes.featureVector.distributions.sampleCountAllTime}.`
            );
          }

          const ensembleOut = AutoWeightingEngine.evaluateEnsemble(
            pmFeatureRes.featureVector,
            allVerifiedRecords,
            config
          );

          const actual2D = pmSettle.twod;
          const candidateRank = ensembleOut.candidates.findIndex((c) => c.twod === actual2D) + 1;
          const candidateProb = ensembleOut.candidates.find((c) => c.twod === actual2D)?.probability || 0;
          const logLoss = AutoWeightingEngine.computeLogLoss(ensembleOut.probabilities, actual2D, config.epsilon);
          const brierScore = AutoWeightingEngine.computeBrierScore(ensembleOut.probabilities, actual2D);

          const modelDistributions: Record<string, { top1: string; top5: string[]; actualProb: number }> = {};
          for (const contrib of ensembleOut.modelContributions) {
            const actualIdx = parseInt(actual2D, 10);
            modelDistributions[contrib.modelId] = {
              top1: contrib.top1,
              top5: contrib.top5,
              actualProb: contrib.probabilities[actualIdx] || 0,
            };
          }

          evaluations.push({
            date: targetDate,
            session: 'PM',
            actualSettlement2D: actual2D,
            predictedTop1: ensembleOut.top1,
            predictedTop3: ensembleOut.top3,
            predictedTop5: ensembleOut.top5,
            predictedTop10: ensembleOut.top10,
            isTop1Hit: ensembleOut.top1 === actual2D,
            isTop3Hit: ensembleOut.top3.includes(actual2D),
            isTop5Hit: ensembleOut.top5.includes(actual2D),
            isTop10Hit: ensembleOut.top10.includes(actual2D),
            actual2DRank: candidateRank,
            actual2DProbability: candidateProb,
            logLoss,
            brierScore,
            entropy: ensembleOut.entropy,
            confidenceScore: ensembleOut.confidenceScore,
            modelWeights: ensembleOut.modelWeights,
            modelDistributions,
            historicalEvidenceCount: ensembleOut.performanceEvidenceCount,
            featureIntegrityHash: ensembleOut.inputIntegrityHash,
            ensembleProbabilityHash: ensembleOut.ensembleProbabilityHash,
          });

          evaluatedCount++;
        }
      }
    }

    if (evaluations.length === 0) {
      return {
        ensembleVersion: AUTO_WEIGHTED_ENSEMBLE_VERSION,
        totalEvaluated: 0,
        startDate: '',
        endDate: '',
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
        averageLogLoss: 0,
        averageBrierScore: 0,
        averageEntropy: 0,
        averageConfidence: 0,
        evaluations: [],
      };
    }

    const totalEvaluated = evaluations.length;
    const amCount = evaluations.filter((e) => e.session === 'AM').length;
    const pmCount = evaluations.filter((e) => e.session === 'PM').length;

    const top1Hits = evaluations.filter((e) => e.isTop1Hit).length;
    const top3Hits = evaluations.filter((e) => e.isTop3Hit).length;
    const top5Hits = evaluations.filter((e) => e.isTop5Hit).length;
    const top10Hits = evaluations.filter((e) => e.isTop10Hit).length;

    const top1HitRate = Math.round((top1Hits / totalEvaluated) * 10000) / 10000;
    const top3HitRate = Math.round((top3Hits / totalEvaluated) * 10000) / 10000;
    const top5HitRate = Math.round((top5Hits / totalEvaluated) * 10000) / 10000;
    const top10HitRate = Math.round((top10Hits / totalEvaluated) * 10000) / 10000;

    const avgLogLoss = Math.round((evaluations.reduce((acc, e) => acc + e.logLoss, 0) / totalEvaluated) * 10000) / 10000;
    const avgBrier = Math.round((evaluations.reduce((acc, e) => acc + e.brierScore, 0) / totalEvaluated) * 10000) / 10000;
    const avgEntropy = Math.round((evaluations.reduce((acc, e) => acc + e.entropy, 0) / totalEvaluated) * 1000) / 1000;
    const avgConfidence = Math.round((evaluations.reduce((acc, e) => acc + e.confidenceScore, 0) / totalEvaluated) * 10) / 10;

    return {
      ensembleVersion: AUTO_WEIGHTED_ENSEMBLE_VERSION,
      totalEvaluated,
      startDate: evaluations[0].date,
      endDate: evaluations[evaluations.length - 1].date,
      amEvaluationsCount: amCount,
      pmEvaluationsCount: pmCount,
      top1Hits,
      top3Hits,
      top5Hits,
      top10Hits,
      top1HitRate,
      top3HitRate,
      top5HitRate,
      top10HitRate,
      averageLogLoss: avgLogLoss,
      averageBrierScore: avgBrier,
      averageEntropy: avgEntropy,
      averageConfidence: avgConfidence,
      evaluations,
    };
  }
}
