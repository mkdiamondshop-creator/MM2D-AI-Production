import { MarketSession, VerifiedMarketRecord } from './market';
import { PredictionModelVersion } from './prediction';

/**
 * Model Promotion Status
 */
export type PromotionStatus = 'CHAMPION' | 'CANDIDATE' | 'REJECTED';

/**
 * Baseline Production Champion Model Identifier
 */
export const BASELINE_CHAMPION_VERSION = 'ALL_TIME_FREQUENCY_V1' as const;

/**
 * Component Weights for Deterministic Statistical Model
 * All weights must be in [0.0, 1.0] and the active components must sum exactly to 1.0 (within 1e-5 tolerance).
 */
export interface ModelComponentWeights {
  freqAllTime: number;          // All-time historical empirical frequency
  freqW30?: number;             // Rolling 30-settlement window empirical frequency
  freqW10?: number;             // Rolling 10-settlement window empirical frequency
  freqW5?: number;              // Rolling 5-settlement window empirical frequency
  weekdayPrior?: number;        // Day-of-week conditional empirical frequency
  sessionPrior?: number;        // Session-specific (AM vs PM) empirical frequency
  amToPmAffinity?: number;      // Morning-to-Afternoon settlement conditional transition probability
  digitMarginals?: number;      // Tens and units marginal joint product P(d1)*P(d2)
  markovTransition?: number;    // First-order state transition probability matrix
  momentumIntraday?: number;    // Pre-lock SET/Value intraday momentum direction prior
}

/**
 * Dual Session Model Weights Configuration
 */
export interface DualSessionModelWeights {
  am: ModelComponentWeights;
  pm: ModelComponentWeights;
}

/**
 * Chronological Block Evaluation Metric
 */
export interface ChronologicalBlockMetric {
  blockId: number;
  startDate: string;
  endDate: string;
  sampleCount: number;
  top1HitRate: number;
  top3HitRate: number;
  top5HitRate: number;
  top10HitRate: number;
  averageSettlementRank: number;
}

/**
 * Calibration & Walk-Forward Evaluation Metrics
 */
export interface CalibrationMetrics {
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
  averageSettlementRank: number;
  medianSettlementRank: number;
  entropyAvg: number;
  confidenceScoreAvg: number;
  stabilityScore: number;
  blockMetrics: ChronologicalBlockMetric[];
}

/**
 * Full Serializable Model Configuration
 */
export interface ModelConfiguration {
  modelVersion: string;
  modelName: string;
  description: string;
  weights: DualSessionModelWeights;
  trainingDataCutoff: string;
  validationRange: {
    startDate: string;
    endDate: string;
  };
  metrics: CalibrationMetrics;
  sampleCount: number;
  calibrationTimestamp: string;
  featureIntegrityHash: string;
  promotionStatus: PromotionStatus;
  parentModelVersion?: string;
  rejectionReason?: string;
}

/**
 * Chronological Partitions Specification
 */
export interface ChronologicalPartitions {
  development: {
    startDate: string;
    endDate: string;
    recordsCount: number;
    records: VerifiedMarketRecord[];
  };
  calibration: {
    startDate: string;
    endDate: string;
    recordsCount: number;
    records: VerifiedMarketRecord[];
  };
  finalLockedHoldout: {
    startDate: string;
    endDate: string;
    recordsCount: number;
    records: VerifiedMarketRecord[];
  };
}

/**
 * Individual Gates Checked during Promotion Review
 */
export interface PromotionGateChecklist {
  zeroLeakage: boolean;
  deterministicReproducibility: boolean;
  sufficientSampleSize: boolean;
  integrityTestsPassed: boolean;
  outOfSampleTop10Improvement: boolean;
  outOfSampleRankImprovement: boolean;
  chronologicalStabilityPassed: boolean;
  noMaterialDegradation: boolean;
  holdoutUntouchedDuringTuning: boolean;
}

/**
 * Comprehensive Promotion Gate Result
 */
export interface PromotionGateResult {
  candidateVersion: string;
  candidateName: string;
  championVersion: string;
  isPromoted: boolean;
  isRecommended: boolean;
  gates: PromotionGateChecklist;
  gateReasons: string[];
  recommendationMessage: string;
  championHoldoutMetrics: CalibrationMetrics;
  candidateHoldoutMetrics: CalibrationMetrics;
}

/**
 * Full Calibration Run Summary Report
 */
export interface CalibrationRunReport {
  timestamp: string;
  championVersion: string;
  totalVerifiedRecords: number;
  partitions: {
    developmentCount: number;
    calibrationCount: number;
    holdoutCount: number;
    dateRange: { start: string; end: string };
  };
  candidatesEvaluated: Array<{
    modelVersion: string;
    modelName: string;
    promotionStatus: PromotionStatus;
    calibrationMetrics: CalibrationMetrics;
    holdoutMetrics: CalibrationMetrics;
    gateResult?: PromotionGateResult;
  }>;
  recommendedChampion: string;
  promotionRecommended: boolean;
  summaryNotes: string[];
}
