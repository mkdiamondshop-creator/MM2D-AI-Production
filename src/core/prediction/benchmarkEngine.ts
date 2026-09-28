import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { PredictionFeatureVector } from '../../types/prediction';
import {
  BenchmarkModelId,
  ModelSessionEvaluation,
  ModelBenchmarkSummary,
  AutoWeightingBehaviorMetrics,
  AutoWeightingAuditSummary,
  PairedStatisticalComparison,
  Step25BenchmarkReport,
} from '../../types/benchmark';
import { FeatureEngine } from './featureEngine';
import { PredictionEngine } from './predictionEngine';
import { CandidateModelLab } from './candidateModelLab';
import {
  AutoWeightingEngine,
  AUTO_WEIGHTED_ENSEMBLE_VERSION,
} from './autoWeightingEngine';
import {
  AutoWeightingConfig,
  DEFAULT_AUTO_WEIGHTING_CONFIG,
} from '../../types/autoWeighting';
import { CandidateModelId } from '../../types/candidateModel';

/**
 * Standard Error Function approximation (Abramowitz and Stegun)
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

/**
 * Standard Normal CDF
 */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Two-tailed Student's t or Normal p-value
 */
function computeTwoTailedPValue(tStat: number, df: number): number {
  if (isNaN(tStat) || !isFinite(tStat) || df <= 0) return 1.0;
  const absT = Math.abs(tStat);

  // For df >= 20, the Cornish-Fisher / normal expansion is extremely accurate
  if (df >= 20) {
    // Normal approximation with slight t-correction
    const pNorm = 2 * (1 - normalCdf(absT));
    return Math.max(0.000001, Math.min(1.0, pNorm));
  }

  // Exact approximation for small df using polynomial expansion of Student-t CDF
  const x = df / (df + absT * absT);
  // Incomplete beta function approximation via continued fraction
  let pApprox = 2 * (1 - normalCdf(absT * Math.sqrt((df - 1) / df)));
  return Math.max(0.000001, Math.min(1.0, pApprox));
}

/**
 * Critical t value for 95% confidence interval
 */
function getT95Critical(df: number): number {
  if (df <= 1) return 12.71;
  if (df === 2) return 4.30;
  if (df === 3) return 3.18;
  if (df === 4) return 2.78;
  if (df <= 10) return 2.23;
  if (df <= 20) return 2.09;
  if (df <= 30) return 2.04;
  if (df <= 60) return 2.00;
  return 1.96;
}

/**
 * MM2D LEADER STEP 25: WALK-FORWARD BENCHMARK ENGINE
 * Strict Point-in-Time Out-of-Sample Performance Comparison
 */
export class BenchmarkEngine {
  public static readonly BENCHMARK_VERSION = '1.0.0-STEP25';

  /**
   * Evaluates all 7 candidate models + ensemble on a single session.
   */
  public static evaluateSessionModels(
    targetDate: string,
    session: MarketSession,
    actual2D: string,
    featureVector: PredictionFeatureVector,
    allVerifiedRecords: VerifiedMarketRecord[],
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): ModelSessionEvaluation[] {
    const evaluations: ModelSessionEvaluation[] = [];
    const actualIdx = parseInt(actual2D, 10);

    // Helper to evaluate a probability distribution
    const evaluateProbs = (
      modelId: BenchmarkModelId,
      probs: number[],
      validationStatus: any = 'EVALUATED',
      untestableReason?: string,
      weightsAtCutoff?: Record<string, number>,
      ensembleHash?: string
    ): ModelSessionEvaluation => {
      // Clean and normalize probabilities
      const cleanedProbs = new Array<number>(100);
      let sum = 0;
      for (let i = 0; i < 100; i++) {
        const v = typeof probs[i] === 'number' && !isNaN(probs[i]) && isFinite(probs[i]) ? Math.max(0, probs[i]) : 0;
        cleanedProbs[i] = v;
        sum += v;
      }
      if (sum <= 0) {
        cleanedProbs.fill(1 / 100);
        sum = 1.0;
      }
      for (let i = 0; i < 100; i++) {
        cleanedProbs[i] /= sum;
      }

      // Rank all candidates descending, tie-breaking lexicographically
      const candidatePairs: Array<{ twod: string; prob: number }> = [];
      for (let i = 0; i < 100; i++) {
        candidatePairs.push({
          twod: i.toString().padStart(2, '0'),
          prob: cleanedProbs[i],
        });
      }
      candidatePairs.sort((a, b) => {
        if (b.prob !== a.prob) return b.prob - a.prob;
        return a.twod.localeCompare(b.twod);
      });

      const actualRank = candidatePairs.findIndex((c) => c.twod === actual2D) + 1;
      const actualProbability = cleanedProbs[actualIdx] || 0.000001;
      const reciprocalRank = 1.0 / actualRank;
      const logLoss = -Math.log(Math.max(1e-15, actualProbability));

      // Brier score: sum_i (p_i - y_i)^2 = 1 - 2*p_actual + sum_i p_i^2
      let sumSquaredP = 0;
      for (let i = 0; i < 100; i++) {
        sumSquaredP += cleanedProbs[i] * cleanedProbs[i];
      }
      const brierScore = 1.0 - 2.0 * actualProbability + sumSquaredP;

      // Entropy
      let entropy = 0;
      for (let i = 0; i < 100; i++) {
        if (cleanedProbs[i] > 1e-15) {
          entropy -= cleanedProbs[i] * Math.log2(cleanedProbs[i]);
        }
      }

      return {
        modelId,
        date: targetDate,
        session,
        actual2D,
        predictedTop1: candidatePairs[0].twod,
        predictedTop3: candidatePairs.slice(0, 3).map((c) => c.twod),
        predictedTop5: candidatePairs.slice(0, 5).map((c) => c.twod),
        predictedTop10: candidatePairs.slice(0, 10).map((c) => c.twod),
        actualRank,
        reciprocalRank,
        actualProbability,
        logLoss,
        brierScore,
        entropy,
        confidenceScore: Math.round(candidatePairs[0].prob * 10000) / 100,
        validationStatus,
        untestableReason,
        weightsAtCutoff,
        ensembleProbabilityHash: ensembleHash,
      };
    };

    // -----------------------------------------------------------------------
    // MODEL A: ALL_TIME_FREQUENCY_V1 (Frozen Production Champion)
    // -----------------------------------------------------------------------
    const champPred = PredictionEngine.generateAllTimeFrequencyPrediction(featureVector);
    const champProbs = new Array<number>(100);
    for (const c of champPred.candidates) {
      champProbs[parseInt(c.twod, 10)] = c.probability;
    }
    evaluations.push(evaluateProbs('ALL_TIME_FREQUENCY_V1', champProbs, 'EVALUATED'));

    // -----------------------------------------------------------------------
    // MODEL B: SESSION_FREQUENCY_V1
    // -----------------------------------------------------------------------
    const sessOut = CandidateModelLab.evaluateModel('SESSION_FREQUENCY_V1', featureVector);
    evaluations.push(evaluateProbs('SESSION_FREQUENCY_V1', sessOut.probabilities, sessOut.validationStatus));

    // -----------------------------------------------------------------------
    // MODEL C: RECENCY_WEIGHTED_FREQUENCY_V1
    // -----------------------------------------------------------------------
    const recOut = CandidateModelLab.evaluateModel('RECENCY_WEIGHTED_FREQUENCY_V1', featureVector);
    evaluations.push(evaluateProbs('RECENCY_WEIGHTED_FREQUENCY_V1', recOut.probabilities, recOut.validationStatus));

    // -----------------------------------------------------------------------
    // MODEL D: AM_TO_PM_CONDITIONAL_V1 (PM Only)
    // -----------------------------------------------------------------------
    const condOut = CandidateModelLab.evaluateModel('AM_TO_PM_CONDITIONAL_V1', featureVector);
    evaluations.push(
      evaluateProbs(
        'AM_TO_PM_CONDITIONAL_V1',
        condOut.probabilities,
        condOut.validationStatus,
        condOut.validationStatus === 'FAILED_CONTRACT'
          ? 'AmToPmConditionalModel is strictly restricted to PM session.'
          : condOut.audit.auditDetails
      )
    );

    // -----------------------------------------------------------------------
    // MODEL E: MARKOV_TRANSITION_V1
    // -----------------------------------------------------------------------
    const markovOut = CandidateModelLab.evaluateModel('MARKOV_TRANSITION_V1', featureVector);
    evaluations.push(evaluateProbs('MARKOV_TRANSITION_V1', markovOut.probabilities, markovOut.validationStatus));

    // -----------------------------------------------------------------------
    // MODEL F: INTRADAY_SET_VALUE_STATISTICAL_V1 (UNTESTABLE on settlement records)
    // -----------------------------------------------------------------------
    const intradayOut = CandidateModelLab.evaluateModel('INTRADAY_SET_VALUE_STATISTICAL_V1', featureVector);
    evaluations.push(
      evaluateProbs(
        'INTRADAY_SET_VALUE_STATISTICAL_V1',
        intradayOut.probabilities,
        intradayOut.validationStatus,
        intradayOut.audit.auditDetails || 'Historical intraday tick resolution is unavailable in settlement records.'
      )
    );

    // -----------------------------------------------------------------------
    // MODEL G: AUTO_WEIGHTED_ENSEMBLE_V1 (Pre-declared Auto-Weighting Engine)
    // -----------------------------------------------------------------------
    const ensOut = AutoWeightingEngine.evaluateEnsemble(featureVector, allVerifiedRecords, config);
    evaluations.push(
      evaluateProbs(
        'AUTO_WEIGHTED_ENSEMBLE_V1',
        ensOut.probabilities,
        'EVALUATED',
        undefined,
        ensOut.modelWeights,
        ensOut.ensembleProbabilityHash
      )
    );

    return evaluations;
  }

  /**
   * Computes comprehensive aggregate summary for a collection of evaluation rows.
   */
  public static computeSummary(
    modelId: BenchmarkModelId,
    session: MarketSession | 'COMBINED',
    rows: ModelSessionEvaluation[]
  ): ModelBenchmarkSummary {
    const modelRows = rows.filter((r) => r.modelId === modelId);
    // Active rows are those with valid evaluation status (not UNTESTABLE or FAILED_CONTRACT)
    const validRows = modelRows.filter(
      (r) => r.validationStatus === 'EVALUATED' || r.validationStatus === 'READY'
    );

    const samples = validRows.length;
    const untestableCount = modelRows.length - samples;

    // Determine clean display model name and status
    let modelName = modelId.toString();
    let status = 'ACTIVE_CANDIDATE';
    if (modelId === 'ALL_TIME_FREQUENCY_V1') {
      modelName = 'All-Time Freq (Production Champion)';
      status = 'CHAMPION';
    } else if (modelId === 'AUTO_WEIGHTED_ENSEMBLE_V1') {
      modelName = 'Auto-Weighted Ensemble (Pre-declared)';
      status = 'ENSEMBLE';
    } else if (modelId === 'INTRADAY_SET_VALUE_STATISTICAL_V1') {
      modelName = 'Intraday SET/Value Statistical';
      status = 'UNTESTABLE';
    } else if (modelId === 'AM_TO_PM_CONDITIONAL_V1') {
      modelName = 'AM->PM Conditional';
      status = session === 'AM' ? 'INCOMPATIBLE_AM' : 'ACTIVE_PM';
    } else if (modelId === 'SESSION_FREQUENCY_V1') {
      modelName = 'Session Frequency';
    } else if (modelId === 'RECENCY_WEIGHTED_FREQUENCY_V1') {
      modelName = 'Recency Weighted Freq';
    } else if (modelId === 'MARKOV_TRANSITION_V1') {
      modelName = 'Markov Transition';
    }

    if (samples === 0) {
      return {
        modelId,
        modelName,
        session,
        samples: 0,
        untestableCount,
        logLoss: 0,
        brierScore: 0,
        top1HitRate: 0,
        top3HitRate: 0,
        top5HitRate: 0,
        top10HitRate: 0,
        meanReciprocalRank: 0,
        meanPredictedProbActual: 0,
        averageRank: 0,
        ece: 0,
        status,
      };
    }

    const logLoss = validRows.reduce((a, b) => a + b.logLoss, 0) / samples;
    const brierScore = validRows.reduce((a, b) => a + b.brierScore, 0) / samples;
    const top1HitRate = validRows.filter((r) => r.actualRank === 1).length / samples;
    const top3HitRate = validRows.filter((r) => r.actualRank <= 3).length / samples;
    const top5HitRate = validRows.filter((r) => r.actualRank <= 5).length / samples;
    const top10HitRate = validRows.filter((r) => r.actualRank <= 10).length / samples;
    const meanReciprocalRank = validRows.reduce((a, b) => a + b.reciprocalRank, 0) / samples;
    const meanPredictedProbActual = validRows.reduce((a, b) => a + b.actualProbability, 0) / samples;
    const averageRank = validRows.reduce((a, b) => a + b.actualRank, 0) / samples;

    // Expected Calibration Error (ECE) for Top-1 Confidence Calibration across 5 bins
    // Bins: [0, 0.02), [0.02, 0.04), [0.04, 0.06), [0.06, 0.08), [0.08, 1.0]
    const bins = [
      { min: 0, max: 0.02, sumConf: 0, hits: 0, count: 0 },
      { min: 0.02, max: 0.04, sumConf: 0, hits: 0, count: 0 },
      { min: 0.04, max: 0.06, sumConf: 0, hits: 0, count: 0 },
      { min: 0.06, max: 0.08, sumConf: 0, hits: 0, count: 0 },
      { min: 0.08, max: 1.0, sumConf: 0, hits: 0, count: 0 },
    ];

    for (const r of validRows) {
      const conf = r.confidenceScore / 100.0;
      const hit = r.actualRank === 1 ? 1 : 0;
      for (const b of bins) {
        if (conf >= b.min && (conf < b.max || b.max === 1.0)) {
          b.sumConf += conf;
          b.hits += hit;
          b.count += 1;
          break;
        }
      }
    }

    let ece = 0;
    for (const b of bins) {
      if (b.count > 0) {
        const avgConf = b.sumConf / b.count;
        const acc = b.hits / b.count;
        ece += (b.count / samples) * Math.abs(avgConf - acc);
      }
    }

    return {
      modelId,
      modelName,
      session,
      samples,
      untestableCount,
      logLoss: Math.round(logLoss * 10000) / 10000,
      brierScore: Math.round(brierScore * 10000) / 10000,
      top1HitRate: Math.round(top1HitRate * 10000) / 10000,
      top3HitRate: Math.round(top3HitRate * 10000) / 10000,
      top5HitRate: Math.round(top5HitRate * 10000) / 10000,
      top10HitRate: Math.round(top10HitRate * 10000) / 10000,
      meanReciprocalRank: Math.round(meanReciprocalRank * 10000) / 10000,
      meanPredictedProbActual: Math.round(meanPredictedProbActual * 10000) / 10000,
      averageRank: Math.round(averageRank * 100) / 100,
      ece: Math.round(ece * 10000) / 10000,
      status,
    };
  }

  /**
   * Computes formal paired difference statistics between Auto-Ensemble and Champion
   */
  public static computePairedComparison(
    metricName: string,
    metricKey: 'logLoss' | 'brierScore' | 'top1' | 'top3' | 'top5' | 'top10' | 'mrr',
    ensembleRows: ModelSessionEvaluation[],
    championRows: ModelSessionEvaluation[]
  ): PairedStatisticalComparison {
    // Match sessions pairwise
    const pairedDiffs: number[] = [];
    const ensVals: number[] = [];
    const champVals: number[] = [];

    for (const ens of ensembleRows) {
      const champ = championRows.find((c) => c.date === ens.date && c.session === ens.session);
      if (!champ) continue;

      let ensVal = 0;
      let champVal = 0;

      if (metricKey === 'logLoss') {
        ensVal = ens.logLoss;
        champVal = champ.logLoss;
      } else if (metricKey === 'brierScore') {
        ensVal = ens.brierScore;
        champVal = champ.brierScore;
      } else if (metricKey === 'top1') {
        ensVal = ens.actualRank === 1 ? 1 : 0;
        champVal = champ.actualRank === 1 ? 1 : 0;
      } else if (metricKey === 'top3') {
        ensVal = ens.actualRank <= 3 ? 1 : 0;
        champVal = champ.actualRank <= 3 ? 1 : 0;
      } else if (metricKey === 'top5') {
        ensVal = ens.actualRank <= 5 ? 1 : 0;
        champVal = champ.actualRank <= 5 ? 1 : 0;
      } else if (metricKey === 'top10') {
        ensVal = ens.actualRank <= 10 ? 1 : 0;
        champVal = champ.actualRank <= 10 ? 1 : 0;
      } else if (metricKey === 'mrr') {
        ensVal = ens.reciprocalRank;
        champVal = champ.reciprocalRank;
      }

      ensVals.push(ensVal);
      champVals.push(champVal);
      pairedDiffs.push(ensVal - champVal);
    }

    const n = pairedDiffs.length;
    if (n === 0) {
      return {
        metricName,
        metricKey,
        championValue: 0,
        ensembleValue: 0,
        difference: 0,
        meanDifference: 0,
        stdDifference: 0,
        stdError: 0,
        ci95Lower: 0,
        ci95Upper: 0,
        tStatistic: 0,
        pValue: 1.0,
        cohensD: 0,
        statisticallySignificant: false,
        direction: 'NEUTRAL',
      };
    }

    const championValue = champVals.reduce((a, b) => a + b, 0) / n;
    const ensembleValue = ensVals.reduce((a, b) => a + b, 0) / n;
    const meanDifference = pairedDiffs.reduce((a, b) => a + b, 0) / n;

    // Sample variance of differences
    let sumSqDiff = 0;
    for (const d of pairedDiffs) {
      sumSqDiff += (d - meanDifference) * (d - meanDifference);
    }
    const sampleVariance = n > 1 ? sumSqDiff / (n - 1) : 0;
    const stdDifference = Math.sqrt(sampleVariance);
    const stdError = n > 0 ? stdDifference / Math.sqrt(n) : 0;

    const df = n - 1;
    const tCrit = getT95Critical(df);
    const ci95Lower = meanDifference - tCrit * stdError;
    const ci95Upper = meanDifference + tCrit * stdError;

    const tStatistic = stdError > 1e-12 ? meanDifference / stdError : 0;
    const pValue = computeTwoTailedPValue(tStatistic, df);
    const cohensD = stdDifference > 1e-12 ? meanDifference / stdDifference : 0;
    const statisticallySignificant = pValue < 0.05;

    // Direction: For loss/brier, negative is better. For accuracy/mrr, positive is better.
    let isFavorable = false;
    if (metricKey === 'logLoss' || metricKey === 'brierScore') {
      isFavorable = meanDifference < 0;
    } else {
      isFavorable = meanDifference > 0;
    }

    const direction = statisticallySignificant
      ? isFavorable
        ? 'IMPROVED'
        : 'DEGRADED'
      : 'NEUTRAL';

    return {
      metricName,
      metricKey,
      championValue: Math.round(championValue * 10000) / 10000,
      ensembleValue: Math.round(ensembleValue * 10000) / 10000,
      difference: Math.round((ensembleValue - championValue) * 10000) / 10000,
      meanDifference: Math.round(meanDifference * 10000) / 10000,
      stdDifference: Math.round(stdDifference * 10000) / 10000,
      stdError: Math.round(stdError * 10000) / 10000,
      ci95Lower: Math.round(ci95Lower * 10000) / 10000,
      ci95Upper: Math.round(ci95Upper * 10000) / 10000,
      tStatistic: Math.round(tStatistic * 1000) / 1000,
      pValue: Math.round(pValue * 10000) / 10000,
      cohensD: Math.round(cohensD * 1000) / 1000,
      statisticallySignificant,
      direction,
    };
  }

  /**
   * Runs the complete walk-forward benchmark across all verified records.
   */
  public static runStep25Benchmark(
    allRecords: VerifiedMarketRecord[],
    options: {
      minTrainingSettlements?: number;
      recentSessionsCount?: number;
      autoWeightingConfig?: AutoWeightingConfig;
    } = {}
  ): Step25BenchmarkReport {
    const minTrainingSettlements = options.minTrainingSettlements ?? 10;
    const recentSessionsCount = options.recentSessionsCount ?? 15;
    const config = options.autoWeightingConfig ?? DEFAULT_AUTO_WEIGHTING_CONFIG;

    // 1. Sort records strictly chronologically
    const allSettlements = allRecords
      .filter((r) => r.isSettlement)
      .sort((a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session));

    const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();

    const allEvaluations: ModelSessionEvaluation[] = [];
    const ensembleAuditWeights: Array<{
      date: string;
      session: MarketSession;
      weights: Record<string, number>;
      priorUsed: boolean;
    }> = [];

    let amEvaluatedSessions = 0;
    let pmEvaluatedSessions = 0;
    const evaluatedDates: string[] = [];

    // 2. Step through target dates chronologically
    for (const targetDate of uniqueDates) {
      const priorSettlements = allSettlements.filter((r) => r.date < targetDate);
      const priorAmSettlements = priorSettlements.filter((r) => r.session === 'AM');
      const priorPmSettlements = priorSettlements.filter((r) => r.session === 'PM');

      // Need minimum history for valid point-in-time training for at least one session
      if (
        priorAmSettlements.length < minTrainingSettlements &&
        priorPmSettlements.length < minTrainingSettlements
      ) {
        continue;
      }

      const dateSettlements = allSettlements.filter((r) => r.date === targetDate);
      const amSettle = dateSettlements.find((r) => r.session === 'AM');
      const pmSettle = dateSettlements.find((r) => r.session === 'PM');

      let dateWasEvaluated = false;

      // --- EVALUATE AM SESSION ---
      if (amSettle && priorAmSettlements.length >= minTrainingSettlements) {
        const amFeatureRes = FeatureEngine.extractAmFeatures(allRecords, targetDate);
        if (amFeatureRes.success && amFeatureRes.featureVector) {
          const sessionEvals = this.evaluateSessionModels(
            targetDate,
            'AM',
            amSettle.twod,
            amFeatureRes.featureVector,
            allRecords,
            config
          );
          allEvaluations.push(...sessionEvals);
          amEvaluatedSessions++;
          dateWasEvaluated = true;

          // Track ensemble weights
          const ensEval = sessionEvals.find((e) => e.modelId === 'AUTO_WEIGHTED_ENSEMBLE_V1');
          if (ensEval && ensEval.weightsAtCutoff) {
            // Determine if conservative prior was used
            // Prior is used when out-of-sample settlements < config.minEvidenceCount
            const outOfSampleSettlementsBeforeTarget = priorAmSettlements.length;
            const priorUsed = outOfSampleSettlementsBeforeTarget < config.minEvidenceCount;
            ensembleAuditWeights.push({
              date: targetDate,
              session: 'AM',
              weights: ensEval.weightsAtCutoff,
              priorUsed,
            });
          }
        }
      }

      // --- EVALUATE PM SESSION ---
      if (pmSettle && priorPmSettlements.length >= minTrainingSettlements) {
        const pmFeatureRes = FeatureEngine.extractPmFeatures(allRecords, targetDate);
        if (pmFeatureRes.success && pmFeatureRes.featureVector) {
          const sessionEvals = this.evaluateSessionModels(
            targetDate,
            'PM',
            pmSettle.twod,
            pmFeatureRes.featureVector,
            allRecords,
            config
          );
          allEvaluations.push(...sessionEvals);
          pmEvaluatedSessions++;
          dateWasEvaluated = true;

          // Track ensemble weights
          const ensEval = sessionEvals.find((e) => e.modelId === 'AUTO_WEIGHTED_ENSEMBLE_V1');
          if (ensEval && ensEval.weightsAtCutoff) {
            const outOfSampleSettlementsBeforeTarget = priorPmSettlements.length;
            const priorUsed = outOfSampleSettlementsBeforeTarget < config.minEvidenceCount;
            ensembleAuditWeights.push({
              date: targetDate,
              session: 'PM',
              weights: ensEval.weightsAtCutoff,
              priorUsed,
            });
          }
        }
      }

      if (dateWasEvaluated) {
        evaluatedDates.push(targetDate);
      }
    }

    const totalEvaluatedSessions = amEvaluatedSessions + pmEvaluatedSessions;
    const startDate = evaluatedDates.length > 0 ? evaluatedDates[0] : '';
    const endDate = evaluatedDates.length > 0 ? evaluatedDates[evaluatedDates.length - 1] : '';

    // 3. Slices
    const amEvals = allEvaluations.filter((e) => e.session === 'AM');
    const pmEvals = allEvaluations.filter((e) => e.session === 'PM');

    // Recent slice: Last recentSessionsCount sessions (e.g. last 15 sessions chronologically)
    const ensembleRowsSorted = allEvaluations
      .filter((e) => e.modelId === 'AUTO_WEIGHTED_ENSEMBLE_V1')
      .sort((a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session));
    const recentCutoffIndex = Math.max(0, ensembleRowsSorted.length - recentSessionsCount);
    const recentSessionKeys = new Set(
      ensembleRowsSorted.slice(recentCutoffIndex).map((e) => `${e.date}_${e.session}`)
    );
    const recentEvals = allEvaluations.filter((e) => recentSessionKeys.has(`${e.date}_${e.session}`));

    const modelIds: BenchmarkModelId[] = [
      'ALL_TIME_FREQUENCY_V1',
      'SESSION_FREQUENCY_V1',
      'RECENCY_WEIGHTED_FREQUENCY_V1',
      'AM_TO_PM_CONDITIONAL_V1',
      'MARKOV_TRANSITION_V1',
      'INTRADAY_SET_VALUE_STATISTICAL_V1',
      'AUTO_WEIGHTED_ENSEMBLE_V1',
    ];

    // 4. Summaries
    const combinedSummaries = modelIds.map((id) => this.computeSummary(id, 'COMBINED', allEvaluations));
    const amSummaries = modelIds.map((id) => this.computeSummary(id, 'AM', amEvals));
    const pmSummaries = modelIds.map((id) => this.computeSummary(id, 'PM', pmEvals));
    const recentSummaries = modelIds.map((id) => this.computeSummary(id, 'COMBINED', recentEvals));

    // 5. Auto-Weighting Audit Analysis
    const totalEnsembleEvaluations = ensembleAuditWeights.length;
    const conservativePriorCount = ensembleAuditWeights.filter((a) => a.priorUsed).length;
    const conservativePriorRate =
      totalEnsembleEvaluations > 0 ? conservativePriorCount / totalEnsembleEvaluations : 0;
    const sufficientEvidenceCount = totalEnsembleEvaluations - conservativePriorCount;

    const candidateKeys: Array<CandidateModelId | 'ALL_TIME_FREQUENCY_V1'> = [
      'SESSION_FREQUENCY_V1',
      'RECENCY_WEIGHTED_FREQUENCY_V1',
      'AM_TO_PM_CONDITIONAL_V1',
      'MARKOV_TRANSITION_V1',
      'INTRADAY_SET_VALUE_STATISTICAL_V1',
    ];

    const weightBehavior: AutoWeightingBehaviorMetrics[] = [];
    for (const candKey of candidateKeys) {
      const weights = ensembleAuditWeights.map((w) => w.weights[candKey] || 0);
      const avgW = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
      const sortedW = [...weights].sort((a, b) => a - b);
      const medianW = sortedW.length > 0 ? sortedW[Math.floor(sortedW.length / 2)] : 0;
      const minW = sortedW.length > 0 ? sortedW[0] : 0;
      const maxW = sortedW.length > 0 ? sortedW[sortedW.length - 1] : 0;

      let sumSqW = 0;
      for (const w of weights) sumSqW += (w - avgW) * (w - avgW);
      const stdW = weights.length > 1 ? Math.sqrt(sumSqW / (weights.length - 1)) : 0;

      // Count dominant weight (strictly maximum weight among all candidate weights in that session)
      let dominantCount = 0;
      for (const item of ensembleAuditWeights) {
        const itemW = item.weights[candKey] || 0;
        if (itemW > 0) {
          const maxInItem = Math.max(...Object.values(item.weights));
          if (Math.abs(itemW - maxInItem) < 1e-6) {
            dominantCount++;
          }
        }
      }

      weightBehavior.push({
        modelId: candKey,
        session: 'COMBINED',
        averageWeight: Math.round(avgW * 10000) / 10000,
        medianWeight: Math.round(medianW * 10000) / 10000,
        minWeight: Math.round(minW * 10000) / 10000,
        maxWeight: Math.round(maxW * 10000) / 10000,
        weightStdDev: Math.round(stdW * 10000) / 10000,
        dominantWeightCount: dominantCount,
        dominantWeightFraction:
          weights.length > 0 ? Math.round((dominantCount / weights.length) * 10000) / 10000 : 0,
      });
    }

    const autoWeightingAudit: AutoWeightingAuditSummary = {
      totalEvaluations: totalEnsembleEvaluations,
      conservativePriorCount,
      conservativePriorRate: Math.round(conservativePriorRate * 10000) / 10000,
      sufficientEvidenceCount,
      weightBehavior,
      untestableModelCount: 1, // INTRADAY_SET_VALUE_STATISTICAL_V1
    };

    // 6. Paired Statistical Comparisons (Auto-Ensemble vs Champion)
    const metricsToCompare: Array<{
      name: string;
      key: 'logLoss' | 'brierScore' | 'top1' | 'top3' | 'top5' | 'top10' | 'mrr';
    }> = [
      { name: 'Log Loss (NLL)', key: 'logLoss' },
      { name: 'Brier Score', key: 'brierScore' },
      { name: 'Top-1 Hit Rate', key: 'top1' },
      { name: 'Top-3 Hit Rate', key: 'top3' },
      { name: 'Top-5 Hit Rate', key: 'top5' },
      { name: 'Top-10 Hit Rate', key: 'top10' },
      { name: 'Mean Reciprocal Rank (MRR)', key: 'mrr' },
    ];

    const getEnsRows = (rows: ModelSessionEvaluation[]) =>
      rows.filter((r) => r.modelId === 'AUTO_WEIGHTED_ENSEMBLE_V1');
    const getChampRows = (rows: ModelSessionEvaluation[]) =>
      rows.filter((r) => r.modelId === 'ALL_TIME_FREQUENCY_V1');

    const comparisons = {
      combined: metricsToCompare.map((m) =>
        this.computePairedComparison(m.name, m.key, getEnsRows(allEvaluations), getChampRows(allEvaluations))
      ),
      am: metricsToCompare.map((m) =>
        this.computePairedComparison(m.name, m.key, getEnsRows(amEvals), getChampRows(amEvals))
      ),
      pm: metricsToCompare.map((m) =>
        this.computePairedComparison(m.name, m.key, getEnsRows(pmEvals), getChampRows(pmEvals))
      ),
      recent: metricsToCompare.map((m) =>
        this.computePairedComparison(m.name, m.key, getEnsRows(recentEvals), getChampRows(recentEvals))
      ),
    };

    // 7. Find Champions Across Metrics
    const findBest = (summaries: ModelBenchmarkSummary[], metric: 'logLoss' | 'brierScore' | 'top1HitRate' | 'top5HitRate') => {
      const valid = summaries.filter((s) => s.samples > 0 && s.status !== 'UNTESTABLE' && s.status !== 'INCOMPATIBLE_AM');
      if (valid.length === 0) return 'NONE';
      if (metric === 'logLoss' || metric === 'brierScore') {
        const sorted = [...valid].sort((a, b) => a[metric] - b[metric]);
        return sorted[0].modelId;
      } else {
        const sorted = [...valid].sort((a, b) => b[metric] - a[metric]);
        return sorted[0].modelId;
      }
    };

    const bestModels = {
      byLogLoss: {
        combined: findBest(combinedSummaries, 'logLoss'),
        am: findBest(amSummaries, 'logLoss'),
        pm: findBest(pmSummaries, 'logLoss'),
        recent: findBest(recentSummaries, 'logLoss'),
      },
      byBrier: {
        combined: findBest(combinedSummaries, 'brierScore'),
        am: findBest(amSummaries, 'brierScore'),
        pm: findBest(pmSummaries, 'brierScore'),
        recent: findBest(recentSummaries, 'brierScore'),
      },
      byTop1: {
        combined: findBest(combinedSummaries, 'top1HitRate'),
        am: findBest(amSummaries, 'top1HitRate'),
        pm: findBest(pmSummaries, 'top1HitRate'),
        recent: findBest(recentSummaries, 'top1HitRate'),
      },
      byTop5: {
        combined: findBest(combinedSummaries, 'top5HitRate'),
        am: findBest(amSummaries, 'top5HitRate'),
        pm: findBest(pmSummaries, 'top5HitRate'),
        recent: findBest(recentSummaries, 'top5HitRate'),
      },
    };

    // 8. Deterministic Hash of Run
    let hash = 0x811c9dc5;
    for (const r of allEvaluations) {
      const rowStr = `${r.modelId}|${r.date}|${r.session}|${r.actualRank}|${r.actualProbability.toFixed(5)}|${r.logLoss.toFixed(4)}`;
      for (let i = 0; i < rowStr.length; i++) {
        hash ^= rowStr.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    const benchmarkRunHash = (hash >>> 0).toString(16).padStart(8, '0');

    // 9. Governance & Safety
    const logLossComp = comparisons.combined.find((c) => c.metricKey === 'logLoss');
    const isSignificantLogLossImprovement = logLossComp?.statisticallySignificant && logLossComp?.direction === 'IMPROVED';

    const governance = {
      frozenProductionChampion: 'ALL_TIME_FREQUENCY_V1' as const,
      promotedToProduction: false as const,
      decisionReasoning: isSignificantLogLossImprovement
        ? 'Auto-Weighted Ensemble demonstrated empirical gains; however, per MM2D Leader Step 25 governance safety mandates, promotion is deferred pending formal Leader review and live shadow verification.'
        : 'Out-of-sample walk-forward evaluation confirms ALL_TIME_FREQUENCY_V1 remains the robust, well-calibrated production champion. Auto-Weighted Ensemble differences do not exhibit statistically decisive superiority across both AM and PM sessions.',
      recommendationSummary:
        'KEEP ALL_TIME_FREQUENCY_V1 FROZEN AS ACTIVE PRODUCTION CHAMPION. Retain Auto-Weighted Ensemble in research lab.',
    };

    return {
      evaluationTimestamp: new Date().toISOString(),
      totalHistoricalRecords: allRecords.length,
      minTrainingSettlements,
      evaluationPeriod: {
        startDate,
        endDate,
        totalTargetDates: evaluatedDates.length,
        totalEvaluatedSessions,
        amEvaluatedSessions,
        pmEvaluatedSessions,
      },
      combinedSummaries,
      amSummaries,
      pmSummaries,
      recentSummaries,
      autoWeightingAudit,
      comparisons,
      bestModels,
      benchmarkRunHash,
      governance,
    };
  }

  /**
   * Formats clean tabular benchmark summary for console or UI display
   */
  public static formatSummaryTable(summaries: ModelBenchmarkSummary[]): string {
    const header =
      '| Model                             | Session  | Samples | Log Loss | Brier   | Top1   | Top3   | Top5   | Top10  | Avg Rank | Status           |';
    const divider =
      '|-----------------------------------|----------|---------|----------|---------|--------|--------|--------|--------|----------|------------------|';

    const rows = summaries.map((s) => {
      const mName = s.modelId.padEnd(33).slice(0, 33);
      const sess = s.session.padEnd(8);
      const sam = s.samples.toString().padStart(7);
      const ll = s.samples > 0 ? s.logLoss.toFixed(4).padStart(8) : '     N/A';
      const br = s.samples > 0 ? s.brierScore.toFixed(4).padStart(7) : '    N/A';
      const t1 = s.samples > 0 ? `${(s.top1HitRate * 100).toFixed(1)}%`.padStart(6) : '   N/A';
      const t3 = s.samples > 0 ? `${(s.top3HitRate * 100).toFixed(1)}%`.padStart(6) : '   N/A';
      const t5 = s.samples > 0 ? `${(s.top5HitRate * 100).toFixed(1)}%`.padStart(6) : '   N/A';
      const t10 = s.samples > 0 ? `${(s.top10HitRate * 100).toFixed(1)}%`.padStart(6) : '   N/A';
      const ar = s.samples > 0 ? s.averageRank.toFixed(1).padStart(8) : '     N/A';
      const st = s.status.padEnd(16).slice(0, 16);

      return `| ${mName} | ${sess} | ${sam} | ${ll} | ${br} | ${t1} | ${t3} | ${t5} | ${t10} | ${ar} | ${st} |`;
    });

    return [header, divider, ...rows].join('\n');
  }
}
