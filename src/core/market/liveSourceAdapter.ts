import {
  ILiveMarketSource,
  LiveSourceResult,
  LiveMarketSnapshot,
  SourceAttemptLog,
} from '../../types/liveSource';
import { ThaiStock2dSource } from './thaistock2dSource';
import { SetOfficialSource } from './setOfficialSource';

export interface LiveSourceAdapterConfig {
  primarySource?: ILiveMarketSource;
  fallbackSource?: ILiveMarketSource;
}

/**
 * Multi-Source Live Market Data Adapter
 * Orchestrates Primary (ThaiStock2D) and Secondary (SET Official) feeds
 * with zero-fabrication safety and end-to-end provenance tracking.
 */
export class LiveSourceAdapter {
  private primarySource: ILiveMarketSource;
  private fallbackSource: ILiveMarketSource;

  constructor(config?: LiveSourceAdapterConfig) {
    this.primarySource = config?.primarySource || new ThaiStock2dSource();
    this.fallbackSource = config?.fallbackSource || new SetOfficialSource();
  }

  /**
   * Fetches authentic live market observation using strict primary-to-fallback order.
   * Invariant: Never estimates, interpolates, fabricates, or uses live 2D as substitute.
   */
  public async getLiveMarketSnapshot(targetDate?: string): Promise<LiveSourceResult> {
    const startTime = Date.now();
    const allAttempts: SourceAttemptLog[] = [];

    // STEP 1: Attempt Primary Source (ThaiStock2D)
    try {
      const primaryResult = await this.primarySource.fetchLiveSnapshot(targetDate);
      allAttempts.push(...primaryResult.sourceAttempts);

      if (primaryResult.success && primaryResult.snapshot) {
        return {
          success: true,
          status: 'SUCCESS',
          snapshot: primaryResult.snapshot,
          sourceUsed: primaryResult.sourceUsed,
          totalLatencyMs: Date.now() - startTime,
          sourceAttempts: allAttempts,
        };
      }

      // If primary indicated market closed (clean weekend/holiday response), respect market closed state
      if (primaryResult.status === 'MARKET_CLOSED') {
        return {
          success: false,
          status: 'MARKET_CLOSED',
          sourceUsed: this.primarySource.sourceType,
          totalLatencyMs: Date.now() - startTime,
          errorDetails: 'Market is closed (ThaiStock2D official feed returned empty/holiday state)',
          sourceAttempts: allAttempts,
        };
      }
    } catch (primaryErr) {
      allAttempts.push({
        source: this.primarySource.sourceType,
        sourceName: this.primarySource.sourceName,
        attemptedAt: new Date().toISOString(),
        status: 'UNAVAILABLE',
        latencyMs: Date.now() - startTime,
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
    }

    // STEP 2: Primary Failed/Unavailable -> Attempt Secondary Fallback (SET Official)
    if (this.fallbackSource.isConfigured()) {
      try {
        const fallbackResult = await this.fallbackSource.fetchLiveSnapshot(targetDate);
        allAttempts.push(...fallbackResult.sourceAttempts);

        if (fallbackResult.success && fallbackResult.snapshot) {
          return {
            success: true,
            status: 'SUCCESS',
            snapshot: fallbackResult.snapshot,
            sourceUsed: fallbackResult.sourceUsed,
            totalLatencyMs: Date.now() - startTime,
            sourceAttempts: allAttempts,
          };
        }
      } catch (fallbackErr) {
        allAttempts.push({
          source: this.fallbackSource.sourceType,
          sourceName: this.fallbackSource.sourceName,
          attemptedAt: new Date().toISOString(),
          status: 'UNAVAILABLE',
          latencyMs: Date.now() - startTime,
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
      }
    } else {
      allAttempts.push({
        source: this.fallbackSource.sourceType,
        sourceName: this.fallbackSource.sourceName,
        attemptedAt: new Date().toISOString(),
        status: 'UNCONFIGURED',
        latencyMs: 0,
        error: 'SET Official fallback interface is unconfigured (requires SET_OFFICIAL_API_KEY/URL)',
      });
    }

    // STEP 3: Both Sources Unavailable / Insufficient Data
    // Strict Zero-Fabrication Rule: Return explicit INSUFFICIENT_LIVE_DATA. Never guess or mock.
    return {
      success: false,
      status: 'INSUFFICIENT_LIVE_DATA',
      totalLatencyMs: Date.now() - startTime,
      errorDetails: 'No official live market source is currently available. Zero-fabrication policy active.',
      sourceAttempts: allAttempts,
    };
  }

  /**
   * Diagnostic inspector for active live data sources
   */
  public getSourceDiagnostics(): {
    primary: { type: string; name: string; configured: boolean };
    fallback: { type: string; name: string; configured: boolean };
  } {
    return {
      primary: {
        type: this.primarySource.sourceType,
        name: this.primarySource.sourceName,
        configured: this.primarySource.isConfigured(),
      },
      fallback: {
        type: this.fallbackSource.sourceType,
        name: this.fallbackSource.sourceName,
        configured: this.fallbackSource.isConfigured(),
      },
    };
  }
}

/**
 * Singleton Live Market Source Adapter instance
 */
export const globalLiveSourceAdapter = new LiveSourceAdapter();
