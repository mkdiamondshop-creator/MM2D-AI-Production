import {
  PredictionFeatureVector,
  PredictionCandidate,
  SessionPredictionOutput,
  PRODUCTION_MODEL_VERSION,
  PredictionModelVersion,
} from '../../types/prediction';
import { VerifiedMarketRecord } from '../../types/market';
import { ModelComponentWeights } from '../../types/calibration';
import { StatisticalEngine } from './statisticalEngine';
import { CandidateModelLab } from './candidateModelLab';
import { AutoWeightingEngine } from './autoWeightingEngine';

/**
 * Authoritative Statistical Prediction Engine
 * 
 * Step 6.8 Validated Production Model: ALL_TIME_FREQUENCY_V1
 * Pure All-Time Empirical Frequency with Deterministic Laplace Smoothing.
 * 
 * Strict Invariants:
 * - Deterministic: Identical feature vectors produce bit-exact identical candidate rankings and probabilities.
 * - Anti-Certainty: Probabilities never claim 100% win guarantee; entropy and margins are fully disclosed.
 * - Zero Fabrication: Strictly derives distributions from verified settlements prior to session cutoff.
 * - Pure Model Isolation: Multi-component ensemble is relegated to explicit research mode.
 */
export class PredictionEngine {
  public static readonly PRODUCTION_MODEL = PRODUCTION_MODEL_VERSION;

  /**
   * Research / Diagnostic Ensemble Weights (Preserved for forensic comparative benchmarks)
   */
  public static readonly RESEARCH_ENSEMBLE_WEIGHTS_AM = {
    freqAllTime: 0.28,
    freqW30: 0.16,
    freqW10: 0.04,
    freqW5: 0.02,
    digitMarginals: 0.06,
    markovTransition: 0.12,
    weekdayPrior: 0.16,
    sessionPrior: 0.08,
    momentumIntraday: 0.08,
  };

  public static readonly RESEARCH_ENSEMBLE_WEIGHTS_PM = {
    freqAllTime: 0.22,
    freqW30: 0.14,
    freqW10: 0.04,
    freqW5: 0.02,
    digitMarginals: 0.05,
    markovTransition: 0.10,
    weekdayPrior: 0.14,
    sessionPrior: 0.07,
    amToPmAffinity: 0.18,
    momentumIntraday: 0.08,
  };

  /**
   * Generates Statistical Prediction output for a point-in-time feature vector.
   * By default, dispatches to session-isolated AM or PM prediction pipelines
   * executing the validated production model (ALL_TIME_FREQUENCY_V1).
   */
  public static generatePrediction(
    featureVector: PredictionFeatureVector,
    modelVersion: PredictionModelVersion = PRODUCTION_MODEL_VERSION,
    allVerifiedRecords?: VerifiedMarketRecord[]
  ): SessionPredictionOutput {
    if (
      modelVersion === 'STEP67_CALIBRATED_ENSEMBLE_RESEARCH' ||
      modelVersion === 'RESEARCH_ENSEMBLE_V1'
    ) {
      return this.generateResearchEnsemblePrediction(featureVector, modelVersion);
    }

    if (modelVersion === 'AUTO_WEIGHTED_ENSEMBLE_V1') {
      const records = allVerifiedRecords || [];
      const ensOut = AutoWeightingEngine.evaluateEnsemble(featureVector, records);
      return AutoWeightingEngine.toSessionPredictionOutput(ensOut);
    }

    if (featureVector.session === 'AM') {
      return this.generateAmPrediction(featureVector, modelVersion, allVerifiedRecords);
    }
    return this.generatePmPrediction(featureVector, modelVersion, allVerifiedRecords);
  }

  /**
   * Dedicated AM Prediction Pipeline
   * Operates strictly on verified historical AM settlements + AM pre-lock live SET/Value.
   * Produces ranked 00–99 candidates from AM-isolated empirical frequency.
   */
  public static generateAmPrediction(
    featureVector: PredictionFeatureVector,
    modelVersion: PredictionModelVersion = PRODUCTION_MODEL_VERSION,
    allVerifiedRecords?: VerifiedMarketRecord[]
  ): SessionPredictionOutput {
    if (featureVector.session !== 'AM') {
      throw new Error(`AmPredictionPipeline invoked with mismatched session: ${featureVector.session}`);
    }

    if (
      modelVersion === 'STEP67_CALIBRATED_ENSEMBLE_RESEARCH' ||
      modelVersion === 'RESEARCH_ENSEMBLE_V1'
    ) {
      return this.generateResearchEnsemblePrediction(featureVector, modelVersion);
    }

    if (modelVersion === 'AUTO_WEIGHTED_ENSEMBLE_V1') {
      const records = allVerifiedRecords || [];
      const ensOut = AutoWeightingEngine.evaluateEnsemble(featureVector, records);
      return AutoWeightingEngine.toSessionPredictionOutput(ensOut);
    }

    if (CandidateModelLab.isCandidateModel(modelVersion)) {
      const candidateOutput = CandidateModelLab.evaluateModel(modelVersion, featureVector);
      return CandidateModelLab.toSessionPredictionOutput(
        candidateOutput,
        featureVector.targetDate,
        featureVector.cutoffTimestamp,
        featureVector.featureIntegrityHash
      );
    }

    return this.generateAllTimeFrequencyPrediction(featureVector);
  }

  /**
   * Dedicated PM Prediction Pipeline
   * Operates strictly on verified historical PM settlements + today's verified 12:01 AM result + PM pre-lock live SET/Value.
   * Produces ranked 00–99 candidates from PM-isolated empirical frequency.
   */
  public static generatePmPrediction(
    featureVector: PredictionFeatureVector,
    modelVersion: PredictionModelVersion = PRODUCTION_MODEL_VERSION,
    allVerifiedRecords?: VerifiedMarketRecord[]
  ): SessionPredictionOutput {
    if (featureVector.session !== 'PM') {
      throw new Error(`PmPredictionPipeline invoked with mismatched session: ${featureVector.session}`);
    }

    if (
      modelVersion === 'STEP67_CALIBRATED_ENSEMBLE_RESEARCH' ||
      modelVersion === 'RESEARCH_ENSEMBLE_V1'
    ) {
      return this.generateResearchEnsemblePrediction(featureVector, modelVersion);
    }

    if (modelVersion === 'AUTO_WEIGHTED_ENSEMBLE_V1') {
      const records = allVerifiedRecords || [];
      const ensOut = AutoWeightingEngine.evaluateEnsemble(featureVector, records);
      return AutoWeightingEngine.toSessionPredictionOutput(ensOut);
    }

    if (CandidateModelLab.isCandidateModel(modelVersion)) {
      const candidateOutput = CandidateModelLab.evaluateModel(modelVersion, featureVector);
      return CandidateModelLab.toSessionPredictionOutput(
        candidateOutput,
        featureVector.targetDate,
        featureVector.cutoffTimestamp,
        featureVector.featureIntegrityHash
      );
    }

    return this.generateAllTimeFrequencyPrediction(featureVector);
  }

  /**
   * Step 6.8 Authoritative Production Model: ALL_TIME_FREQUENCY_V1
   * Pure All-Time Empirical Frequency distribution across 00..99 with Laplace smoothing.
   */
  public static generateAllTimeFrequencyPrediction(
    featureVector: PredictionFeatureVector
  ): SessionPredictionOutput {
    const pAllTime = featureVector.distributions.freqAllTime;
    const sampleCount = featureVector.distributions.sampleCountAllTime;

    // Build all 100 candidates
    const candidates: PredictionCandidate[] = [];
    for (let i = 0; i < 100; i++) {
      const twod = i.toString().padStart(2, '0');
      const prob = pAllTime[i] || 0.01;
      const roundedProb = Math.round(prob * 100000) / 100000;
      candidates.push({
        rank: 0,
        twod,
        probability: roundedProb,
        score: roundedProb,
      });
    }

    // Deterministic ranking: Sort descending by probability with strict lexicographical tie-break on 2D
    candidates.sort((a, b) => {
      if (b.probability !== a.probability) {
        return b.probability - a.probability;
      }
      return a.twod.localeCompare(b.twod);
    });

    // Assign 1-indexed ranks (1 to 100)
    for (let r = 0; r < candidates.length; r++) {
      candidates[r].rank = r + 1;
    }

    // Extract Top Sets
    const top1 = candidates[0].twod;
    const top3 = candidates.slice(0, 3).map((c) => c.twod);
    const top5 = candidates.slice(0, 5).map((c) => c.twod);
    const top10 = candidates.slice(0, 10).map((c) => c.twod);

    // Calculate Entropy & Margins
    const entropy = StatisticalEngine.computeShannonEntropy(pAllTime);
    const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;

    // Calibrated Confidence Rating (0-100 scale, strictly clamped to [15, 85] anti-certainty boundary)
    // 1. Effective sample count depth factor (from 10 baseline to 150+ robust settlements)
    const depthFactor = Math.min(1.0, Math.max(0.0, (sampleCount - 10) / 140));

    // 2. Entropy distribution sharpness factor (natural empirical entropy is ~6.5 - 6.6)
    const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));

    // 3. Top Margin advantage factor
    const marginFactor = Math.min(1.0, Math.max(0.0, topMargin / 0.015));

    // Blended Calibrated Confidence Score
    const rawConfidence = (depthFactor * 0.50 + entropyFactor * 0.25 + marginFactor * 0.25) * 100;
    const confidenceScore = Math.min(85, Math.max(15, Math.round(rawConfidence)));

    return {
      recordType: 'MODEL_PREDICTION',
      modelVersion: PRODUCTION_MODEL_VERSION,
      targetDate: featureVector.targetDate,
      session: featureVector.session,
      generatedAt: new Date().toISOString(),
      cutoffTime: featureVector.cutoffTimestamp,
      isFrozen: false,
      status: 'PREDICTION_READY',
      candidates,
      top1,
      top3,
      top5,
      top10,
      entropy,
      topMargin,
      confidenceScore,
      featureIntegrityHash: featureVector.featureIntegrityHash,
    };
  }

  /**
   * Research-Only: Step 6.7 Calibrated Multi-Component Ensemble
   */
  private static generateResearchEnsemblePrediction(
    featureVector: PredictionFeatureVector,
    modelVersion: PredictionModelVersion = 'RESEARCH_ENSEMBLE_V1'
  ): SessionPredictionOutput {
    const session = featureVector.session;
    const dist = featureVector.distributions;

    const pAllTime = dist.freqAllTime;
    const pW30 = dist.freqW30;
    const pW10 = dist.freqW10;
    const pW5 = dist.freqW5;

    // Digit Marginals Joint Product: P(Tens) * P(Units)
    const pDigitMarginals = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      const probD1 = dist.firstDigitFreqW30[d1] || 0.1;
      const probD2 = dist.secondDigitFreqW30[d2] || 0.1;
      pDigitMarginals[i] = probD1 * probD2;
    }
    const sumMarginals = pDigitMarginals.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 100; i++) {
      pDigitMarginals[i] /= sumMarginals;
    }

    const pMarkov = dist.markovTransitionProbabilities;
    const pWeekday = dist.weekdayFreq;
    const pSession = dist.sessionFreq;
    const pAmToPm = dist.amToPmTransitionProbabilities || new Array<number>(100).fill(1 / 100);
    const pMomentum = this.computeMomentumComponent(featureVector);

    const rawScores = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      let score = 0;
      if (session === 'AM') {
        const w = this.RESEARCH_ENSEMBLE_WEIGHTS_AM;
        score += w.freqAllTime * pAllTime[i];
        score += w.freqW30 * pW30[i];
        score += w.freqW10 * pW10[i];
        score += w.freqW5 * pW5[i];
        score += w.digitMarginals * pDigitMarginals[i];
        score += w.markovTransition * pMarkov[i];
        score += w.weekdayPrior * pWeekday[i];
        score += w.sessionPrior * pSession[i];
        score += w.momentumIntraday * pMomentum[i];
      } else {
        const w = this.RESEARCH_ENSEMBLE_WEIGHTS_PM;
        score += w.freqAllTime * pAllTime[i];
        score += w.freqW30 * pW30[i];
        score += w.freqW10 * pW10[i];
        score += w.freqW5 * pW5[i];
        score += w.digitMarginals * pDigitMarginals[i];
        score += w.markovTransition * pMarkov[i];
        score += w.weekdayPrior * pWeekday[i];
        score += w.sessionPrior * pSession[i];
        score += w.amToPmAffinity * pAmToPm[i];
        score += w.momentumIntraday * pMomentum[i];
      }
      rawScores[i] = Math.max(0.00001, score);
    }

    const totalScore = rawScores.reduce((a, b) => a + b, 0);
    const normalizedProbabilities = rawScores.map((s) => s / totalScore);

    const candidates: PredictionCandidate[] = [];
    for (let i = 0; i < 100; i++) {
      const twod = i.toString().padStart(2, '0');
      candidates.push({
        rank: 0,
        twod,
        probability: Math.round(normalizedProbabilities[i] * 100000) / 100000,
        score: Math.round(rawScores[i] * 100000) / 100000,
      });
    }

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

    const entropy = StatisticalEngine.computeShannonEntropy(normalizedProbabilities);
    const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;

    const depthFactor = Math.min(1.0, Math.max(0.0, (dist.sampleCountAllTime - 10) / 140));
    const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));
    const liveFactor = featureVector.isPreLockLiveAvailable ? 1.0 : 0.65;

    const rawConfidence = (depthFactor * 0.40 + entropyFactor * 0.35 + liveFactor * 0.25) * 100;
    const confidenceScore = Math.min(85, Math.max(15, Math.round(rawConfidence)));

    return {
      recordType: 'MODEL_PREDICTION',
      modelVersion,
      targetDate: featureVector.targetDate,
      session: featureVector.session,
      generatedAt: new Date().toISOString(),
      cutoffTime: featureVector.cutoffTimestamp,
      isFrozen: false,
      status: 'PREDICTION_READY',
      candidates,
      top1,
      top3,
      top5,
      top10,
      entropy,
      topMargin,
      confidenceScore,
      featureIntegrityHash: featureVector.featureIntegrityHash,
    };
  }

  /**
   * Generates Statistical Prediction output given specific deterministic component weights.
   * Enables clean calibration and candidate evaluation without hard-coding future models.
   */
  public static generateConfiguredPrediction(
    featureVector: PredictionFeatureVector,
    weights: ModelComponentWeights,
    modelVersion: string = 'CONFIGURED_CANDIDATE'
  ): SessionPredictionOutput {
    // If weights are 100% freqAllTime, delegate directly to authoritative all-time baseline
    if (
      weights.freqAllTime >= 0.99999 &&
      !weights.freqW30 &&
      !weights.freqW10 &&
      !weights.freqW5 &&
      !weights.weekdayPrior &&
      !weights.sessionPrior &&
      !weights.amToPmAffinity &&
      !weights.digitMarginals &&
      !weights.markovTransition &&
      !weights.momentumIntraday
    ) {
      const baseOut = this.generateAllTimeFrequencyPrediction(featureVector);
      return { ...baseOut, modelVersion };
    }

    const dist = featureVector.distributions;
    const pAllTime = dist.freqAllTime;
    const pW30 = dist.freqW30;
    const pW10 = dist.freqW10;
    const pW5 = dist.freqW5;

    // Digit Marginals Joint Product: P(Tens) * P(Units)
    let pDigitMarginals: number[] | null = null;
    if (weights.digitMarginals && weights.digitMarginals > 0) {
      pDigitMarginals = new Array<number>(100);
      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        const probD1 = dist.firstDigitFreqW30[d1] || 0.1;
        const probD2 = dist.secondDigitFreqW30[d2] || 0.1;
        pDigitMarginals[i] = probD1 * probD2;
      }
      const sumMarginals = pDigitMarginals.reduce((a, b) => a + b, 0);
      for (let i = 0; i < 100; i++) {
        pDigitMarginals[i] /= (sumMarginals || 1);
      }
    }

    const pMarkov = dist.markovTransitionProbabilities;
    const pWeekday = dist.weekdayFreq;
    const pSession = dist.sessionFreq;
    const pAmToPm = dist.amToPmTransitionProbabilities;
    const pMomentum = weights.momentumIntraday && weights.momentumIntraday > 0
      ? this.computeMomentumComponent(featureVector)
      : null;

    const rawScores = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      let score = 0;
      if (weights.freqAllTime) score += weights.freqAllTime * pAllTime[i];
      if (weights.freqW30 && pW30) score += weights.freqW30 * pW30[i];
      if (weights.freqW10 && pW10) score += weights.freqW10 * pW10[i];
      if (weights.freqW5 && pW5) score += weights.freqW5 * pW5[i];
      if (weights.digitMarginals && pDigitMarginals) score += weights.digitMarginals * pDigitMarginals[i];
      if (weights.markovTransition && pMarkov) score += weights.markovTransition * pMarkov[i];
      if (weights.weekdayPrior && pWeekday) score += weights.weekdayPrior * pWeekday[i];
      if (weights.sessionPrior && pSession) score += weights.sessionPrior * pSession[i];
      if (weights.amToPmAffinity && pAmToPm) score += weights.amToPmAffinity * pAmToPm[i];
      if (weights.momentumIntraday && pMomentum) score += weights.momentumIntraday * pMomentum[i];

      rawScores[i] = Math.max(0.00001, score);
    }

    const totalScore = rawScores.reduce((a, b) => a + b, 0);
    const normalizedProbabilities = rawScores.map((s) => s / totalScore);

    const candidates: PredictionCandidate[] = [];
    for (let i = 0; i < 100; i++) {
      const twod = i.toString().padStart(2, '0');
      candidates.push({
        rank: 0,
        twod,
        probability: Math.round(normalizedProbabilities[i] * 100000) / 100000,
        score: Math.round(rawScores[i] * 100000) / 100000,
      });
    }

    // Deterministic ranking: Sort descending by probability with strict lexicographical tie-break
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

    const entropy = StatisticalEngine.computeShannonEntropy(normalizedProbabilities);
    const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;

    const depthFactor = Math.min(1.0, Math.max(0.0, (dist.sampleCountAllTime - 10) / 140));
    const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));
    const marginFactor = Math.min(1.0, Math.max(0.0, topMargin / 0.015));

    const rawConfidence = (depthFactor * 0.50 + entropyFactor * 0.25 + marginFactor * 0.25) * 100;
    const confidenceScore = Math.min(85, Math.max(15, Math.round(rawConfidence)));

    return {
      recordType: 'MODEL_PREDICTION',
      modelVersion,
      targetDate: featureVector.targetDate,
      session: featureVector.session,
      generatedAt: new Date().toISOString(),
      cutoffTime: featureVector.cutoffTimestamp,
      isFrozen: false,
      status: 'PREDICTION_READY',
      candidates,
      top1,
      top3,
      top5,
      top10,
      entropy,
      topMargin,
      confidenceScore,
      featureIntegrityHash: featureVector.featureIntegrityHash,
    };
  }

  /**
   * Computes Intraday Pre-Lock SET & Value Movement Component Distribution
   */
  private static computeMomentumComponent(featureVector: PredictionFeatureVector): number[] {
    const momentum = featureVector.momentum;
    const result = new Array<number>(100).fill(1 / 100);

    if (momentum.currentSet === null || momentum.currentValue === null) {
      return result;
    }

    const setStr = momentum.currentSet.toFixed(2);
    const setParts = setStr.split('.');
    const setTail = setParts[1] || '00';
    const setTens = parseInt(setTail[0], 10);
    const setUnits = parseInt(setTail[1], 10);

    const valInt = Math.floor(momentum.currentValue);
    const valTail = (valInt % 10);

    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;

      let affinity = 1.0;
      if (d1 === setUnits) affinity += 1.2;
      if (d2 === setUnits) affinity += 0.8;
      if (d2 === valTail) affinity += 1.5;
      if (d1 === valTail) affinity += 0.6;
      if (d1 === setTens) affinity += 0.5;

      result[i] = affinity;
    }

    const sum = result.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 100; i++) {
      result[i] /= sum;
    }

    return result;
  }
}

