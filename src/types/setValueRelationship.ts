import { MarketSession, VerifiedMarketRecord } from './market';
import { PredictionCandidate, PredictionFeatureVector } from './prediction';
import { ModelValidationStatus } from './candidateModel';

/**
 * Step 30: Set/Value Relationship Engine Identifiers
 */
export type SetValueRelationshipModelId =
  | 'SET_TO_2D_RELATIONSHIP_V1'
  | 'VALUE_TO_2D_RELATIONSHIP_V1'
  | 'SET_VALUE_JOINT_RELATIONSHIP_V1'
  | 'SIMILAR_CONDITIONS_RELATIONSHIP_V1'
  | 'RECENCY_SET_VALUE_RELATIONSHIP_V1'
  | 'SESSION_SPECIFIC_SET_VALUE_V1';

/**
 * Standardized Output Produced by Every Set/Value Relationship Engine
 */
export interface SetValueEngineOutput {
  modelId: SetValueRelationshipModelId;
  version: string;
  session: MarketSession;
  targetDate: string;
  probabilities: number[];            // Exactly 100 normalized non-negative probabilities summing to 1.0
  candidates: PredictionCandidate[];  // Ranked 00..99 with ranks 1..100
  top1: string;
  top5: string[];
  top10: string[];
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  validationStatus: ModelValidationStatus;
  auditDetails: string;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
}

/**
 * Point-in-Time Evaluation Event for Walk-Forward Benchmarking
 */
export interface SetValueWalkForwardEvent {
  date: string;
  session: MarketSession;
  actualSettlement2D: string;
  actualSettlementSet: number;
  actualSettlementValue: number;
  observedPreLockSet: number | null;
  observedPreLockValue: number | null;
  engineOutputs: Record<SetValueRelationshipModelId | 'ALL_TIME_FREQUENCY_V1', SetValueEngineOutput>;
}

/**
 * Detailed Performance Metric for an Engine across Walk-Forward Evaluations
 */
export interface SetValueEngineWalkForwardMetric {
  modelId: SetValueRelationshipModelId | 'ALL_TIME_FREQUENCY_V1';
  totalEvaluations: number;
  amEvaluations: number;
  pmEvaluations: number;
  avgLogLoss: number;
  avgBrierScore: number;
  top1HitRate: number;
  top3HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  avgEntropy: number;
  deltaLogLossVsChampion: number; // Negative = Outperforming ALL_TIME_FREQUENCY_V1
  deltaBrierVsChampion: number;   // Negative = Outperforming ALL_TIME_FREQUENCY_V1
  sessionBreakdown: {
    AM: {
      evaluations: number;
      avgLogLoss: number;
      avgBrierScore: number;
      top1HitRate: number;
      top5HitRate: number;
      top10HitRate: number;
    };
    PM: {
      evaluations: number;
      avgLogLoss: number;
      avgBrierScore: number;
      top1HitRate: number;
      top5HitRate: number;
      top10HitRate: number;
    };
  };
  isEligibleForAutoWeighting: boolean;
  eligibilityRationale: string;
}

/**
 * Comprehensive Benchmark Report Output for Step 30 Lab
 */
export interface SetValueLabBenchmarkReport {
  evaluationWindow: {
    startDate: string;
    endDate: string;
    totalTradingDays: number;
    totalEvents: number;
    amEvents: number;
    pmEvents: number;
  };
  championBaseline: SetValueEngineWalkForwardMetric;
  engineMetrics: Record<SetValueRelationshipModelId, SetValueEngineWalkForwardMetric>;
  rankedEnginesByLogLoss: SetValueRelationshipModelId[];
  eligibleEnginesForAutoWeighting: SetValueRelationshipModelId[];
  ineligibleEnginesForAutoWeighting: SetValueRelationshipModelId[];
}
