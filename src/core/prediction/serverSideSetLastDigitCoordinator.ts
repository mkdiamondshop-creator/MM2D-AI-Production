import { MarketSession } from '../../types/market';
import { D1StorageAdapter, D1SetLastDigitRecord } from '../storage/d1StorageAdapter';
import { TimezoneContract } from '../market/timezoneUtils';
import { MarketCalendar } from '../market/marketCalendar';
import { SetLastDigitSignalV1, extractSetLastDigit } from './setLastDigitSignalV1';

export interface CoordinatorSetLastDigitOptions {
  targetDate?: string;
  session?: MarketSession;
  simulatedClock?: Date | string;
  forceLock?: boolean;
  overrideMarketGate?: boolean;
}

export interface ServerSideSetLastDigitResult {
  success: boolean;
  date: string;
  session: MarketSession;
  status:
    | 'WAITING_FOR_MARKET_OPEN'
    | 'LIVE_ANALYSIS'
    | 'FINAL_LOCKED'
    | 'SETTLED'
    | 'MARKET_CLOSED';
  isLocked: boolean;
  lockTime: string;
  lockTimestamp: string;
  candidates: string[]; // 1–3 digits strictly AFTER lock; EMPTY array before lock
  candidateCount: number;
  primaryDigit: string;
  liveSetObserved: number | null;
  liveObservationCount: number;
  marketClosedReason?: string;
  settlement?: {
    officialSetLastDigit: string;
    status: 'HIT' | 'MISS';
  } | null;
  signalRecord?: D1SetLastDigitRecord | null;
}

/**
 * Server-Side SET Last Digit Signal V1 Coordinator
 *
 * Runs fully server-side inside Cloudflare Worker unattended pipeline:
 * 1. Collects/analyzes live SET observations during market hours.
 * 2. Before lock: Returns NO candidate digits ("LIVE_ANALYSIS" or "WAITING_FOR_MARKET_OPEN").
 * 3. At lock (AM 11:30 MMT / 12:00 BKK, PM 15:30 MMT / 16:00 BKK):
 *    - Calculates 1–3 candidate digits deterministically from Live SET + Historical SET.
 *    - Freezes the candidates and persists to D1 set_last_digit_signals.
 *    - Strictly immutable after freeze.
 * 4. Official settlement: Automatically evaluates HIT/MISS without altering frozen predictions.
 * 5. Input = SET only (Zero Value, Zero live.twod, Zero fabrication).
 */
export class ServerSideSetLastDigitCoordinator {
  public static async coordinateSession(
    d1: D1StorageAdapter,
    session: MarketSession,
    options?: CoordinatorSetLastDigitOptions
  ): Promise<ServerSideSetLastDigitResult> {
    const clockInput = options?.simulatedClock || new Date();
    const nowBkk = TimezoneContract.toBangkok(clockInput);
    const targetDate = options?.targetDate || nowBkk.dateStr;
    const currentTime = nowBkk.timeStr;

    const openTime = session === 'AM' ? '10:00:00' : '14:00:00';
    const lockTime = session === 'AM' ? '12:00:00' : '16:00:00';
    const lockTimestamp = `${targetDate}T${lockTime}+07:00`;

    // 0. Calendar / Trading Day Gate
    const tradingDayEval = MarketCalendar.isTradingDay(targetDate);
    if (!tradingDayEval.isTradingDay && !options?.overrideMarketGate) {
      return {
        success: true,
        date: targetDate,
        session,
        status: 'MARKET_CLOSED',
        isLocked: true,
        lockTime,
        lockTimestamp,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveObservationCount: 0,
        marketClosedReason: tradingDayEval.reason,
      };
    }

    const isToday = nowBkk.dateStr === targetDate;

    // 0b. Session Visibility Gate: During AM hours, PM signal lifecycle is not active
    if (isToday && session === 'PM' && currentTime < '12:01:00' && !options?.overrideMarketGate) {
      return {
        success: true,
        date: targetDate,
        session: 'PM',
        status: 'WAITING_FOR_MARKET_OPEN',
        isLocked: false,
        lockTime: '16:00:00',
        lockTimestamp,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveObservationCount: 0,
        marketClosedReason: 'PM session is waiting for afternoon market open (14:00 BKK)',
      };
    }

    // 1. Check if signal is already frozen in D1
    const existing = await d1.getSetLastDigitSignal(targetDate, session);

    // Check if official settlement has arrived in D1
    const settlements = await d1.queryVerifiedRecords({ date: targetDate, session, limit: 10 });
    const officialSettlement = settlements.find(
      (r) => Boolean(r.isSettlement) && (r.setRaw || r.setNumeric !== undefined)
    );

    if (existing && existing.isFrozen === 1) {
      let candidateList: string[] = [];
      try {
        candidateList = JSON.parse(existing.candidatesJson);
      } catch {
        candidateList = [];
      }

      // Check if official settlement arrived and needs HIT/MISS evaluation
      if (officialSettlement) {
        const rawSet = officialSettlement.setRaw || officialSettlement.setNumeric;
        const officialDigit = extractSetLastDigit(rawSet);

        if (officialDigit && /^\d$/.test(officialDigit)) {
          const isHit = candidateList.includes(officialDigit);
          const evalStatus = isHit ? 'HIT' : 'MISS';

          // Update record if not yet marked as settled in D1
          if (existing.settlementStatus !== evalStatus || existing.status !== 'SETTLED') {
            await d1.storeSetLastDigitSignal({
              date: targetDate,
              session,
              status: 'SETTLED',
              isFrozen: true,
              frozenAt: existing.frozenAt,
              candidates: candidateList,
              primaryDigit: existing.primaryDigit,
              observedSet: existing.observedSet,
              liveObservationsCount: existing.liveObservationsCount,
              settlementLastDigit: officialDigit,
              settlementStatus: evalStatus,
            });
          }

          return {
            success: true,
            date: targetDate,
            session,
            status: 'SETTLED',
            isLocked: true,
            lockTime,
            lockTimestamp: existing.frozenAt,
            candidates: candidateList,
            candidateCount: candidateList.length,
            primaryDigit: existing.primaryDigit,
            liveSetObserved: existing.observedSet,
            liveObservationCount: existing.liveObservationsCount,
            settlement: {
              officialSetLastDigit: officialDigit,
              status: evalStatus,
            },
            signalRecord: existing,
          };
        }
      }

      // Already frozen but settlement not yet verified
      return {
        success: true,
        date: targetDate,
        session,
        status: 'FINAL_LOCKED',
        isLocked: true,
        lockTime,
        lockTimestamp: existing.frozenAt,
        candidates: candidateList,
        candidateCount: candidateList.length,
        primaryDigit: existing.primaryDigit,
        liveSetObserved: existing.observedSet,
        liveObservationCount: existing.liveObservationsCount,
        settlement: null,
        signalRecord: existing,
      };
    }

    // 2. Signal not yet frozen: determine current lifecycle phase
    const isBeforeOpen = isToday && currentTime < openTime && !options?.overrideMarketGate;
    const isPastLock = (isToday && currentTime >= lockTime) || (targetDate < nowBkk.dateStr) || Boolean(options?.forceLock);

    // 2a. Before Market Open: Strictly NO candidates
    if (isBeforeOpen) {
      return {
        success: true,
        date: targetDate,
        session,
        status: 'WAITING_FOR_MARKET_OPEN',
        isLocked: false,
        lockTime,
        lockTimestamp,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveObservationCount: 0,
      };
    }

    // Query live observations from D1 for current session
    const rawObservations = await d1.queryLiveObservations({ date: targetDate, session });
    const eligibleTicks = rawObservations.filter((obs) => {
      if (typeof obs.set !== 'number' || !Number.isFinite(obs.set) || obs.set < 100) {
        return false;
      }
      if (obs.time > lockTime) return false;
      return true;
    });

    const liveCount = eligibleTicks.length;
    const latestTick = liveCount > 0 ? eligibleTicks[liveCount - 1] : null;
    const liveSet = latestTick ? latestTick.set : null;

    // 2b. Market Open → Lock (Live Analysis phase):
    // IMPORTANT CANDIDATE DISPLAY RULE:
    // Do NOT display prediction candidate numbers before the lock!
    // Return status: "LIVE_ANALYSIS", candidate digits: EMPTY []
    if (!isPastLock) {
      return {
        success: true,
        date: targetDate,
        session,
        status: 'LIVE_ANALYSIS',
        isLocked: false,
        lockTime,
        lockTimestamp,
        candidates: [], // STRICTLY EMPTY before lock
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: liveSet,
        liveObservationCount: liveCount,
      };
    }

    // 2c. At or after Lock (Freeze Boundary):
    // Calculate final 1–3 candidate digits deterministically and freeze them.
    const historicalRecords = await d1.queryVerifiedRecords({ limit: 1000 });
    const liveObsInput = eligibleTicks.map((t) => ({
      set: t.set,
      time: t.time,
      timestamp: t.timestamp,
      date: t.date,
      session: t.session,
    }));

    const prediction = SetLastDigitSignalV1.predict({
      targetDate,
      session,
      historicalRecords,
      liveObservations: liveObsInput,
      currentTime: lockTimestamp,
    });

    const candidates = prediction.candidates.map((c) => c.digit);
    const primaryDigit = candidates[0] || '';

    // If candidate digits generated, persist frozen signal into D1
    if (candidates.length > 0) {
      let settlementStatus: 'HIT' | 'MISS' | null = null;
      let officialDigit: string | null = null;

      if (officialSettlement) {
        const rawSet = officialSettlement.setRaw || officialSettlement.setNumeric;
        officialDigit = extractSetLastDigit(rawSet);
        if (officialDigit && /^\d$/.test(officialDigit)) {
          settlementStatus = candidates.includes(officialDigit) ? 'HIT' : 'MISS';
        }
      }

      const finalStatus = settlementStatus ? 'SETTLED' : 'FINAL_LOCKED';

      await d1.storeSetLastDigitSignal({
        date: targetDate,
        session,
        status: finalStatus,
        isFrozen: true,
        frozenAt: lockTimestamp,
        candidates,
        primaryDigit,
        observedSet: liveSet,
        liveObservationsCount: liveCount,
        settlementLastDigit: officialDigit,
        settlementStatus,
      });

      return {
        success: true,
        date: targetDate,
        session,
        status: finalStatus,
        isLocked: true,
        lockTime,
        lockTimestamp,
        candidates,
        candidateCount: candidates.length,
        primaryDigit,
        liveSetObserved: liveSet,
        liveObservationCount: liveCount,
        settlement: officialDigit && settlementStatus ? {
          officialSetLastDigit: officialDigit,
          status: settlementStatus,
        } : null,
      };
    }

    // Fallback if zero live ticks were available at lock
    return {
      success: true,
      date: targetDate,
      session,
      status: 'WAITING_FOR_MARKET_OPEN',
      isLocked: true,
      lockTime,
      lockTimestamp,
      candidates: [],
      candidateCount: 0,
      primaryDigit: '',
      liveSetObserved: null,
      liveObservationCount: 0,
    };
  }

  /**
   * Coordinates the currently active session based on clock time.
   */
  public static async coordinateActiveCycle(
    d1: D1StorageAdapter,
    options?: CoordinatorSetLastDigitOptions
  ): Promise<{
    date: string;
    amResult?: ServerSideSetLastDigitResult;
    pmResult?: ServerSideSetLastDigitResult;
  }> {
    const clockInput = options?.simulatedClock || new Date();
    const nowBkk = TimezoneContract.toBangkok(clockInput);
    const targetDate = options?.targetDate || nowBkk.dateStr;
    const currentTime = nowBkk.timeStr;

    if (options?.session) {
      const res = await this.coordinateSession(d1, options.session, options);
      return {
        date: targetDate,
        ...(options.session === 'AM' ? { amResult: res } : { pmResult: res }),
      };
    }

    // Determine session from current Bangkok time:
    // Morning (< 12:01:00): AM active
    // Afternoon (>= 12:01:00): PM active (and lock AM if needed)
    if (currentTime < '12:01:00') {
      const amResult = await this.coordinateSession(d1, 'AM', options);
      return { date: targetDate, amResult };
    } else {
      // Ensure AM is frozen at lock if not already frozen
      const amResult = await this.coordinateSession(d1, 'AM', {
        ...options,
        forceLock: true,
      });
      const pmResult = await this.coordinateSession(d1, 'PM', options);
      return { date: targetDate, amResult, pmResult };
    }
  }
}
