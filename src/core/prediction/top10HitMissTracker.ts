import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { D1V2PredictionRecord } from '../storage/d1StorageAdapter';

export type HitMissStatus = 'HIT' | 'MISS';

export interface HitMissRecord {
  id: string; // Format: ${date}_${session}
  date: string; // YYYY-MM-DD
  session: MarketSession; // 'AM' | 'PM'
  officialTwod: string; // Official 2D result from Stock Exchange of Thailand
  status: HitMissStatus; // Strictly HIT or MISS (no Top-1 vs Top-10 separation)
  evaluatedAt: string; // ISO timestamp
}

export interface SessionHitMissDetail {
  status: HitMissStatus;
  officialTwod: string;
}

export interface TradingDayHitMissDetail {
  date: string;
  am?: SessionHitMissDetail;
  pm?: SessionHitMissDetail;
}

export interface SessionPerformanceMetric {
  hitCount: number;
  total: number;
  ratioText: string; // e.g. "HIT 4/5" or "HIT 7/10"
}

export interface RollingPerformanceSummary {
  am: SessionPerformanceMetric;
  pm: SessionPerformanceMetric;
  overall: SessionPerformanceMetric;
  tradingDays: TradingDayHitMissDetail[];
}

const STORAGE_KEY = 'MM2D_TOP10_HIT_MISS_1WEEK_V1';

/**
 * Top-10 HIT/MISS Tracking System (1-Week Observation Period)
 *
 * Strict Rules & Invariants:
 * 1. For each AM/PM prediction session, compares official 2D result with FINAL AUTO_WEIGHTED_V2 Top 10.
 *    - Official 2D in Final Top 10 -> HIT.
 *    - Not included -> MISS.
 * 2. Zero separation of Top-1 vs Top-10.
 * 3. Zero calculation or storage of probability/rank performance.
 * 4. Zero live SET/Value stored in this feature.
 * 5. Zero duplicate prediction data stored.
 * 6. Retention: Strictly keeps only the latest 5 trading days (max 10 sessions).
 * 7. When a new trading day enters beyond the 5-day window, automatically deletes the oldest HIT/MISS record.
 * 8. Official 2D result is the only ground truth (zero synthetic/mock/fake fallback).
 */
export class Top10HitMissTracker {
  public static readonly MAX_TRADING_DAYS = 5;
  public static readonly MAX_SESSIONS = 10;

  private records: Map<string, HitMissRecord> = new Map();
  private isLoaded = false;
  private storageKey: string;
  private isPersistent: boolean;
  private listeners: Set<(summary: RollingPerformanceSummary) => void> = new Set();

  constructor(storageKey = STORAGE_KEY, isPersistent = true) {
    this.storageKey = storageKey;
    this.isPersistent = isPersistent;
    if (this.isPersistent) {
      this.loadFromStorage();
    }
  }

  private getKey(date: string, session: MarketSession): string {
    return `${date}_${session}`;
  }

  private loadFromStorage(): void {
    if (this.isLoaded) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed: HitMissRecord[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.date && item.session && item.officialTwod && item.status) {
                this.records.set(this.getKey(item.date, item.session), item);
              }
            }
          }
        }
      }
    } catch {
      // Gracefully continue with in-memory map
    } finally {
      this.isLoaded = true;
      this.enforceRetention();
    }
  }

  private persistToStorage(): void {
    if (!this.isPersistent) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const list = Array.from(this.records.values());
        window.localStorage.setItem(this.storageKey, JSON.stringify(list));
      }
    } catch {
      // Ignore storage quota or environment restrictions
    }
  }

  private notify(): void {
    const summary = this.getRollingSummary();
    for (const listener of this.listeners) {
      try {
        listener(summary);
      } catch (err) {
        console.warn('Error in Top10HitMissTracker listener:', err);
      }
    }
  }

  public subscribe(callback: (summary: RollingPerformanceSummary) => void): () => void {
    this.listeners.add(callback);
    callback(this.getRollingSummary());
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Evaluates a session against official 2D settlement and records HIT or MISS.
   * Immediately triggers automatic 5-day retention cleanup.
   */
  public recordSession(
    date: string,
    session: MarketSession,
    finalTop10: readonly string[] | string[],
    officialTwod: string
  ): { record: HitMissRecord; prunedDates: string[] } {
    this.loadFromStorage();

    const cleanDate = date.trim();
    const cleanTwod = officialTwod.trim();

    if (!cleanTwod || cleanTwod.length !== 2 || !/^\d{2}$/.test(cleanTwod)) {
      throw new Error(`Invalid official 2D result: "${officialTwod}". Expected 2 digits.`);
    }

    const top10Candidates = Array.isArray(finalTop10) ? finalTop10.slice(0, 10).map((c) => String(c).trim()) : [];
    const isHit = top10Candidates.includes(cleanTwod);
    const status: HitMissStatus = isHit ? 'HIT' : 'MISS';

    const key = this.getKey(cleanDate, session);
    const record: HitMissRecord = {
      id: key,
      date: cleanDate,
      session,
      officialTwod: cleanTwod,
      status,
      evaluatedAt: new Date().toISOString(),
    };

    this.records.set(key, record);

    // Automatic retention pruning: deletes records older than latest 5 trading days
    const prunedDates = this.enforceRetention();

    this.persistToStorage();
    this.notify();

    return { record, prunedDates };
  }

  /**
   * Enforces 5-trading-day retention:
   * - Retains only records from the latest 5 distinct trading dates.
   * - Automatically deletes all records belonging to older dates.
   * - Maximum 10 sessions retained.
   */
  public enforceRetention(): string[] {
    const distinctDates = this.getDistinctTradingDays();
    if (distinctDates.length <= Top10HitMissTracker.MAX_TRADING_DAYS) {
      return [];
    }

    const retainedDates = new Set(distinctDates.slice(0, Top10HitMissTracker.MAX_TRADING_DAYS));
    const prunedDates: string[] = [];

    for (const [key, record] of Array.from(this.records.entries())) {
      if (!retainedDates.has(record.date)) {
        this.records.delete(key);
        if (!prunedDates.includes(record.date)) {
          prunedDates.push(record.date);
        }
      }
    }

    return prunedDates;
  }

  /**
   * Retrieves all distinct trading dates in descending order (latest first).
   */
  public getDistinctTradingDays(): string[] {
    const dates = new Set<string>();
    for (const rec of this.records.values()) {
      dates.add(rec.date);
    }
    return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }

  /**
   * Retrieves all stored records.
   */
  public getRecords(): HitMissRecord[] {
    this.loadFromStorage();
    this.enforceRetention();
    return Array.from(this.records.values()).sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return a.session.localeCompare(b.session);
    });
  }

  /**
   * Generates the rolling performance summary:
   * - AM: HIT x/5
   * - PM: HIT x/5
   * - Overall: HIT x/10
   * - 5 trading-day AM/PM details
   */
  public getRollingSummary(): RollingPerformanceSummary {
    this.loadFromStorage();
    this.enforceRetention();

    const distinctDates = this.getDistinctTradingDays();
    const activeDates = distinctDates.slice(0, Top10HitMissTracker.MAX_TRADING_DAYS);

    let amHitCount = 0;
    let pmHitCount = 0;

    const tradingDays: TradingDayHitMissDetail[] = [];

    for (const date of activeDates) {
      const amRec = this.records.get(this.getKey(date, 'AM'));
      const pmRec = this.records.get(this.getKey(date, 'PM'));

      if (amRec && amRec.status === 'HIT') amHitCount++;
      if (pmRec && pmRec.status === 'HIT') pmHitCount++;

      tradingDays.push({
        date,
        am: amRec ? { status: amRec.status, officialTwod: amRec.officialTwod } : undefined,
        pm: pmRec ? { status: pmRec.status, officialTwod: pmRec.officialTwod } : undefined,
      });
    }

    const overallHitCount = amHitCount + pmHitCount;

    return {
      am: {
        hitCount: amHitCount,
        total: Top10HitMissTracker.MAX_TRADING_DAYS,
        ratioText: `HIT ${amHitCount}/${Top10HitMissTracker.MAX_TRADING_DAYS}`,
      },
      pm: {
        hitCount: pmHitCount,
        total: Top10HitMissTracker.MAX_TRADING_DAYS,
        ratioText: `HIT ${pmHitCount}/${Top10HitMissTracker.MAX_TRADING_DAYS}`,
      },
      overall: {
        hitCount: overallHitCount,
        total: Top10HitMissTracker.MAX_SESSIONS,
        ratioText: `HIT ${overallHitCount}/${Top10HitMissTracker.MAX_SESSIONS}`,
      },
      tradingDays,
    };
  }

  /**
   * Synchronizes HIT/MISS tracking by matching existing prediction records
   * and official verified settlement market records.
   * Does NOT duplicate predictions or store SET/Value.
   */
  public syncFromExistingData(
    predictions: Array<{ date: string; session: MarketSession; top10: readonly string[] | string[]; isFrozen?: boolean }>,
    officialRecords: VerifiedMarketRecord[]
  ): RollingPerformanceSummary {
    this.loadFromStorage();

    // Map verified settlement records by date and session
    const settlements = new Map<string, string>();
    for (const r of officialRecords) {
      if (r && r.isSettlement && r.twod && r.twod.length === 2) {
        settlements.set(`${r.date}_${r.session}`, r.twod);
      }
    }

    // Sort predictions chronologically (ascending) so newest dates arrive last and prune older ones correctly
    const sortedPredictions = [...predictions].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.session.localeCompare(b.session);
    });

    for (const pred of sortedPredictions) {
      const key = `${pred.date}_${pred.session}`;
      const twod = settlements.get(key);
      if (twod && pred.top10 && pred.top10.length > 0) {
        this.recordSession(pred.date, pred.session, pred.top10, twod);
      }
    }

    return this.getRollingSummary();
  }

  /**
   * Resets tracker (strictly for tests).
   */
  public clear(): void {
    this.records.clear();
    if (this.isPersistent) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(this.storageKey);
        }
      } catch {
        // Ignore
      }
    }
    this.notify();
  }
}

/**
 * Singleton instance for app-wide rolling 1-week Top-10 observation.
 */
export const globalTop10HitMissTracker = new Top10HitMissTracker();
