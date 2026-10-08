import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  SET_DAY_NAMES,
} from './setLastDigitSignalV1';
import { computeProbabilityHash, normalizeProbabilities } from './autoWeightedV2Engine';
import { MarketCalendar } from '../market/marketCalendar';

/**
 * MM2D V3 — Joint SET x Value Trajectory Architecture
 *
 * Core Principle:
 * Official 2D = (SET settlement last decimal digit) + (Value settlement last integer digit)
 *
 * Models:
 * 1. SET settlement last decimal digit (0-9) conditioned on live SET trajectory + historical settlement priors
 * 2. Value settlement last integer digit (0-9) conditioned on live Value trajectory + historical settlement priors
 * 3. Learned joint SET x Value contingency distribution P(SET_digit, Value_digit)
 * 4. Combines marginal digit predictions with the learned joint relationship across all 100 2D pairs (00-99)
 */

export interface TrajectoryPoint {
  time: string; // HH:mm:ss
  value: number; // numeric price or value metric
  timestamp?: string;
}

export interface TrajectoryFeatures {
  count: number;
  firstValue: number;
  lastValue: number;
  delta: number;
  min: number;
  max: number;
  range: number;
  mean: number;
  volatility: number;
  rateOfChange: number; // units per minute based on actual time elapsed
  timeRemainingSeconds: number; // seconds remaining to cutoff lock
  previousSettlementDistance: number | null; // distance from prior session official settlement
  momentumDirection: 1 | 0 | -1;
  recentLastDigit: number; // last digit of latest value
  digitTransitions: Array<{ from: number; to: number }>;
  transitionMatrix: number[][]; // [10][10] empirical transition probabilities between digits
  digitFrequencies: number[]; // frequency of each digit 0-9 in trajectory
}

export interface SetValueJointDistribution {
  jointProbabilities: number[][]; // [10][10] matrix where [d_set][d_val] is prob of 2D = d_set * 10 + d_val
  totalSamples: number;
  conditionalValueGivenSet: number[][]; // [10][10] P(val_digit | set_digit)
  conditionalSetGivenValue: number[][]; // [10][10] P(set_digit | val_digit)
}

export interface V3ComponentModelWeights {
  setTrajectoryWeight: number;
  valTrajectoryWeight: number;
  jointHistoricalWeight: number;
  sessionPriorWeight: number;
}

export interface V3CandidateAttribution {
  twod: string;
  setDigit: number;
  valueDigit: number;
  setDigitProb: number;
  valueDigitProb: number;
  jointProb: number;
  independentProductProb: number;
  ensembleScore: number;
}

export interface V3Candidate {
  rank: number;
  twod: string;
  probability: number;
  score: number;
  setDigit: number;
  valueDigit: number;
  attribution: V3CandidateAttribution;
}

export interface V3PredictionOutput {
  modelId: 'MM2D_V3_JOINT_TRAJECTORY';
  version: '3.0.0';
  session: MarketSession;
  targetDate: string;
  cutoffTime: string;
  isLocked: boolean;
  probabilities: number[]; // 100 probabilities 00-99 summing to 1.0
  candidates: V3Candidate[]; // 100 candidates ranked 1..100
  top1: string;
  top3: string[];
  top5: string[];
  top10: string[];
  setDigitProbabilities: number[]; // 10 probabilities for SET settlement digit 0-9
  valueDigitProbabilities: number[]; // 10 probabilities for Value settlement digit 0-9
  setTrajectoryFeatures: TrajectoryFeatures | null;
  valTrajectoryFeatures: TrajectoryFeatures | null;
  weights: V3ComponentModelWeights;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  auditDetails: string;
  inputIntegrityHash: string;
  distributionHash: string;
}

/**
 * Extracts target SET settlement decimal digit ('0'-'9').
 * Financial SET is rounded to 2 decimals, e.g. 1581.67 -> '7'.
 */
export function extractSettlementSetDecimalDigit(setVal: number | string): number {
  if (typeof setVal === 'string') {
    const clean = setVal.replace(/,/g, '').trim();
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const decimals = parts[1].replace(/[^\d]/g, '');
      if (decimals.length >= 2) {
        return parseInt(decimals[1], 10);
      }
      if (decimals.length === 1) {
        return parseInt(decimals[0], 10);
      }
    }
    const digitsOnly = clean.replace(/[^\d]/g, '');
    return digitsOnly.length > 0 ? parseInt(digitsOnly.slice(-1), 10) : 0;
  }

  if (typeof setVal === 'number' && Number.isFinite(setVal)) {
    const str = setVal.toFixed(2);
    return parseInt(str.slice(-1), 10);
  }

  return 0;
}

/**
 * Extracts target Value settlement integer digit before decimal point ('0'-'9').
 * E.g., 49707.75 -> '7'
 *       31121.43 -> '1'
 */
export function extractSettlementValueIntegerDigit(val: number | string): number {
  if (typeof val === 'string') {
    const clean = val.replace(/,/g, '').trim();
    const integerPart = clean.split('.')[0].replace(/[^\d]/g, '');
    return integerPart.length > 0 ? parseInt(integerPart.slice(-1), 10) : 0;
  }

  if (typeof val === 'number' && Number.isFinite(val)) {
    const intVal = Math.floor(Math.abs(val));
    return intVal % 10;
  }

  return 0;
}

/**
 * Trajectory Feature Extractor
 */
export class TrajectoryFeatureExtractor {
  public static extract(
    points: TrajectoryPoint[],
    isSet: boolean,
    cutoffTime: string = '12:00:00',
    previousSettlementValue?: number | null
  ): TrajectoryFeatures | null {
    if (!points || points.length === 0) return null;

    const values = points.map((p) => p.value);
    const count = values.length;
    const firstValue = values[0];
    const lastValue = values[count - 1];
    const delta = lastValue - firstValue;

    // Time calculations
    const parseTimeToSeconds = (t: string): number => {
      const parts = t.slice(0, 8).split(':').map((x) => parseInt(x, 10));
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };

    const firstTimeSec = parseTimeToSeconds(points[0].time);
    const lastTimeSec = parseTimeToSeconds(points[count - 1].time);
    const elapsedMinutes = Math.max(1, (lastTimeSec - firstTimeSec) / 60);
    const cutoffSec = parseTimeToSeconds(cutoffTime);
    const timeRemainingSeconds = Math.max(0, cutoffSec - lastTimeSec);

    const rateOfChange = delta / elapsedMinutes; // change per minute

    const previousSettlementDistance =
      previousSettlementValue !== undefined && previousSettlementValue !== null
        ? Math.abs(lastValue - previousSettlementValue)
        : null;

    let min = values[0];
    let max = values[0];
    let sum = 0;

    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    const mean = sum / count;
    const range = max - min;

    let varianceSum = 0;
    for (const v of values) {
      const diff = v - mean;
      varianceSum += diff * diff;
    }
    const volatility = count > 1 ? Math.sqrt(varianceSum / (count - 1)) : 0;

    const momentumDirection: 1 | 0 | -1 = delta > 0.001 ? 1 : delta < -0.001 ? -1 : 0;

    const extractDigit = isSet ? extractSettlementSetDecimalDigit : extractSettlementValueIntegerDigit;
    const recentLastDigit = extractDigit(lastValue);

    const digitFrequencies = new Array(10).fill(0);
    const digitTransitions: Array<{ from: number; to: number }> = [];
    const transitionMatrix: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));

    let prevDigit = extractDigit(values[0]);
    digitFrequencies[prevDigit]++;

    for (let i = 1; i < count; i++) {
      const currentDigit = extractDigit(values[i]);
      digitFrequencies[currentDigit]++;
      transitionMatrix[prevDigit][currentDigit]++;
      if (currentDigit !== prevDigit) {
        digitTransitions.push({ from: prevDigit, to: currentDigit });
      }
      prevDigit = currentDigit;
    }

    return {
      count,
      firstValue,
      lastValue,
      delta,
      min,
      max,
      range,
      mean,
      volatility,
      rateOfChange,
      timeRemainingSeconds,
      previousSettlementDistance,
      momentumDirection,
      recentLastDigit,
      digitTransitions,
      transitionMatrix,
      digitFrequencies,
    };
  }
}

/**
 * V3 Joint Prediction Engine
 */
export class Mm2dV3PredictionEngine {
  public static readonly MODEL_ID = 'MM2D_V3_JOINT_TRAJECTORY' as const;
  public static readonly VERSION = '3.0.0' as const;

  /**
   * Learns empirical joint distribution P(SET_digit, Value_digit) strictly from historical verified settlements
   */
  public static learnHistoricalJointDistribution(
    historicalRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession
  ): SetValueJointDistribution {
    // 10x10 matrix initialized with Laplace smoothing prior
    const counts: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(1));
    let totalSamples = 100; // prior mass

    const eligible = historicalRecords.filter((r) => {
      if (!r.isSettlement || !r.twod || r.twod.length !== 2) return false;
      if (r.date < targetDate) return true;
      if (r.date === targetDate && session === 'PM' && r.session === 'AM') {
        return true; // AM settlement on same day is legitimate prior for PM
      }
      return false; // Zero future/target session leakage!
    });

    for (const rec of eligible) {
      let setDigit = -1;
      let valDigit = -1;

      // Extract set and value digits from verified record
      if (rec.mathematicalCheck) {
        setDigit = parseInt(rec.mathematicalCheck.setLastDigit, 10);
        valDigit = parseInt(rec.mathematicalCheck.valueLastDigitBeforeDecimal, 10);
      }

      if (isNaN(setDigit) || setDigit < 0 || setDigit > 9) {
        setDigit = parseInt(rec.twod[0], 10);
      }
      if (isNaN(valDigit) || valDigit < 0 || valDigit > 9) {
        valDigit = parseInt(rec.twod[1], 10);
      }

      if (setDigit >= 0 && setDigit <= 9 && valDigit >= 0 && valDigit <= 9) {
        // If session matches, give higher weight (1.5x)
        const weight = rec.session === session ? 1.5 : 1.0;
        counts[setDigit][valDigit] += weight;
        totalSamples += weight;
      }
    }

    // Normalize joint probabilities
    const jointProbabilities: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    for (let s = 0; s < 10; s++) {
      for (let v = 0; v < 10; v++) {
        jointProbabilities[s][v] = counts[s][v] / totalSamples;
      }
    }

    // Conditionals P(val | set) and P(set | val)
    const conditionalValueGivenSet: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
    const conditionalSetGivenValue: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));

    for (let s = 0; s < 10; s++) {
      const sumSet = counts[s].reduce((sum, c) => sum + c, 0);
      for (let v = 0; v < 10; v++) {
        conditionalValueGivenSet[s][v] = counts[s][v] / (sumSet || 1);
      }
    }

    for (let v = 0; v < 10; v++) {
      let sumVal = 0;
      for (let s = 0; s < 10; s++) sumVal += counts[s][v];
      for (let s = 0; s < 10; s++) {
        conditionalSetGivenValue[s][v] = counts[s][v] / (sumVal || 1);
      }
    }

    return {
      jointProbabilities,
      totalSamples,
      conditionalValueGivenSet,
      conditionalSetGivenValue,
    };
  }

  /**
   * Computes SET settlement last decimal digit distribution (0-9)
   */
  public static predictSetDigitDistribution(
    historicalRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    trajectory: TrajectoryFeatures | null
  ): number[] {
    const scores = new Array(10).fill(1.0); // uniform prior

    // 1. Historical Session Frequency Prior
    const eligible = historicalRecords.filter((r) => {
      if (!r.isSettlement || !r.twod || r.twod.length !== 2) return false;
      if (r.date < targetDate) return true;
      if (r.date === targetDate && session === 'PM' && r.session === 'AM') return true;
      return false;
    });

    const histCounts = new Array(10).fill(0);
    let totalHist = 0;
    for (const r of eligible) {
      const d = parseInt(r.mathematicalCheck?.setLastDigit || r.twod[0], 10);
      if (!isNaN(d) && d >= 0 && d <= 9) {
        const weight = r.session === session ? 1.5 : 1.0;
        histCounts[d] += weight;
        totalHist += weight;
      }
    }

    if (totalHist > 0) {
      for (let d = 0; d < 10; d++) {
        const pHist = (histCounts[d] + 1) / (totalHist + 10);
        scores[d] += pHist * 3.5;
      }
    }

    // 2. Trajectory Dynamics & Modulo Neighborhood Evidence
    if (trajectory && trajectory.count > 0) {
      const anchorDigit = trajectory.recentLastDigit;

      // Feature A: Time-remaining weighting factor (as lock approaches, live trajectory weight increases)
      // When timeRemaining is close to 0, confidence in trajectory anchor reaches maximum (1.5x)
      const lockWeightFactor = 1.0 + Math.max(0, 1.0 - trajectory.timeRemainingSeconds / 7200) * 0.5;

      for (let d = 0; d < 10; d++) {
        const directDist = Math.abs(d - anchorDigit);
        const circularDist = Math.min(directDist, 10 - directDist);

        if (circularDist === 0) {
          scores[d] += 4.5 * lockWeightFactor; // Anchor digit
        } else if (circularDist === 1) {
          scores[d] += 2.8 * lockWeightFactor; // +/- 1 drift
        } else if (circularDist === 2) {
          scores[d] += 1.4 * lockWeightFactor; // +/- 2 drift
        } else if (circularDist === 3) {
          scores[d] += 0.5 * lockWeightFactor;
        }

        // Feature B: Repeated Digit Frequencies in Pre-Lock Sequence
        if (trajectory.digitFrequencies[d] > 0) {
          scores[d] += (trajectory.digitFrequencies[d] / trajectory.count) * 2.2;
        }

        // Feature C: Empirical Digit Transitions (Likelihood of transitioning from anchorDigit to d)
        const transitionSum = trajectory.transitionMatrix[anchorDigit]?.reduce((a, b) => a + b, 0) || 0;
        if (transitionSum > 0) {
          const transP = trajectory.transitionMatrix[anchorDigit][d] / transitionSum;
          scores[d] += transP * 1.8;
        }
      }

      // Feature D: Momentum & Rate of Change (Speed of index movement shifts expected target digit)
      if (trajectory.momentumDirection !== 0 && trajectory.count >= 2) {
        // High rate of change (+/- > 0.05 index pts/min) pushes target by 1-2 digits
        const rateMagnitude = Math.min(2, Math.floor(Math.abs(trajectory.rateOfChange) * 20));
        const step = Math.max(1, rateMagnitude);
        const trendOffset = trajectory.momentumDirection > 0 ? step : (10 - step);
        const trendDigit = (anchorDigit + trendOffset) % 10;
        scores[trendDigit] += 1.5;
      }

      // Feature E: Volatility dispersion (high volatility flattens scores / boosts dispersion across neighborhood)
      if (trajectory.volatility > 0.10) {
        const neighborA = (anchorDigit + 2) % 10;
        const neighborB = (anchorDigit + 8) % 10;
        scores[neighborA] += Math.min(1.0, trajectory.volatility * 2);
        scores[neighborB] += Math.min(1.0, trajectory.volatility * 2);
      }

      // Feature F: Distance from previous official settlement
      if (trajectory.previousSettlementDistance !== null && trajectory.previousSettlementDistance > 5.0) {
        // Mean reversion tendency in financial index drift
        const meanRevDigit = (anchorDigit + 5) % 10;
        scores[meanRevDigit] += 0.4;
      }
    }

    const total = scores.reduce((sum, s) => sum + s, 0);
    return scores.map((s) => s / total);
  }

  /**
   * Computes Value settlement last integer digit distribution (0-9)
   */
  public static predictValueDigitDistribution(
    historicalRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    trajectory: TrajectoryFeatures | null
  ): number[] {
    const scores = new Array(10).fill(1.0); // uniform prior

    // 1. Historical Session Frequency Prior
    const eligible = historicalRecords.filter((r) => {
      if (!r.isSettlement || !r.twod || r.twod.length !== 2) return false;
      if (r.date < targetDate) return true;
      if (r.date === targetDate && session === 'PM' && r.session === 'AM') return true;
      return false;
    });

    const histCounts = new Array(10).fill(0);
    let totalHist = 0;
    for (const r of eligible) {
      const d = parseInt(r.mathematicalCheck?.valueLastDigitBeforeDecimal || r.twod[1], 10);
      if (!isNaN(d) && d >= 0 && d <= 9) {
        const weight = r.session === session ? 1.5 : 1.0;
        histCounts[d] += weight;
        totalHist += weight;
      }
    }

    if (totalHist > 0) {
      for (let d = 0; d < 10; d++) {
        const pHist = (histCounts[d] + 1) / (totalHist + 10);
        scores[d] += pHist * 3.5;
      }
    }

    // 2. Trajectory Dynamics & Modulo Neighborhood Evidence
    if (trajectory && trajectory.count > 0) {
      const anchorDigit = trajectory.recentLastDigit;

      // Time-remaining weighting factor
      const lockWeightFactor = 1.0 + Math.max(0, 1.0 - trajectory.timeRemainingSeconds / 7200) * 0.5;

      for (let d = 0; d < 10; d++) {
        const directDist = Math.abs(d - anchorDigit);
        const circularDist = Math.min(directDist, 10 - directDist);

        if (circularDist === 0) {
          scores[d] += 4.5 * lockWeightFactor;
        } else if (circularDist === 1) {
          scores[d] += 2.8 * lockWeightFactor;
        } else if (circularDist === 2) {
          scores[d] += 1.4 * lockWeightFactor;
        } else if (circularDist === 3) {
          scores[d] += 0.5 * lockWeightFactor;
        }

        // Repeated Digit Frequencies in Pre-Lock Sequence
        if (trajectory.digitFrequencies[d] > 0) {
          scores[d] += (trajectory.digitFrequencies[d] / trajectory.count) * 2.2;
        }

        // Empirical Digit Transitions
        const transitionSum = trajectory.transitionMatrix[anchorDigit]?.reduce((a, b) => a + b, 0) || 0;
        if (transitionSum > 0) {
          const transP = trajectory.transitionMatrix[anchorDigit][d] / transitionSum;
          scores[d] += transP * 1.8;
        }
      }

      // Momentum & Rate of Change for Value
      if (trajectory.momentumDirection !== 0 && trajectory.count >= 2) {
        const rateMagnitude = Math.min(2, Math.floor(Math.abs(trajectory.rateOfChange) / 500));
        const step = Math.max(1, rateMagnitude);
        const trendOffset = trajectory.momentumDirection > 0 ? step : (10 - step);
        const trendDigit = (anchorDigit + trendOffset) % 10;
        scores[trendDigit] += 1.5;
      }

      // Volatility dispersion
      if (trajectory.volatility > 50) {
        const neighborA = (anchorDigit + 2) % 10;
        const neighborB = (anchorDigit + 8) % 10;
        scores[neighborA] += 0.8;
        scores[neighborB] += 0.8;
      }

      // Distance from previous official settlement
      if (trajectory.previousSettlementDistance !== null && trajectory.previousSettlementDistance > 1000) {
        const meanRevDigit = (anchorDigit + 5) % 10;
        scores[meanRevDigit] += 0.4;
      }
    }

    const total = scores.reduce((sum, s) => sum + s, 0);
    return scores.map((s) => s / total);
  }

  /**
   * Core V3 Predict Pipeline
   */
  public static predict(options: {
    targetDate: string;
    session: MarketSession;
    historicalRecords: VerifiedMarketRecord[];
    liveObservations?: Array<{ time: string; set: number | string; value: number | string; timestamp?: string }>;
    currentTime?: Date | string;
    isLocked?: boolean;
  }): V3PredictionOutput {
    const { targetDate, session, historicalRecords, liveObservations = [], currentTime, isLocked: overrideLock } = options;

    const cutoffTime = session === 'AM' ? '12:00:00' : '16:00:00';
    const isPastLock = overrideLock !== undefined ? overrideLock : false;

    // 1. Strict Anti-Leakage Temporal Isolation
    const safeRecords = historicalRecords.filter((r) => {
      if (r.date > targetDate) return false;
      if (r.date === targetDate) {
        if (session === 'AM') {
          if (r.isSettlement || r.time > '12:00:00') return false;
        } else {
          if (r.isSettlement && r.session === 'PM') return false;
          if (r.time > '16:00:00') return false;
        }
      }
      return true;
    });

    // 2. Sanitize Live Observations
    const sessionOpen = session === 'AM' ? '10:00:00' : '14:00:00';
    const sanitizedLive: Array<{ time: string; set: number; value: number; timestamp?: string }> = [];

    for (const obs of liveObservations) {
      if (!obs || !obs.time || obs.time < sessionOpen || obs.time > cutoffTime) continue;

      const rawSetStr = String(obs.set ?? '').trim();
      const rawValStr = String(obs.value ?? '').trim();
      const lowerSet = rawSetStr.toLowerCase();
      const lowerVal = rawValStr.toLowerCase();

      if (
        lowerSet === 'set' ||
        lowerVal === 'value' ||
        lowerSet === 'nan' ||
        lowerVal === 'nan' ||
        lowerSet === 'null' ||
        lowerVal === 'undefined' ||
        rawSetStr === '--' ||
        rawValStr === '0.00' ||
        rawSetStr === '0'
      ) {
        continue;
      }

      const s = typeof obs.set === 'number' ? obs.set : parseFloat(rawSetStr.replace(/,/g, ''));
      const v = typeof obs.value === 'number' ? obs.value : parseFloat(rawValStr.replace(/,/g, ''));

      if (Number.isFinite(s) && Number.isFinite(v) && s >= 100 && s <= 5000 && v >= 100) {
        sanitizedLive.push({
          time: obs.time,
          set: s,
          value: v,
          timestamp: obs.timestamp,
        });
      }
    }

    sanitizedLive.sort((a, b) => a.time.localeCompare(b.time));

    // 3. Extract Trajectory Features
    const setPoints: TrajectoryPoint[] = sanitizedLive.map((t) => ({ time: t.time, value: t.set, timestamp: t.timestamp }));
    const valPoints: TrajectoryPoint[] = sanitizedLive.map((t) => ({ time: t.time, value: t.value, timestamp: t.timestamp }));

    // Find most recent prior official settlement record to measure distance
    const priorSettlements = safeRecords.filter((r) => r.isSettlement && r.setNumeric && r.valueNumeric);
    const lastPriorSettlement = priorSettlements.length > 0 ? priorSettlements[priorSettlements.length - 1] : null;

    const setTrajectory = TrajectoryFeatureExtractor.extract(
      setPoints,
      true,
      cutoffTime,
      lastPriorSettlement?.setNumeric
    );
    const valTrajectory = TrajectoryFeatureExtractor.extract(
      valPoints,
      false,
      cutoffTime,
      lastPriorSettlement?.valueNumeric
    );

    // 4. Compute Marginal Settlement Digit Probabilities
    const setDigitProbs = this.predictSetDigitDistribution(safeRecords, targetDate, session, setTrajectory);
    const valDigitProbs = this.predictValueDigitDistribution(safeRecords, targetDate, session, valTrajectory);

    // 5. Learn Joint Relationship Matrix P(SET_digit, Value_digit)
    const jointModel = this.learnHistoricalJointDistribution(safeRecords, targetDate, session);

    // 6. Synthesize Joint Probabilities for all 100 2D Pairs (00-99)
    // Formula:
    // P(2D = s*10 + v) combines:
    // A. Marginal product P(s) * P(v) (independent baseline)
    // B. Learned empirical joint P_joint(s, v)
    // C. Conditional P(s | v) * P(v) and P(v | s) * P(s)
    const raw2DProbs = new Array<number>(100).fill(0);
    const candidateAttributions: V3CandidateAttribution[] = [];

    const weights: V3ComponentModelWeights = {
      setTrajectoryWeight: setTrajectory ? 0.35 : 0.20,
      valTrajectoryWeight: valTrajectory ? 0.35 : 0.20,
      jointHistoricalWeight: 0.30,
      sessionPriorWeight: 0.10,
    };

    for (let s = 0; s < 10; s++) {
      for (let v = 0; v < 10; v++) {
        const idx = s * 10 + v;
        const twod = idx.toString().padStart(2, '0');

        const ps = setDigitProbs[s];
        const pv = valDigitProbs[v];
        const pJoint = jointModel.jointProbabilities[s][v];
        const pIndependent = ps * pv;

        // Blended score preferring the learned joint model with trajectory weighting
        // P(s, v) = 0.50 * P_joint(s, v) + 0.50 * (P(s) * P(v))
        const combinedScore = 0.50 * pJoint + 0.50 * pIndependent;

        raw2DProbs[idx] = combinedScore;

        candidateAttributions.push({
          twod,
          setDigit: s,
          valueDigit: v,
          setDigitProb: ps,
          valueDigitProb: pv,
          jointProb: pJoint,
          independentProductProb: pIndependent,
          ensembleScore: combinedScore,
        });
      }
    }

    const norm2DProbs = normalizeProbabilities(raw2DProbs);

    // 7. Build Candidates List & Sort
    const candidates: V3Candidate[] = [];
    for (let i = 0; i < 100; i++) {
      const twod = i.toString().padStart(2, '0');
      const prob = Math.round(norm2DProbs[i] * 100000) / 100000;
      const attr = candidateAttributions[i];

      candidates.push({
        rank: 0,
        twod,
        probability: prob,
        score: prob,
        setDigit: attr.setDigit,
        valueDigit: attr.valueDigit,
        attribution: attr,
      });
    }

    // Deterministic Sort: Descending by probability, ascending by twod string
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

    // Compute Metrics
    let entropy = 0;
    for (const p of norm2DProbs) {
      if (p > 1e-15) entropy -= p * Math.log2(p);
    }
    const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;
    const confidenceScore = Math.min(88, Math.max(15, Math.round((6.6438 - entropy) * 150)));

    const latestObs = sanitizedLive.length > 0 ? sanitizedLive[sanitizedLive.length - 1] : null;
    const observedSet = latestObs ? latestObs.set : null;
    const observedValue = latestObs ? latestObs.value : null;

    const inputHash = computeProbabilityHash(
      sanitizedLive.length > 0 ? sanitizedLive.map((x) => x.set + x.value) : [1.0]
    );
    const distributionHash = computeProbabilityHash(norm2DProbs);

    const auditDetails = `MM2D V3 Joint Architecture (${session}): SET Trajectory (${sanitizedLive.length} ticks) + Value Trajectory + Empirical Joint SETxValue matrix (${jointModel.totalSamples} prior samples). Top 1: ${top1} (${(candidates[0].probability * 100).toFixed(2)}%).`;

    return {
      modelId: 'MM2D_V3_JOINT_TRAJECTORY',
      version: '3.0.0',
      session,
      targetDate,
      cutoffTime,
      isLocked: isPastLock,
      probabilities: norm2DProbs,
      candidates,
      top1,
      top3,
      top5,
      top10,
      setDigitProbabilities: setDigitProbs,
      valueDigitProbabilities: valDigitProbs,
      setTrajectoryFeatures: setTrajectory,
      valTrajectoryFeatures: valTrajectory,
      weights,
      observedPreLockSet: observedSet,
      observedPreLockValue: observedValue,
      entropy,
      topMargin,
      confidenceScore,
      auditDetails,
      inputIntegrityHash: inputHash,
      distributionHash,
    };
  }
}
