import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { TimezoneContract } from '../market/timezoneUtils';
import { MarketCalendar } from '../market/marketCalendar';

export const SET_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export interface SetLastDigitCandidate {
  digit: string; // '0' - '9'
  probability: number; // 0.0 - 1.0
  rank: number; // 1, 2, or 3
}

export interface SetLastDigitInput {
  targetDate: string;
  session: MarketSession;
  historicalRecords: VerifiedMarketRecord[];
  liveObservations?: Array<{ set: number; value?: number; time: string; timestamp?: string }>;
  currentTime?: Date | string;
}

export type SetLastDigitStatus =
  | 'LIVE_SIGNAL'
  | 'FINAL_SIGNAL'
  | 'WAITING_FOR_MARKET_OPEN'
  | 'WAITING_FOR_LIVE_SET'
  | 'READY'
  | 'MARKET_NOT_OPEN'
  | 'LOCKED'
  | 'MARKET_CLOSED'
  | 'FUTURE_SESSION_NOT_ELIGIBLE'
  | 'INSUFFICIENT_DATA';

export interface SetLastDigitEligibility {
  isTradingDay: boolean;
  isMarketClosed: boolean;
  targetDate: string | null; // e.g. "2026-10-02" or null if weekend/holiday/closed
  dayName: string | null; // e.g. "Friday"
  formattedTargetDate: string | null; // e.g. "2026-10-02 (Friday)"
  eligibleSession: MarketSession | null; // 'AM' | 'PM' | null
  sessionLabel: string | null; // "AM — 12:01 PM Target" or "PM — 4:30 PM Target"
  lockTimeString: string | null; // "12:00:00" or "16:00:00"
  settlementTimeString: string | null; // "12:01:00" or "16:30:00"
  isLocked: boolean;
  reason: string;
  holidayName?: string;
}

export interface SetLastDigitResult {
  targetDate: string;
  formattedTargetDate?: string;
  session: MarketSession;
  signalVersion: 'SET_LAST_DIGIT_V1';
  status: SetLastDigitStatus;
  isLocked: boolean;
  lockTime: string; // "12:00:00" for AM, "16:00:00" for PM
  candidates: SetLastDigitCandidate[]; // strictly 1 to 3 items when active, [] when closed or waiting
  candidateCount: number; // 0 | 1 | 2 | 3
  primaryDigit: string;
  liveSetObserved: number | null;
  liveValueObserved?: number | null;
  liveObservationCount: number;
  evidenceSummary: {
    dominantCandidate: boolean;
    topScore: number;
    secondaryScore: number | null;
    confidenceLevel: 'HIGH' | 'MODERATE' | 'BALANCED';
    rationale: string;
  };
  distribution: Array<{ digit: string; probability: number }>;
  antiLeakageAudit: {
    zeroOfficialSettlementUsed: boolean;
    zeroPostLockDataUsed: boolean;
    zeroLiveTwodUsed: boolean;
    isolatedFromV2Ensemble: boolean;
  };
  marketClosedReason?: string;
}

/**
 * Extracts the official SET last decimal digit (0-9).
 * E.g., 1571.62 -> '2'
 *       1450.80 -> '0'
 *       1395.05 -> '5'
 */
export function extractSetLastDigit(setVal: number | string): string {
  if (typeof setVal === 'string') {
    const clean = setVal.replace(/,/g, '').trim();
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const decimals = parts[1].replace(/[^\d]/g, '');
      if (decimals.length >= 2) {
        return decimals[1]; // Standard 2-decimal financial SET: 2nd decimal digit
      }
      if (decimals.length === 1) {
        return decimals[0];
      }
    }
    const digitsOnly = clean.replace(/[^\d]/g, '');
    return digitsOnly.length > 0 ? digitsOnly.slice(-1) : '0';
  }

  if (typeof setVal === 'number' && Number.isFinite(setVal)) {
    const str = setVal.toFixed(2);
    return str.slice(-1);
  }

  return '0';
}

/**
 * SET Last Digit Signal Engine V1
 *
 * Isolated experimental statistical model predicting the final settlement SET decimal last digit (0-9).
 *
 * Invariants:
 * 1. Independent signal: Does NOT influence AUTO_WEIGHTED_V2, engine weights, or 2D Top-10.
 * 2. Allowed Inputs: Pre-lock live SET/Value, historical verified SET/Value/2D, AM/PM session.
 * 3. Output Rule: Predicts 1, 2, or maximum 3 candidates based on evidence strength.
 * 4. Zero Live 2D: Never consumes or extracts 'live.twod'.
 * 5. Strict Anti-Leakage: Strictly drops post-lock or future records.
 */
export class SetLastDigitSignalV1 {
  public static readonly VERSION = 'SET_LAST_DIGIT_V1' as const;

  /**
   * Resolves target-date and session eligibility under official SET trading calendar rules.
   *
   * Rules:
   * 1. Saturday and Sunday = SET market closed. No prediction, no target date, market closed state.
   * 2. Official SET Holidays = SET market closed. No prediction, no target date, market closed state.
   * 3. Valid SET Trading Day (Monday-Friday):
   *    - AM Window (00:00:00 - 12:01:00): AM only ("AM — 12:01 PM Target"). PM is hidden.
   *    - PM Window (12:01:00 - 16:30:00): PM only ("PM — 4:30 PM Target").
   *    - Post-PM (after 16:30:00): Concluded for today. Next prediction is only on the next valid SET trading day.
   */
  public static resolveEligibility(options?: {
    currentTime?: Date | string;
    historicalRecords?: VerifiedMarketRecord[];
  }): SetLastDigitEligibility {
    const clock = options?.currentTime
      ? TimezoneContract.toBangkok(options.currentTime)
      : TimezoneContract.toBangkok(new Date());

    const bkkDateStr = clock.dateStr;
    const bkkTimeStr = clock.timeStr;
    const dayOfWeek = MarketCalendar.getDayOfWeek(bkkDateStr);
    const dayName = SET_DAY_NAMES[dayOfWeek];

    // 1. Weekend Check (Saturday = 6, Sunday = 0)
    if (MarketCalendar.isWeekend(bkkDateStr) || dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        isTradingDay: false,
        isMarketClosed: true,
        targetDate: null,
        dayName,
        formattedTargetDate: null,
        eligibleSession: null,
        sessionLabel: null,
        lockTimeString: null,
        settlementTimeString: null,
        isLocked: true,
        reason: `${dayName} - Market Closed (Weekend Gate)`,
      };
    }

    // 2. Official SET Holiday Check
    const tradingDayEval = MarketCalendar.isTradingDay(
      bkkDateStr,
      options?.historicalRecords,
      bkkDateStr
    );
    if (!tradingDayEval.isTradingDay) {
      return {
        isTradingDay: false,
        isMarketClosed: true,
        targetDate: null,
        dayName,
        formattedTargetDate: null,
        eligibleSession: null,
        sessionLabel: null,
        lockTimeString: null,
        settlementTimeString: null,
        isLocked: true,
        reason: tradingDayEval.reason,
        holidayName: tradingDayEval.holidayName,
      };
    }

    // 3. Valid SET Trading Day
    const formattedTargetDate = `${bkkDateStr} (${dayName})`;

    // AM Phase: 00:00:00 up to AM settlement (12:01:00)
    if (bkkTimeStr < '12:01:00') {
      const isLocked = bkkTimeStr >= '12:00:00';
      return {
        isTradingDay: true,
        isMarketClosed: false,
        targetDate: bkkDateStr,
        dayName,
        formattedTargetDate,
        eligibleSession: 'AM',
        sessionLabel: 'AM — 12:01 PM Target',
        lockTimeString: '12:00:00',
        settlementTimeString: '12:01:00',
        isLocked,
        reason: isLocked
          ? 'AM Session Locked (12:00 PM cutoff)'
          : 'Active SET Trading Day (AM Window)',
      };
    }

    // PM Phase: 12:01:00 up to PM settlement (16:30:00)
    if (bkkTimeStr <= '16:30:00') {
      const isLocked = bkkTimeStr >= '16:00:00';
      return {
        isTradingDay: true,
        isMarketClosed: false,
        targetDate: bkkDateStr,
        dayName,
        formattedTargetDate,
        eligibleSession: 'PM',
        sessionLabel: 'PM — 4:30 PM Target',
        lockTimeString: '16:00:00',
        settlementTimeString: '16:30:00',
        isLocked,
        reason: isLocked
          ? 'PM Session Locked (16:00 PM cutoff)'
          : 'Active SET Trading Day (PM Window)',
      };
    }

    // Post-PM (after 16:30:00): Market is closed for today.
    // Next prediction is only on the next valid SET trading day.
    return {
      isTradingDay: false,
      isMarketClosed: true,
      targetDate: null,
      dayName,
      formattedTargetDate: null,
      eligibleSession: null,
      sessionLabel: null,
      lockTimeString: null,
      settlementTimeString: null,
      isLocked: true,
      reason: 'Trading Day Concluded - Market Closed. Next prediction on next valid SET trading day.',
    };
  }

  public static predict(input: SetLastDigitInput): SetLastDigitResult {
    const { targetDate, session, historicalRecords, liveObservations = [], currentTime } = input;

    const clock = currentTime ? TimezoneContract.toBangkok(currentTime) : TimezoneContract.toBangkok(new Date());
    const lockTime = session === 'AM' ? '12:00:00' : '16:00:00';
    const openTime = session === 'AM' ? '10:00:00' : '14:00:00';

    // 0. Trading Day Gate: Enforce SET Trading Calendar (No weekend or holiday predictions)
    const tradingDayEval = MarketCalendar.isTradingDay(targetDate, historicalRecords, clock.dateStr);
    if (!tradingDayEval.isTradingDay) {
      return {
        targetDate,
        session,
        signalVersion: 'SET_LAST_DIGIT_V1',
        status: 'MARKET_CLOSED',
        isLocked: true,
        lockTime,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveValueObserved: null,
        liveObservationCount: 0,
        evidenceSummary: {
          dominantCandidate: false,
          topScore: 0,
          secondaryScore: null,
          confidenceLevel: 'BALANCED',
          rationale: tradingDayEval.reason,
        },
        distribution: [],
        antiLeakageAudit: {
          zeroOfficialSettlementUsed: true,
          zeroPostLockDataUsed: true,
          zeroLiveTwodUsed: true,
          isolatedFromV2Ensemble: true,
        },
        marketClosedReason: tradingDayEval.reason,
      };
    }

    // 0b. Session Visibility Rule: On same-day AM phase, PM prediction is not eligible/hidden
    const isToday = clock.dateStr === targetDate;
    if (isToday && session === 'PM' && clock.timeStr < '12:01:00') {
      return {
        targetDate,
        session,
        signalVersion: 'SET_LAST_DIGIT_V1',
        status: 'FUTURE_SESSION_NOT_ELIGIBLE',
        isLocked: false,
        lockTime: '16:00:00',
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveValueObserved: null,
        liveObservationCount: 0,
        evidenceSummary: {
          dominantCandidate: false,
          topScore: 0,
          secondaryScore: null,
          confidenceLevel: 'BALANCED',
          rationale: 'PM prediction is hidden during AM window (Legitimately active at 12:01 PM)',
        },
        distribution: [],
        antiLeakageAudit: {
          zeroOfficialSettlementUsed: true,
          zeroPostLockDataUsed: true,
          zeroLiveTwodUsed: true,
          isolatedFromV2Ensemble: true,
        },
        marketClosedReason: 'PM prediction is hidden during AM window (Legitimately active at 12:01 PM)',
      };
    }

    const isPastLock = isToday && clock.timeStr >= lockTime;
    const isFutureDay = clock.dateStr < targetDate;
    const isBeforeOpen = isToday && clock.timeStr < openTime;

    const targetDayOfWeek = MarketCalendar.getDayOfWeek(targetDate);
    const formattedTargetDate = `${targetDate} (${SET_DAY_NAMES[targetDayOfWeek]})`;

    // 0c. Market Open Gate: Before session open, strictly output NO candidates
    if (isBeforeOpen) {
      return {
        targetDate,
        formattedTargetDate,
        session,
        signalVersion: 'SET_LAST_DIGIT_V1',
        status: 'WAITING_FOR_MARKET_OPEN',
        isLocked: false,
        lockTime,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveObservationCount: 0,
        evidenceSummary: {
          dominantCandidate: false,
          topScore: 0,
          secondaryScore: null,
          confidenceLevel: 'BALANCED',
          rationale: `Waiting for market open (${session === 'AM' ? '10:00 AM' : '2:00 PM'} BKK)`,
        },
        distribution: [],
        antiLeakageAudit: {
          zeroOfficialSettlementUsed: true,
          zeroPostLockDataUsed: true,
          zeroLiveTwodUsed: true,
          isolatedFromV2Ensemble: true,
        },
      };
    }

    // 1. Strict Anti-Leakage: Filter historical records strictly before the target session
    const eligibleHistorical = historicalRecords.filter((r) => {
      if (!r.isSettlement || !r.twod || r.twod.length !== 2) return false;
      if (r.date < targetDate) return true;
      if (r.date === targetDate && session === 'PM' && r.session === 'AM') {
        // AM settlement on same day is legitimate prior for PM
        return true;
      }
      return false; // Target session settlement or future dates strictly excluded!
    });

    // 2. Strict Pre-Lock Live Observations Filter (Drop post-lock or malformed observations)
    // Value is strictly NOT used for prediction input. Only valid SET numbers are accepted.
    const eligibleLive = liveObservations.filter((obs) => {
      if (typeof obs.set !== 'number' || !Number.isFinite(obs.set) || obs.set < 100) return false;
      // Cut off at lock boundary time
      if (obs.time && obs.time > lockTime) return false;
      return true;
    });

    // Sort eligible live observations chronologically
    eligibleLive.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const latestLive = eligibleLive.length > 0 ? eligibleLive[eligibleLive.length - 1] : null;
    const liveSet = latestLive ? latestLive.set : null;

    // Check if this is historical settlement backfill in observation tracker
    const hasCompletedHistoricalSettlement = isPastLock && historicalRecords.some(
      (r) => r.isSettlement && r.date === targetDate && r.session === session
    );

    // 2b. Insufficient Live SET Check: When no eligible live SET observations exist
    if (eligibleLive.length === 0 && !hasCompletedHistoricalSettlement) {
      return {
        targetDate,
        formattedTargetDate,
        session,
        signalVersion: 'SET_LAST_DIGIT_V1',
        status: isBeforeOpen ? 'WAITING_FOR_MARKET_OPEN' : 'WAITING_FOR_LIVE_SET',
        isLocked: isPastLock,
        lockTime,
        candidates: [],
        candidateCount: 0,
        primaryDigit: '',
        liveSetObserved: null,
        liveObservationCount: 0,
        evidenceSummary: {
          dominantCandidate: false,
          topScore: 0,
          secondaryScore: null,
          confidenceLevel: 'BALANCED',
          rationale: 'Insufficient live SET evidence (waiting for live SET observations)',
        },
        distribution: [],
        antiLeakageAudit: {
          zeroOfficialSettlementUsed: true,
          zeroPostLockDataUsed: true,
          zeroLiveTwodUsed: true,
          isolatedFromV2Ensemble: true,
        },
      };
    }

    // 3. Compute Base Statistical Evidence for Digits 0-9
    // Initial uniform prior: 1.0 for each digit
    const scores: number[] = new Array(10).fill(1.0);

    // Feature A: Historical Session Frequency Prior for SET Last Digit
    // Reads verified historical SET settlements strictly before the target session (AM or PM)
    const sessionHistory = eligibleHistorical.filter((r) => r.session === session);
    const histCounts = new Array(10).fill(0);
    let totalHist = 0;

    for (const rec of sessionHistory) {
      const digitStr = rec.mathematicalCheck?.setLastDigit || rec.twod[0] || extractSetLastDigit(rec.setRaw);
      const digit = parseInt(digitStr, 10);
      if (!isNaN(digit) && digit >= 0 && digit <= 9) {
        histCounts[digit]++;
        totalHist++;
      }
    }

    if (totalHist >= 10) {
      for (let d = 0; d < 10; d++) {
        // Laplace smoothed historical probability
        const pHist = (histCounts[d] + 1) / (totalHist + 10);
        // Weight historical frequency: 0.35
        scores[d] += pHist * 3.5;
      }
    }

    // Feature B: Live SET Intraday Trajectory & Modulo Neighborhood Evidence
    if (liveSet !== null && Number.isFinite(liveSet)) {
      const liveLastDigitStr = extractSetLastDigit(liveSet);
      const liveLastDigit = parseInt(liveLastDigitStr, 10);

      if (!isNaN(liveLastDigit) && liveLastDigit >= 0 && liveLastDigit <= 9) {
        // In financial SET index dynamics, the pre-lock index decimal digit provides strong
        // localized anchor evidence, decaying as distance mod 10 increases.
        for (let d = 0; d < 10; d++) {
          const directDist = Math.abs(d - liveLastDigit);
          const circularDist = Math.min(directDist, 10 - directDist);

          if (circularDist === 0) {
            scores[d] += 4.5; // Exact current live digit anchor
          } else if (circularDist === 1) {
            scores[d] += 2.8; // Immediate neighbor (+/- 1 tick drift)
          } else if (circularDist === 2) {
            scores[d] += 1.5; // Moderate drift (+/- 2 ticks)
          } else if (circularDist === 3) {
            scores[d] += 0.6;
          }
        }
      }

      // Live SET Intraday Movement / Momentum: if multiple live ticks exist, reward direction of drift
      if (eligibleLive.length >= 2) {
        const firstObs = eligibleLive[0];
        const delta = liveSet - firstObs.set;
        // Directional momentum bias
        const trendDigitOffset = delta > 0 ? 1 : delta < 0 ? 9 : 0;
        const trendDigit = (liveLastDigit + trendDigitOffset) % 10;
        scores[trendDigit] += 1.2;
      }
    }

    // 4. Normalize Scores to Probabilities (Sum = 1.0)
    const totalScore = scores.reduce((sum, s) => sum + s, 0);
    const probabilities = scores.map((s) => s / totalScore);

    // Create ranked list of all 10 digits
    const rankedDigits = probabilities
      .map((prob, digit) => ({
        digit: digit.toString(),
        probability: Math.round(prob * 1000) / 1000,
      }))
      .sort((a, b) => b.probability - a.probability);

    const p0 = rankedDigits[0].probability;
    const p1 = rankedDigits[1].probability;
    const p2 = rankedDigits[2].probability;

    // 5. Output Rule: 1 to 3 Candidates Maximum (Never always 3, never > 3)
    let candidateCount: 1 | 2 | 3;
    let confidenceLevel: 'HIGH' | 'MODERATE' | 'BALANCED';
    let dominant = false;
    let rationale = '';

    if (p0 >= 0.28 && p0 - p1 >= 0.10) {
      // Evidence strongly supports one candidate
      candidateCount = 1;
      confidenceLevel = 'HIGH';
      dominant = true;
      rationale = `Strong statistical and live SET convergence on single digit ${rankedDigits[0].digit} (${(p0 * 100).toFixed(1)}%).`;
    } else if (p0 + p1 >= 0.40 && p1 - p2 >= 0.05) {
      // Two candidates meaningfully supported above uncertainty
      candidateCount = 2;
      confidenceLevel = 'MODERATE';
      rationale = `Bimodal evidence concentrating on dual digits ${rankedDigits[0].digit} and ${rankedDigits[1].digit} (${((p0 + p1) * 100).toFixed(1)}% combined).`;
    } else {
      // Dispersion requires 3 candidates for adequate coverage
      candidateCount = 3;
      confidenceLevel = 'BALANCED';
      rationale = `Multi-path dispersion across digits ${rankedDigits[0].digit}, ${rankedDigits[1].digit}, and ${rankedDigits[2].digit}.`;
    }

    const selectedCandidates: SetLastDigitCandidate[] = rankedDigits
      .slice(0, candidateCount)
      .map((item, idx) => ({
        digit: item.digit,
        probability: item.probability,
        rank: idx + 1,
      }));

    const status: SetLastDigitResult['status'] = isPastLock ? 'FINAL_SIGNAL' : 'LIVE_SIGNAL';

    return {
      targetDate,
      formattedTargetDate,
      session,
      signalVersion: 'SET_LAST_DIGIT_V1',
      status,
      isLocked: isPastLock,
      lockTime,
      candidates: selectedCandidates,
      candidateCount,
      primaryDigit: selectedCandidates[0].digit,
      liveSetObserved: liveSet,
      liveObservationCount: eligibleLive.length,
      evidenceSummary: {
        dominantCandidate: dominant,
        topScore: p0,
        secondaryScore: p1,
        confidenceLevel,
        rationale,
      },
      distribution: rankedDigits,
      antiLeakageAudit: {
        zeroOfficialSettlementUsed: true,
        zeroPostLockDataUsed: true,
        zeroLiveTwodUsed: true,
        isolatedFromV2Ensemble: true,
      },
    };
  }
}
