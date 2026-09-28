/**
 * MM2D AUTHORITATIVE TIMEZONE CONTRACT & NORMALIZATION UTILITIES
 * 
 * Timezone Specifications:
 * - Canonical Internal Market Timezone: Asia/Bangkok (UTC+7:00, +420 minutes)
 * - User-Facing & Production Lock Definition Timezone: Asia/Yangon (UTC+6:30, +390 minutes)
 * - Timezone Relationship: Bangkok = Yangon + 30 minutes (Yangon = Bangkok - 30 minutes)
 * 
 * Critical Rules:
 * 1. Never compare a Bangkok timestamp directly against a Yangon cutoff.
 * 2. Never compare a Yangon timestamp directly against a Bangkok cutoff.
 * 3. All external/provider market timestamps must be normalized to Asia/Bangkok before session/lock calculations.
 * 4. Device/phone local timezone must NEVER alter session membership or lock state.
 */

import { MarketSession } from '../../types/market';

export const TIMEZONE_CONSTANTS = {
  CANONICAL_MARKET_TZ: 'Asia/Bangkok',
  USER_DISPLAY_TZ: 'Asia/Yangon',
  BANGKOK_UTC_OFFSET_HOURS: 7.0,
  YANGON_UTC_OFFSET_HOURS: 6.5,
  OFFSET_DIFF_MINUTES: 30, // Bangkok is 30 minutes ahead of Yangon
} as const;

export interface NormalizedTimeComponents {
  dateStr: string; // "YYYY-MM-DD"
  timeStr: string; // "HH:mm:ss"
  hours: number;
  minutes: number;
  seconds: number;
  totalMinutes: number; // hours * 60 + minutes
  totalSeconds: number; // hours * 3600 + minutes * 60 + seconds
  epochMillis: number;
  isoString: string;
}

export class TimezoneContract {
  /**
   * Normalizes any Date, ISO string, or epoch timestamp to canonical Asia/Bangkok (UTC+7).
   * Device-Independent: Uses pure UTC epoch math to guarantee immunity from host/browser timezone offsets.
   */
  public static toBangkok(instant?: Date | string | number): NormalizedTimeComponents {
    const epochMillis = this.parseToEpochMillis(instant);
    
    // Bangkok is UTC+7 (7 * 3600 * 1000 ms)
    const bkkDate = new Date(epochMillis + 7 * 3600000);
    const year = bkkDate.getUTCFullYear();
    const month = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(bkkDate.getUTCDate()).padStart(2, '0');
    const hours = bkkDate.getUTCHours();
    const minutes = bkkDate.getUTCMinutes();
    const seconds = bkkDate.getUTCSeconds();

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const totalMinutes = hours * 60 + minutes;
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const isoString = `${dateStr}T${timeStr}+07:00`;

    return {
      dateStr,
      timeStr,
      hours,
      minutes,
      seconds,
      totalMinutes,
      totalSeconds,
      epochMillis,
      isoString,
    };
  }

  /**
   * Normalizes any Date, ISO string, or epoch timestamp to Asia/Yangon (UTC+6:30).
   * Device-Independent: Uses pure UTC epoch math.
   */
  public static toYangon(instant?: Date | string | number): NormalizedTimeComponents & { formattedAmPm: string } {
    const epochMillis = this.parseToEpochMillis(instant);
    
    // Yangon is UTC+6:30 (6.5 * 3600 * 1000 ms = 23,400,000 ms)
    const ygnDate = new Date(epochMillis + 23400000);
    const year = ygnDate.getUTCFullYear();
    const month = String(ygnDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(ygnDate.getUTCDate()).padStart(2, '0');
    const hours = ygnDate.getUTCHours();
    const minutes = ygnDate.getUTCMinutes();
    const seconds = ygnDate.getUTCSeconds();

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const totalMinutes = hours * 60 + minutes;
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const isoString = `${dateStr}T${timeStr}+06:30`;

    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;
    const formattedAmPm = `${displayHour}:${String(minutes).padStart(2, '0')} ${ampm}`;

    return {
      dateStr,
      timeStr,
      hours,
      minutes,
      seconds,
      totalMinutes,
      totalSeconds,
      epochMillis,
      isoString,
      formattedAmPm,
    };
  }

  /**
   * Converts a Yangon time string ("HH:mm" or "HH:mm:ss") to Bangkok time string ("HH:mm:ss")
   * (Adds 30 minutes)
   */
  public static yangonToBangkokTimeString(yangonTime: string): string {
    const parts = yangonTime.split(':').map(Number);
    const yH = parts[0] || 0;
    const yM = parts[1] || 0;
    const yS = parts[2] || 0;

    let bM = yM + 30;
    let bH = yH + Math.floor(bM / 60);
    bM = bM % 60;
    bH = bH % 24;

    return `${String(bH).padStart(2, '0')}:${String(bM).padStart(2, '0')}:${String(yS).padStart(2, '0')}`;
  }

  /**
   * Converts a Bangkok time string ("HH:mm" or "HH:mm:ss") to Yangon time string ("HH:mm:ss")
   * (Subtracts 30 minutes)
   */
  public static bangkokToYangonTimeString(bangkokTime: string): string {
    const parts = bangkokTime.split(':').map(Number);
    const bH = parts[0] || 0;
    const bM = parts[1] || 0;
    const bS = parts[2] || 0;

    let totalMins = bH * 60 + bM - 30;
    if (totalMins < 0) totalMins += 24 * 60;

    const yH = Math.floor(totalMins / 60);
    const yM = totalMins % 60;

    return `${String(yH).padStart(2, '0')}:${String(yM).padStart(2, '0')}:${String(bS).padStart(2, '0')}`;
  }

  /**
   * Parses various date formats into epoch milliseconds safely.
   */
  private static parseToEpochMillis(instant?: Date | string | number): number {
    if (typeof instant === 'number') {
      return instant;
    }
    if (instant instanceof Date) {
      return instant.getTime();
    }
    if (typeof instant === 'string') {
      // Check if it's already an ISO or date string with timezone/offset
      if (instant.includes('T') || instant.includes('Z') || instant.includes('+') || (instant.includes('-') && instant.includes(':'))) {
        const parsed = Date.parse(instant);
        if (!isNaN(parsed)) return parsed;
      }
      // If it's a bare time string "HH:mm:ss", treat as today's Bangkok time
      if (!instant.includes('-') && instant.includes(':')) {
        const nowBkk = this.toBangkok(Date.now());
        const bkkIso = `${nowBkk.dateStr}T${instant}+07:00`;
        const parsed = Date.parse(bkkIso);
        if (!isNaN(parsed)) return parsed;
      }
      // If it's a date string "YYYY-MM-DD"
      if (instant.length === 10 && instant.includes('-')) {
        const bkkIso = `${instant}T00:00:00+07:00`;
        const parsed = Date.parse(bkkIso);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return Date.now();
  }
}
