import { MarketSession } from '../../types/market';
import { SESSION_SCHEDULES } from './marketOpenGate';
import { TimezoneContract } from './timezoneUtils';
import { LiveObservation, LiveObservationBuffer } from './liveObservationBuffer';

export type DataSufficiencyState =
  | 'AWAITING_DATA'
  | 'EARLY_PREDICTION_READY'
  | 'REFINING'
  | 'LOCKED';

export interface DataSufficiencyEvaluationOptions {
  session: MarketSession;
  targetDate: string;
  currentBangkokTime?: Date | string;
  buffer: LiveObservationBuffer;
  isSessionLocked?: boolean;
  hasOfficialResult?: boolean;
}

export interface DataSufficiencyResult {
  state: DataSufficiencyState;
  session: MarketSession;
  targetDate: string;
  observationCount: number;
  latestObservation: LiveObservation | null;
  reason: string;
  isPredictionPermitted: boolean;
  isEarlyPredictionReady: boolean;
  isRefining: boolean;
  isLocked: boolean;
}

/**
 * Deterministic Data Sufficiency Gate
 * Governs session prediction readiness through authentic live observation accumulation:
 * 
 * Invariants:
 * 1. AWAITING_DATA:
 *    - Session not yet open (before 10:00 AM BKK for AM, before 14:00 PM BKK for PM)
 *    - OR session open, but 0 verified live observations in buffer.
 * 
 * 2. EARLY_PREDICTION_READY:
 *    - Session is open and unlocked.
 *    - Exactly 1 verified authentic pre-lock live SET/Value observation in buffer.
 *    - Unlocks initial conditional prediction calculation.
 * 
 * 3. REFINING:
 *    - Session is open and unlocked.
 *    - >= 2 verified authentic pre-lock live SET/Value observations in buffer.
 *    - Continuous live updates dynamically refine probability distributions.
 * 
 * 4. LOCKED:
 *    - Cutoff reached (12:00 PM BKK / 11:30 AM MMT for AM; 16:00 PM BKK / 15:30 PM MMT for PM)
 *    - OR official settlement result is available
 *    - OR session is explicitly marked locked.
 *    - Freezes distribution snapshot; no new ticks alter the locked prediction.
 */
export class DataSufficiencyGate {
  public static evaluate(options: DataSufficiencyEvaluationOptions): DataSufficiencyResult {
    const {
      session,
      targetDate,
      currentBangkokTime,
      buffer,
      isSessionLocked = false,
      hasOfficialResult = false,
    } = options;

    const schedule = SESSION_SCHEDULES[session];
    const bkk = TimezoneContract.toBangkok(currentBangkokTime || new Date());
    const currentDateBkk = bkk.dateStr;
    const currentMinutes = bkk.totalMinutes;
    const currentTimeStr = bkk.timeStr;

    const observations = buffer.getObservations(session, targetDate);
    const observationCount = observations.length;
    const latestObservation = observationCount > 0 ? observations[observationCount - 1] : null;

    // RULE 1: LOCKED
    // If official result is available, session is locked
    if (hasOfficialResult) {
      return {
        state: 'LOCKED',
        session,
        targetDate,
        observationCount,
        latestObservation,
        reason: `Official ${session} settlement published. Session locked.`,
        isPredictionPermitted: true,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: true,
      };
    }

    // Historical date (strictly before today in Bangkok)
    if (targetDate < currentDateBkk) {
      return {
        state: 'LOCKED',
        session,
        targetDate,
        observationCount,
        latestObservation,
        reason: `Historical session (${targetDate}). Results finalized and locked.`,
        isPredictionPermitted: true,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: true,
      };
    }

    // Today: check lock threshold
    const isPastLockTime = targetDate === currentDateBkk && currentMinutes >= schedule.lockMinutes;
    if (isSessionLocked || isPastLockTime) {
      return {
        state: 'LOCKED',
        session,
        targetDate,
        observationCount,
        latestObservation,
        reason: `Session cutoff reached at ${schedule.lockTimeString} Bangkok (${schedule.userLockTimeStringYangon} Yangon). Frozen.`,
        isPredictionPermitted: true,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: true,
      };
    }

    // Future date check
    if (targetDate > currentDateBkk) {
      return {
        state: 'AWAITING_DATA',
        session,
        targetDate,
        observationCount: 0,
        latestObservation: null,
        reason: `Future session (${targetDate}) not yet open.`,
        isPredictionPermitted: false,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: false,
      };
    }

    // RULE 2: AWAITING_DATA
    // Today's date, but before session open time
    if (currentMinutes < schedule.openMinutes) {
      return {
        state: 'AWAITING_DATA',
        session,
        targetDate,
        observationCount,
        latestObservation,
        reason: `Session opens at ${schedule.openTimeString} Bangkok (${schedule.openMinutes - currentMinutes}m remaining). Awaiting market open.`,
        isPredictionPermitted: false,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: false,
      };
    }

    // Today's date, market is open, but 0 valid observations in buffer
    if (observationCount === 0) {
      return {
        state: 'AWAITING_DATA',
        session,
        targetDate,
        observationCount: 0,
        latestObservation: null,
        reason: `Market session is open (${currentTimeStr}). Awaiting initial authentic live SET/Value tick.`,
        isPredictionPermitted: false,
        isEarlyPredictionReady: false,
        isRefining: false,
        isLocked: false,
      };
    }

    // RULE 3: EARLY_PREDICTION_READY
    // Exactly 1 authentic observation accumulated
    if (observationCount === 1) {
      return {
        state: 'EARLY_PREDICTION_READY',
        session,
        targetDate,
        observationCount: 1,
        latestObservation,
        reason: `Initial authentic pre-lock observation verified at ${latestObservation?.time} (SET: ${latestObservation?.set}, Val: ${latestObservation?.value}). Early prediction ready.`,
        isPredictionPermitted: true,
        isEarlyPredictionReady: true,
        isRefining: false,
        isLocked: false,
      };
    }

    // RULE 4: REFINING
    // 2 or more authentic observations accumulated
    return {
      state: 'REFINING',
      session,
      targetDate,
      observationCount,
      latestObservation,
      reason: `Accumulated ${observationCount} authentic pre-lock ticks. Live refinement active until ${schedule.lockTimeString} BKK cutoff.`,
      isPredictionPermitted: true,
      isEarlyPredictionReady: false,
      isRefining: true,
      isLocked: false,
    };
  }
}
