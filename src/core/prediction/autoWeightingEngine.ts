import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  PredictionCandidate,
  PredictionFeatureVector,
  SessionPredictionOutput,
} from '../../types/prediction';
import {
  CandidateModelId,
  CandidateModelOutput,
  ModelValidationStatus,
} from '../../types/candidateModel';
import {
  AutoWeightedEnsembleOutput,
  AutoWeightingAudit,
  AutoWeightingConfig,
  DEFAULT_AUTO_WEIGHTING_CONFIG,
  HistoricalModelEvaluation,
  ModelContributionInfo,
  ModelPerformanceMetrics,
} from '../../types/autoWeighting';
import {
  CandidateModelLab,
  computeProbabilityHash,
  normalizeProbabilities,
} from './candidateModelLab';
import { FeatureEngine } from './featureEngine';
import { StatisticalEngine } from './statisticalEngine';

export const AUTO_WEIGHTED_ENSEMBLE_VERSION = 'AUTO_WEIGHTED_ENSEMBLE_V1' as const;

/**
 * Leakage-Safe Point-In-Time Auto Weighting Engine
 * 
 * Automatically calculates non-negative, normalized weights for Step 23 candidate models
 * based strictly on out-of-sample historical negative log likelihood (Log Loss) and recency decay.
 * 
 * Anti-Leakage Guarantees:
 * 1. For target date D, weights are calculated ONLY from evaluations on dates strictly before D.
 * 2. Today's actual settlement cannot and does not influence today's weights.
 * 3. Future results are strictly excluded.
 * 4. AM and PM weights are evaluated independently with zero cross-session contamination.
 * 5. Models marked UNTESTABLE, FAILED_CONTRACT, or NOT_ACTIVATED receive strictly 0.0 weight.
 * 6. Under insufficient evidence (< minEvidenceCount), models receive conservative uniform prior weight.
 * 7. Model weights among eligible models always sum exactly to 1.0.
 */
export class AutoWeightingEngine {
  /**
   * Computes Negative Log Likelihood (Log Loss) for a probability distribution given actual outcome.
   * LogLoss = -ln(max(epsilon, P[actual]))
   */
  public static computeLogLoss(
    probabilities: number[],
    actualSettlement2D: string,
    epsilon: number = 1e-15
  ): number {
    const outcomeIndex = parseInt(actualSettlement2D, 10);
    if (isNaN(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= 100) {
      return -Math.log(epsilon);
    }
    const prob = probabilities[outcomeIndex] !== undefined ? probabilities[outcomeIndex] : 0;
    const clamped = Math.max(epsilon, Math.min(1.0, prob));
    return -Math.log(clamped);
  }

  /**
   * Computes Brier Score for a probability distribution given actual outcome.
   * Brier = sum_{i=0..99} (P[i] - 1_{actual=i})^2
   */
  public static computeBrierScore(
    probabilities: number[],
    actualSettlement2D: string
  ): number {
    const outcomeIndex = parseInt(actualSettlement2D, 10);
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      const target = i === outcomeIndex ? 1.0 : 0.0;
      const diff = probabilities[i] - target;
      sum += diff * diff;
    }
    return sum;
  }

  /**
   * Checks whether a candidate model is eligible for weighting in a given session.
   */
  public static isModelEligibleForSession(
    modelId: CandidateModelId,
    session: MarketSession
  ): { eligible: boolean; status: ModelValidationStatus; reason?: string } {
    const model = CandidateModelLab.getModel(modelId);
    if (!model) {
      return {
        eligible: false,
        status: 'FAILED_CONTRACT',
        reason: `Model ${modelId} is not registered in CandidateModelLab.`,
      };
    }

    // Explicit UNTESTABLE handling: Intraday model lacks historical tick resolution
    if (modelId === 'INTRADAY_SET_VALUE_STATISTICAL_V1') {
      return {
        eligible: false,
        status: 'UNTESTABLE',
        reason: 'Lacks historical intraday tick resolution in settlement datasets; synthetic interpolation prohibited.',
      };
    }

    // Inactive composite handling
    if (modelId === 'HYBRID_CANDIDATE_V1') {
      return {
        eligible: false,
        status: 'NOT_ACTIVATED',
        reason: 'Composite hybrid model kept inactive pending complete multi-model validation.',
      };
    }

    // Session compatibility check
    if (model.session !== 'BOTH' && model.session !== session) {
      return {
        eligible: false,
        status: 'FAILED_CONTRACT',
        reason: `Model ${modelId} designed for session ${model.session}, incompatible with requested ${session}.`,
      };
    }

    return {
      eligible: true,
      status: 'READY',
    };
  }

  /**
   * Reconstructs point-in-time historical evaluations strictly before targetDate for a specific session.
   * Strictly evaluates candidate models on historical dates d < targetDate using point-in-time features.
   */
  public static buildHistoricalEvaluations(
    allVerifiedRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): HistoricalModelEvaluation[] {
    // 1. Gather all verified settlements for this session strictly before targetDate
    const priorSettlements = allVerifiedRecords
      .filter((r) => r.isSettlement && r.session === session && r.date < targetDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (priorSettlements.length === 0) {
      return [];
    }

    // 2. Identify candidate models to evaluate
    const allModels = CandidateModelLab.getAllModels();
    const evaluations: HistoricalModelEvaluation[] = [];

    // 3. For each historical settlement date, simulate point-in-time prediction
    for (const settleRecord of priorSettlements) {
      const evalDate = settleRecord.date;
      const actual2D = settleRecord.twod;

      // Extract point-in-time feature vector available strictly before evalDate
      const featRes = FeatureEngine.extractFeatures(allVerifiedRecords, evalDate, session);
      if (!featRes.success || !featRes.featureVector) {
        continue;
      }

      const features = featRes.featureVector;

      // Evaluate each model against this historical date
      for (const model of allModels) {
        const eligibility = this.isModelEligibleForSession(model.modelId, session);
        if (!eligibility.eligible) {
          continue;
        }

        try {
          const out = model.predict(features);

          // If model contract failed on historical features, skip recording
          if (out.validationStatus === 'FAILED_CONTRACT' || out.validationStatus === 'UNTESTABLE') {
            continue;
          }

          const logLoss = this.computeLogLoss(out.probabilities, actual2D, config.epsilon);
          const brierScore = this.computeBrierScore(out.probabilities, actual2D);
          const outcomeIdx = parseInt(actual2D, 10);
          const predProb = out.probabilities[outcomeIdx] || 0;

          evaluations.push({
            evaluationDate: evalDate,
            session,
            modelId: model.modelId,
            modelVersion: model.version,
            actualSettlement2D: actual2D,
            logLoss,
            brierScore,
            isTop1Hit: out.top1 === actual2D,
            isTop5Hit: out.top5.includes(actual2D),
            isTop10Hit: out.top10.includes(actual2D),
            predictedProbability: predProb,
            predictedTop1: out.top1,
            candidateProbabilityHash: out.audit.candidateProbabilityHash,
            evaluatedAt: new Date().toISOString(),
          });
        } catch {
          // Model threw exception; exclude from historical evaluations
        }
      }
    }

    return evaluations;
  }

  /**
   * Computes aggregated performance metrics and recency-decayed scores from historical evaluations.
   */
  public static calculatePerformanceMetrics(
    evaluations: HistoricalModelEvaluation[],
    session: MarketSession,
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): Record<CandidateModelId, ModelPerformanceMetrics> {
    const allModels = CandidateModelLab.getAllModels();
    const result: Partial<Record<CandidateModelId, ModelPerformanceMetrics>> = {};

    for (const model of allModels) {
      const eligibility = this.isModelEligibleForSession(model.modelId, session);

      // Model-specific historical evaluations sorted chronologically
      const modelEvals = evaluations
        .filter((e) => e.modelId === model.modelId && e.session === session)
        .sort((a, b) => a.evaluationDate.localeCompare(b.evaluationDate));

      // Apply rolling window slice if configured
      let windowedEvals = modelEvals;
      if (config.windowType === 'ROLLING' && modelEvals.length > config.windowSize) {
        windowedEvals = modelEvals.slice(modelEvals.length - config.windowSize);
      }

      const K = windowedEvals.length;
      const hasSufficientEvidence = eligibility.eligible && K >= config.minEvidenceCount;

      if (!eligibility.eligible || K === 0) {
        result[model.modelId] = {
          modelId: model.modelId,
          session,
          evaluationCount: K,
          averageLogLoss: 4.605, // Neutral uniform baseline -ln(0.01)
          weightedLogLoss: 4.605,
          averageBrierScore: 0.99,
          top1HitRate: 0.0,
          top5HitRate: 0.0,
          top10HitRate: 0.0,
          hasSufficientEvidence: false,
          eligible: eligibility.eligible,
          validationStatus: eligibility.status,
          rejectionReason: eligibility.reason,
        };
        continue;
      }

      // Compute recency-decayed weighted Log Loss
      // Most recent evaluation (index K-1) has age 0 -> decay = 1.0
      // Older evaluations have decay = gamma^(K - 1 - k)
      let sumDecayWeights = 0;
      let weightedLogLossSum = 0;
      let rawLogLossSum = 0;
      let rawBrierSum = 0;
      let top1Hits = 0;
      let top5Hits = 0;
      let top10Hits = 0;

      for (let k = 0; k < K; k++) {
        const age = K - 1 - k;
        const decay = Math.pow(config.recencyDecayFactor, age);
        const ev = windowedEvals[k];

        sumDecayWeights += decay;
        weightedLogLossSum += decay * ev.logLoss;
        rawLogLossSum += ev.logLoss;
        rawBrierSum += ev.brierScore;

        if (ev.isTop1Hit) top1Hits++;
        if (ev.isTop5Hit) top5Hits++;
        if (ev.isTop10Hit) top10Hits++;
      }

      const weightedLogLoss = sumDecayWeights > 0 ? weightedLogLossSum / sumDecayWeights : rawLogLossSum / K;
      const averageLogLoss = rawLogLossSum / K;
      const averageBrierScore = rawBrierSum / K;

      result[model.modelId] = {
        modelId: model.modelId,
        session,
        evaluationCount: K,
        averageLogLoss,
        weightedLogLoss,
        averageBrierScore,
        top1HitRate: Math.round((top1Hits / K) * 10000) / 10000,
        top5HitRate: Math.round((top5Hits / K) * 10000) / 10000,
        top10HitRate: Math.round((top10Hits / K) * 10000) / 10000,
        hasSufficientEvidence,
        eligible: eligibility.eligible,
        validationStatus: eligibility.status,
      };
    }

    return result as Record<CandidateModelId, ModelPerformanceMetrics>;
  }

  /**
   * Calculates normalized, non-negative model weights.
   * 
   * Mathematical Rule:
   * 1. Ineligible or untestable models receive strictly weight = 0.0.
   * 2. If all eligible models have insufficient evidence, assign equal conservative prior weight (1 / |E|).
   * 3. For eligible models with sufficient evidence, score = -weightedLogLoss.
   *    Models with insufficient evidence are assigned the neutral baseline score (average of scores).
   * 4. Apply numerically stable softmax with temperature tau.
   * 5. Ensure exact sum to 1.0.
   */
  public static calculateWeights(
    metrics: Record<CandidateModelId, ModelPerformanceMetrics>,
    session: MarketSession,
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): Record<CandidateModelId, number> {
    const allModelIds: CandidateModelId[] = [
      'SESSION_FREQUENCY_V1',
      'RECENCY_WEIGHTED_FREQUENCY_V1',
      'AM_TO_PM_CONDITIONAL_V1',
      'MARKOV_TRANSITION_V1',
      'INTRADAY_SET_VALUE_STATISTICAL_V1',
      'HYBRID_CANDIDATE_V1',
    ];

    const weights: Record<CandidateModelId, number> = {
      SESSION_FREQUENCY_V1: 0,
      RECENCY_WEIGHTED_FREQUENCY_V1: 0,
      AM_TO_PM_CONDITIONAL_V1: 0,
      MARKOV_TRANSITION_V1: 0,
      INTRADAY_SET_VALUE_STATISTICAL_V1: 0,
      HYBRID_CANDIDATE_V1: 0,
    };

    // Filter eligible models for this session
    const eligibleModelIds = allModelIds.filter((id) => {
      const m = metrics[id];
      return m && m.eligible && m.validationStatus === 'READY';
    });

    if (eligibleModelIds.length === 0) {
      return weights;
    }

    // Check evidence count across eligible models
    const modelsWithEvidence = eligibleModelIds.filter((id) => metrics[id]?.hasSufficientEvidence);

    // Case A: None of the eligible models have met the evidence threshold yet
    // => Assign exact uniform prior among eligible models
    if (modelsWithEvidence.length === 0) {
      const priorWeight = 1.0 / eligibleModelIds.length;
      for (const id of eligibleModelIds) {
        weights[id] = priorWeight;
      }
      return this.enforceExactSum(weights, eligibleModelIds);
    }

    // Case B: Performance-based weighting via Softmax
    // Score is negative weighted log loss (lower loss -> higher score)
    const rawScores: Record<string, number> = {};
    for (const id of modelsWithEvidence) {
      rawScores[id] = -metrics[id].weightedLogLoss;
    }

    // For eligible models without enough evidence, assign the average score of models with evidence
    const avgScore =
      Object.values(rawScores).reduce((acc, s) => acc + s, 0) / modelsWithEvidence.length;

    for (const id of eligibleModelIds) {
      if (!metrics[id]?.hasSufficientEvidence) {
        rawScores[id] = avgScore;
      }
    }

    // Numerically stable softmax
    let maxScore = -Infinity;
    for (const id of eligibleModelIds) {
      if (rawScores[id] > maxScore) {
        maxScore = rawScores[id];
      }
    }

    const expScores: Record<string, number> = {};
    let expSum = 0;
    const temp = Math.max(0.01, config.softmaxTemperature);

    for (const id of eligibleModelIds) {
      const shifted = (rawScores[id] - maxScore) / temp;
      const expVal = Math.exp(shifted);
      expScores[id] = expVal;
      expSum += expVal;
    }

    for (const id of eligibleModelIds) {
      weights[id] = expSum > 0 ? expScores[id] / expSum : 1.0 / eligibleModelIds.length;
    }

    return this.enforceExactSum(weights, eligibleModelIds);
  }

  /**
   * Helper to ensure weights sum exactly to 1.0 and remain non-negative.
   */
  private static enforceExactSum(
    weights: Record<CandidateModelId, number>,
    eligibleModelIds: CandidateModelId[]
  ): Record<CandidateModelId, number> {
    if (eligibleModelIds.length === 0) return weights;

    let sum = 0;
    for (const id of eligibleModelIds) {
      weights[id] = Math.max(0, Math.round(weights[id] * 100000) / 100000);
      sum += weights[id];
    }

    if (sum <= 0) {
      const uniform = 1.0 / eligibleModelIds.length;
      for (const id of eligibleModelIds) {
        weights[id] = uniform;
      }
      return weights;
    }

    // Normalize
    let normalizedSum = 0;
    for (const id of eligibleModelIds) {
      weights[id] = weights[id] / sum;
      normalizedSum += weights[id];
    }

    // Precision adjustment to the highest weighted eligible model
    const diff = 1.0 - normalizedSum;
    if (Math.abs(diff) > 1e-9) {
      const topModel = eligibleModelIds.reduce((prev, curr) =>
        weights[curr] > weights[prev] ? curr : prev
      );
      weights[topModel] += diff;
    }

    return weights;
  }

  /**
   * Evaluates the AutoWeightedEnsemble for a target date and session.
   * 
   * Strict Point-In-Time Pipeline:
   * 1. Gather historical evaluations strictly before targetDate.
   * 2. Compute metrics and frozen model weights.
   * 3. Evaluate each eligible candidate model on date D's point-in-time feature vector.
   * 4. Compute weighted ensemble distribution: P_ens = sum(w_m * P_m).
   * 5. Return complete AutoWeightedEnsembleOutput with full auditability.
   */
  public static evaluateEnsemble(
    features: PredictionFeatureVector,
    allVerifiedRecords: VerifiedMarketRecord[],
    config: AutoWeightingConfig = DEFAULT_AUTO_WEIGHTING_CONFIG
  ): AutoWeightedEnsembleOutput {
    const session = features.session;
    const targetDate = features.targetDate;

    // 1. Build out-of-sample historical evaluations strictly before targetDate
    const historicalEvals = this.buildHistoricalEvaluations(
      allVerifiedRecords,
      targetDate,
      session,
      config
    );

    // 2. Compute performance metrics and model weights
    const metrics = this.calculatePerformanceMetrics(historicalEvals, session, config);
    const weights = this.calculateWeights(metrics, session, config);

    // 3. Evaluate eligible candidate models on target date's feature vector
    const allModels = CandidateModelLab.getAllModels();
    const modelOutputs: Partial<Record<CandidateModelId, CandidateModelOutput>> = {};
    const contributions: ModelContributionInfo[] = [];

    for (const model of allModels) {
      const eligibility = this.isModelEligibleForSession(model.modelId, session);
      const modelMetric = metrics[model.modelId];

      if (eligibility.eligible) {
        const out = model.predict(features);
        modelOutputs[model.modelId] = out;

        contributions.push({
          modelId: model.modelId,
          version: model.version,
          session,
          weight: weights[model.modelId] || 0,
          eligible: true,
          validationStatus: out.validationStatus,
          evaluationCount: modelMetric?.evaluationCount || 0,
          averageLogLoss: modelMetric?.averageLogLoss || 0,
          weightedLogLoss: modelMetric?.weightedLogLoss || 0,
          averageBrierScore: modelMetric?.averageBrierScore || 0,
          top1HitRate: modelMetric?.top1HitRate || 0,
          top5HitRate: modelMetric?.top5HitRate || 0,
          top10HitRate: modelMetric?.top10HitRate || 0,
          top1: out.top1,
          top5: out.top5,
          probabilities: out.probabilities,
        });
      } else {
        contributions.push({
          modelId: model.modelId,
          version: model.version,
          session,
          weight: 0,
          eligible: false,
          validationStatus: eligibility.status,
          evaluationCount: 0,
          averageLogLoss: 0,
          weightedLogLoss: 0,
          averageBrierScore: 0,
          top1HitRate: 0,
          top5HitRate: 0,
          top10HitRate: 0,
          top1: '--',
          top5: [],
          probabilities: new Array<number>(100).fill(0.01),
          rejectionReason: eligibility.reason,
        });
      }
    }

    // 4. Blend probabilities: P_ensemble[i] = sum_{m} w_m * P_m[i]
    const rawEnsembleProbs = new Array<number>(100).fill(0);
    for (let i = 0; i < 100; i++) {
      let blended = 0;
      for (const contrib of contributions) {
        if (contrib.eligible && contrib.weight > 0) {
          blended += contrib.weight * contrib.probabilities[i];
        }
      }
      rawEnsembleProbs[i] = blended;
    }

    const normEnsembleProbs = normalizeProbabilities(rawEnsembleProbs);

    // 5. Rank candidates 00..99
    const candidates: PredictionCandidate[] = [];
    for (let i = 0; i < 100; i++) {
      const twod = i.toString().padStart(2, '0');
      const prob = Math.round(normEnsembleProbs[i] * 100000) / 100000;
      candidates.push({
        rank: 0,
        twod,
        probability: prob,
        score: prob,
      });
    }

    // Deterministic sort: descending probability, lexicographical tie-break
    candidates.sort((a, b) => {
      if (b.probability !== a.probability) {
        return b.probability - a.probability;
      }
      return a.twod.localeCompare(b.twod);
    });

    for (let r = 0; r < candidates.length; r++) {
      candidates[r].rank = r + 1;
    }

    const top1 = candidates[0].twod;
    const top3 = candidates.slice(0, 3).map((c) => c.twod);
    const top5 = candidates.slice(0, 5).map((c) => c.twod);
    const top10 = candidates.slice(0, 10).map((c) => c.twod);

    const entropy = StatisticalEngine.computeShannonEntropy(normEnsembleProbs);
    const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;

    const sampleCount = features.distributions.sampleCountAllTime || 0;
    const depthFactor = Math.min(1.0, Math.max(0.0, (sampleCount - 10) / 140));
    const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));
    const rawConfidence = 20.0 + depthFactor * 40.0 + entropyFactor * 30.0;
    const confidenceScore = Math.min(85.0, Math.max(15.0, Math.round(rawConfidence * 10) / 10));

    const ensembleHash = computeProbabilityHash(normEnsembleProbs);

    // 6. Evidence window details
    const evalDates = historicalEvals.map((e) => e.evaluationDate).sort();
    const startDate = evalDates.length > 0 ? evalDates[0] : undefined;
    const endDate = evalDates.length > 0 ? evalDates[evalDates.length - 1] : undefined;

    const modelIdsAndVersions: Record<string, string> = {};
    for (const model of allModels) {
      modelIdsAndVersions[model.modelId] = model.version;
    }

    const audit: AutoWeightingAudit = {
      ensembleVersion: AUTO_WEIGHTED_ENSEMBLE_VERSION,
      session,
      targetDate,
      modelIdsAndVersions,
      modelWeights: weights,
      historicalEvidenceWindow: {
        startDate,
        endDate,
        evaluationCount: historicalEvals.length,
        windowType: config.windowType,
        recencyDecayFactor: config.recencyDecayFactor,
      },
      weightCalculationCutoff: features.cutoffTimestamp,
      scoringMetric: 'NEGATIVE_LOG_LIKELIHOOD',
      weightCalculationMethod: `RECENCY_DECAY_SOFTMAX_${config.windowType}`,
      featureContractVersion: 'v1.0.0-pit',
      inputIntegrityHash: features.featureIntegrityHash,
      ensembleProbabilityHash: ensembleHash,
      evaluationTimestamp: new Date().toISOString(),
    };

    return {
      ensembleVersion: AUTO_WEIGHTED_ENSEMBLE_VERSION,
      session,
      targetDate,
      cutoffTime: features.cutoffTimestamp,
      probabilities: normEnsembleProbs,
      candidates,
      top1,
      top3,
      top5,
      top10,
      entropy,
      topMargin,
      confidenceScore,
      modelWeights: weights,
      modelContributions: contributions,
      weightCalculationCutoff: features.cutoffTimestamp,
      evaluationWindow: {
        startDate,
        endDate,
        count: historicalEvals.length,
      },
      performanceEvidenceCount: historicalEvals.length,
      featureContractVersion: 'v1.0.0-pit',
      inputIntegrityHash: features.featureIntegrityHash,
      ensembleProbabilityHash: ensembleHash,
      audit,
    };
  }

  /**
   * Adapts an AutoWeightedEnsembleOutput to standard SessionPredictionOutput.
   */
  public static toSessionPredictionOutput(
    output: AutoWeightedEnsembleOutput
  ): SessionPredictionOutput {
    return {
      recordType: 'MODEL_PREDICTION',
      modelVersion: output.ensembleVersion,
      targetDate: output.targetDate,
      session: output.session,
      generatedAt: output.audit.evaluationTimestamp,
      cutoffTime: output.cutoffTime,
      isFrozen: false,
      status: 'PREDICTION_READY',
      candidates: output.candidates,
      top1: output.top1,
      top3: output.top3,
      top5: output.top5,
      top10: output.top10,
      entropy: output.entropy,
      topMargin: output.topMargin,
      confidenceScore: output.confidenceScore,
      featureIntegrityHash: output.inputIntegrityHash,
    };
  }
}
