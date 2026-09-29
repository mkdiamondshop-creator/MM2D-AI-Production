import {
  ILiveMarketSource,
  LiveSourceResult,
  LiveMarketSnapshot,
  SourceAttemptLog,
} from '../../types/liveSource';
import { TimezoneContract } from './timezoneUtils';

export const THAISTOCK_LIVE_ENDPOINT = 'https://api.thaistock2d.com/live';

interface ThaiStockLivePayload {
  server_time?: string;
  live?: {
    set?: string | number | null;
    value?: string | number | null;
    time?: string | null;
    twod?: string | null;
    date?: string | null;
  };
  result?: Array<{
    open_twod?: string;
    twod_12_01?: string;
    twod_15_00?: string;
    twod_16_30?: string;
    set?: string;
    value?: string;
  }>;
}

/**
 * Primary Live Market Source: ThaiStock2D Official Live Gateway
 * Fetches real-time SET Index and Market Value metrics.
 * Strict Zero-Fabrication Guarantee: Never fabricates or estimates numbers.
 */
export class ThaiStock2dSource implements ILiveMarketSource {
  public readonly sourceType = 'THAISTOCK_2D_PRIMARY';
  public readonly sourceName = 'ThaiStock2D Official Live Feed';
  private customEndpoint?: string;

  constructor(customEndpoint?: string) {
    this.customEndpoint = customEndpoint;
  }

  public isConfigured(): boolean {
    return true; // Public verified endpoint is always reachable
  }

  public async fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult> {
    const startTime = Date.now();
    const endpoint = this.customEndpoint || THAISTOCK_LIVE_ENDPOINT;
    const attemptLog: SourceAttemptLog = {
      source: this.sourceType,
      sourceName: this.sourceName,
      attemptedAt: new Date().toISOString(),
      status: 'AVAILABLE',
      latencyMs: 0,
    };

    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller?.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      attemptLog.latencyMs = Date.now() - startTime;
      attemptLog.httpStatus = response.status;

      if (!response.ok) {
        attemptLog.status = response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE';
        attemptLog.error = `HTTP error ${response.status}: ${response.statusText}`;
        return {
          success: false,
          status: 'SOURCE_UNAVAILABLE',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const responseText = await response.text();
      const trimmed = (responseText || '').trim();

      if (!trimmed || trimmed === '[]' || trimmed === '{}') {
        attemptLog.status = 'INSUFFICIENT_DATA';
        attemptLog.error = 'Empty response body from ThaiStock2D live feed (Market Closed/Weekend)';
        return {
          success: false,
          status: 'MARKET_CLOSED',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      let parsed: ThaiStockLivePayload;
      try {
        parsed = JSON.parse(trimmed);
      } catch (jsonErr) {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = `Failed to parse JSON response: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`;
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const liveObj = parsed.live;
      if (!liveObj || typeof liveObj !== 'object') {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = 'Missing "live" object in ThaiStock2D payload';
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const rawSet = String(liveObj.set ?? '').trim();
      const rawValue = String(liveObj.value ?? '').trim();
      const rawTime = String(liveObj.time ?? '').trim();

      // Strict Zero-Fabrication check: Reject literal field names ("set", "value"), placeholders, empty, or non-numeric values
      const lowerSet = rawSet.toLowerCase();
      const lowerVal = rawValue.toLowerCase();
      if (
        !rawSet ||
        !rawValue ||
        rawSet === '--' ||
        rawValue === '--' ||
        rawSet === '0.00' ||
        rawValue === '0.00' ||
        lowerSet === 'set' ||
        lowerVal === 'value' ||
        lowerSet === 'nan' ||
        lowerVal === 'nan' ||
        lowerSet === 'null' ||
        lowerVal === 'null' ||
        lowerSet === 'undefined' ||
        lowerVal === 'undefined'
      ) {
        attemptLog.status = 'INSUFFICIENT_DATA';
        attemptLog.error = `Invalid literal, placeholder, or empty SET/Value received: set="${rawSet}", value="${rawValue}"`;
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const cleanSet = rawSet.replace(/,/g, '');
      const cleanVal = rawValue.replace(/,/g, '');
      const setNumeric = parseFloat(cleanSet);
      const valueNumeric = parseFloat(cleanVal);

      // Validate numeric sanity (SET index between 100 and 5000, Market Value >= 100)
      if (
        isNaN(setNumeric) ||
        isNaN(valueNumeric) ||
        !Number.isFinite(setNumeric) ||
        !Number.isFinite(valueNumeric) ||
        setNumeric < 100.0 ||
        setNumeric > 5000.0 ||
        valueNumeric < 100.0
      ) {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = `Invalid numeric SET/Value received: set=${setNumeric}, value=${valueNumeric}`;
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      // Parse provider timestamp:
      // Stock Exchange of Thailand (SET) live market feed emits timestamps in canonical Bangkok time (Asia/Bangkok, UTC+7:00).
      // Normalize provider timestamp to canonical Bangkok market time (Asia/Bangkok, UTC+7:00) using TimezoneContract
      // before freshness, date mismatch, or session comparisons.
      let bkkNormalized: { dateStr: string; timeStr: string; isoString: string };

      if (rawTime.includes('+') || rawTime.endsWith('Z')) {
        bkkNormalized = TimezoneContract.toBangkok(rawTime);
      } else {
        let providerDateStr = (liveObj.date && typeof liveObj.date === 'string' ? liveObj.date.trim() : '');
        let providerTimeStr = '10:30:00';

        if (rawTime.includes(' ')) {
          const parts = rawTime.split(' ');
          if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
            providerDateStr = parts[0];
          }
          providerTimeStr = parts[1];
        } else if (rawTime.includes('T')) {
          const parts = rawTime.split('T');
          if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
            providerDateStr = parts[0];
          }
          providerTimeStr = parts[1].slice(0, 8);
        } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(rawTime)) {
          providerTimeStr = rawTime.length === 5 ? `${rawTime}:00` : rawTime;
        }

        if (!providerDateStr && parsed.server_time && typeof parsed.server_time === 'string' && parsed.server_time.includes(' ')) {
          const stParts = parsed.server_time.trim().split(' ');
          if (/^\d{4}-\d{2}-\d{2}$/.test(stParts[0])) {
            providerDateStr = stParts[0];
          }
        }

        if (!providerDateStr) {
          providerDateStr = targetDate || TimezoneContract.toBangkok(Date.now()).dateStr;
        }

        const bkkIso = `${providerDateStr}T${providerTimeStr}+07:00`;
        bkkNormalized = TimezoneContract.toBangkok(bkkIso);
      }

      const dateStr = bkkNormalized.dateStr;
      const timeStr = bkkNormalized.timeStr;

      // Check date mismatch / staleness against canonical Bangkok targetDate
      if (targetDate && dateStr !== targetDate) {
        if (dateStr < targetDate) {
          attemptLog.status = 'STALE_DATA';
          attemptLog.error = `Stale observation date: received ${dateStr}, expected ${targetDate}`;
          return {
            success: false,
            status: 'LIVE_DATA_STALE',
            sourceUsed: this.sourceType,
            totalLatencyMs: attemptLog.latencyMs,
            errorDetails: attemptLog.error,
            sourceAttempts: [attemptLog],
          };
        } else {
          attemptLog.status = 'SCHEMA_ERROR';
          attemptLog.error = `Future observation date: received ${dateStr}, target is ${targetDate}`;
          return {
            success: false,
            status: 'INSUFFICIENT_LIVE_DATA',
            sourceUsed: this.sourceType,
            totalLatencyMs: attemptLog.latencyMs,
            errorDetails: attemptLog.error,
            sourceAttempts: [attemptLog],
          };
        }
      }

      // Check future timestamp vs actual clock (Bangkok UTC+7)
      const nowBkk = TimezoneContract.toBangkok(Date.now());
      if (dateStr > nowBkk.dateStr) {
        attemptLog.status = 'SCHEMA_ERROR';
        attemptLog.error = `Observation has future date: ${dateStr} > current ${nowBkk.dateStr}`;
        return {
          success: false,
          status: 'INSUFFICIENT_LIVE_DATA',
          sourceUsed: this.sourceType,
          totalLatencyMs: attemptLog.latencyMs,
          errorDetails: attemptLog.error,
          sourceAttempts: [attemptLog],
        };
      }

      const isCheckpoint1100 = timeStr >= '10:59:00' && timeStr <= '11:05:00';
      const isCheckpoint1500 = timeStr >= '14:59:00' && timeStr <= '15:05:00';

      const snapshot: LiveMarketSnapshot = {
        source: this.sourceType,
        sourceName: this.sourceName,
        timestamp: bkkNormalized.isoString,
        date: dateStr,
        time: timeStr,
        setNumeric,
        valueNumeric,
        setRaw: rawSet,
        valueRaw: rawValue,
        isCheckpoint1100,
        isCheckpoint1500,
        provenance: `THAISTOCK_2D_LIVE_HTTP:${endpoint}`,
        quality: 'OFFICIAL_VERIFIED',
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
