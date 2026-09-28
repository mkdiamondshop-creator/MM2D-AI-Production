import { MarketSession } from '../../types/market';
import {
  PredictionCandidate,
  PredictionFeatureVector,
  SessionPredictionOutput,
} from '../../types/prediction';
import {
  CandidateModel,
  CandidateModelAudit,
  CandidateModelId,
  CandidateModelOutput,
  ModelValidationStatus,
} from '../../types/candidateModel';
import { StatisticalEngine } from './statisticalEngine';

/**
 * Normalizes an array of raw probabilities so that:
 * 1. Exactly 100 elements
 * 2. Every element is finite and >= 0
 * 3. Sum of elements equals exactly 1.0
 */
export function normalizeProbabilities(raw: number[]): number[] {
  if (!raw || raw.length !== 100) {
    return new Array<number>(100).fill(1 / 100);
  }

  let sum = 0;
  const cleaned = new Array<number>(100);
  for (let i = 0; i < 100; i++) {
    const val = typeof raw[i] === 'number' && !isNaN(raw[i]) && isFinite(raw[i]) ? Math.max(0, raw[i]) : 0;
    cleaned[i] = val;
    sum += val;
  }

  if (sum <= 0) {
    return new Array<number>(100).fill(1 / 100);
  }

  const normalized = new Array<number>(100);
  for (let i = 0; i < 100; i++) {
    normalized[i] = cleaned[i] / sum;
  }
  return normalized;
}

/**
 * Computes deterministic probability hash for auditability
 */
export function computeProbabilityHash(probabilities: number[]): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < 100; i++) {
    const val = Math.round(probabilities[i] * 100000);
    hash ^= val + i * 31;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Standardized Candidate Builder and Ranker
 * Generates ranked 00..99 candidates, Top 1, Top 5, Top 10, entropy, margin, and confidence.
 */
export function buildCandidateOutput(
  modelId: CandidateModelId,
  version: string,
  session: MarketSession,
  probabilities: number[],
  features: PredictionFeatureVector,
  validationStatus: ModelValidationStatus,
  auditDetails?: string
): CandidateModelOutput {
  const normProbs = normalizeProbabilities(probabilities);

  // 1. Build 100 candidates
  const candidates: PredictionCandidate[] = [];
  for (let i = 0; i < 100; i++) {
    const twod = i.toString().padStart(2, '0');
    const prob = Math.round(normProbs[i] * 100000) / 100000;
    candidates.push({
      rank: 0,
      twod,
      probability: prob,
      score: prob,
    });
  }

  // 2. Deterministic sort: descending by probability, lexicographical tie-break on 2D
  candidates.sort((a, b) => {
    if (b.probability !== a.probability) {
      return b.probability - a.probability;
    }
    return a.twod.localeCompare(b.twod);
  });

  // 3. Assign ranks (1 to 100)
  for (let r = 0; r < candidates.length; r++) {
    candidates[r].rank = r + 1;
  }

  // 4. Extract Top Sets
  const top1 = candidates[0].twod;
  const top5 = candidates.slice(0, 5).map((c) => c.twod);
  const top10 = candidates.slice(0, 10).map((c) => c.twod);

  // 5. Entropy & Confidence
  const entropy = StatisticalEngine.computeShannonEntropy(normProbs);
  const topMargin =
    Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;

  const sampleCount = features.distributions.sampleCountAllTime || 0;
  const depthFactor = Math.min(1.0, Math.max(0.0, (sampleCount - 10) / 140));
  const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));
  const rawConfidence = 15.0 + depthFactor * 40.0 + entropyFactor * 30.0;
  const confidenceScore = Math.min(85.0, Math.max(15.0, Math.round(rawConfidence * 10) / 10));

  // 6. Audit Record
  const probHash = computeProbabilityHash(normProbs);
  const audit: CandidateModelAudit = {
    modelId,
    version,
    session,
    evaluationDate: features.targetDate,
    featureContractVersion: 'v1.0.0-pit',
    inputIntegrityHash: features.featureIntegrityHash,
    candidateProbabilityHash: probHash,
    trainingCutoff: features.cutoffTimestamp,
    evaluationTimestamp: new Date().toISOString(),
    validationStatus,
    auditDetails,
  };

  return {
    modelId,
    version,
    session,
    probabilities: normProbs,
    candidates,
    top1,
    top5,
    top10,
    entropy,
    topMargin,
    confidenceScore,
    validationStatus,
    audit,
  };
}

/**
 * MODEL 1: SessionFrequencyModel
 * Calculates empirical frequency from the session-isolated historical dataset.
 */
export class SessionFrequencyModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'SESSION_FREQUENCY_V1';
  public readonly version = '1.0.0';
  public readonly session = 'BOTH';
  public readonly requiredFeatures: readonly string[] = [
    'AM_HISTORICAL_SETTLEMENTS',
    'AM_DISTRIBUTIONS_HISTORICAL',
    'PM_HISTORICAL_SETTLEMENTS',
    'PM_DISTRIBUTIONS_HISTORICAL',
  ];
  public readonly description =
    'Session-isolated empirical historical frequency with Laplace smoothing.';

  public getValidationStatus(): ModelValidationStatus {
    return 'READY';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    // Session-isolated historical frequency is stored in sessionFreq / freqAllTime
    const probs = features.distributions.sessionFreq || features.distributions.freqAllTime;
    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      probs,
      features,
      'READY',
      'Session-isolated empirical frequency calculated from verified historical settlements.'
    );
  }
}

/**
 * Configuration for Recency Weighted Frequency Model
 */
export interface RecencyWeightConfig {
  w5Weight: number; // 5-sample short horizon weight
  w10Weight: number; // 10-sample medium horizon weight
  w30Weight: number; // 30-sample long horizon weight
  allTimeWeight: number; // Baseline all-time weight
}

/**
 * MODEL 2: RecencyWeightedFrequencyModel
 * Weights historical observations by recency using an explicit, configurable horizon weight vector.
 * Does not tune parameters using future evaluation data.
 */
export class RecencyWeightedFrequencyModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'RECENCY_WEIGHTED_FREQUENCY_V1';
  public readonly version = '1.0.0';
  public readonly session = 'BOTH';
  public readonly requiredFeatures: readonly string[] = [
    'AM_DISTRIBUTIONS_HISTORICAL',
    'PM_DISTRIBUTIONS_HISTORICAL',
  ];
  public readonly description =
    'Recency-weighted empirical frequency across multiple historical lookback horizons.';

  private readonly config: RecencyWeightConfig;

  constructor(
    config: RecencyWeightConfig = {
      w5Weight: 0.1,
      w10Weight: 0.2,
      w30Weight: 0.4,
      allTimeWeight: 0.3,
    }
  ) {
    this.config = config;
  }

  public getValidationStatus(): ModelValidationStatus {
    return 'READY';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    const dist = features.distributions;
    const probs = new Array<number>(100);

    const w5 = dist.freqW5;
    const w10 = dist.freqW10;
    const w30 = dist.freqW30;
    const all = dist.freqAllTime;

    const { w5Weight, w10Weight, w30Weight, allTimeWeight } = this.config;
    const totalWeight = w5Weight + w10Weight + w30Weight + allTimeWeight;

    for (let i = 0; i < 100; i++) {
      const p5 = w5 && w5[i] !== undefined ? w5[i] : 0.01;
      const p10 = w10 && w10[i] !== undefined ? w10[i] : 0.01;
      const p30 = w30 && w30[i] !== undefined ? w30[i] : 0.01;
      const pAll = all && all[i] !== undefined ? all[i] : 0.01;

      probs[i] =
        (w5Weight * p5 + w10Weight * p10 + w30Weight * p30 + allTimeWeight * pAll) / totalWeight;
    }

    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      probs,
      features,
      'READY',
      `Recency horizon weights applied: [W5: ${w5Weight}, W10: ${w10Weight}, W30: ${w30Weight}, AllTime: ${allTimeWeight}]`
    );
  }
}

/**
 * MODEL 3: AmToPmConditionalModel
 * PM ONLY.
 * Estimates P(PM 2D | historical AM 2D).
 * Today's verified AM official settlement conditions the PM distribution.
 * Never uses today's PM result.
 */
export class AmToPmConditionalModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'AM_TO_PM_CONDITIONAL_V1';
  public readonly version = '1.0.0';
  public readonly session = 'PM';
  public readonly requiredFeatures: readonly string[] = [
    'SAME_DAY_AM_OFFICIAL_SETTLEMENT',
    'PM_AM_TO_PM_TRANSITION_PROBABILITIES',
  ];
  public readonly description =
    'Conditional PM distribution conditioned on same-day verified 12:01 AM settlement.';

  public getValidationStatus(features?: PredictionFeatureVector): ModelValidationStatus {
    if (!features) return 'READY';
    if (features.session !== 'PM') return 'FAILED_CONTRACT';
    if (!features.distributions.todayAmSettlement2D) return 'REQUIRES_MORE_DATA';
    return 'READY';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    // 1. Enforce PM-Only Contract
    if (features.session !== 'PM') {
      return buildCandidateOutput(
        this.modelId,
        this.version,
        features.session,
        new Array<number>(100).fill(1 / 100),
        features,
        'FAILED_CONTRACT',
        'AmToPmConditionalModel is strictly restricted to PM session.'
      );
    }

    // 2. Check conditioning availability
    const todayAm = features.distributions.todayAmSettlement2D;
    if (!todayAm) {
      return buildCandidateOutput(
        this.modelId,
        this.version,
        features.session,
        features.distributions.freqAllTime,
        features,
        'REQUIRES_MORE_DATA',
        "Waiting for today's verified 12:01 AM official settlement."
      );
    }

    // 3. Extract conditional transition distribution
    const transProbs = features.distributions.amToPmTransitionProbabilities;
    if (!transProbs || transProbs.length !== 100) {
      return buildCandidateOutput(
        this.modelId,
        this.version,
        features.session,
        features.distributions.freqAllTime,
        features,
        'REQUIRES_MORE_DATA',
        'AM->PM transition probabilities matrix unavailable.'
      );
    }

    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      transProbs,
      features,
      'READY',
      `Conditioned on verified same-day AM settlement (${todayAm}).`
    );
  }
}

/**
 * MODEL 4: MarkovTransitionModel
 * Uses valid historical sequential transitions available strictly before evaluation timestamp.
 * Session-aware: Evaluates transition from prior session settlement.
 */
export class MarkovTransitionModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'MARKOV_TRANSITION_V1';
  public readonly version = '1.0.0';
  public readonly session = 'BOTH';
  public readonly requiredFeatures: readonly string[] = [
    'AM_HISTORICAL_SETTLEMENTS',
    'AM_MARKOV_TRANSITIONS',
    'PM_HISTORICAL_SETTLEMENTS',
    'PM_MARKOV_TRANSITIONS',
  ];
  public readonly description =
    'First-order Markov chain empirical transition distribution P(Y_t | Y_{t-1}).';

  public getValidationStatus(): ModelValidationStatus {
    return 'READY';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    const markovProbs = features.distributions.markovTransitionProbabilities;
    const prev2D = features.distributions.prevSettlement2D;

    if (!markovProbs || markovProbs.length !== 100) {
      return buildCandidateOutput(
        this.modelId,
        this.version,
        features.session,
        features.distributions.freqAllTime,
        features,
        'READY',
        'Markov probabilities unavailable, defaulted to base frequency.'
      );
    }

    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      markovProbs,
      features,
      'READY',
      `Markov sequential transition evaluated from prior session settlement: ${prev2D ?? 'none (blended)'}`
    );
  }
}

/**
 * MODEL 5: IntradaySetValueStatisticalModel
 * Uses only validated pre-lock SET/Value observations.
 * Never consumes any 2D or result field.
 *
 * CRITICAL RULE: If historical intraday resolution is insufficient for honest backtesting,
 * mark the model UNTESTABLE rather than creating synthetic/interpolated historical data.
 */
export class IntradaySetValueStatisticalModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'INTRADAY_SET_VALUE_STATISTICAL_V1';
  public readonly version = '1.0.0';
  public readonly session = 'BOTH';
  public readonly requiredFeatures: readonly string[] = [
    'AM_PRE_LOCK_SET_INDEX',
    'AM_PRE_LOCK_MARKET_VALUE',
    'AM_PRE_LOCK_SET_CHANGE',
    'AM_PRE_LOCK_VALUE_CHANGE',
    'PM_PRE_LOCK_SET_INDEX',
    'PM_PRE_LOCK_MARKET_VALUE',
    'PM_PRE_LOCK_SET_CHANGE',
    'PM_PRE_LOCK_VALUE_CHANGE',
  ];
  public readonly description =
    'Statistical prior derived from pre-lock SET index drift and market value flow without 2D inspection.';

  public getValidationStatus(features?: PredictionFeatureVector): ModelValidationStatus {
    if (!features) return 'UNTESTABLE';
    // If evaluated on historical backtest data without intraday tick resolution:
    if (!features.isPreLockLiveAvailable || features.momentum.observationCount < 2) {
      return 'UNTESTABLE';
    }
    return 'READY';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    // 1. Backtest & Insufficient Granularity Check
    if (!features.isPreLockLiveAvailable || features.momentum.observationCount < 2) {
      return buildCandidateOutput(
        this.modelId,
        this.version,
        features.session,
        new Array<number>(100).fill(1 / 100),
        features,
        'UNTESTABLE',
        'Historical intraday tick resolution is unavailable in settlement records; synthetic data interpolation is prohibited by MM2D zero-fabrication rules.'
      );
    }

    // 2. Statistical Prior Derivation from Valid Pre-Lock SET & Value only (Zero 2D inspection)
    const setChange = features.momentum.setChangeFromSessionOpen || 0;
    const valueChange = features.momentum.valueChangeFromSessionOpen || 0;
    const baseFreq = features.distributions.freqAllTime;

    const probs = new Array<number>(100);
    const setDirection = setChange > 0 ? 1 : setChange < 0 ? -1 : 0;
    const valueMagnitudeFactor = Math.min(1.0, Math.abs(valueChange) / 10000);

    for (let i = 0; i < 100; i++) {
      const base = baseFreq && baseFreq[i] !== undefined ? baseFreq[i] : 0.01;
      const tens = Math.floor(i / 10);
      const units = i % 10;

      // Pure macro momentum drift modulation (no result inspection)
      let driftBoost = 1.0;
      if (setDirection > 0 && tens >= 5) driftBoost += 0.05 * valueMagnitudeFactor;
      if (setDirection < 0 && tens < 5) driftBoost += 0.05 * valueMagnitudeFactor;
      if (units % 2 === (setDirection >= 0 ? 0 : 1)) driftBoost += 0.02;

      probs[i] = base * driftBoost;
    }

    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      probs,
      features,
      'READY',
      `Derived from ${features.momentum.observationCount} valid pre-lock SET/Value ticks (SET delta: ${setChange.toFixed(2)}, Value delta: ${valueChange.toFixed(2)}).`
    );
  }
}

/**
 * MODEL 6: HybridCandidateModel
 * Combines independently validated candidate distributions with fixed, non-optimized weights.
 *
 * RULE: If insufficient validation infrastructure exists, implement the interface but do not activate it.
 * Marked as NOT_ACTIVATED.
 */
export class HybridCandidateModel implements CandidateModel {
  public readonly modelId: CandidateModelId = 'HYBRID_CANDIDATE_V1';
  public readonly version = '1.0.0';
  public readonly session = 'BOTH';
  public readonly requiredFeatures: readonly string[] = [
    'AM_HISTORICAL_SETTLEMENTS',
    'AM_DISTRIBUTIONS_HISTORICAL',
    'PM_HISTORICAL_SETTLEMENTS',
    'PM_DISTRIBUTIONS_HISTORICAL',
    'SAME_DAY_AM_OFFICIAL_SETTLEMENT',
  ];
  public readonly description =
    'Equal-weighted composite of independently validated candidate models (Inactive / Not Promoted).';

  private readonly sessionFreqModel = new SessionFrequencyModel();
  private readonly recencyModel = new RecencyWeightedFrequencyModel();
  private readonly amToPmModel = new AmToPmConditionalModel();

  public getValidationStatus(): ModelValidationStatus {
    return 'NOT_ACTIVATED';
  }

  public predict(features: PredictionFeatureVector): CandidateModelOutput {
    const m1 = this.sessionFreqModel.predict(features);
    const m2 = this.recencyModel.predict(features);

    const probs = new Array<number>(100);

    if (features.session === 'PM' && features.distributions.todayAmSettlement2D) {
      const m3 = this.amToPmModel.predict(features);
      // Fixed prior weights: 40% session freq, 30% recency, 30% AM->PM conditional
      for (let i = 0; i < 100; i++) {
        probs[i] = 0.4 * m1.probabilities[i] + 0.3 * m2.probabilities[i] + 0.3 * m3.probabilities[i];
      }
    } else {
      // 50% session freq, 50% recency
      for (let i = 0; i < 100; i++) {
        probs[i] = 0.5 * m1.probabilities[i] + 0.5 * m2.probabilities[i];
      }
    }

    return buildCandidateOutput(
      this.modelId,
      this.version,
      features.session,
      probs,
      features,
      'NOT_ACTIVATED',
      'Candidate model is inactive: awaiting completion of out-of-sample multi-model validation infrastructure.'
    );
  }
}

/**
 * CANDIDATE MODEL LAB REGISTRY
 * Central execution and benchmarking environment for candidate models.
 */
export class CandidateModelLab {
  private static readonly models: Map<CandidateModelId, CandidateModel> = new Map<
    CandidateModelId,
    CandidateModel
  >([
    ['SESSION_FREQUENCY_V1', new SessionFrequencyModel()],
    ['RECENCY_WEIGHTED_FREQUENCY_V1', new RecencyWeightedFrequencyModel()],
    ['AM_TO_PM_CONDITIONAL_V1', new AmToPmConditionalModel()],
    ['MARKOV_TRANSITION_V1', new MarkovTransitionModel()],
    ['INTRADAY_SET_VALUE_STATISTICAL_V1', new IntradaySetValueStatisticalModel()],
    ['HYBRID_CANDIDATE_V1', new HybridCandidateModel()],
  ]);

  /**
   * Retrieves a candidate model by ID
   */
  public static getModel(id: string): CandidateModel | undefined {
    return this.models.get(id as CandidateModelId);
  }

  /**
   * Checks if an ID corresponds to a registered candidate model
   */
  public static isCandidateModel(id: string): boolean {
    return this.models.has(id as CandidateModelId);
  }

  /**
   * Returns all registered candidate models
   */
  public static getAllModels(): CandidateModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Evaluates a specific candidate model on a point-in-time feature vector
   */
  public static evaluateModel(
    id: CandidateModelId | string,
    features: PredictionFeatureVector
  ): CandidateModelOutput {
    const model = this.models.get(id as CandidateModelId);
    if (!model) {
      throw new Error(`Unknown candidate model identifier: ${id}`);
    }
    return model.predict(features);
  }

  /**
   * Evaluates all candidate models against a point-in-time feature vector
   */
  public static evaluateAllCandidates(
    features: PredictionFeatureVector
  ): CandidateModelOutput[] {
    return Array.from(this.models.values()).map((model) => model.predict(features));
  }

  /**
   * Adapts a CandidateModelOutput into a standard SessionPredictionOutput
   * for seamless backtesting without modifying ALL_TIME_FREQUENCY_V1.
   */
  public static toSessionPredictionOutput(
    output: CandidateModelOutput,
    targetDate: string,
    cutoffTime: string,
    featureIntegrityHash: string
  ): SessionPredictionOutput {
    return {
      recordType: 'MODEL_PREDICTION',
      modelVersion: output.modelId,
      targetDate,
      session: output.session,
      generatedAt: output.audit.evaluationTimestamp,
      cutoffTime,
      isFrozen: false,
      status: 'PREDICTION_READY',
      candidates: output.candidates,
      top1: output.top1,
      top3: output.candidates.slice(0, 3).map((c) => c.twod),
      top5: output.top5,
      top10: output.top10,
      entropy: output.entropy,
      topMargin: output.topMargin,
      confidenceScore: output.confidenceScore,
      featureIntegrityHash,
    };
  }
}
