import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { ShadowSessionRecord, QualityGateEvaluationResult } from '../../types/autoWeightedV2';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { AutoWeightedV2QualityGate } from './autoWeightedV2QualityGate';
import { LiveObservationBuffer } from '../market/liveObservationBuffer';

const STORAGE_KEY = 'MM2D_SHADOW_AUTO_TRACKING_V2';

/**
 * MM2D LEADER — STEP 33 & STEP 47: AUTO-WEIGHTED V2 SHADOW TRACKER & IMMUTABLE LOCK LIFECYCLE
 *
 * Connects official ThaiStock2D result auto-sync to V2 shadow evaluation.
 * Automatically records and preserves out-of-sample evaluation:
 * - V2 vs Champion result
 * - Top-1/3/5/10
 * - rank/MRR
 * - engine weights
 * - per-engine performance
 *
 * Strict Principles:
 * - Production Champion remains ALL_TIME_FREQUENCY_V1.
 * - AUTO_WEIGHTED_V2 remains strictly in shadow mode.
 * - AM and PM remain 100% separate pipelines.
 * - Point-in-time anti-leakage: pre-lock inputs only, zero future dates.
 * - Lock Invariant: Frozen at cutoff (AM 11:30 MMT / 12:00 BKK, PM 15:30 MMT / 16:00 BKK).
 * - Official settlement evaluation reads ONLY the frozen snapshot — never regenerates prediction.
 */
export class AutoWeightedV2ShadowTracker {
  private evaluatedSessions: Map<string, ShadowSessionRecord> = new Map();
  private listeners: Set<(records: ShadowSessionRecord[]) => void> = new Set();
  private isLoaded = false;

  constructor() {
    this.loadFromStorage();
  }

  private getKey(date: string, session: MarketSession): string {
    return `${date}_${session}`;
  }

  private loadFromStorage(): void {
    if (this.isLoaded) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: ShadowSessionRecord[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const rec of parsed) {
              if (rec && rec.targetDate && rec.session) {
                this.evaluatedSessions.set(this.getKey(rec.targetDate, rec.session), rec);
              }
            }
          }
        }
      }
    } catch {
      // Gracefully fall back to in-memory map
    } finally {
      this.isLoaded = true;
    }
  }

  private persistToStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const records = Array.from(this.evaluatedSessions.values());
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      }
    } catch {
      // Ignore storage quota or environment restrictions
    }
  }

  private notifyListeners(): void {
    const all = this.getAllRecordedSessions();
    for (const listener of this.listeners) {
      try {
        listener(all);
      } catch (err) {
        console.warn('Error in shadow tracker listener:', err);
      }
    }
  }

  public subscribe(callback: (records: ShadowSessionRecord[]) => void): () => void {
    this.listeners.add(callback);
    callback(this.getAllRecordedSessions());
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Hydrates server-side predictions into memory and local storage.
   * If an existing evaluation is already frozen at lock, only updates if incoming is frozen or has settlement.
   */
  public hydrateRecords(records: ShadowSessionRecord[]): void {
    this.loadFromStorage();
    let changed = false;
    for (const rec of records) {
      if (!rec || !rec.targetDate || !rec.session) continue;
      const key = this.getKey(rec.targetDate, rec.session);
      const existing = this.evaluatedSessions.get(key);

      if (existing && existing.isFrozenAtLock && !rec.isFrozenAtLock) {
        continue;
      }
      this.evaluatedSessions.set(key, rec);
      changed = true;
    }
    if (changed) {
      this.persistToStorage();
      this.notifyListeners();
    }
  }

  public hydrateRecord(rec: ShadowSessionRecord): void {
    this.hydrateRecords([rec]);
  }

  /**
   * Freezes and persists the pre-lock ensemble snapshot at cutoff (AM 11:30 MMT / 12:00 BKK, PM 15:30 MMT / 16:00 BKK).
   * Once locked, new live ticks do NOT change the frozen prediction.
   */
  public freezeLockSnapshot(
    targetDate: string,
    session: MarketSession,
    allRecords: VerifiedMarketRecord[],
    liveInput?: LiveObservationBuffer | Array<{ time: string; set: number | string; value: number | string }>,
    currentBangkokTime?: Date | string | number
  ): ShadowSessionRecord {
    this.loadFromStorage();
    const key = this.getKey(targetDate, session);
    const existing = this.evaluatedSessions.get(key);
    if (existing && existing.isFrozenAtLock) {
      return existing;
    }

    const frozen = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
      allRecords,
      targetDate,
      session,
      liveInput,
      currentBangkokTime
    );

    this.evaluatedSessions.set(key, frozen);
    this.persistToStorage();
    this.notifyListeners();
    return frozen;
  }

  /**
   * Evaluates and records a specific session if verified official settlement exists.
   *
   * Crucial Invariant: Reads ONLY the frozen snapshot. NEVER regenerates or recalculates the prediction.
   */
  public evaluateAndRecord(
    targetDate: string,
    session: MarketSession,
    allRecords: VerifiedMarketRecord[],
    liveInput?: LiveObservationBuffer | Array<{ time: string; set: number | string; value: number | string }>
  ): ShadowSessionRecord | null {
    this.loadFromStorage();

    // 1. Check if official settlement exists for target date and session
    const dayRecords = allRecords.filter((r) => r.date === targetDate);
    const settleRec = dayRecords.find((r) => r.session === session && r.isSettlement && r.twod);

    if (!settleRec || !settleRec.twod || settleRec.twod.length !== 2) {
      return null;
    }

    const key = this.getKey(targetDate, session);
    const existing = this.evaluatedSessions.get(key);

    // If already evaluated with settlementComparison, return existing directly
    if (existing && existing.settlementComparison) {
      return existing;
    }

    // 2. Retrieve or freeze the exact pre-lock snapshot.
    // Settlement evaluation reads ONLY this frozen snapshot and NEVER recalculates prediction.
    let frozenSnapshot: ShadowSessionRecord;
    if (existing && existing.isFrozenAtLock) {
      frozenSnapshot = existing;
    } else {
      const validatorFrozen = AutoWeightedV2ShadowValidator.getFrozenSnapshot(targetDate, session);
      if (validatorFrozen) {
        frozenSnapshot = validatorFrozen;
      } else {
        // Cold start / initial sync: freeze strictly at final cutoff using pre-lock data
        frozenSnapshot = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
          allRecords,
          targetDate,
          session,
          liveInput,
          session === 'AM' ? `${targetDate}T12:00:00+07:00` : `${targetDate}T16:00:00+07:00`
        );
      }
    }

    // 3. Evaluate settlement against official outcome reading ONLY the frozen snapshot
    const evaluatedRecord = AutoWeightedV2ShadowValidator.evaluateSettlement(
      frozenSnapshot,
      allRecords
    );

    // 4. Store and persist evaluation
    this.evaluatedSessions.set(key, evaluatedRecord);
    this.persistToStorage();
    this.notifyListeners();

    return evaluatedRecord;
  }

  /**
   * Traverses all verified market records, evaluates any settled AM and PM sessions,
   * and automatically records the evaluations in chronological sequence.
   */
  public syncAndRecordAllSettlements(allRecords: VerifiedMarketRecord[]): ShadowSessionRecord[] {
    this.loadFromStorage();
    if (!allRecords || allRecords.length === 0) return [];

    const distinctDates = Array.from(new Set(allRecords.map((r) => r.date))).sort();
    const evaluatedList: ShadowSessionRecord[] = [];

    for (const date of distinctDates) {
      const dayRecords = allRecords.filter((r) => r.date === date);

      // Evaluate AM if settlement exists
      const amSettle = dayRecords.find((r) => r.session === 'AM' && r.isSettlement && r.twod);
      if (amSettle) {
        const amEval = this.evaluateAndRecord(date, 'AM', allRecords);
        if (amEval) evaluatedList.push(amEval);
      }

      // Evaluate PM if settlement exists
      const pmSettle = dayRecords.find((r) => r.session === 'PM' && r.isSettlement && r.twod);
      if (pmSettle) {
        const pmEval = this.evaluateAndRecord(date, 'PM', allRecords);
        if (pmEval) evaluatedList.push(pmEval);
      }
    }

    return evaluatedList;
  }

  /**
   * Retrieves a recorded session evaluation.
   */
  public getEvaluation(date: string, session: MarketSession): ShadowSessionRecord | null {
    this.loadFromStorage();
    return this.evaluatedSessions.get(this.getKey(date, session)) || null;
  }

  /**
   * Retrieves all recorded evaluations in descending chronological order.
   */
  public getAllRecordedSessions(): ShadowSessionRecord[] {
    this.loadFromStorage();
    return Array.from(this.evaluatedSessions.values()).sort((a, b) => {
      const cmp = b.targetDate.localeCompare(a.targetDate);
      if (cmp !== 0) return cmp;
      return b.session === 'PM' ? 1 : -1;
    });
  }

  /**
   * Retrieves the latest recorded session evaluation (optionally filtered by AM/PM).
   */
  public getLatestRecordedSession(session?: MarketSession): ShadowSessionRecord | null {
    const all = this.getAllRecordedSessions();
    if (!session) return all[0] || null;
    return all.find((r) => r.session === session) || null;
  }

  /**
   * Evaluates all verified recorded sessions against the real-day OOS Quality Gate.
   */
  public getQualityGateResult(): QualityGateEvaluationResult {
    const all = this.getAllRecordedSessions();
    return AutoWeightedV2QualityGate.evaluate(all);
  }

  /**
   * Clears internal state (primarily for test harness isolation).
   */
  public reset(): void {
    this.evaluatedSessions.clear();
    AutoWeightedV2ShadowValidator.clearFrozenSnapshotsForTesting();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
    this.isLoaded = false;
  }
}

export const globalShadowTracker = new AutoWeightedV2ShadowTracker();
