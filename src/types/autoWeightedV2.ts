import { MarketSession, VerifiedMarketRecord } from './market';
import { PredictionCandidate } from './prediction';
import { SetValueEngineOutput } from './setValueRelationship';

/**
 * Component Engines Participating in AUTO_WEIGHTED_V2
 */
export type AutoWeightedV2ComponentModelId =
  | 'SESSION_SPECIFIC_SET_VALUE_V1'
  | 'SET_VALUE_JOINT_RELATIONSHIP_V1'
  | 'VALUE_TO_2D_RELATIONSHIP_V1'
  | 'ALL_TIME_FREQUENCY_V1';

export const AUTO_WEIGHTED_V2_COMPONENTS: AutoWeightedV2ComponentModelId[] = [
  'SESSION_SPECIFIC_SET_VALUE_V1',
  'SET_VALUE_JOINT_RELATIONSHIP_V1',
  'VALUE_TO_2D_RELATIONSHIP_V1',
  'ALL_TIME_FREQUENCY_V1',
];

/**
 * Configuration Parameters for Auto-Weighted V2 Ensemble
 */
export interface AutoWeightedV2Config {
  minEvidenceCount: number;      // Minimum prior walk-forward evaluations required before departing from uniform prior (default: 4)
  recencyDecayFactor: number;    // Exponential decay factor gamma in (0, 1] per evaluation step (default: 0.95)
  softmaxTemperature: number;    // Temperature tau for softmax weighting (default: 0.50)
  brierPenaltyWeight: number;    // Multiplier for Brier score in composite scoring (default: 0.25)
  epsilon: number;               // Smoothing floor for log loss calculation (default: 1e-15)
  conservativePriorWeight: number; // Prior weight for each of the 4 engines when evidence is insufficient (0.25)
}

export const DEFAULT_AUTO_WEIGHTED_V2_CONFIG: AutoWeightedV2Config = {
  minEvidenceCount: 4,
  recencyDecayFactor: 0.95,
  softmaxTemperature: 0.50,
  brierPenaltyWeight: 0.25,
  epsilon: 1e-15,
  conservativePriorWeight: 0.25,
};

/**
 * Per-Engine Candidate Support Breakdown for UI & Diagnostic Inspection
 */
export interface EngineCandidateSupport {
  modelId: AutoWeightedV2ComponentModelId;
  weight: number;
  probability: number;
  rankInModel: number;
  weightedProbability: number;
  contributionShare: number; // (weight * prob) / ensembleProb
  isInModelTop5: boolean;
  isInModelTop10: boolean;
}

/**
 * Enhanced Prediction Candidate with Detailed Multi-Engine Attribution
 */
export interface AutoWeightedV2Candidate extends PredictionCandidate {
  engineSupports: Record<AutoWeightedV2ComponentModelId, EngineCandidateSupport>;
  dominantEngine: AutoWeightedV2ComponentModelId;
  consensusCount: number; // Number of engines with this candidate in their Top 10
}

/**
 * Historical Evaluation Record for a Component Engine in Out-Of-Sample Walk-Forward
 */
export interface ComponentEngineOosEvaluation {
  date: string;
  session: MarketSession;
  modelId: AutoWeightedV2ComponentModelId;
  actualSettlement2D: string;
  actualSettlementRank: number;
  actualSettlementProb: number;
  logLoss: number;
  brierScore: number;
  reciprocalRank: number;
  isTop1Hit: boolean;
  isTop3Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
}

/**
 * Aggregated Historical Metrics for a Component Engine in a Specific Session
 */
export interface ComponentEngineMetricsSummary {
  modelId: AutoWeightedV2ComponentModelId;
  session: MarketSession;
  evaluationCount: number;
  averageLogLoss: number;
  weightedLogLoss: number;
  averageBrierScore: number;
  weightedBrierScore: number;
  compositeScore: number;
  top1HitRate: number;
  top3HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  mrr: number; // Mean Reciprocal Rank (sum(1/rank) / N)
  averageRank: number;
  learnedWeight: number;
  hasSufficientEvidence: boolean;
}

/**
 * Output format for component engines participating in Auto-Weighted V2
 */
export interface AutoWeightedComponentOutput {
  modelId: AutoWeightedV2ComponentModelId;
  version: string;
  session: MarketSession;
  targetDate: string;
  probabilities: number[];
  candidates: PredictionCandidate[];
  top1: string;
  top5: string[];
  top10: string[];
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  validationStatus: string;
  auditDetails: string;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
}

/**
 * Complete Prediction Output Produced by AUTO_WEIGHTED_V2
 */
export interface AutoWeightedV2Output {
  modelId: 'AUTO_WEIGHTED_V2';
  version: '2.0.0';
  session: MarketSession;
  targetDate: string;
  cutoffTime: string;
  probabilities: number[]; // Exactly 100 normalized probabilities summing to 1.0
  candidates: AutoWeightedV2Candidate[]; // Ranked 1..100
  top1: string;
  top3: string[];
  top5: string[];
  top10: string[];
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  weights: Record<AutoWeightedV2ComponentModelId, number>;
  componentMetrics: Record<AutoWeightedV2ComponentModelId, ComponentEngineMetricsSummary>;
  engineOutputs: Record<AutoWeightedV2ComponentModelId, AutoWeightedComponentOutput>;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
  historicalEvidenceCount: number;
  auditDetails: string;
  inputIntegrityHash: string;
  distributionHash: string;
}

/**
 * Event-level Walk-Forward Evaluation Record Comparing V2 vs Champion
 */
export interface AutoWeightedV2EvaluationEvent {
  date: string;
  session: MarketSession;
  actualSettlement2D: string;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
  // V2 Ensemble metrics
  v2Top1: string;
  v2Top3: string[];
  v2Top5: string[];
  v2Top10: string[];
  v2Rank: number;
  v2Prob: number;
  v2LogLoss: number;
  v2Brier: number;
  v2Entropy: number;
  v2Weights: Record<AutoWeightedV2ComponentModelId, number>;
  // Champion Baseline metrics
  champTop1: string;
  champTop3: string[];
  champTop5: string[];
  champTop10: string[];
  champRank: number;
  champProb: number;
  champLogLoss: number;
  champBrier: number;
  champEntropy: number;
  // Comparative diffs (V2 - Champ: negative is better for loss/brier, positive for rank)
  deltaLogLoss: number; // v2LogLoss - champLogLoss
  deltaBrier: number;   // v2Brier - champBrier
  isV2WinOnLoss: boolean;
  isChampWinOnLoss: boolean;
  isLossTie: boolean;
}

/**
 * Paired Statistical Test Comparison Summary
 */
export interface PairedStatisticalComparison {
  metricName: string;
  meanV2: number;
  meanChampion: number;
  meanDifference: number; // V2 - Champion
  stdDifference: number;
  tStatistic: number;
  degreesOfFreedom: number;
  pValueTwoTailed: number;
  isStatisticallySignificant: boolean; // p < 0.05
  v2Wins: number;
  championWins: number;
  ties: number;
}

/**
 * Session-Specific Aggregate Performance
 */
export interface SessionPerformanceAggregate {
  session: MarketSession;
  eventCount: number;
  avgLogLossV2: number;
  avgLogLossChamp: number;
  deltaLogLoss: number; // V2 - Champ
  avgBrierV2: number;
  avgBrierChamp: number;
  deltaBrier: number;
  top1RateV2: number;
  top1RateChamp: number;
  top3RateV2: number;
  top3RateChamp: number;
  top5RateV2: number;
  top5RateChamp: number;
  top10RateV2: number;
  top10RateChamp: number;
  mrrV2: number;
  mrrChamp: number;
  avgRankV2: number;
  avgRankChamp: number;
  avgEntropyV2: number;
  avgEntropyChamp: number;
  improvesConsistently: boolean;
}

/**
 * Comprehensive Benchmark Report Produced for Step 31
 */
export interface AutoWeightedV2BenchmarkReport {
  benchmarkTimestamp: string;
  sampleCounts: {
    totalEvents: number;
    amEvents: number;
    pmEvents: number;
    tradingDaysCount: number;
    startDate: string;
    endDate: string;
  };
  componentEngineMetrics: Record<AutoWeightedV2ComponentModelId, {
    overallLogLoss: number;
    overallBrier: number;
    overallTop1Rate: number;
    overallTop3Rate: number;
    overallTop5Rate: number;
    overallTop10Rate: number;
    overallMrr: number;
    overallAvgRank: number;
    amLogLoss: number;
    pmLogLoss: number;
  }>;
  learnedWeights: {
    AM: Record<AutoWeightedV2ComponentModelId, number>;
    PM: Record<AutoWeightedV2ComponentModelId, number>;
  };
  overallEnsembleMetrics: {
    v2: {
      logLoss: number;
      brierScore: number;
      top1HitRate: number;
      top3HitRate: number;
      top5HitRate: number;
      top10HitRate: number;
      mrr: number;
      avgRank: number;
      avgEntropy: number;
    };
    champion: {
      logLoss: number;
      brierScore: number;
      top1HitRate: number;
      top3HitRate: number;
      top5HitRate: number;
      top10HitRate: number;
      mrr: number;
      avgRank: number;
      avgEntropy: number;
    };
    delta: {
      logLoss: number;
      brierScore: number;
      top1HitRate: number;
      top3HitRate: number;
      top5HitRate: number;
      top10HitRate: number;
      mrr: number;
      avgRank: number;
    };
  };
  sessionBreakdown: {
    AM: SessionPerformanceAggregate;
    PM: SessionPerformanceAggregate;
  };
  pairedStatisticalComparison: {
    logLoss: PairedStatisticalComparison;
    brier: PairedStatisticalComparison;
  };
  consistencyAssessment: {
    improvesInAM: boolean;
    improvesInPM: boolean;
    consistentBothSessions: boolean;
    summary: string;
  };
  productionPromotionRecommendation: {
    recommended: boolean;
    recommendationType: 'MAINTAIN_FROZEN_CHAMPION' | 'RECOMMEND_PROMOTION_V2';
    summary: string;
    actionItems: string[];
  };
  events: AutoWeightedV2EvaluationEvent[];
}

/**
 * STEP 32: SHADOW VALIDATION DATA TYPES
 */
export interface ShadowSettlementMetrics {
  logLoss: number;
  brierScore: number;
  actualRank: number;
  actualProbability: number;
  isTop1Hit: boolean;
  isTop3Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
  reciprocalRank: number;
}

/**
 * STEP 33: Per-Engine Settlement Performance Metrics
 */
export interface PerEngineSettlementPerformance {
  modelId: AutoWeightedV2ComponentModelId;
  weight: number;
  probability: number;
  rankInModel: number;
  logLoss: number;
  brierScore: number;
  reciprocalRank: number;
  isTop1Hit: boolean;
  isTop3Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
  contributionShare: number;
}

export interface ShadowSessionRecord {
  id: string; // e.g. SHADOW_2026-08-25_AM
  targetDate: string;
  session: MarketSession;
  publishBoundaryTime: string; // '11:00:00' | '15:00:00'
  lockBoundaryTime: string;    // '12:00:00' | '16:00:00'
  settlementTime: string;      // '12:01:00' | '16:30:00'
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
  isFrozenAtLock: boolean;
  frozenAtTimestamp: string;
  top1?: string; // Top Candidate (#1)
  top5?: readonly string[]; // Top-5 (strictly first 5 of Top-10)
  top10?: readonly string[]; // Top-10
  liveObservationSnapshot?: readonly { time: string; set: number; value: number; timestamp?: string }[];
  engineWeights?: Record<AutoWeightedV2ComponentModelId, number>;
  integrityHash?: string;
  immutableV2Output: {
    probabilities: readonly number[]; // 100 probabilities
    top1?: string; // Top Candidate (#1)
    top5?: readonly string[]; // Top-5
    top10: readonly string[];
    weights: Readonly<Record<AutoWeightedV2ComponentModelId, number>>;
    candidates: readonly AutoWeightedV2Candidate[];
    distributionHash: string;
    entropy: number;
    liveObservationSnapshot?: readonly { time: string; set: number; value: number; timestamp?: string }[];
    integrityHash?: string;
  };
  settlementComparison: {
    actualSettlement2D: string;
    actualSettlementSet: number;
    actualSettlementValue: number;
    settledAt: string;
    v2: ShadowSettlementMetrics;
    champion: ShadowSettlementMetrics;
    delta: {
      deltaLogLoss: number; // v2 - champ
      deltaBrier: number;   // v2 - champ
      rankDifference: number; // champRank - v2Rank (positive = v2 higher)
      winner: 'V2' | 'CHAMPION' | 'TIE';
    };
    engineWeights?: Record<AutoWeightedV2ComponentModelId, number>;
    perEnginePerformance?: Record<AutoWeightedV2ComponentModelId, PerEngineSettlementPerformance>;
  } | null;
  immutabilityHash: string;
  antiLeakageAudit: {
    zeroPostLockDataUsed: boolean;
    zeroFutureDatesUsed: boolean;
    zeroTargetSettlementLeakage: boolean;
    sessionIsolationEnforced: boolean;
  };
}

export interface ShadowValidationSummary {
  totalEvaluatedSessions: number;
  amEvaluatedSessions: number;
  pmEvaluatedSessions: number;
  startDate: string;
  endDate: string;
  tradingDaysCount: number;
  metrics: {
    v2: {
      logLoss: number;
      brierScore: number;
      top1Rate: number;
      top3Rate: number;
      top5Rate: number;
      top10Rate: number;
      mrr: number;
      avgRank: number;
      avgEntropy: number;
    };
    champion: {
      logLoss: number;
      brierScore: number;
      top1Rate: number;
      top3Rate: number;
      top5Rate: number;
      top10Rate: number;
      mrr: number;
      avgRank: number;
      avgEntropy: number;
    };
    delta: {
      logLoss: number;
      brierScore: number;
      top1Rate: number;
      top3Rate: number;
      top5Rate: number;
      top10Rate: number;
      mrr: number;
      avgRank: number;
    };
  };
  sessionBreakdown: {
    AM: {
      count: number;
      v2LogLoss: number;
      champLogLoss: number;
      deltaLogLoss: number;
      v2Brier: number;
      champBrier: number;
      v2Top10: number;
      champTop10: number;
      v2Mrr: number;
      champMrr: number;
      v2AvgRank: number;
      champAvgRank: number;
      learnedWeights: Record<AutoWeightedV2ComponentModelId, number>;
    };
    PM: {
      count: number;
      v2LogLoss: number;
      champLogLoss: number;
      deltaLogLoss: number;
      v2Brier: number;
      champBrier: number;
      v2Top10: number;
      champTop10: number;
      v2Mrr: number;
      champMrr: number;
      v2AvgRank: number;
      champAvgRank: number;
      learnedWeights: Record<AutoWeightedV2ComponentModelId, number>;
    };
  };
  headToHead: {
    v2Wins: number;
    champWins: number;
    ties: number;
    v2WinRate: number;
  };
  pairedTTest: {
    tStatistic: number;
    pValue: number;
    isSignificant: boolean;
  };
  records: ShadowSessionRecord[];
}

/**
 * Step 34: V2 Shadow Quality Gate Status & Criteria
 */
export type QualityGateStatus = 'SHADOW' | 'INSUFFICIENT_EVIDENCE' | 'PASS_CANDIDATE';

export interface QualityGateCriterion {
  id: string;
  name: string;
  category: 'MINIMUM_EVIDENCE' | 'SESSION_CONSISTENCY' | 'STATISTICAL_SAFETY' | 'ANTI_LEAKAGE';
  threshold: string;
  actual: string | number;
  passed: boolean;
  description: string;
}

export interface EngineAggregateMetric {
  avgNll: number;
  avgBrier: number;
  top1Rate: number;
  top3Rate: number;
  top5Rate: number;
  top10Rate: number;
  mrr: number;
  avgRank: number;
  avgWeight: number;
}

export interface SessionDetailedPerformance {
  count: number;
  v2: {
    nll: number;
    brier: number;
    top1Rate: number;
    top3Rate: number;
    top5Rate: number;
    top10Rate: number;
    mrr: number;
    avgRank: number;
  };
  champion: {
    nll: number;
    brier: number;
    top1Rate: number;
    top3Rate: number;
    top5Rate: number;
    top10Rate: number;
    mrr: number;
    avgRank: number;
  };
  delta: {
    deltaNll: number;
    deltaBrier: number;
    deltaTop1: number;
    deltaTop3: number;
    deltaTop5: number;
    deltaTop10: number;
    deltaMrr: number;
    deltaAvgRank: number;
  };
  headToHead: {
    v2Wins: number;
    champWins: number;
    ties: number;
    winRate: number;
  };
  perEnginePerformance: Record<AutoWeightedV2ComponentModelId, EngineAggregateMetric>;
}

export interface QualityGateEvaluationResult {
  status: QualityGateStatus;
  totalEvidenceSessions: number;
  amEvidenceSessions: number;
  pmEvidenceSessions: number;
  tradingDaysCount: number;
  amPerformance: SessionDetailedPerformance;
  pmPerformance: SessionDetailedPerformance;
  overallPerformance: SessionDetailedPerformance;
  statisticalSafety: {
    tStatistic: number;
    pValue: number;
    isSignificant: boolean;
    headToHeadWinRate: number;
    maxSingleDayContributionShare: number;
    passedSingleDayOutlierCheck: boolean;
    zeroTargetDayLeakageVerified: boolean;
    zeroPostLockLeakageVerified: boolean;
  };
  criteria: QualityGateCriterion[];
  failedCriteria: string[];
  recommendation: string;
  evaluatedAt: string;
}


