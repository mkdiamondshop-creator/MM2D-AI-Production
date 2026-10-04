import { VerifiedMarketRecord, MarketSession } from '../../types/market';

export type HotUnseenSessionFilter = 'ALL' | 'AM' | 'PM';

export interface HotNumberItem {
  rank: number;
  twod: string;
  count: number;
  percentage: number;
  lastSeenDate: string | null;
}

export interface UnseenNumberItem {
  twod: string;
  lastSeenDate: string | null;
}

export interface HotUnseenAnalysis {
  session: HotUnseenSessionFilter;
  windowTradingDays: number;
  totalSessionsInWindow: number;
  dateRange: { start: string; end: string } | null;
  hotNumbers: HotNumberItem[];
  unseenNumbers: UnseenNumberItem[];
}

/**
 * Calculates Hot & Unseen Numbers from verified official 2D results.
 *
 * Strict Principles:
 * - Uses ONLY verified official 2D settlement records from existing historical dataset.
 * - Window: Latest 30 trading days.
 * - Does NOT create or store duplicate historical data.
 * - Purely informational statistics; zero connection to prediction engines.
 */
export function calculateHotAndUnseen(
  records: VerifiedMarketRecord[],
  sessionFilter: HotUnseenSessionFilter = 'ALL',
  maxTradingDays = 30
): HotUnseenAnalysis {
  // 1. Filter only valid verified official settlement records (12:01 AM or 16:30 PM)
  const officialSettlements = records.filter(
    (r) => Boolean(r.isSettlement) && Boolean(r.twod) && r.twod.length === 2 && /^\d{2}$/.test(r.twod)
  );

  // 2. Identify distinct trading dates in descending order (latest first)
  const distinctDates = Array.from(new Set(officialSettlements.map((r) => r.date))).sort((a, b) =>
    b.localeCompare(a)
  );

  // Take latest 30 trading days
  const windowDateList = distinctDates.slice(0, maxTradingDays);
  const windowDateSet = new Set(windowDateList);

  const dateRange =
    windowDateList.length > 0
      ? {
          start: windowDateList[windowDateList.length - 1],
          end: windowDateList[0],
        }
      : null;

  // 3. Filter window settlements matching the selected session
  const windowSettlements = officialSettlements.filter((r) => {
    if (!windowDateSet.has(r.date)) return false;
    if (sessionFilter === 'AM') return r.session === 'AM';
    if (sessionFilter === 'PM') return r.session === 'PM';
    return true; // 'ALL'
  });

  const totalSessionsInWindow = windowSettlements.length;

  // 4. Compute overall historical last seen date for each 2D number (00-99)
  // Considers session filter so AM last seen reflects AM, etc.
  const relevantHistoricalSettlements = officialSettlements.filter((r) => {
    if (sessionFilter === 'AM') return r.session === 'AM';
    if (sessionFilter === 'PM') return r.session === 'PM';
    return true;
  });

  const lastSeenMap = new Map<string, string>();
  for (const r of relevantHistoricalSettlements) {
    const existing = lastSeenMap.get(r.twod);
    if (!existing || r.date > existing) {
      lastSeenMap.set(r.twod, r.date);
    }
  }

  // 5. Count appearance frequency within the 30-day window
  const countMap = new Map<string, number>();
  for (let i = 0; i < 100; i++) {
    const twod = i.toString().padStart(2, '0');
    countMap.set(twod, 0);
  }

  for (const s of windowSettlements) {
    const current = countMap.get(s.twod) || 0;
    countMap.set(s.twod, current + 1);
  }

  // 6. Separate into Hot Numbers and Unseen Numbers
  const hotList: Array<{ twod: string; count: number; lastSeenDate: string | null }> = [];
  const unseenList: UnseenNumberItem[] = [];

  for (let i = 0; i < 100; i++) {
    const twod = i.toString().padStart(2, '0');
    const count = countMap.get(twod) || 0;
    const lastSeenDate = lastSeenMap.get(twod) || null;

    if (count > 0) {
      hotList.push({ twod, count, lastSeenDate });
    } else {
      unseenList.push({ twod, lastSeenDate });
    }
  }

  // Sort Hot Numbers: highest count first; if tied, digit ascending
  hotList.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.twod.localeCompare(b.twod);
  });

  const hotNumbers: HotNumberItem[] = hotList.map((item, index) => ({
    rank: index + 1,
    twod: item.twod,
    count: item.count,
    percentage:
      totalSessionsInWindow > 0
        ? Math.round((item.count / totalSessionsInWindow) * 1000) / 10
        : 0,
    lastSeenDate: item.lastSeenDate,
  }));

  // Sort Unseen Numbers: by last seen date (oldest first, with null/never seen first)
  unseenList.sort((a, b) => {
    if (!a.lastSeenDate && !b.lastSeenDate) return a.twod.localeCompare(b.twod);
    if (!a.lastSeenDate) return -1;
    if (!b.lastSeenDate) return 1;
    const dateComp = a.lastSeenDate.localeCompare(b.lastSeenDate);
    if (dateComp !== 0) return dateComp;
    return a.twod.localeCompare(b.twod);
  });

  return {
    session: sessionFilter,
    windowTradingDays: windowDateList.length,
    totalSessionsInWindow,
    dateRange,
    hotNumbers,
    unseenNumbers: unseenList,
  };
}
