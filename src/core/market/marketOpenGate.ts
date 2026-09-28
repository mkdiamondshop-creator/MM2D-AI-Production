import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { PredictionStatus, PREDICTION_CUTOFFS } from '../../types/prediction';
import { MarketCalendar } from './marketCalendar';
import { TimezoneContract } from './timezoneUtils';

export interface MarketSessionSchedule {
  session: MarketSession;
  openTimeString: string; // "10:00:00" for AM, "14:00:00" for PM (Bangkok Time)
  openMinutes: number; // 600 (10:00 AM) or 840 (14:00 PM)
  publishTimeString: string; // "11:55:00" for AM, "15:55:00" for PM (Bangkok Time)
  publishMinutes: number; // 715 (11:55 AM) or 955 (15:55 PM)
  checkpointTimeString: string; // "11:00:00" or "15:00:00" (Bangkok Time)
  lockTimeString: string; // "12:00:00" (11:30 MM) or "16:00:00" (15:30 MM) (Bangkok Time)
  lockMinutes: number; // 720 (12:00 PM) or 960 (16:00 PM)
  settlementTimeString: string; // "12:01:00" or "16:30:00" (Official MM2D Result Convention / Provider timestamp)
  userLockTimeStringYangon: string; // "11:30:00" or "15:30:00" (Myanmar Lock Time)
  userResultTimeStringYangon: string; // "12:01:00" or "16:30:00" (Myanmar Result Display Time)
  userPublishTimeStringYangon: string; // "11:25:00" or "15:25:00" (Myanmar Publish Time)
}

export const SESSION_SCHEDULES: Record<MarketSession, MarketSessionSchedule> = {
  AM: {
    session: 'AM',
    openTimeString: '10:00:00', // 10:00:00 Bangkok (09:30:00 Yangon)
    openMinutes: 10 * 60, // 600 minutes
    publishTimeString: '11:55:00', // 11:55:00 Bangkok (11:25:00 Yangon)
    publishMinutes: 11 * 60 + 55, // 715 minutes
    checkpointTimeString: '11:00:00', // 11:00:00 Bangkok (10:30:00 Yangon)
    lockTimeString: '12:00:00', // 12:00:00 Bangkok (11:30:00 Yangon Lock)
    lockMinutes: 12 * 60, // 720 minutes
    settlementTimeString: '12:01:00', // Provider MM2D Result Label / 12:01 PM Myanmar Result
    userLockTimeStringYangon: '11:30:00',
    userResultTimeStringYangon: '12:01:00',
    userPublishTimeStringYangon: '11:25:00',
  },
  PM: {
    session: 'PM',
    openTimeString: '14:00:00', // 14:00:00 Bangkok (13:30:00 Yangon)
    openMinutes: 14 * 60, // 840 minutes
    publishTimeString: '15:55:00', // 15:55:00 Bangkok (15:25:00 Yangon)
    publishMinutes: 15 * 60 + 55, // 955 minutes
    checkpointTimeString: '15:00:00', // 15:00:00 Bangkok (14:30:00 Yangon)
    lockTimeString: '16:00:00', // 16:00:00 Bangkok (15:30:00 Yangon Lock)
    lockMinutes: 16 * 60, // 960 minutes
    settlementTimeString: '16:30:00', // Provider MM2D Result Label / 4:30 PM Myanmar Result
    userLockTimeStringYangon: '15:30:00',
    userResultTimeStringYangon: '16:30:00',
    userPublishTimeStringYangon: '15:25:00',
  },
};

/**
 * Market Open Gate & Session Lifecycle Engine
 * 
 * Invariants:
 * 1. Predictions are only enabled for valid trading sessions.
 * 2. Before session open (10:00 AM Bangkok for morning, 14:00 PM Bangkok for afternoon), state is MARKET_NOT_OPEN.
 * 3. Live ticks outside the permitted session window [Open, Lock] are strictly rejected.
 * 4. Distinct lifecycle states are resolved deterministically without fabrication.
 */
export class MarketOpenGate {
  /**
   * Converts a Date or ISO/time string to total Bangkok minutes from midnight
   */
  public static getBangkokMinutes(
    dateOrTime?: Date | string | number,
    targetDateContext?: string
  ): {
    dateStr: string;
    timeStr: string;
    totalMinutes: number;
    totalSeconds: number;
  } {
    if (typeof dateOrTime === 'string' && !dateOrTime.includes('-') && dateOrTime.includes(':')) {
      // Pure time string "HH:mm:ss"
      const parts = dateOrTime.split(':').map(Number);
      const hours = parts[0] || 0;
      const minutes = parts[1] || 0;
      const seconds = parts[2] || 0;
      const totalMinutes = hours * 60 + minutes;
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      const fallbackDate = targetDateContext || TimezoneContract.toBangkok(Date.now()).dateStr;
      return {
        dateStr: fallbackDate,
        timeStr,
        totalMinutes,
        totalSeconds,
      };
    }

    const bkk = TimezoneContract.toBangkok(dateOrTime);
    return {
      dateStr: targetDateContext || bkk.dateStr,
      timeStr: bkk.timeStr,
      totalMinutes: bkk.totalMinutes,
      totalSeconds: bkk.totalSeconds,
    };
  }

  /**
   * Checks if the market session has legitimately opened in Bangkok time
   */
  public static isMarketOpen(session: MarketSession, currentBangkokTime?: Date | string): boolean {
    const { totalMinutes } = this.getBangkokMinutes(currentBangkokTime);
    const schedule = SESSION_SCHEDULES[session];
    return totalMinutes >= schedule.openMinutes;
  }

  /**
   * Checks if a specific time string is within the permitted live observation window
   * e.g. AM: [10:00:00, 11:30:00], PM: [14:00:00, 15:30:00]
   */
  public static isWithinObservationWindow(session: MarketSession, timeStr: string): boolean {
    let cleanTime = timeStr;
    if (cleanTime.includes('T')) {
      cleanTime = cleanTime.split('T')[1].slice(0, 8);
    } else if (cleanTime.includes(' ')) {
      cleanTime = cleanTime.split(' ')[1].slice(0, 8);
    }

    const schedule = SESSION_SCHEDULES[session];
    return cleanTime >= schedule.openTimeString && cleanTime <= schedule.lockTimeString;
  }

  /**
   * Resolves the comprehensive, truthful lifecycle state of a market session
   */
  public static resolveLifecycleState(options: {
    targetDate: string;
    session: MarketSession;
    currentBangkokTime?: Date | string;
    historicalRecords?: VerifiedMarketRecord[];
    hasOfficialResult?: boolean;
    isSessionLocked?: boolean;
    hasLiveObservations?: boolean;
    liveSourceStatus?: 'SUCCESS' | 'INSUFFICIENT_LIVE_DATA' | 'LIVE_DATA_STALE' | 'MARKET_CLOSED' | 'SOURCE_UNAVAILABLE';
  }): {
    status: PredictionStatus;
    isTradingDay: boolean;
    isMarketOpen: boolean;
    isLocked: boolean;
    hasResult: boolean;
    description: string;
  } {
    const {
      targetDate,
      session,
      currentBangkokTime,
      historicalRecords = [],
      hasOfficialResult = false,
      isSessionLocked = false,
      hasLiveObservations = false,
      liveSourceStatus,
    } = options;

    const { dateStr: bkkDateStr, totalMinutes } = this.getBangkokMinutes(currentBangkokTime, targetDate);
    const schedule = SESSION_SCHEDULES[session];

    // 1. Check Trading Day Gate
    const tradingDayEval = MarketCalendar.isTradingDay(targetDate, historicalRecords, bkkDateStr);
    if (!tradingDayEval.isTradingDay) {
      return {
        status: 'NON_TRADING_DAY',
        isTradingDay: false,
        isMarketOpen: false,
        isLocked: false,
        hasResult: false,
        description: tradingDayEval.reason,
      };
    }

    // 2. Official Result Available
    if (hasOfficialResult) {
      return {
        status: 'OFFICIAL_RESULT_AVAILABLE',
        isTradingDay: true,
        isMarketOpen: true,
        isLocked: true,
        hasResult: true,
        description: `Official ${session} settlement result published.`,
      };
    }

    // 3. Past Date evaluation (historical viewing)
    if (targetDate < bkkDateStr) {
      return {
        status: 'OFFICIAL_RESULT_AVAILABLE',
        isTradingDay: true,
        isMarketOpen: true,
        isLocked: true,
        hasResult: true,
        description: 'Historical verified session.',
      };
    }

    // 4. Future Date evaluation
    if (targetDate > bkkDateStr) {
      return {
        status: 'MARKET_NOT_OPEN',
        isTradingDay: true,
        isMarketOpen: false,
        isLocked: false,
        hasResult: false,
        description: 'Future session not yet opened.',
      };
    }

    // 5. Today's Date: Check Market Open Gate
    const isSessionOpen = totalMinutes >= schedule.openMinutes;
    if (!isSessionOpen) {
      return {
        status: 'MARKET_NOT_OPEN',
        isTradingDay: true,
        isMarketOpen: false,
        isLocked: false,
        hasResult: false,
        description: `Market session opens at ${schedule.openTimeString} (Bangkok).`,
      };
    }

    // 6. Check Lock Boundary
    const locked = isSessionLocked || totalMinutes >= schedule.lockMinutes;
    if (locked) {
      return {
        status: 'PREDICTION_LOCKED',
        isTradingDay: true,
        isMarketOpen: true,
        isLocked: true,
        hasResult: false,
        description: `Prediction locked at ${schedule.lockTimeString}. Awaiting official result.`,
      };
    }

    // 7. Session is Open and Unlocked: Check Live Data State
    if (liveSourceStatus === 'INSUFFICIENT_LIVE_DATA' || liveSourceStatus === 'SOURCE_UNAVAILABLE' || liveSourceStatus === 'LIVE_DATA_STALE') {
      return {
        status: 'INSUFFICIENT_LIVE_DATA',
        isTradingDay: true,
        isMarketOpen: true,
        isLocked: false,
        hasResult: false,
        description: 'Live market feeds currently unavailable or returned insufficient data.',
      };
    }

    if (hasLiveObservations) {
      if (totalMinutes < schedule.publishMinutes) {
        return {
          status: 'ANALYZING_LIVE_DATA',
          isTradingDay: true,
          isMarketOpen: true,
          isLocked: false,
          hasResult: false,
          description: `Analyzing live market data until calculation window (${schedule.userPublishTimeStringYangon} MMT / ${schedule.publishTimeString} BKK).`,
        };
      }

      return {
        status: 'READY_FOR_PREDICTION',
        isTradingDay: true,
        isMarketOpen: true,
        isLocked: false,
        hasResult: false,
        description: 'Active prediction session with verified live SET/Value conditioning.',
      };
    }

    return {
      status: 'WAITING_FOR_LIVE_DATA',
      isTradingDay: true,
      isMarketOpen: true,
      isLocked: false,
      hasResult: false,
      description: 'Session open; waiting for initial pre-lock live market ticks.',
    };
  }
}
