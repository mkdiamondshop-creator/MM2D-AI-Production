import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { LiveMarketSnapshot } from '../../types/liveSource';
import { SESSION_SCHEDULES } from './marketOpenGate';
import { TimezoneContract } from './timezoneUtils';

export interface LiveObservation {
  time: string; // "HH:mm:ss" in Bangkok time
  date: string; // "YYYY-MM-DD"
  set: number; // Verified numeric SET Index
  value: number; // Verified numeric Market Value
  timestamp: string; // ISO 8601 string
  session: MarketSession;
  source?: string;
}

export interface ObservationValidationResult {
  isValid: boolean;
  reason?: string;
  sanitizedObservation?: LiveObservation;
}

/**
 * In-Memory Session Accumulator for Authentic Pre-Lock Market Observations
 * 
 * Strict Invariants:
 * 1. Accumulates verified live SET, Value, and timestamp from market open to lock.
 * 2. Zero Live 2D: Never stores, accepts, or exposes live 2D.
 * 3. Rejects stale, future, or mathematically invalid observations.
 * 4. Strictly isolates AM and PM observation buffers.
 */
export class LiveObservationBuffer {
  // Keyed by date (YYYY-MM-DD), then session (AM | PM)
  private buffer: Map<string, { AM: LiveObservation[]; PM: LiveObservation[] }> = new Map();

  // Maximum allowed timestamp age for incoming live observations (15 minutes in ms)
  private readonly maxStalenessMs: number = 15 * 60 * 1000;

  // Maximum allowable forward clock skew (60 seconds in ms)
  private readonly maxForwardClockSkewMs: number = 60 * 1000;

  /**
   * Validates an incoming observation candidate against strict market invariants.
   * Ensures no live 2D is present, numbers are finite and positive, and time is within session.
   */
  public validateObservation(
    raw: {
      time: string;
      date: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
      session?: MarketSession;
      source?: string;
      [key: string]: unknown; // captures any arbitrary field like twod to safely discard
    },
    currentBangkokTime?: Date | string
  ): ObservationValidationResult {
    // 1. Date format check (YYYY-MM-DD)
    if (!raw.date || typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
      return { isValid: false, reason: 'Invalid or missing date string (expected YYYY-MM-DD)' };
    }

    // 2. Time format check (HH:mm:ss)
    let cleanTime = (raw.time || '').trim();
    if (cleanTime.includes('T')) cleanTime = cleanTime.split('T')[1].slice(0, 8);
    if (cleanTime.includes(' ')) cleanTime = cleanTime.split(' ')[1].slice(0, 8);

    if (!/^\d{2}:\d{2}:\d{2}$/.test(cleanTime)) {
      return { isValid: false, reason: `Invalid time format '${raw.time}' (expected HH:mm:ss)` };
    }

    // 3. Numeric SET check
    const rawSetStr = typeof raw.set === 'string' ? raw.set.trim() : String(raw.set ?? '').trim();
    const lowerSet = rawSetStr.toLowerCase();
    if (
      lowerSet === 'set' ||
      lowerSet === 'nan' ||
      lowerSet === 'null' ||
      lowerSet === 'undefined' ||
      rawSetStr === '--' ||
      rawSetStr === '0.00' ||
      rawSetStr === '0'
    ) {
      return { isValid: false, reason: `Invalid literal or placeholder SET '${raw.set}'` };
    }
    const numericSet = typeof raw.set === 'number' ? raw.set : parseFloat(rawSetStr.replace(/,/g, ''));
    if (!Number.isFinite(numericSet) || numericSet < 100 || numericSet > 5000) {
      return { isValid: false, reason: `Invalid SET index '${raw.set}' (must be finite number between 100 and 5000)` };
    }

    // 4. Numeric Value check
    const rawValStr = typeof raw.value === 'string' ? raw.value.trim() : String(raw.value ?? '').trim();
    const lowerVal = rawValStr.toLowerCase();
    if (
      lowerVal === 'value' ||
      lowerVal === 'nan' ||
      lowerVal === 'null' ||
      lowerVal === 'undefined' ||
      rawValStr === '--' ||
      rawValStr === '0.00' ||
      rawValStr === '0'
    ) {
      return { isValid: false, reason: `Invalid literal or placeholder Market Value '${raw.value}'` };
    }
    const numericValue = typeof raw.value === 'number' ? raw.value : parseFloat(rawValStr.replace(/,/g, ''));
    if (!Number.isFinite(numericValue) || numericValue < 100) {
      return { isValid: false, reason: `Invalid Market Value '${raw.value}' (must be positive finite number >= 100)` };
    }

    // 5. Determine Session
    const session: MarketSession = raw.session || (cleanTime < '13:00:00' ? 'AM' : 'PM');
    const schedule = SESSION_SCHEDULES[session];

    // 6. Observation Window Check: Must be between market open and lock cutoff
    if (cleanTime < schedule.openTimeString) {
      return {
        isValid: false,
        reason: `Observation time ${cleanTime} is before market open (${schedule.openTimeString} for ${session})`,
      };
    }

    if (cleanTime > schedule.lockTimeString) {
      return {
        isValid: false,
        reason: `Observation time ${cleanTime} is after lock cutoff (${schedule.lockTimeString} for ${session})`,
      };
    }

    // 7. Clock Skew and Staleness Check (if timestamp provided)
    const nowBkk = TimezoneContract.toBangkok(currentBangkokTime || new Date());
    const nowMs = nowBkk.epochMillis;
    const tsStr = raw.timestamp || `${raw.date}T${cleanTime}+07:00`;
    const obsDate = new Date(tsStr);
    const obsMs = obsDate.getTime();
    const isStored = raw.source?.startsWith('D1') || raw.source?.startsWith('STORED') || raw.source?.startsWith('HISTORICAL');

    if (!Number.isNaN(obsMs)) {
      // Future timestamp rejection (only for unauthenticated incoming live feed)
      if (!isStored && obsMs - nowMs > this.maxForwardClockSkewMs && raw.date >= nowBkk.dateStr) {
        return {
          isValid: false,
          reason: `Observation timestamp ${tsStr} is ahead of current clock by > ${this.maxForwardClockSkewMs / 1000}s`,
        };
      }

      // Staleness check (only if target date is current date and NOT from D1 or stored cache)
      if (!isStored && raw.date === nowBkk.dateStr && nowMs - obsMs > this.maxStalenessMs && cleanTime < nowBkk.timeStr) {
        // If current time is past lock, historical ticks inside the window remain valid for playback/replay
        if (nowBkk.timeStr <= schedule.lockTimeString) {
          const diffMinutes = Math.round((nowMs - obsMs) / 60000);
          if (diffMinutes > 15) {
            return {
              isValid: false,
              reason: `Observation is stale by ${diffMinutes} minutes (exceeds ${this.maxStalenessMs / 60000}m limit)`,
            };
          }
        }
      }
    }

    // 8. Sanitized Observation: STRICTLY OMIT ANY 2D VALUE
    const sanitized: LiveObservation = {
      date: raw.date,
      time: cleanTime,
      set: numericSet,
      value: numericValue,
      timestamp: tsStr,
      session,
      source: raw.source || 'AUTHENTIC_FEED',
    };

    return {
      isValid: true,
      sanitizedObservation: sanitized,
    };
  }

  /**
   * Adds a validated observation to the session buffer.
   * Deduplicates identical observations and maintains chronological ordering.
   */
  public addObservation(
    observation: {
      time: string;
      date: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
      session?: MarketSession;
      source?: string;
    },
    currentBangkokTime?: Date | string
  ): boolean {
    const validation = this.validateObservation(observation, currentBangkokTime);
    if (!validation.isValid || !validation.sanitizedObservation) {
      return false;
    }

    const obs = validation.sanitizedObservation;
    const sessionMap = this.getOrCreateDateBuffer(obs.date);
    const list = sessionMap[obs.session];

    // Deduplicate: If an observation with identical time, set, and value exists, ignore
    const duplicateIdx = list.findIndex(
      (existing) => existing.time === obs.time && existing.set === obs.set && existing.value === obs.value
    );
    if (duplicateIdx >= 0) {
      return false;
    }

    // If same time but different values (e.g. tick update within same second), replace
    const sameTimeIdx = list.findIndex((existing) => existing.time === obs.time);
    if (sameTimeIdx >= 0) {
      list[sameTimeIdx] = obs;
    } else {
      list.push(obs);
      // Keep strictly sorted chronologically by time
      list.sort((a, b) => a.time.localeCompare(b.time));
    }

    return true;
  }

  /**
   * Ingests a LiveMarketSnapshot from LiveSourceAdapter.
   */
  public ingestSnapshot(snapshot: LiveMarketSnapshot, currentBangkokTime?: Date | string): boolean {
    if (!snapshot || !snapshot.date || !snapshot.time) {
      return false;
    }

    const session: MarketSession = snapshot.time < '13:00:00' ? 'AM' : 'PM';

    return this.addObservation(
      {
        date: snapshot.date,
        time: snapshot.time,
        set: snapshot.setNumeric,
        value: snapshot.valueNumeric,
        timestamp: snapshot.timestamp,
        session,
        source: snapshot.source,
      },
      currentBangkokTime
    );
  }

  /**
   * Hydrates observations from server storage (e.g. D1 live_observations).
   * Invariants:
   * 1. Re-validates each observation.
   * 2. Zero 2D.
   * 3. Retains chronological sorting.
   */
  public hydrateObservations(
    observations: Array<{
      time: string;
      date: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
      session?: MarketSession;
      source?: string;
    }>,
    currentBangkokTime?: Date | string
  ): number {
    let count = 0;
    for (const obs of observations) {
      if (
        this.addObservation(
          {
            ...obs,
            source: obs.source || 'D1_SERVER_COLLECTOR',
          },
          currentBangkokTime
        )
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Ingests pre-lock checkpoint record (11:00 AM or 15:00 PM) from VerifiedMarketRecord.
   */
  public ingestVerifiedCheckpointRecord(record: VerifiedMarketRecord): boolean {
    if (!record || record.isSettlement) return false;
    if (record.time !== '11:00:00' && record.time !== '15:00:00') return false;

    return this.addObservation({
      date: record.date,
      time: record.time,
      set: record.setNumeric,
      value: record.valueNumeric,
      timestamp: record.verifiedAt,
      session: record.session,
      source: 'VERIFIED_RECORD_CHECKPOINT',
    });
  }

  /**
   * Returns all observations accumulated for a given session and date.
   */
  public getObservations(session: MarketSession, date: string): LiveObservation[] {
    const sessionMap = this.buffer.get(date);
    if (!sessionMap) return [];
    return [...sessionMap[session]];
  }

  /**
   * Returns observations formatted for engine consumption (time, set, value, timestamp).
   * Invariant: Never contains 2D.
   */
  public getEngineFeed(
    session: MarketSession,
    date: string
  ): Array<{ time: string; set: number; value: number; timestamp: string }> {
    return this.getObservations(session, date).map((obs) => ({
      time: obs.time,
      set: obs.set,
      value: obs.value,
      timestamp: obs.timestamp,
    }));
  }

  /**
   * Returns the count of authentic observations accumulated for a session.
   */
  public getObservationCount(session: MarketSession, date: string): number {
    return this.getObservations(session, date).length;
  }

  /**
   * Returns the latest accumulated observation for a session.
   */
  public getLatestObservation(session: MarketSession, date: string): LiveObservation | null {
    const list = this.getObservations(session, date);
    if (list.length === 0) return null;
    return list[list.length - 1];
  }

  /**
   * Clears accumulated observations for a specific session or date.
   */
  public clear(date?: string, session?: MarketSession): void {
    if (!date) {
      this.buffer.clear();
      return;
    }
    const sessionMap = this.buffer.get(date);
    if (!sessionMap) return;
    if (session) {
      sessionMap[session] = [];
    } else {
      this.buffer.delete(date);
    }
  }

  private getOrCreateDateBuffer(date: string): { AM: LiveObservation[]; PM: LiveObservation[] } {
    let sessionMap = this.buffer.get(date);
    if (!sessionMap) {
      sessionMap = { AM: [], PM: [] };
      this.buffer.set(date, sessionMap);
    }
    return sessionMap;
  }
}

export const globalLiveObservationBuffer = new LiveObservationBuffer();
