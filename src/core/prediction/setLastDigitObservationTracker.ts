import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { SetLastDigitSignalV1, extractSetLastDigit } from './setLastDigitSignalV1';
import { MarketCalendar } from '../market/marketCalendar';

export type SetLastDigitObservationStatus = 'HIT' | 'MISS';

export interface SetLastDigitObservationRecord {
  id: string; // Format: ${date}_${session}
  date: string; // YYYY-MM-DD
  session: MarketSession; // 'AM' | 'PM'
  candidateDigits: string[]; // Predicted candidate digits (1 to 3 digits)
  officialSetLastDigit: string; // Official SET settlement last decimal digit
  status: SetLastDigitObservationStatus; // Strictly HIT or MISS
  evaluatedAt: string; // ISO timestamp
}

export interface SetLastDigitObservationMetric {
  hitCount: number;
  total: number;
  hitRatePercent: number;
  ratioText: string; // e.g. "AM HIT: 3/5"
}

export interface SetLastDigitObservationSummary {
  am: SetLastDigitObservationMetric;
  pm: SetLastDigitObservationMetric;
  overall: SetLastDigitObservationMetric;
  records: SetLastDigitObservationRecord[];
  sessionCount: number;
}

const STORAGE_KEY = 'MM2D_SET_LAST_DIGIT_OBSERVATION_V1';

/**
 * Step 63 / 65: SET_LAST_DIGIT_V1 Production Observation Tracker
 *
 * Rules:
 * 1. For each completed valid trading session:
 *    - Compare SET_LAST_DIGIT_V1 frozen candidate digit(s) with official SET settlement's last decimal digit.
 *    - If official digit is among candidates -> HIT.
 *    - Otherwise -> MISS.
 * 2. Record only: date, session (AM/PM), candidate digits, official SET last decimal digit, HIT/MISS.
 * 3. Never generate 10-number series.
 * 4. Never use live.twod (extracts exclusively from official SET index settlement).
 * 5. Keep AM and PM separate.
 * 6. Never evaluate an unfinished session (requires verified settlement).
 * 7. Saturday / Sunday / official SET holidays strictly excluded from observation count.
 * 8. Retention: keeps latest 5 trading days only (max 10 sessions); minimal temporary storage.
 * 9. Observation only: does not alter predictions, engines, or models.
 */
export class SetLastDigitObservationTracker {
  public static readonly MAX_TRADING_DAYS = 5;
  public static readonly MAX_SESSIONS = 10;

  private records: Map<string, SetLastDigitObservationRecord> = new Map();
  private isLoaded = false;
  private storageKey: string;
  private isPersistent: boolean;
  private listeners: Set<(summary: SetLastDigitObservationSummary) => void> = new Set();

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
          const parsed: SetLastDigitObservationRecord[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (
                item &&
                item.date &&
                item.session &&
                Array.isArray(item.candidateDigits) &&
                typeof item.officialSetLastDigit === 'string' &&
                (item.status === 'HIT' || item.status === 'MISS')
              ) {
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
      // Storage errors handled gracefully
    }
  }

  private notify(): void {
    const summary = this.getSummary();
    for (const listener of this.listeners) {
      try {
        listener(summary);
      } catch (err) {
        console.warn('Error in SetLastDigitObservationTracker listener:', err);
      }
    }
  }

  public subscribe(callback: (summary: SetLastDigitObservationSummary) => void): () => void {
    this.listeners.add(callback);
    callback(this.getSummary());
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Evaluates a completed session against official SET settlement.
   * If official SET last decimal digit is in candidateDigits -> HIT, else MISS.
   * Rejects unfinished sessions without official settlement.
   */
  public recordSession(
    date: string,
    session: MarketSession,
    candidateDigits: string[],
    officialSettlement: VerifiedMarketRecord | string | number
  ): SetLastDigitObservationRecord | null {
    this.loadFromStorage();

    const cleanDate = date.trim();
    if (!cleanDate) return null;

    // Reject weekend (Saturday, Sunday) or official holiday
    if (MarketCalendar.isWeekend(cleanDate) || !MarketCalendar.isTradingDay(cleanDate).isTradingDay) {
      return null;
    }

    let officialDigit: string | null = null;

    if (typeof officialSettlement === 'object' && officialSettlement !== null) {
      // Must be a completed, verified settlement record
      if (!officialSettlement.isSettlement) {
        return null; // Unfinished session: cannot evaluate
      }
      const rawVal = officialSettlement.setRaw || officialSettlement.setNumeric;
      if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        return null;
      }
      officialDigit = extractSetLastDigit(rawVal);
    } else if (typeof officialSettlement === 'string') {
      const cleanStr = officialSettlement.trim();
      if (!cleanStr) return null;
      officialDigit = extractSetLastDigit(cleanStr);
    } else if (typeof officialSettlement === 'number' && Number.isFinite(officialSettlement)) {
      officialDigit = extractSetLastDigit(officialSettlement);
    } else {
      return null;
    }

    if (officialDigit === null || !/^\d$/.test(officialDigit)) {
      return null;
    }

    // Clean candidates: keep only unique valid single digits (0-9)
    const cleanCandidates = Array.from(
      new Set(candidateDigits.map((d) => String(d).trim()).filter((d) => /^\d$/.test(d)))
    );

    if (cleanCandidates.length === 0) {
      return null;
    }

    const isHit = cleanCandidates.includes(officialDigit);
    const status: SetLastDigitObservationStatus = isHit ? 'HIT' : 'MISS';

    const key = this.getKey(cleanDate, session);
    const record: SetLastDigitObservationRecord = {
      id: key,
      date: cleanDate,
      session,
      candidateDigits: cleanCandidates,
      officialSetLastDigit: officialDigit,
      status,
      evaluatedAt: new Date().toISOString(),
    };

    this.records.set(key, record);
    this.enforceRetention();
    this.persistToStorage();
    this.notify();

    return record;
  }

  /**
   * Enforces retention policy: keeps latest distinct trading days up to MAX_TRADING_DAYS
   */
  public enforceRetention(): string[] {
    const dates = new Set<string>();
    for (const rec of this.records.values()) {
      dates.add(rec.date);
    }

    const sortedDates = Array.from(dates).sort((a, b) => b.localeCompare(a));
    if (sortedDates.length <= SetLastDigitObservationTracker.MAX_TRADING_DAYS) {
      return [];
    }

    const activeDates = new Set(sortedDates.slice(0, SetLastDigitObservationTracker.MAX_TRADING_DAYS));
    const prunedDates: string[] = [];

    for (const [key, rec] of this.records.entries()) {
      if (!activeDates.has(rec.date)) {
        this.records.delete(key);
        if (!prunedDates.includes(rec.date)) {
          prunedDates.push(rec.date);
        }
      }
    }

    return prunedDates;
  }

  /**
   * Returns all recorded observations sorted latest first.
   */
  public getRecords(): SetLastDigitObservationRecord[] {
    this.loadFromStorage();
    this.enforceRetention();
    return Array.from(this.records.values()).sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      return a.session.localeCompare(b.session);
    });
  }

  /**
   * Calculates overall, AM, and PM performance metrics without drawing conclusions.
   */
  public getSummary(): SetLastDigitObservationSummary {
    this.loadFromStorage();
    this.enforceRetention();

    let amHit = 0;
    let amTotal = 0;
    let pmHit = 0;
    let pmTotal = 0;

    const records = this.getRecords();

    for (const rec of records) {
      if (rec.session === 'AM') {
        amTotal++;
        if (rec.status === 'HIT') amHit++;
      } else {
        pmTotal++;
        if (rec.status === 'HIT') pmHit++;
      }
    }

    const overallTotal = amTotal + pmTotal;
    const overallHit = amHit + pmHit;

    return {
      am: {
        hitCount: amHit,
        total: amTotal,
        hitRatePercent: amTotal > 0 ? Math.round((amHit / amTotal) * 1000) / 10 : 0,
        ratioText: `AM HIT: ${amHit}/5`,
      },
      pm: {
        hitCount: pmHit,
        total: pmTotal,
        hitRatePercent: pmTotal > 0 ? Math.round((pmHit / pmTotal) * 1000) / 10 : 0,
        ratioText: `PM HIT: ${pmHit}/5`,
      },
      overall: {
        hitCount: overallHit,
        total: overallTotal,
        hitRatePercent: overallTotal > 0 ? Math.round((overallHit / overallTotal) * 1000) / 10 : 0,
        ratioText: `TOTAL HIT: ${overallHit}/10`,
      },
      records,
      sessionCount: overallTotal,
    };
  }

  /**
   * Automatically synchronizes production observations from verified official settlement records.
   * Finds the corresponding frozen SET_LAST_DIGIT_V1 candidate digits at lock boundary,
   * extracts the official SET last decimal digit, and records HIT/MISS.
   *
   * Invariants:
   * 1. Evaluates ONLY completed sessions with isSettlement === true and valid SET value.
   * 2. Excludes unfinished or non-trading sessions.
   * 3. AM and PM remain strictly separated.
   * 4. Zero live.twod used.
   * 5. No manual user action required.
   */
  public syncFromOfficialSettlements(
    officialRecords: VerifiedMarketRecord[]
  ): SetLastDigitObservationSummary {
    this.loadFromStorage();

    if (!officialRecords || officialRecords.length === 0) {
      return this.getSummary();
    }

    // Filter only valid, completed settlements that have SET values
    const settlementRecords = officialRecords.filter(
      (r) =>
        r &&
        r.isSettlement &&
        r.date &&
        (r.session === 'AM' || r.session === 'PM') &&
        (r.setRaw || r.setNumeric !== undefined)
    );

    // Sort chronologically ascending so newest settlements arrive last
    settlementRecords.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.session.localeCompare(b.session);
    });

    for (const settlement of settlementRecords) {
      const key = this.getKey(settlement.date, settlement.session);

      // If already evaluated and recorded in tracker, skip re-evaluating
      if (this.records.has(key)) {
        continue;
      }

      // Generate the corresponding frozen SET_LAST_DIGIT_V1 candidate digits at lock boundary
      const lockTimeStr = settlement.session === 'AM' ? '12:00:00' : '16:00:00';
      const lockClockTime = `${settlement.date}T${lockTimeStr}+07:00`;

      const prediction = SetLastDigitSignalV1.predict({
        targetDate: settlement.date,
        session: settlement.session,
        historicalRecords: officialRecords,
        currentTime: lockClockTime,
      });

      // Only record if candidate digits were generated on a valid trading day
      if (prediction.candidates && prediction.candidates.length > 0) {
        const candidateDigits = prediction.candidates.map((c) => c.digit);
        this.recordSession(settlement.date, settlement.session, candidateDigits, settlement);
      }
    }

    return this.getSummary();
  }

  /**
   * Synchronizes observation records from server-side frozen signals in D1 and verified settlements.
   * If a signal is frozen and an official settlement exists, records the session with HIT/MISS.
   */
  public syncFromFrozenSignals(
    signals: Array<{ date: string; session: MarketSession; candidates: string[] }>,
    officialRecords: VerifiedMarketRecord[]
  ): SetLastDigitObservationSummary {
    this.loadFromStorage();

    if (!signals || signals.length === 0 || !officialRecords || officialRecords.length === 0) {
      return this.getSummary();
    }

    for (const sig of signals) {
      const key = this.getKey(sig.date, sig.session);
      if (this.records.has(key)) continue;

      const settlement = officialRecords.find(
        (r) => Boolean(r.isSettlement) && r.date === sig.date && r.session === sig.session && (r.setRaw || r.setNumeric !== undefined)
      );

      if (settlement && sig.candidates && sig.candidates.length > 0) {
        this.recordSession(sig.date, sig.session, sig.candidates, settlement);
      }
    }

    return this.getSummary();
  }

  /**
   * Clears in-memory and persistent records (primarily for testing)
   */
  public clear(): void {
    this.records.clear();
    if (this.isPersistent && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.storageKey);
    }
    this.notify();
  }
}

export const globalSetLastDigitObservationTracker = new SetLastDigitObservationTracker();
