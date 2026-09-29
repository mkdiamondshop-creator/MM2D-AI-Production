import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { PredictionCandidate } from '../../types/prediction';
import { ModelValidationStatus } from '../../types/candidateModel';
import {
  SetValueRelationshipModelId,
  SetValueEngineOutput,
  SetValueEngineWalkForwardMetric,
  SetValueLabBenchmarkReport,
  SetValueWalkForwardEvent,
} from '../../types/setValueRelationship';
import { StatisticalEngine } from './statisticalEngine';
import { normalizeProbabilities } from './candidateModelLab';
import { PredictionEngine } from './predictionEngine';
import { FeatureEngine } from './featureEngine';

/**
 * Common builder for Set/Value Relationship Engine outputs.
 * Enforces:
 * 1. Exactly 100 candidates ranked 00..99 with ranks 1..100
 * 2. Strict probability normalization (sum to 1.0)
 * 3. Deterministic descending sort with lexicographical tie-breaker
 * 4. Extraction of Top 1, Top 5, Top 10, Shannon entropy, and margin
 */
export function buildSetValueOutput(
  modelId: SetValueRelationshipModelId,
  version: string,
  session: MarketSession,
  targetDate: string,
  probabilities: number[],
  preLockSet: number | null,
  preLockValue: number | null,
  validationStatus: ModelValidationStatus = 'READY',
  auditDetails: string = ''
): SetValueEngineOutput {
  const normProbs = normalizeProbabilities(probabilities);

  // 1. Build candidates
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

  // 2. Deterministic sorting: descending by probability, ascending by twod string
  candidates.sort((a, b) => {
    if (b.probability !== a.probability) {
      return b.probability - a.probability;
    }
    return a.twod.localeCompare(b.twod);
  });

  // 3. Assign ranks
  for (let r = 0; r < candidates.length; r++) {
    candidates[r].rank = r + 1;
  }

  const top1 = candidates[0].twod;
  const top5 = candidates.slice(0, 5).map((c) => c.twod);
  const top10 = candidates.slice(0, 10).map((c) => c.twod);

  const entropy = StatisticalEngine.computeShannonEntropy(normProbs);
  const topMargin = Math.round((candidates[0].probability - candidates[1].probability) * 100000) / 100000;
  const rawConfidence = Math.min(85, Math.max(15, Math.round((6.6438 - entropy) * 150)));

  return {
    modelId,
    version,
    session,
    targetDate,
    probabilities: normProbs,
    candidates,
    top1,
    top5,
    top10,
    entropy,
    topMargin,
    confidenceScore: rawConfidence,
    validationStatus,
    auditDetails,
    observedPreLockSet: preLockSet,
    observedPreLockValue: preLockValue,
  };
}

/**
 * Historical Intraday Training Pair
 */
export interface HistoricalTrainingPair {
  date: string;
  session: MarketSession;
  preLockSet: number;
  preLockValue: number;
  settlementSet: number;
  settlementValue: number;
  settlement2D: string;
  preLockSetDecimal: number;   // Last decimal digit (0-9)
  preLockValueInteger: number; // Last integer digit (0-9)
  settlementFirstDigit: number;// twod[0] (0-9)
  settlementSecondDigit: number;// twod[1] (0-9)
}

/**
 * Helper to extract pre-lock and settlement pairs from historical records.
 * Strictly filters out any records on or after targetDate (or on targetDate PM for AM session).
 */
export function extractHistoricalTrainingPairs(
  allRecords: VerifiedMarketRecord[],
  targetDate: string,
  session: MarketSession
): {
  trainingPairs: HistoricalTrainingPair[];
  allPriorSettlements: VerifiedMarketRecord[];
} {
  // PIT Filter
  const priorSettlements = allRecords.filter((r) => {
    if (!r.isSettlement || !r.twod) return false;
    if (r.date < targetDate) return true;
    if (r.date === targetDate && session === 'PM' && r.session === 'AM') return true;
    return false;
  });

  // Group by date and session to find matching pre-lock checkpoints
  const pairs: HistoricalTrainingPair[] = [];
  const groupedByDate = new Map<string, VerifiedMarketRecord[]>();

  for (const r of allRecords) {
    if (r.date >= targetDate) continue; // Strictly prior dates only
    if (!groupedByDate.has(r.date)) groupedByDate.set(r.date, []);
    groupedByDate.get(r.date)!.push(r);
  }

  for (const [d, dayRecs] of groupedByDate.entries()) {
    // AM pair
    const amCheck = dayRecs.find((r) => r.time === '11:00:00');
    const amSettle = dayRecs.find((r) => r.session === 'AM' && r.isSettlement && r.twod);
    if (amCheck && amSettle && amCheck.setNumeric && amCheck.valueNumeric && amSettle.twod.length === 2) {
      const setDec = Math.round(amCheck.setNumeric * 100) % 10;
      const valInt = Math.floor(amCheck.valueNumeric) % 10;
      pairs.push({
        date: d,
        session: 'AM',
        preLockSet: amCheck.setNumeric,
        preLockValue: amCheck.valueNumeric,
        settlementSet: amSettle.setNumeric || amCheck.setNumeric,
        settlementValue: amSettle.valueNumeric || amCheck.valueNumeric,
        settlement2D: amSettle.twod,
        preLockSetDecimal: Math.abs(setDec),
        preLockValueInteger: Math.abs(valInt),
        settlementFirstDigit: parseInt(amSettle.twod[0], 10),
        settlementSecondDigit: parseInt(amSettle.twod[1], 10),
      });
    }

    // PM pair
    const pmCheck = dayRecs.find((r) => r.time === '15:00:00');
    const pmSettle = dayRecs.find((r) => r.session === 'PM' && r.isSettlement && r.twod);
    if (pmCheck && pmSettle && pmCheck.setNumeric && pmCheck.valueNumeric && pmSettle.twod.length === 2) {
      const setDec = Math.round(pmCheck.setNumeric * 100) % 10;
      const valInt = Math.floor(pmCheck.valueNumeric) % 10;
      pairs.push({
        date: d,
        session: 'PM',
        preLockSet: pmCheck.setNumeric,
        preLockValue: pmCheck.valueNumeric,
        settlementSet: pmSettle.setNumeric || pmCheck.setNumeric,
        settlementValue: pmSettle.valueNumeric || pmCheck.valueNumeric,
        settlement2D: pmSettle.twod,
        preLockSetDecimal: Math.abs(setDec),
        preLockValueInteger: Math.abs(valInt),
        settlementFirstDigit: parseInt(pmSettle.twod[0], 10),
        settlementSecondDigit: parseInt(pmSettle.twod[1], 10),
      });
    }
  }

  return { trainingPairs: pairs, allPriorSettlements: priorSettlements };
}

/**
 * Extracts the target session pre-lock SET and Value from records or live feed
 */
export function resolveTargetPreLockObservation(
  allRecords: VerifiedMarketRecord[],
  targetDate: string,
  session: MarketSession,
  liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
): { set: number | null; value: number | null; time: string } {
  if (liveFeed && liveFeed.length > 0) {
    for (let i = liveFeed.length - 1; i >= 0; i--) {
      const obs = liveFeed[i];
      if (!obs) continue;
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
        rawValStr === '--' ||
        rawSetStr === '0.00' ||
        rawValStr === '0.00' ||
        rawSetStr === '0'
      ) {
        continue;
      }

      const s = typeof obs.set === 'number' ? obs.set : parseFloat(rawSetStr.replace(/,/g, ''));
      const v = typeof obs.value === 'number' ? obs.value : parseFloat(rawValStr.replace(/,/g, ''));

      if (Number.isFinite(s) && s >= 100 && s <= 5000 && Number.isFinite(v) && v >= 100) {
        return { set: s, value: v, time: obs.time };
      }
    }
  }

  const checkTime = session === 'AM' ? '11:00:00' : '15:00:00';
  const match = allRecords.find((r) => r.date === targetDate && r.time === checkTime);
  if (
    match &&
    Number.isFinite(match.setNumeric) &&
    match.setNumeric >= 100 &&
    Number.isFinite(match.valueNumeric) &&
    match.valueNumeric >= 100
  ) {
    return { set: match.setNumeric, value: match.valueNumeric, time: match.time };
  }

  return { set: null, value: null, time: '' };
}

// ============================================================================
// ENGINE 1: SET → 2D RELATIONSHIP ENGINE
// ============================================================================
export class SetTo2DRelationshipEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'SET_TO_2D_RELATIONSHIP_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    const probs = new Array<number>(100).fill(0.01);
    const laplaceAlpha = 0.5;

    // Empirical baseline marginals
    const d1Counts = new Array<number>(10).fill(0);
    const d2Counts = new Array<number>(10).fill(0);
    for (const r of allPriorSettlements) {
      if (r.twod && r.twod.length === 2) {
        d1Counts[parseInt(r.twod[0], 10)]++;
        d2Counts[parseInt(r.twod[1], 10)]++;
      }
    }

    const totalPrior = Math.max(1, allPriorSettlements.length);
    const pD2 = d2Counts.map((c) => (c + laplaceAlpha) / (totalPrior + 10 * laplaceAlpha));

    if (targetObs.set !== null && trainingPairs.length > 0) {
      const preSetDecimal = Math.abs(Math.round(targetObs.set * 100) % 10);
      const transitionCounts = new Array<number>(10).fill(0);

      for (const pair of trainingPairs) {
        if (pair.preLockSetDecimal === preSetDecimal) {
          transitionCounts[pair.settlementFirstDigit]++;
        }
      }

      const totalTransitions = transitionCounts.reduce((a, b) => a + b, 0);
      const pD1GivenSet = transitionCounts.map((c) => (c + laplaceAlpha) / (totalTransitions + 10 * laplaceAlpha));

      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        probs[i] = pD1GivenSet[d1] * pD2[d2];
      }

      return buildSetValueOutput(
        SetTo2DRelationshipEngine.MODEL_ID,
        SetTo2DRelationshipEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `Evaluated SET decimal digit ${preSetDecimal} against ${trainingPairs.length} historical pairs.`
      );
    }

    // Fallback if no pre-lock SET observation is present
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      const pD1 = (d1Counts[d1] + laplaceAlpha) / (totalPrior + 10 * laplaceAlpha);
      probs[i] = pD1 * pD2[d2];
    }

    return buildSetValueOutput(
      SetTo2DRelationshipEngine.MODEL_ID,
      SetTo2DRelationshipEngine.VERSION,
      session,
      targetDate,
      probs,
      targetObs.set,
      targetObs.value,
      'READY',
      'No pre-lock SET tick observed; evaluated on baseline marginal empirical distributions.'
    );
  }
}

// ============================================================================
// ENGINE 2: VALUE → 2D RELATIONSHIP ENGINE
// ============================================================================
export class ValueTo2DRelationshipEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'VALUE_TO_2D_RELATIONSHIP_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    const probs = new Array<number>(100).fill(0.01);
    const laplaceAlpha = 0.5;

    const d1Counts = new Array<number>(10).fill(0);
    const d2Counts = new Array<number>(10).fill(0);
    for (const r of allPriorSettlements) {
      if (r.twod && r.twod.length === 2) {
        d1Counts[parseInt(r.twod[0], 10)]++;
        d2Counts[parseInt(r.twod[1], 10)]++;
      }
    }

    const totalPrior = Math.max(1, allPriorSettlements.length);
    const pD1 = d1Counts.map((c) => (c + laplaceAlpha) / (totalPrior + 10 * laplaceAlpha));

    if (targetObs.value !== null && trainingPairs.length > 0) {
      const preValInteger = Math.abs(Math.floor(targetObs.value) % 10);
      const transitionCounts = new Array<number>(10).fill(0);

      for (const pair of trainingPairs) {
        if (pair.preLockValueInteger === preValInteger) {
          transitionCounts[pair.settlementSecondDigit]++;
        }
      }

      const totalTransitions = transitionCounts.reduce((a, b) => a + b, 0);
      const pD2GivenVal = transitionCounts.map((c) => (c + laplaceAlpha) / (totalTransitions + 10 * laplaceAlpha));

      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        probs[i] = pD1[d1] * pD2GivenVal[d2];
      }

      return buildSetValueOutput(
        ValueTo2DRelationshipEngine.MODEL_ID,
        ValueTo2DRelationshipEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `Evaluated Value integer digit ${preValInteger} against ${trainingPairs.length} historical pairs.`
      );
    }

    // Fallback if no pre-lock Value observation is present
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      const pD2 = (d2Counts[d2] + laplaceAlpha) / (totalPrior + 10 * laplaceAlpha);
      probs[i] = pD1[d1] * pD2;
    }

    return buildSetValueOutput(
      ValueTo2DRelationshipEngine.MODEL_ID,
      ValueTo2DRelationshipEngine.VERSION,
      session,
      targetDate,
      probs,
      targetObs.set,
      targetObs.value,
      'READY',
      'No pre-lock Value tick observed; evaluated on baseline marginal empirical distributions.'
    );
  }
}

// ============================================================================
// ENGINE 3: SET + VALUE JOINT RELATIONSHIP ENGINE
// ============================================================================
export class SetValueJointRelationshipEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'SET_VALUE_JOINT_RELATIONSHIP_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    const probs = new Array<number>(100).fill(0.01);
    const laplaceAlpha = 0.5;

    if (targetObs.set !== null && targetObs.value !== null && trainingPairs.length > 0) {
      const preSetDecimal = Math.abs(Math.round(targetObs.set * 100) % 10);
      const preValInteger = Math.abs(Math.floor(targetObs.value) % 10);

      // 1. Marginal conditional digit transitions
      const d1Counts = new Array<number>(10).fill(0);
      const d2Counts = new Array<number>(10).fill(0);
      const exactJointMatches = new Array<number>(100).fill(0);

      for (const pair of trainingPairs) {
        if (pair.preLockSetDecimal === preSetDecimal) {
          d1Counts[pair.settlementFirstDigit]++;
        }
        if (pair.preLockValueInteger === preValInteger) {
          d2Counts[pair.settlementSecondDigit]++;
        }
        if (pair.preLockSetDecimal === preSetDecimal && pair.preLockValueInteger === preValInteger) {
          exactJointMatches[parseInt(pair.settlement2D, 10)]++;
        }
      }

      const totalD1 = d1Counts.reduce((a, b) => a + b, 0);
      const totalD2 = d2Counts.reduce((a, b) => a + b, 0);
      const totalJoint = exactJointMatches.reduce((a, b) => a + b, 0);

      const pD1 = d1Counts.map((c) => (c + laplaceAlpha) / (totalD1 + 10 * laplaceAlpha));
      const pD2 = d2Counts.map((c) => (c + laplaceAlpha) / (totalD2 + 10 * laplaceAlpha));

      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        const indepProduct = pD1[d1] * pD2[d2];

        if (totalJoint > 0) {
          const jointProb = (exactJointMatches[i] + laplaceAlpha) / (totalJoint + 100 * laplaceAlpha);
          probs[i] = 0.70 * indepProduct + 0.30 * jointProb;
        } else {
          probs[i] = indepProduct;
        }
      }

      return buildSetValueOutput(
        SetValueJointRelationshipEngine.MODEL_ID,
        SetValueJointRelationshipEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `Joint evaluation of SET decimal ${preSetDecimal} and Value integer ${preValInteger} across ${trainingPairs.length} pairs.`
      );
    }

    // Fallback: Use all-time empirical frequencies
    const freq = StatisticalEngine.computeFrequencyDistribution(
      allPriorSettlements.map((r) => r.twod),
      0.1
    );
    return buildSetValueOutput(
      SetValueJointRelationshipEngine.MODEL_ID,
      SetValueJointRelationshipEngine.VERSION,
      session,
      targetDate,
      freq,
      targetObs.set,
      targetObs.value,
      'READY',
      'Insufficient pre-lock SET/Value inputs; defaulted to empirical prior.'
    );
  }
}

// ============================================================================
// ENGINE 4: SIMILAR HISTORICAL CONDITIONS ENGINE (k-NN Analogs)
// ============================================================================
export class SimilarConditionsRelationshipEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'SIMILAR_CONDITIONS_RELATIONSHIP_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>,
    k: number = 5
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    const baseFreq = StatisticalEngine.computeFrequencyDistribution(
      allPriorSettlements.map((r) => r.twod),
      0.1
    );

    if (targetObs.set !== null && targetObs.value !== null && trainingPairs.length >= 3) {
      // Calculate mean and variance of historical SET and Value
      const sets = trainingPairs.map((p) => p.preLockSet);
      const vals = trainingPairs.map((p) => p.preLockValue);

      const meanSet = sets.reduce((a, b) => a + b, 0) / sets.length;
      const meanVal = vals.reduce((a, b) => a + b, 0) / vals.length;

      const stdSet = Math.sqrt(sets.reduce((a, b) => a + Math.pow(b - meanSet, 2), 0) / sets.length) || 10.0;
      const stdVal = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - meanVal, 2), 0) / vals.length) || 5000.0;

      // Distance computation
      const scoredPairs = trainingPairs.map((pair) => {
        const normSetDist = (pair.preLockSet - targetObs.set!) / stdSet;
        const normValDist = (pair.preLockValue - targetObs.value!) / stdVal;
        const dist = Math.sqrt(Math.pow(normSetDist, 2) + Math.pow(normValDist, 2));
        const weight = 1.0 / (1.0 + dist);
        return { pair, dist, weight };
      });

      scoredPairs.sort((a, b) => a.dist - b.dist);
      const nearest = scoredPairs.slice(0, Math.min(k, scoredPairs.length));
      const totalWeight = nearest.reduce((a, b) => a + b.weight, 0);

      const knnVotes = new Array<number>(100).fill(0);
      for (const item of nearest) {
        const outcome = parseInt(item.pair.settlement2D, 10);
        if (!isNaN(outcome) && outcome >= 0 && outcome < 100) {
          knnVotes[outcome] += item.weight / totalWeight;
        }
      }

      // Blend 60% empirical baseline prior + 40% nearest neighbors
      const probs = new Array<number>(100);
      for (let i = 0; i < 100; i++) {
        probs[i] = 0.60 * baseFreq[i] + 0.40 * knnVotes[i];
      }

      return buildSetValueOutput(
        SimilarConditionsRelationshipEngine.MODEL_ID,
        SimilarConditionsRelationshipEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `k-NN analogy engine evaluated ${nearest.length} most similar historical sessions (SET: ${targetObs.set.toFixed(2)}, Value: ${targetObs.value.toFixed(0)}).`
      );
    }

    return buildSetValueOutput(
      SimilarConditionsRelationshipEngine.MODEL_ID,
      SimilarConditionsRelationshipEngine.VERSION,
      session,
      targetDate,
      baseFreq,
      targetObs.set,
      targetObs.value,
      'READY',
      'Insufficient condition history; defaulted to empirical prior.'
    );
  }
}

// ============================================================================
// ENGINE 5: RECENCY + SET/VALUE RELATIONSHIP ENGINE
// ============================================================================
export class RecencySetValueRelationshipEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'RECENCY_SET_VALUE_RELATIONSHIP_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>,
    decayRate: number = 0.08
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    const probs = new Array<number>(100).fill(0.01);
    const laplaceAlpha = 0.5;

    if (targetObs.set !== null && targetObs.value !== null && trainingPairs.length > 0) {
      const preSetDecimal = Math.abs(Math.round(targetObs.set * 100) % 10);
      const preValInteger = Math.abs(Math.floor(targetObs.value) % 10);

      // Sort training pairs chronological ascending
      trainingPairs.sort((a, b) => a.date.localeCompare(b.date));
      const nPairs = trainingPairs.length;

      const d1WeightedCounts = new Array<number>(10).fill(0);
      const d2WeightedCounts = new Array<number>(10).fill(0);

      for (let idx = 0; idx < nPairs; idx++) {
        const pair = trainingPairs[idx];
        const age = nPairs - 1 - idx; // 0 = newest prior pair
        const recencyWeight = Math.exp(-decayRate * age);

        if (pair.preLockSetDecimal === preSetDecimal) {
          d1WeightedCounts[pair.settlementFirstDigit] += recencyWeight;
        }
        if (pair.preLockValueInteger === preValInteger) {
          d2WeightedCounts[pair.settlementSecondDigit] += recencyWeight;
        }
      }

      const totalD1 = d1WeightedCounts.reduce((a, b) => a + b, 0);
      const totalD2 = d2WeightedCounts.reduce((a, b) => a + b, 0);

      const pD1 = d1WeightedCounts.map((c) => (c + laplaceAlpha) / (totalD1 + 10 * laplaceAlpha));
      const pD2 = d2WeightedCounts.map((c) => (c + laplaceAlpha) / (totalD2 + 10 * laplaceAlpha));

      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        probs[i] = pD1[d1] * pD2[d2];
      }

      return buildSetValueOutput(
        RecencySetValueRelationshipEngine.MODEL_ID,
        RecencySetValueRelationshipEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `Recency-decayed SET/Value transitions applied across ${nPairs} historical pairs (decay: ${decayRate}).`
      );
    }

    const baseFreq = StatisticalEngine.computeFrequencyDistribution(
      allPriorSettlements.map((r) => r.twod),
      0.1
    );
    return buildSetValueOutput(
      RecencySetValueRelationshipEngine.MODEL_ID,
      RecencySetValueRelationshipEngine.VERSION,
      session,
      targetDate,
      baseFreq,
      targetObs.set,
      targetObs.value,
      'READY',
      'Defaulted to base empirical frequency.'
    );
  }
}

// ============================================================================
// ENGINE 6: AM/PM-SPECIFIC SET/VALUE ENGINE
// ============================================================================
export class SessionSpecificSetValueEngine {
  public static readonly MODEL_ID: SetValueRelationshipModelId = 'SESSION_SPECIFIC_SET_VALUE_V1';
  public static readonly VERSION = '1.0.0';

  public static predict(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): SetValueEngineOutput {
    const { trainingPairs, allPriorSettlements } = extractHistoricalTrainingPairs(allRecords, targetDate, session);
    const targetObs = resolveTargetPreLockObservation(allRecords, targetDate, session, liveFeed);

    // Isolate strictly session-matching historical pairs
    const sessionPairs = trainingPairs.filter((p) => p.session === session);
    const sessionSettlements = allPriorSettlements.filter((r) => r.session === session);

    const baseFreq = StatisticalEngine.computeFrequencyDistribution(
      sessionSettlements.map((r) => r.twod),
      0.1
    );

    const probs = new Array<number>(100).fill(0.01);
    const laplaceAlpha = 0.5;

    if (targetObs.set !== null && targetObs.value !== null && sessionPairs.length > 0) {
      const preSetDecimal = Math.abs(Math.round(targetObs.set * 100) % 10);
      const preValInteger = Math.abs(Math.floor(targetObs.value) % 10);

      const d1Counts = new Array<number>(10).fill(0);
      const d2Counts = new Array<number>(10).fill(0);

      for (const pair of sessionPairs) {
        if (pair.preLockSetDecimal === preSetDecimal) {
          d1Counts[pair.settlementFirstDigit]++;
        }
        if (pair.preLockValueInteger === preValInteger) {
          d2Counts[pair.settlementSecondDigit]++;
        }
      }

      const totalD1 = d1Counts.reduce((a, b) => a + b, 0);
      const totalD2 = d2Counts.reduce((a, b) => a + b, 0);

      const pD1 = d1Counts.map((c) => (c + laplaceAlpha) / (totalD1 + 10 * laplaceAlpha));
      const pD2 = d2Counts.map((c) => (c + laplaceAlpha) / (totalD2 + 10 * laplaceAlpha));

      for (let i = 0; i < 100; i++) {
        const d1 = Math.floor(i / 10);
        const d2 = i % 10;
        probs[i] = pD1[d1] * pD2[d2];
      }

      // If PM session, blend with today's AM settlement transition prior if available
      if (session === 'PM') {
        const todayAmSettle = allRecords.find((r) => r.date === targetDate && r.session === 'AM' && r.isSettlement && r.twod);
        if (todayAmSettle && todayAmSettle.twod) {
          const amOutcome = parseInt(todayAmSettle.twod, 10);
          // Modulate with AM-to-PM affinity
          probs[amOutcome] = probs[amOutcome] * 0.5; // Same-day repeat reduction
        }
      }

      return buildSetValueOutput(
        SessionSpecificSetValueEngine.MODEL_ID,
        SessionSpecificSetValueEngine.VERSION,
        session,
        targetDate,
        probs,
        targetObs.set,
        targetObs.value,
        'READY',
        `Session-isolated ${session} model evaluated against ${sessionPairs.length} ${session} historical pairs.`
      );
    }

    return buildSetValueOutput(
      SessionSpecificSetValueEngine.MODEL_ID,
      SessionSpecificSetValueEngine.VERSION,
      session,
      targetDate,
      baseFreq,
      targetObs.set,
      targetObs.value,
      'READY',
      `Session-isolated ${session} model defaulted to ${session} empirical baseline.`
    );
  }
}

// ============================================================================
// CENTRAL SET/VALUE LAB REGISTRY & WALK-FORWARD BENCHMARK RUNNER
// ============================================================================
export class SetValueRelationshipLab {
  public static readonly ALL_ENGINE_IDS: SetValueRelationshipModelId[] = [
    'SET_TO_2D_RELATIONSHIP_V1',
    'VALUE_TO_2D_RELATIONSHIP_V1',
    'SET_VALUE_JOINT_RELATIONSHIP_V1',
    'SIMILAR_CONDITIONS_RELATIONSHIP_V1',
    'RECENCY_SET_VALUE_RELATIONSHIP_V1',
    'SESSION_SPECIFIC_SET_VALUE_V1',
  ];

  /**
   * Evaluates a specific engine by ID
   */
  public static evaluateEngine(
    modelId: SetValueRelationshipModelId,
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): SetValueEngineOutput {
    switch (modelId) {
      case 'SET_TO_2D_RELATIONSHIP_V1':
        return SetTo2DRelationshipEngine.predict(allRecords, targetDate, session, liveFeed);
      case 'VALUE_TO_2D_RELATIONSHIP_V1':
        return ValueTo2DRelationshipEngine.predict(allRecords, targetDate, session, liveFeed);
      case 'SET_VALUE_JOINT_RELATIONSHIP_V1':
        return SetValueJointRelationshipEngine.predict(allRecords, targetDate, session, liveFeed);
      case 'SIMILAR_CONDITIONS_RELATIONSHIP_V1':
        return SimilarConditionsRelationshipEngine.predict(allRecords, targetDate, session, liveFeed);
      case 'RECENCY_SET_VALUE_RELATIONSHIP_V1':
        return RecencySetValueRelationshipEngine.predict(allRecords, targetDate, session, liveFeed);
      case 'SESSION_SPECIFIC_SET_VALUE_V1':
        return SessionSpecificSetValueEngine.predict(allRecords, targetDate, session, liveFeed);
      default:
        throw new Error(`Unknown SetValueRelationshipModelId: ${modelId}`);
    }
  }

  /**
   * Evaluates all 6 engines + production champion baseline for a single session
   */
  public static evaluateAllEngines(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    liveFeed?: Array<{ time: string; set: number | string; value: number | string }>
  ): Record<SetValueRelationshipModelId | 'ALL_TIME_FREQUENCY_V1', SetValueEngineOutput> {
    const outputs: any = {};

    // 1. Evaluate 6 research engines
    for (const id of this.ALL_ENGINE_IDS) {
      outputs[id] = this.evaluateEngine(id, allRecords, targetDate, session, liveFeed);
    }

    // 2. Evaluate frozen production champion: ALL_TIME_FREQUENCY_V1
    const featRes = FeatureEngine.extractFeatures(allRecords, targetDate, session, liveFeed);
    if (featRes.success && featRes.featureVector) {
      const champOut = PredictionEngine.generatePrediction(featRes.featureVector, 'ALL_TIME_FREQUENCY_V1');
      outputs['ALL_TIME_FREQUENCY_V1'] = {
        modelId: 'ALL_TIME_FREQUENCY_V1',
        version: '1.0.0',
        session,
        targetDate,
        probabilities: champOut.candidates.map((c) => c.probability),
        candidates: champOut.candidates,
        top1: champOut.top1,
        top5: champOut.top5,
        top10: champOut.top10,
        entropy: champOut.entropy,
        topMargin: champOut.topMargin,
        confidenceScore: champOut.confidenceScore,
        validationStatus: 'READY',
        auditDetails: 'Authoritative Production Champion Baseline',
        observedPreLockSet: featRes.featureVector.momentum.currentSet,
        observedPreLockValue: featRes.featureVector.momentum.currentValue,
      };
    } else {
      // Fallback
      outputs['ALL_TIME_FREQUENCY_V1'] = buildSetValueOutput(
        'SET_TO_2D_RELATIONSHIP_V1',
        '1.0.0',
        session,
        targetDate,
        new Array<number>(100).fill(0.01),
        null,
        null,
        'READY',
        'Champion fallback'
      );
    }

    return outputs;
  }

  /**
   * Executes strict walk-forward point-in-time backtesting across all available trading dates.
   * Compares all 6 research engines against ALL_TIME_FREQUENCY_V1.
   */
  public static runWalkForwardBenchmark(
    allRecords: VerifiedMarketRecord[],
    minTrainingDays: number = 10
  ): SetValueLabBenchmarkReport {
    // 1. Identify all unique trading dates sorted chronological ascending
    const allDates = Array.from(new Set(allRecords.map((r) => r.date))).sort();

    if (allDates.length < minTrainingDays + 2) {
      throw new Error(
        `Insufficient trading dates for walk-forward evaluation: found ${allDates.length}, requires at least ${minTrainingDays + 2}.`
      );
    }

    const evaluationDates = allDates.slice(minTrainingDays);
    const events: SetValueWalkForwardEvent[] = [];

    for (const evalDate of evaluationDates) {
      const dayRecords = allRecords.filter((r) => r.date === evalDate);

      // AM Event
      const amSettle = dayRecords.find((r) => r.session === 'AM' && r.isSettlement && r.twod);
      if (amSettle && amSettle.twod && amSettle.twod.length === 2) {
        const amCheck = dayRecords.find((r) => r.time === '11:00:00');
        const amLive = amCheck && amCheck.setNumeric && amCheck.valueNumeric
          ? [{ time: '11:00:00', set: amCheck.setNumeric, value: amCheck.valueNumeric }]
          : undefined;

        const amEngineOutputs = this.evaluateAllEngines(allRecords, evalDate, 'AM', amLive);

        events.push({
          date: evalDate,
          session: 'AM',
          actualSettlement2D: amSettle.twod,
          actualSettlementSet: amSettle.setNumeric || 0,
          actualSettlementValue: amSettle.valueNumeric || 0,
          observedPreLockSet: amCheck?.setNumeric || null,
          observedPreLockValue: amCheck?.valueNumeric || null,
          engineOutputs: amEngineOutputs,
        });
      }

      // PM Event
      const pmSettle = dayRecords.find((r) => r.session === 'PM' && r.isSettlement && r.twod);
      if (pmSettle && pmSettle.twod && pmSettle.twod.length === 2) {
        const pmCheck = dayRecords.find((r) => r.time === '15:00:00');
        const pmLive = pmCheck && pmCheck.setNumeric && pmCheck.valueNumeric
          ? [{ time: '15:00:00', set: pmCheck.setNumeric, value: pmCheck.valueNumeric }]
          : undefined;

        const pmEngineOutputs = this.evaluateAllEngines(allRecords, evalDate, 'PM', pmLive);

        events.push({
          date: evalDate,
          session: 'PM',
          actualSettlement2D: pmSettle.twod,
          actualSettlementSet: pmSettle.setNumeric || 0,
          actualSettlementValue: pmSettle.valueNumeric || 0,
          observedPreLockSet: pmCheck?.setNumeric || null,
          observedPreLockValue: pmCheck?.valueNumeric || null,
          engineOutputs: pmEngineOutputs,
        });
      }
    }

    // 2. Compute performance metrics for each engine
    const allModelKeys: Array<SetValueRelationshipModelId | 'ALL_TIME_FREQUENCY_V1'> = [
      'ALL_TIME_FREQUENCY_V1',
      ...this.ALL_ENGINE_IDS,
    ];

    const metricsMap: Record<string, SetValueEngineWalkForwardMetric> = {};

    for (const key of allModelKeys) {
      let totalLogLoss = 0;
      let totalBrier = 0;
      let totalEntropy = 0;
      let top1Hits = 0;
      let top3Hits = 0;
      let top5Hits = 0;
      let top10Hits = 0;

      let amEvals = 0;
      let amLogLoss = 0;
      let amBrier = 0;
      let amTop1 = 0;
      let amTop5 = 0;
      let amTop10 = 0;

      let pmEvals = 0;
      let pmLogLoss = 0;
      let pmBrier = 0;
      let pmTop1 = 0;
      let pmTop5 = 0;
      let pmTop10 = 0;

      for (const ev of events) {
        const out = ev.engineOutputs[key];
        const actualIdx = parseInt(ev.actualSettlement2D, 10);
        const actualProb = out.probabilities[actualIdx] !== undefined ? Math.max(1e-15, out.probabilities[actualIdx]) : 1e-15;

        const logLoss = -Math.log(actualProb);
        let brier = 0;
        for (let i = 0; i < 100; i++) {
          const target = i === actualIdx ? 1 : 0;
          brier += Math.pow(out.probabilities[i] - target, 2);
        }

        totalLogLoss += logLoss;
        totalBrier += brier;
        totalEntropy += out.entropy;

        if (out.top1 === ev.actualSettlement2D) top1Hits++;
        if (out.top5.slice(0, 3).includes(ev.actualSettlement2D)) top3Hits++;
        if (out.top5.includes(ev.actualSettlement2D)) top5Hits++;
        if (out.top10.includes(ev.actualSettlement2D)) top10Hits++;

        if (ev.session === 'AM') {
          amEvals++;
          amLogLoss += logLoss;
          amBrier += brier;
          if (out.top1 === ev.actualSettlement2D) amTop1++;
          if (out.top5.includes(ev.actualSettlement2D)) amTop5++;
          if (out.top10.includes(ev.actualSettlement2D)) amTop10++;
        } else {
          pmEvals++;
          pmLogLoss += logLoss;
          pmBrier += brier;
          if (out.top1 === ev.actualSettlement2D) pmTop1++;
          if (out.top5.includes(ev.actualSettlement2D)) pmTop5++;
          if (out.top10.includes(ev.actualSettlement2D)) pmTop10++;
        }
      }

      const count = events.length;
      metricsMap[key] = {
        modelId: key,
        totalEvaluations: count,
        amEvaluations: amEvals,
        pmEvaluations: pmEvals,
        avgLogLoss: Math.round((totalLogLoss / count) * 10000) / 10000,
        avgBrierScore: Math.round((totalBrier / count) * 10000) / 10000,
        top1HitRate: Math.round((top1Hits / count) * 1000) / 10,
        top3HitRate: Math.round((top3Hits / count) * 1000) / 10,
        top5HitRate: Math.round((top5Hits / count) * 1000) / 10,
        top10HitRate: Math.round((top10Hits / count) * 1000) / 10,
        avgEntropy: Math.round((totalEntropy / count) * 1000) / 1000,
        deltaLogLossVsChampion: 0,
        deltaBrierVsChampion: 0,
        sessionBreakdown: {
          AM: {
            evaluations: amEvals,
            avgLogLoss: amEvals > 0 ? Math.round((amLogLoss / amEvals) * 10000) / 10000 : 0,
            avgBrierScore: amEvals > 0 ? Math.round((amBrier / amEvals) * 10000) / 10000 : 0,
            top1HitRate: amEvals > 0 ? Math.round((amTop1 / amEvals) * 1000) / 10 : 0,
            top5HitRate: amEvals > 0 ? Math.round((amTop5 / amEvals) * 1000) / 10 : 0,
            top10HitRate: amEvals > 0 ? Math.round((amTop10 / amEvals) * 1000) / 10 : 0,
          },
          PM: {
            evaluations: pmEvals,
            avgLogLoss: pmEvals > 0 ? Math.round((pmLogLoss / pmEvals) * 10000) / 10000 : 0,
            avgBrierScore: pmEvals > 0 ? Math.round((pmBrier / pmEvals) * 10000) / 10000 : 0,
            top1HitRate: pmEvals > 0 ? Math.round((pmTop1 / pmEvals) * 1000) / 10 : 0,
            top5HitRate: pmEvals > 0 ? Math.round((pmTop5 / pmEvals) * 1000) / 10 : 0,
            top10HitRate: pmEvals > 0 ? Math.round((pmTop10 / pmEvals) * 1000) / 10 : 0,
          },
        },
        isEligibleForAutoWeighting: false,
        eligibilityRationale: '',
      };
    }

    // 3. Compare deltas against ALL_TIME_FREQUENCY_V1 champion
    const champMetrics = metricsMap['ALL_TIME_FREQUENCY_V1'];

    const eligibleList: SetValueRelationshipModelId[] = [];
    const ineligibleList: SetValueRelationshipModelId[] = [];

    for (const id of this.ALL_ENGINE_IDS) {
      const m = metricsMap[id];
      m.deltaLogLossVsChampion = Math.round((m.avgLogLoss - champMetrics.avgLogLoss) * 10000) / 10000;
      m.deltaBrierVsChampion = Math.round((m.avgBrierScore - champMetrics.avgBrierScore) * 10000) / 10000;

      // Eligibility Criteria for next Auto-Weighting stage:
      // 1. LogLoss delta <= +0.20 (does not suffer catastrophic probability collapse)
      // 2. Top-10 hit rate >= 10.0% (captures true settlement within top decile)
      // 3. Stable entropy >= 6.0 bits (avoids over-confident single-point betting)
      if (m.deltaLogLossVsChampion <= 0.20 && m.top10HitRate >= 10.0 && m.avgEntropy >= 6.0) {
        m.isEligibleForAutoWeighting = true;
        m.eligibilityRationale = `Passes calibration gates: ΔLogLoss ${m.deltaLogLossVsChampion > 0 ? '+' : ''}${m.deltaLogLossVsChampion}, Top-10 Hit Rate ${m.top10HitRate}%, Stable entropy ${m.avgEntropy} bits.`;
        eligibleList.push(id);
      } else {
        m.isEligibleForAutoWeighting = false;
        m.eligibilityRationale = `Fails calibration criteria: ΔLogLoss ${m.deltaLogLossVsChampion > 0 ? '+' : ''}${m.deltaLogLossVsChampion} (threshold <= +0.20), Top-10 ${m.top10HitRate}% (threshold >= 10.0%).`;
        ineligibleList.push(id);
      }
    }

    // Rank engines by Log Loss ascending
    const sortedEngineIds = [...this.ALL_ENGINE_IDS].sort(
      (a, b) => metricsMap[a].avgLogLoss - metricsMap[b].avgLogLoss
    );

    return {
      evaluationWindow: {
        startDate: evaluationDates[0],
        endDate: evaluationDates[evaluationDates.length - 1],
        totalTradingDays: evaluationDates.length,
        totalEvents: events.length,
        amEvents: events.filter((e) => e.session === 'AM').length,
        pmEvents: events.filter((e) => e.session === 'PM').length,
      },
      championBaseline: champMetrics,
      engineMetrics: metricsMap as any,
      rankedEnginesByLogLoss: sortedEngineIds,
      eligibleEnginesForAutoWeighting: eligibleList,
      ineligibleEnginesForAutoWeighting: ineligibleList,
    };
  }
}
