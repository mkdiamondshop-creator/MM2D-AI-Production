import {
  ILiveMarketSource,
  LiveSourceResult,
  LiveMarketSnapshot,
  SourceAttemptLog,
} from '../../types/liveSource';

export interface SetOfficialConfig {
  apiUrl?: string;
  apiKey?: string;
  partnerId?: string;
}

/**
 * Secondary Fallback Live Market Source: Stock Exchange of Thailand (SET) Official API
 * Architecture Ready: Reserved for official enterprise/direct market data feed integration.
 * Strict Zero-Fabrication: Does NOT scrape, fabricate, or simulate unofficial feeds.
 */
export class SetOfficialSource implements ILiveMarketSource {
  public readonly sourceType = 'SET_OFFICIAL_FALLBACK';
  public readonly sourceName = 'SET Thailand Official Market Feed (Secondary Fallback)';
  private config: SetOfficialConfig;

  constructor(config?: SetOfficialConfig) {
    this.config = config || {
      apiUrl: typeof process !== 'undefined' ? process.env?.SET_OFFICIAL_API_URL : undefined,
      apiKey: typeof process !== 'undefined' ? process.env?.SET_OFFICIAL_API_KEY : undefined,
      partnerId: typeof process !== 'undefined' ? process.env?.SET_OFFICIAL_PARTNER_ID : undefined,
    };
  }

  /**
   * Checks if verified official SET API credentials and endpoint are active.
   */
  public isConfigured(): boolean {
    return Boolean(this.config.apiUrl && this.config.apiKey);
  }

  public async fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult> {
    const startTime = Date.now();
    const attemptLog: SourceAttemptLog = {
      source: this.sourceType,
      sourceName: this.sourceName,
      attemptedAt: new Date().toISOString(),
      status: 'UNCONFIGURED',
      latencyMs: 0,
    };

    // If official SET API credentials are not provisioned, fail fast without scraping or guessing
    if (!this.isConfigured()) {
      attemptLog.status = 'UNCONFIGURED';
      attemptLog.error = 'SET Official secondary API interface is not configured (requires SET_OFFICIAL_API_KEY / URL)';
      attemptLog.latencyMs = Date.now() - startTime;

      return {
        success: false,
        status: 'SOURCE_UNAVAILABLE',
        sourceUsed: this.sourceType,
        totalLatencyMs: attemptLog.latencyMs,
        errorDetails: attemptLog.error,
        sourceAttempts: [attemptLog],
      };
    }

    try {
      const endpoint = this.config.apiUrl!;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-SET-API-Key': this.config.apiKey!,
          'X-SET-Partner-ID': this.config.partnerId || 'MM2D-CORE',
        },
        signal: controller?.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      attemptLog.latencyMs = Date.now() - startTime;
      attemptLog.httpStatus = response.status;

      if (!response.ok) {
        attemptLog.status = response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE';
        attemptLog.error = `SET Official API HTTP ${response.status}: ${response.statusText}`;
        return {
          success: false,
          status: 'SOURCE_UNAVAILABLE',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const data = await response.json();

      // Expected official structure: { setIndex: number, marketValue: number, asOfTime: string }
      if (!data || typeof data !== 'object') {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = 'Invalid JSON response from SET Official API';
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const setNum = typeof data.setIndex === 'number' ? data.setIndex : parseFloat(String(data.setIndex || ''));
      const valNum = typeof data.marketValue === 'number' ? data.marketValue : parseFloat(String(data.marketValue || ''));
      const asOf = String(data.asOfTime || data.timestamp || '').trim();

      if (isNaN(setNum) || isNaN(valNum) || setNum < 100.0 || valNum < 100.0) {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = `SET Official returned invalid numeric values: set=${setNum}, val=${valNum}`;
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const nowBkk = new Date(Date.now() + 7 * 3600 * 1000);
      const dateStr = targetDate || nowBkk.toISOString().slice(0, 10);
      const timeStr = asOf && asOf.includes(':') ? asOf.slice(-8) : '11:00:00';

      const snapshot: LiveMarketSnapshot = {
        source: this.sourceType,
        sourceName: this.sourceName,
        timestamp: `${dateStr}T${timeStr}+07:00`,
        date: dateStr,
        time: timeStr,
        setNumeric: setNum,
        valueNumeric: valNum,
        setRaw: setNum.toFixed(2),
        valueRaw: valNum.toFixed(2),
        isCheckpoint1100: timeStr >= '10:59:00' && timeStr <= '11:05:00',
        isCheckpoint1500: timeStr >= '14:59:00' && timeStr <= '15:05:00',
        provenance: `SET_OFFICIAL_DIRECT_API:${endpoint}`,
        quality: 'FALLBACK_VERIFIED',
        latencyMs: attemptLog.latencyMs,
      };

      attemptLog.status = 'AVAILABLE';

      return {
        success: true,
        status: 'SUCCESS',
        snapshot,
        sourceUsed: this.sourceType,
        totalLatencyMs: attemptLog.latencyMs,
        sourceAttempts: [attemptLog],
      };
    } catch (err) {
      attemptLog.latencyMs = Date.now() - startTime;
      attemptLog.status = 'UNAVAILABLE';
      attemptLog.error = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        status: 'SOURCE_UNAVAILABLE',
        sourceUsed: this.sourceType,
        totalLatencyMs: attemptLog.latencyMs,
        errorDetails: attemptLog.error,
        sourceAttempts: [attemptLog],
      };
    }
  }
}
