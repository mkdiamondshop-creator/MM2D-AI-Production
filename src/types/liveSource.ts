/**
 * Type definitions for Multi-Source Live Market Data Layer
 * Strict Zero-Fabrication & Source Provenance Architecture
 */

export type LiveSourceType = 'THAISTOCK_2D_PRIMARY' | 'SET_OFFICIAL_FALLBACK';

export type LiveSourceStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'UNCONFIGURED'
  | 'RATE_LIMITED'
  | 'SCHEMA_ERROR'
  | 'STALE_DATA'
  | 'INSUFFICIENT_DATA';

export type LiveDataQuality =
  | 'OFFICIAL_VERIFIED'
  | 'FALLBACK_VERIFIED'
  | 'LIVE_DATA_STALE'
  | 'INSUFFICIENT_LIVE_DATA';

/**
 * Point-in-Time Live Market Observation Snapshot
 * Contains verified SET and Market Value metrics with complete source provenance.
 * NOTE: Live 2D is explicitly prohibited from model inputs or SET/Value substitution.
 */
export interface LiveMarketSnapshot {
  source: LiveSourceType;
  sourceName: string;
  timestamp: string;          // ISO timestamp in Asia/Bangkok (+07:00)
  date: string;               // "YYYY-MM-DD"
  time: string;               // "HH:mm:ss"
  setNumeric: number;         // Verified numeric SET Index (e.g. 1609.03)
  valueNumeric: number;       // Verified numeric Market Value (e.g. 39115.49)
  setRaw: string;             // Raw string as received from upstream (e.g. "1,609.03")
  valueRaw: string;           // Raw string as received from upstream (e.g. "39,115.49")
  isCheckpoint1100: boolean;  // True if captured at/for 11:00 AM session open
  isCheckpoint1500: boolean;  // True if captured at/for 15:00 PM session open
  provenance: string;         // Descriptive provenance trail
  quality: LiveDataQuality;
  latencyMs: number;
}

export interface SourceAttemptLog {
  source: LiveSourceType;
  sourceName: string;
  attemptedAt: string;
  status: LiveSourceStatus;
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}

/**
 * Result returned by the Live Source Adapter
 */
export interface LiveSourceResult {
  success: boolean;
  status: 'SUCCESS' | 'INSUFFICIENT_LIVE_DATA' | 'LIVE_DATA_STALE' | 'MARKET_CLOSED' | 'SOURCE_UNAVAILABLE';
  snapshot?: LiveMarketSnapshot;
  sourceUsed?: LiveSourceType;
  totalLatencyMs: number;
  errorDetails?: string;
  sourceAttempts: SourceAttemptLog[];
}

/**
 * Contract for all official live market data source providers
 */
export interface ILiveMarketSource {
  readonly sourceType: LiveSourceType;
  readonly sourceName: string;
  
  /**
   * Indicates if the source is properly configured with valid endpoints/credentials.
   */
  isConfigured(): boolean;

  /**
   * Fetches authentic live SET and Value metrics from the upstream provider.
   * Never fabricates, estimates, or interpolates missing numbers.
   */
  fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult>;
}
