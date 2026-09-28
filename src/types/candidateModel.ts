import { MarketSession } from './market';
import { PredictionCandidate, PredictionFeatureVector, PredictionStatus } from './prediction';

/**
 * Registered Candidate Model Identifiers
 */
export type CandidateModelId =
  | 'SESSION_FREQUENCY_V1'
  | 'RECENCY_WEIGHTED_FREQUENCY_V1'
  | 'AM_TO_PM_CONDITIONAL_V1'
  | 'MARKOV_TRANSITION_V1'
  | 'INTRADAY_SET_VALUE_STATISTICAL_V1'
  | 'HYBRID_CANDIDATE_V1';

/**
 * Candidate Model Validation Status
 */
export type ModelValidationStatus =
  | 'READY'               // Model is fully evaluated and compliant with point-in-time contract
  | 'UNTESTABLE'          // Missing historical granularity (e.g. intraday ticks in backtesting)
  | 'REQUIRES_MORE_DATA'  // E.g. waiting for same-day AM settlement for PM conditioning
  | 'NOT_ACTIVATED'       // Experimental composite model kept inactive
  | 'FAILED_CONTRACT';    // Contract violation (e.g. AM invoked on PM-only model)

/**
 * Audit Record Preserved for Every Candidate Evaluation
 */
export interface CandidateModelAudit {
  modelId: string;
  version: string;
  session: MarketSession;
  evaluationDate: string;
  featureContractVersion: string;
  inputIntegrityHash: string;
  candidateProbabilityHash: string;
  trainingCutoff: string;
  evaluationTimestamp: string;
  validationStatus: ModelValidationStatus;
  auditDetails?: string;
}

/**
 * Standardized Output Produced by Any Candidate Model
 */
export interface CandidateModelOutput {
  modelId: string;
  version: string;
  session: MarketSession;
  probabilities: number[];            // Exactly 100 normalized non-negative probabilities summing to 1.0
  candidates: PredictionCandidate[];  // Ranked 00..99 with ranks 1..100
  top1: string;
  top5: string[];
  top10: string[];
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  validationStatus: ModelValidationStatus;
  audit: CandidateModelAudit;
}

/**
 * Common Model Contract Interface
 */
export interface CandidateModel {
  readonly modelId: CandidateModelId;
  readonly version: string;
  readonly session: MarketSession | 'BOTH';
  readonly requiredFeatures: readonly string[];
  readonly description: string;

  getValidationStatus(features?: PredictionFeatureVector): ModelValidationStatus;
  predict(features: PredictionFeatureVector): CandidateModelOutput;
}
