import { MarketSession } from './market';
import { CandidateModelId, ModelValidationStatus } from './candidateModel';
import { PredictionCandidate } from './prediction';

/**
 * Supported Evaluation Window Types
 */
export type EvaluationWindowType = 'EXPANDING' | 'ROLLING';

/**
 * Configuration Parameters for Auto-Weighting Engine
 */
export interface AutoWeightingConfig {
  windowType: EvaluationWindowType;
  windowSize: number;           // Number of evaluations if ROLLING (default 30)
  minEvidenceCount: number;     // Minimum evaluations before departure from conservative prior (default 5)
  recencyDecayFactor: number;   // Decay factor gamma in (0, 1] applied to chronological steps (default 0.96)
  softmaxTemperature: number;   // Temperature tau for log-loss conversion (default 0.5)
  epsilon: number;              // Clamping value for log loss (default 1e-15)
  priorType: 'UNIFORM_ELIGIBLE'; // Conservative prior type
}

/**
 * Default Leakage-Safe Auto-Weighting Configuration
 */
export const DEFAULT_AUTO_WEIGHTING_CONFIG: AutoWeightingConfig = {
  windowType: 'EXPANDING',
  windowSize: 30,
  minEvidenceCount: 5,
  recencyDecayFactor: 0.96,
  softmaxTemperature: 0.5,
  epsilon: 1e-15,
  priorType: 'UNIFORM_ELIGIBLE',
};

/**
 * Historical Out-of-Sample Evaluation Record for a Single Candidate Model
 */
export interface HistoricalModelEvaluation {
  evaluationDate: string;
  session: MarketSession;
  modelId: CandidateModelId;
  modelVersion: string;
  actualSettlement2D: string;
  logLoss: number;
  brierScore: number;
  isTop1Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
  predictedProbability: number;
  predictedTop1: string;
  candidateProbabilityHash: string;
  evaluatedAt: string;
}

/**
 * Aggregated Historical Performance Metrics for a Candidate Model
 */
export interface ModelPerformanceMetrics {
  modelId: CandidateModelId;
  session: MarketSession;
  evaluationCount: number;
  averageLogLoss: number;
  weightedLogLoss: number;
  averageBrierScore: number;
  top1HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  hasSufficientEvidence: boolean;
  eligible: boolean;
  validationStatus: ModelValidationStatus;
  rejectionReason?: string;
}

/**
 * Detailed Model Contribution Breakdown in the Auto-Weighted Ensemble
 */
export interface ModelContributionInfo {
  modelId: CandidateModelId;
  version: string;
  session: MarketSession;
  weight: number;
  eligible: boolean;
  validationStatus: ModelValidationStatus;
  evaluationCount: number;
  averageLogLoss: number;
  weightedLogLoss: number;
  averageBrierScore: number;
  top1HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  top1: string;
  top5: string[];
  probabilities: number[];
  rejectionReason?: string;
}

/**
 * Audit Record Preserved for Every Auto-Weighted Ensemble Evaluation
 */
export interface AutoWeightingAudit {
  ensembleVersion: string;
  session: MarketSession;
  targetDate: string;
  modelIdsAndVersions: Record<string, string>;
  modelWeights: Record<string, number>;
  historicalEvidenceWindow: {
    startDate?: string;
    endDate?: string;
    evaluationCount: number;
    windowType: EvaluationWindowType;
    recencyDecayFactor: number;
  };
  weightCalculationCutoff: string;
  scoringMetric: 'NEGATIVE_LOG_LIKELIHOOD';
  weightCalculationMethod: string;
  featureContractVersion: string;
  inputIntegrityHash: string;
  ensembleProbabilityHash: string;
  evaluationTimestamp: string;
}

/**
 * Standardized Output Produced by AutoWeightedEnsemble
 */
export interface AutoWeightedEnsembleOutput {
  ensembleVersion: string; // 'AUTO_WEIGHTED_ENSEMBLE_V1'
  session: MarketSession;
  targetDate: string;
  cutoffTime: string;
  probabilities: number[]; // Exactly 100 elements summing to 1.0
  candidates: PredictionCandidate[]; // Ranked 00..99 with ranks 1..100
  top1: string;
  top3: string[];
  top5: string[];
  top10: string[];
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  modelWeights: Record<CandidateModelId, number>;
  modelContributions: ModelContributionInfo[];
  weightCalculationCutoff: string;
  evaluationWindow: {
    startDate?: string;
    endDate?: string;
    count: number;
  };
  performanceEvidenceCount: number;
  featureContractVersion: string;
  inputIntegrityHash: string;
  ensembleProbabilityHash: string;
  audit: AutoWeightingAudit;
}

/**
 * Backtest Evaluation Row for AutoWeightedEnsemble
 */
export interface EnsembleBacktestEvaluationRow {
  date: string;
  session: MarketSession;
  actualSettlement2D: string;
  predictedTop1: string;
  predictedTop3: string[];
  predictedTop5: string[];
  predictedTop10: string[];
  isTop1Hit: boolean;
  isTop3Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
  actual2DRank: number;
  actual2DProbability: number;
  logLoss: number;
  brierScore: number;
  entropy: number;
  confidenceScore: number;
  modelWeights: Record<string, number>;
  modelDistributions: Record<string, { top1: string; top5: string[]; actualProb: number }>;
  historicalEvidenceCount: number;
  featureIntegrityHash: string;
  ensembleProbabilityHash: string;
}

/**
 * Aggregated Walk-Forward Backtest Report for AutoWeightedEnsemble
 */
export interface EnsembleBacktestSummaryReport {
  ensembleVersion: string;
  totalEvaluated: number;
  startDate: string;
  endDate: string;
  amEvaluationsCount: number;
  pmEvaluationsCount: number;
  top1Hits: number;
  top3Hits: number;
  top5Hits: number;
  top10Hits: number;
  top1HitRate: number;
  top3HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  averageLogLoss: number;
  averageBrierScore: number;
  averageEntropy: number;
  averageConfidence: number;
  evaluations: EnsembleBacktestEvaluationRow[];
}

