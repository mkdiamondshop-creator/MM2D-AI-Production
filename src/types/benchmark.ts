import { MarketSession } from './market';
import { ModelValidationStatus } from './candidateModel';

/**
 * Benchmark Model Identifiers
 */
export type BenchmarkModelId =
  | 'ALL_TIME_FREQUENCY_V1'
  | 'SESSION_FREQUENCY_V1'
  | 'RECENCY_WEIGHTED_FREQUENCY_V1'
  | 'AM_TO_PM_CONDITIONAL_V1'
  | 'MARKOV_TRANSITION_V1'
  | 'INTRADAY_SET_VALUE_STATISTICAL_V1'
  | 'AUTO_WEIGHTED_ENSEMBLE_V1';

/**
 * Single-Session Evaluation Record for a Model
 */
export interface ModelSessionEvaluation {
  modelId: BenchmarkModelId;
  date: string;
  session: MarketSession;
  actual2D: string;
  predictedTop1: string;
  predictedTop3: string[];
  predictedTop5: string[];
  predictedTop10: string[];
  actualRank: number;                 // 1 to 100
  reciprocalRank: number;             // 1 / actualRank
  actualProbability: number;          // P(actual2D)
  logLoss: number;                    // -ln(max(1e-15, P(actual2D)))
  brierScore: number;                 // Sum_i (P_i - y_i)^2
  entropy: number;
  confidenceScore: number;
  validationStatus: ModelValidationStatus | 'EVALUATED';
  untestableReason?: string;
  weightsAtCutoff?: Record<string, number>;
  ensembleProbabilityHash?: string;
}

/**
 * Aggregate Benchmark Summary for a Model in a Given Session Context
 */
export interface ModelBenchmarkSummary {
  modelId: BenchmarkModelId;
  modelName: string;
  session: MarketSession | 'COMBINED';
  samples: number;                    // Number of successfully evaluated sessions
  untestableCount: number;            // Number of sessions skipped due to UNTESTABLE / FAILED_CONTRACT
  logLoss: number;                    // Average Log Loss / Negative Log Likelihood
  brierScore: number;                 // Average Brier Score
  top1HitRate: number;                // Fraction of Top-1 hits (0.0 to 1.0)
  top3HitRate: number;                // Fraction of Top-3 hits (0.0 to 1.0)
  top5HitRate: number;                // Fraction of Top-5 hits (0.0 to 1.0)
  top10HitRate: number;               // Fraction of Top-10 hits (0.0 to 1.0)
  meanReciprocalRank: number;         // MRR
  meanPredictedProbActual: number;    // Average probability assigned to true outcome
  averageRank: number;                // Average rank of true outcome (1.0 to 100.0)
  ece: number;                        // Expected Calibration Error (Top-1 confidence calibration)
  status: string;                     // 'CHAMPION' | 'ACTIVE_CANDIDATE' | 'UNTESTABLE' | 'PM_ONLY'
}

/**
 * Dynamic Weight Distribution Behavior for a Candidate Model in Auto-Weighting
 */
export interface AutoWeightingBehaviorMetrics {
  modelId: string;
  session: MarketSession | 'COMBINED';
  averageWeight: number;
  medianWeight: number;
  minWeight: number;
  maxWeight: number;
  weightStdDev: number;
  dominantWeightCount: number;         // Number of times this model had the strictly highest weight
  dominantWeightFraction: number;      // Fraction of sessions with dominant weight
}

/**
 * Audit of Auto-Weighting Engine Decisions Across Walk-Forward Period
 */
export interface AutoWeightingAuditSummary {
  totalEvaluations: number;
  conservativePriorCount: number;      // Number of sessions falling back to uniform prior
  conservativePriorRate: number;       // conservativePriorCount / totalEvaluations
  sufficientEvidenceCount: number;
  weightBehavior: AutoWeightingBehaviorMetrics[];
  untestableModelCount: number;
}

/**
 * Paired Statistical Difference (Auto-Ensemble minus Frozen Champion)
 */
export interface PairedStatisticalComparison {
  metricName: string;                 // 'Log Loss' | 'Brier Score' | 'Top-1 Hit Rate' | 'Top-5 Hit Rate'
  metricKey: 'logLoss' | 'brierScore' | 'top1' | 'top3' | 'top5' | 'top10' | 'mrr';
  championValue: number;
  ensembleValue: number;
  difference: number;                 // ensemble - champion (negative is improvement for loss/brier)
  meanDifference: number;
  stdDifference: number;
  stdError: number;
  ci95Lower: number;
  ci95Upper: number;
  tStatistic: number;
  pValue: number;
  cohensD: number;
  statisticallySignificant: boolean;  // p < 0.05
  direction: 'IMPROVED' | 'DEGRADED' | 'NEUTRAL';
}

/**
 * Complete Walk-Forward Step 25 Benchmark Report
 */
export interface Step25BenchmarkReport {
  evaluationTimestamp: string;
  totalHistoricalRecords: number;
  minTrainingSettlements: number;
  evaluationPeriod: {
    startDate: string;
    endDate: string;
    totalTargetDates: number;
    totalEvaluatedSessions: number;
    amEvaluatedSessions: number;
    pmEvaluatedSessions: number;
  };
  // Summaries by evaluation slice
  combinedSummaries: ModelBenchmarkSummary[];
  amSummaries: ModelBenchmarkSummary[];
  pmSummaries: ModelBenchmarkSummary[];
  recentSummaries: ModelBenchmarkSummary[];
  // Auto-weighting dynamic behavior
  autoWeightingAudit: AutoWeightingAuditSummary;
  // Formal Paired Comparisons (Auto-Ensemble vs Champion)
  comparisons: {
    combined: PairedStatisticalComparison[];
    am: PairedStatisticalComparison[];
    pm: PairedStatisticalComparison[];
    recent: PairedStatisticalComparison[];
  };
  // Champions across metrics
  bestModels: {
    byLogLoss: { combined: string; am: string; pm: string; recent: string };
    byBrier: { combined: string; am: string; pm: string; recent: string };
    byTop1: { combined: string; am: string; pm: string; recent: string };
    byTop5: { combined: string; am: string; pm: string; recent: string };
  };
  // Deterministic Hashes
  benchmarkRunHash: string;
  // Safe Governance Recommendation
  governance: {
    frozenProductionChampion: 'ALL_TIME_FREQUENCY_V1';
    promotedToProduction: false;
    decisionReasoning: string;
    recommendationSummary: string;
  };
}
