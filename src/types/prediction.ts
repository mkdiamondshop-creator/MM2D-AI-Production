import { MarketSession, VerifiedMarketRecord } from './market';

/**
 * Production Model Version Identifiers
 */
export type PredictionModelVersion =
  | 'AUTO_WEIGHTED_V2'
  | 'ALL_TIME_FREQUENCY_V1'
  | 'STEP67_CALIBRATED_ENSEMBLE_RESEARCH'
  | 'MARKOV_RESEARCH'
  | 'AUTO_WEIGHTED_ENSEMBLE_V1'
  | string;

export const PRODUCTION_MODEL_VERSION: PredictionModelVersion = 'AUTO_WEIGHTED_V2';

/**
 * Logical Record Type Isolation
 */
export type PredictionRecordType = 'MODEL_PREDICTION' | 'OFFICIAL_RESULT';

/**
 * Explicit Prediction Status States
 */
export type PredictionStatus =
  | 'NON_TRADING_DAY'
  | 'MARKET_NOT_OPEN'
  | 'WAITING_FOR_LIVE_DATA'
  | 'ANALYZING_LIVE_DATA'
  | 'INSUFFICIENT_LIVE_DATA'
  | 'LIVE_DATA_STALE'
  | 'READY_FOR_PREDICTION'
  | 'PREDICTION_READY'
  | 'PREDICTION_LOCKED'
  | 'OFFICIAL_RESULT_AVAILABLE'
  | 'INSUFFICIENT_HISTORICAL_DATA'
  | 'TRADING_CALENDAR_UNAVAILABLE'
  | 'MARKET_CLOSED'
  | 'WAITING_FOR_LOCK'
  | 'INSUFFICIENT_DATA';

/**
 * Session Cutoff & Result Specifications
 * Canonical Predictions:
 * AM Lock: 11:30 Yangon (MMT) = 12:00 Bangkok (BKK)
 * AM Publish: 11:25 Yangon (MMT) = 11:55 Bangkok (BKK)
 * AM Result: 12:01 Yangon (MMT) / Provider Timestamp 12:01:00
 * PM Lock: 15:30 Yangon (MMT) = 16:00 Bangkok (BKK)
 * PM Publish: 15:25 Yangon (MMT) = 15:55 Bangkok (BKK)
 * PM Result: 16:30 Yangon (MMT) / Provider Timestamp 16:30:00
 */
export const PREDICTION_CUTOFFS = {
  AM: {
    hour: 12,
    minute: 0,
    timeString: '12:00:00', // Bangkok Lock Time (UTC+7)
    yangonTimeString: '11:30:00', // Myanmar Lock Time (UTC+6:30)
    publishHour: 11,
    publishMinute: 55,
    publishTimeString: '11:55:00', // Bangkok Publish Time (UTC+7) = 11:25 Myanmar
    yangonPublishTimeString: '11:25:00', // Myanmar Publish Time (UTC+6:30)
    settlementTime: '12:01:00', // Provider MM2D Result Label (12:01 PM Myanmar)
    yangonResultTimeString: '12:01:00', // Myanmar Result Display Time (12:01 PM)
    targetSession: 'AM' as MarketSession,
  },
  PM: {
    hour: 16,
    minute: 0,
    timeString: '16:00:00', // Bangkok Lock Time (UTC+7)
    yangonTimeString: '15:30:00', // Myanmar Lock Time (UTC+6:30)
    publishHour: 15,
    publishMinute: 55,
    publishTimeString: '15:55:00', // Bangkok Publish Time (UTC+7) = 15:25 Myanmar
    yangonPublishTimeString: '15:25:00', // Myanmar Publish Time (UTC+6:30)
    settlementTime: '16:30:00', // Provider MM2D Result Label (4:30 PM Myanmar)
    yangonResultTimeString: '16:30:00', // Myanmar Result Display Time (4:30 PM)
    targetSession: 'PM' as MarketSession,
  },
} as const;

/**
 * Pre-Lock Live Intraday Market Observation
 * Captures SET index and Market Value observed before cutoff.
 * NOTE: Live 2D is explicitly prohibited from model inputs.
 */
export interface PreLockObservation {
  timestamp: string; // ISO string or Bangkok timestamp
  time: string; // "HH:mm:ss"
  set: number; // e.g. 1609.03
  value: number; // e.g. 39115.49
  isCheckpoint1100?: boolean; // True if from 11:00 AM checkpoint
  isCheckpoint1500?: boolean; // True if from 15:00 PM checkpoint
}

/**
 * Pre-Lock Live Snapshot containing valid observations prior to cutoff
 */
export interface PreLockLiveSnapshot {
  targetDate: string; // "YYYY-MM-DD"
  session: MarketSession; // "AM" | "PM"
  cutoffTimestamp: string; // Bangkok cutoff ISO string
  observations: PreLockObservation[]; // Sorted chronologically
  latestObservation?: PreLockObservation;
  sessionOpenObservation?: PreLockObservation; // 11:00 for AM, 15:00 for PM
  isValid: boolean;
  status: 'VALID' | 'NO_OBSERVATIONS' | 'POST_LOCK_DATA_EXCLUDED' | 'MARKET_CLOSED';
}

/**
 * Statistical Distributions & Historical Matrices
 */
export interface HistoricalDistributions {
  // Digit distributions for 00..99 (normalized probabilities summing to 1.0, length 100)
  freqAllTime: number[];
  freqW30: number[];
  freqW10: number[];
  freqW5: number[];
  
  // Digit-level marginals (0..9)
  firstDigitFreqW30: number[];  // Tens digit distribution (0-9)
  secondDigitFreqW30: number[]; // Units digit distribution (0-9)
  
  // Parity statistics (W30)
  oddRatioW30: number;          // Fraction of odd 2D numbers (0..1)
  evenRatioW30: number;         // Fraction of even 2D numbers (0..1)
  highRatioW30: number;         // Fraction >= 50 (0..1)
  lowRatioW30: number;          // Fraction < 50 (0..1)

  // Contextual distributions
  weekdayFreq: number[];        // Historical distribution for this specific dayOfWeek (length 100)
  sessionFreq: number[];        // Historical distribution for AM or PM (length 100)

  // Markov & Sequential Transitions
  prevSettlement2D: string | null; // e.g. "84"
  markovTransitionProbabilities: number[]; // Empirical transition distribution P(Y_t | Y_{t-1}) (length 100)
  
  // PM Inter-Session Transition (PM only, conditioned on today's verified 12:01 AM settlement)
  todayAmSettlement2D?: string | null;
  amToPmTransitionProbabilities?: number[]; // P(PM_t | AM_t) (length 100)
  
  // Sample Counts
  sampleCountAllTime: number;
  sampleCountW30: number;
  sampleCountW10: number;
  sampleCountW5: number;
}

/**
 * Macro SET & Value Momentum Features
 */
export interface MarketMomentumFeatures {
  // Inter-day Momentum (Historical settlements only)
  prevCloseSet: number | null;     // Previous day PM settlement SET
  prevCloseValue: number | null;   // Previous day PM settlement Value
  setDeltaW5: number | null;       // 5-day net SET change: SET(T-1) - SET(T-6)
  valueRatioW5: number | null;     // 5-day avg value / 30-day baseline ratio

  // Intraday Pre-Lock Movements (T <= Cutoff)
  currentSet: number | null;
  currentValue: number | null;
  setChangeFromPrevClose: number | null;
  valueChangeFromPrevClose: number | null;
  setChangeFromSessionOpen: number | null; // vs 11:00 for AM, vs 15:00 for PM
  valueChangeFromSessionOpen: number | null;
  observationCount: number;
  intradaySetVolatility: number | null;    // Sample standard deviation of pre-lock SET ticks
}

/**
 * Complete Point-in-Time Prediction Feature Vector
 */
export interface PredictionFeatureVector {
  targetDate: string;                    // "YYYY-MM-DD"
  session: MarketSession;                // "AM" | "PM"
  dayOfWeek: number;                     // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  cutoffTimestamp: string;               // ISO representation in Asia/Bangkok
  isPreLockLiveAvailable: boolean;
  
  distributions: HistoricalDistributions;
  momentum: MarketMomentumFeatures;
  
  // Anti-Leakage Audit Hash & Provenance
  featureIntegrityHash: string;          // SHA-256 hash of all input components
  eligibleRecordsCount: number;          // Total historical verified records strictly prior to cutoff
}

/**
 * Feature Contract Source Classification
 */
export type FeatureSource =
  | 'HISTORICAL_AM_DATABASE'
  | 'HISTORICAL_PM_DATABASE'
  | 'SAME_DAY_AM_OFFICIAL_SETTLEMENT'
  | 'PRE_LOCK_INTRADAY_LIVE_FEED'
  | 'CALENDAR_METADATA';

export type FeatureStatus = 'ALLOWED' | 'FORBIDDEN';

/**
 * Explicit Feature Contract Specification
 */
export interface FeatureContractEntry {
  featureId: string;
  featureName: string;
  source: FeatureSource;
  session: MarketSession | 'BOTH';
  cutoffSpecification: string;
  status: FeatureStatus;
  prohibitionReason?: string;
  description: string;
}

/**
 * Feature Audit Compliance Report
 */
export interface FeatureAuditReport {
  targetDate: string;
  session: MarketSession;
  auditedAt: string;
  isCompliant: boolean;
  violationsCount: number;
  violations: string[];
  allowedFeaturesChecked: number;
  forbiddenFeaturesChecked: number;
}

/**
 * Feature Extraction Result
 */
export interface FeatureExtractionResult {
  success: boolean;
  featureVector?: PredictionFeatureVector;
  status: 'READY' | 'INSUFFICIENT_HISTORICAL_DATA' | 'MARKET_CLOSED' | 'LEAKAGE_DETECTED';
  errorDetails?: string;
  contractAudit?: FeatureAuditReport;
}

/**
 * Candidate 2D Prediction
 */
export interface PredictionCandidate {
  rank: number;       // 1-indexed (1 to 100)
  twod: string;       // "00" to "99"
  probability: number;// Calibrated probability [0.0, 1.0]
  score: number;      // Raw score
}

/**
 * Final Session Prediction Result
 */
export interface SessionPredictionOutput {
  recordType: 'MODEL_PREDICTION';
  modelVersion: string;              // e.g. 'ALL_TIME_FREQUENCY_V1'
  targetDate: string;
  session: MarketSession;
  generatedAt: string;
  cutoffTime: string;
  isFrozen: boolean;
  status: PredictionStatus;
  candidates: PredictionCandidate[]; // All 100 ranked candidates
  top1: string;
  top3: string[];
  top5: string[];
  top10: string[];
  entropy: number;                   // Shannon entropy measuring distribution sharpness
  topMargin: number;                 // Difference between Top-1 and Top-2 probability
  confidenceScore: number;           // Normalized confidence rating (0-100)
  featureIntegrityHash: string;
  preLockSourceUsed?: string;        // e.g. 'THAISTOCK_2D_PRIMARY', 'SET_OFFICIAL_FALLBACK', 'INSUFFICIENT_LIVE_DATA'
}

/**
 * Locked Snapshot Record stored in Lock Engine
 */
export interface FrozenPredictionSnapshot {
  targetDate: string;
  session: MarketSession;
  modelVersion: string;
  cutoffTimestamp: string;
  frozenAt: string;
  featureVector: PredictionFeatureVector;
  predictionOutput: SessionPredictionOutput;
  featureIntegrityHash: string;
  isLocked: boolean;
}

/**
 * Stored Model Prediction Record (Separated completely from Official Results)
 */
export interface StoredModelPrediction {
  id: string; // e.g. "pred_2026-08-27_AM_ALL_TIME_FREQUENCY_V1"
  recordType: 'MODEL_PREDICTION';
  targetDate: string;
  session: MarketSession;
  modelVersion: string;
  status: PredictionStatus;
  top1: string;
  top3Json: string;
  top5Json: string;
  top10Json: string;
  candidatesJson: string;
  entropy: number;
  topMargin: number;
  confidenceScore: number;
  featureIntegrityHash: string;
  cutoffTime: string;
  generatedAt: string;
  isFrozen: number;
  frozenAt?: string;
  preLockSourceUsed?: string;
}

/**
 * Walk-Forward Backtest Prediction Evaluation Result
 */
export interface BacktestEvaluationRow {
  date: string;
  session: MarketSession;
  modelVersion: string;
  actualSettlement2D: string;
  predictedTop1: string;
  predictedTop3: string[];
  predictedTop5: string[];
  predictedTop10: string[];
  isTop1Hit: boolean;
  isTop3Hit: boolean;
  isTop5Hit: boolean;
  isTop10Hit: boolean;
  actual2DRank: number; // Rank position of actual settlement in predicted 00..99
  actual2DProbability: number;
  entropy: number;
  confidenceScore: number;
  featureIntegrityHash: string;
  trainingSamplesCount: number;
}

/**
 * Aggregated Walk-Forward Backtest Report
 */
export interface BacktestSummaryReport {
  modelVersion: string;
  totalEvaluated: number;
  startDate: string;
  endDate: string;
  amEvaluationsCount: number;
  pmEvaluationsCount: number;
  top1Hits: number;
  top3Hits: number;
  top5Hits: number;
  top10Hits: number;
  top1HitRate: number;  // [0.0, 1.0]
  top3HitRate: number;  // [0.0, 1.0]
  top5HitRate: number;  // [0.0, 1.0]
  top10HitRate: number; // [0.0, 1.0]
  averageEntropy: number;
  averageConfidence: number;
  evaluations: BacktestEvaluationRow[];
}


