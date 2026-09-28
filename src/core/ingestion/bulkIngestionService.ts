import { fetch2DResultByDate } from '../api/thaistockClient';
import { parseAndVerify2DResult } from '../integrity/parser';
import { sqliteStorage } from '../storage/sqliteManager';
import { VerifiedMarketRecord } from '../../types/market';

export interface DateIngestionProgress {
  currentDate: string;
  currentIndex: number;
  totalDates: number;
  status: 'pending' | 'fetching' | 'verified' | 'non-trading' | 'failed';
  message: string;
  verifiedInDate: number;
  rejectedInDate: number;
}

export interface BulkIngestionDateResult {
  date: string;
  status: 'trading' | 'non-trading' | 'failed';
  rawCount: number;
  verifiedCount: number;
  rejectedCount: number;
  inserted: number;
  duplicatesSkipped: number;
  errorMessage?: string;
  records: VerifiedMarketRecord[];
}

export interface BulkIngestionSummary {
  startDate: string;
  endDate: string;
  totalDatesAttempted: number;
  tradingDatesFound: number;
  nonTradingDates: number;
  failedDates: string[];
  totalRawRecords: number;
  totalVerifiedRecords: number;
  totalRejectedRecords: number;
  totalDuplicatesSkipped: number;
  totalNewlyInserted: number;
  finalDbTotal: number;
  finalAmCount: number;
  finalPmCount: number;
  executedAt: string;
  dateBreakdown: BulkIngestionDateResult[];
}

/**
 * Generate an array of YYYY-MM-DD date strings between start and end dates (inclusive).
 */
export function generateDateRange(startDateStr: string, endDateStr: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${startDateStr} to ${endDateStr}`);
  }

  if (start > end) {
    throw new Error(`Start date (${startDateStr}) cannot be after end date (${endDateStr})`);
  }

  const current = new Date(start);
  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Executes controlled real historical data bulk ingestion.
 */
export async function executeHistoricalBulkIngestion(
  startDate: string,
  endDate: string,
  onProgress?: (progress: DateIngestionProgress) => void
): Promise<BulkIngestionSummary> {
  await sqliteStorage.init();

  const dates = generateDateRange(startDate, endDate);
  const dateBreakdown: BulkIngestionDateResult[] = [];
  const failedDates: string[] = [];

  let tradingDatesFound = 0;
  let nonTradingDates = 0;
  let totalRawRecords = 0;
  let totalVerifiedRecords = 0;
  let totalRejectedRecords = 0;
  let totalDuplicatesSkipped = 0;
  let totalNewlyInserted = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];

    if (onProgress) {
      onProgress({
        currentDate: date,
        currentIndex: i + 1,
        totalDates: dates.length,
        status: 'fetching',
        message: `${date} ရက်စွဲအား API မှ စတင်ရယူနေပါသည်...`,
        verifiedInDate: 0,
        rejectedInDate: 0,
      });
    }

    try {
      // 1. Real API Fetch
      const rawPayload = await fetch2DResultByDate(date);

      // Check if trading day or weekend/empty
      if (!rawPayload || rawPayload.length === 0) {
        nonTradingDates++;
        dateBreakdown.push({
          date,
          status: 'non-trading',
          rawCount: 0,
          verifiedCount: 0,
          rejectedCount: 0,
          inserted: 0,
          duplicatesSkipped: 0,
          records: [],
        });

        if (onProgress) {
          onProgress({
            currentDate: date,
            currentIndex: i + 1,
            totalDates: dates.length,
            status: 'non-trading',
            message: `${date} သည် ဈေးပိတ်ရက် (သို့မဟုတ်) မှတ်တမ်းမရှိသောရက် ဖြစ်ပါသည်`,
            verifiedInDate: 0,
            rejectedInDate: 0,
          });
        }
        continue;
      }

      // 2. Preserve RAW Feed
      await sqliteStorage.saveRawFeed(date, `/2d_result?date=${date}`, rawPayload);

      // 3. Parse and Verify using Phase 2A integrity rules
      const ingestion = parseAndVerify2DResult(rawPayload, date);

      totalRawRecords += ingestion.rawCount;
      totalVerifiedRecords += ingestion.verifiedCount;
      totalRejectedRecords += ingestion.rejectedCount;

      if (ingestion.verifiedCount > 0) {
        tradingDatesFound++;
      } else {
        nonTradingDates++;
      }

      // 4. Store Verified Records in IndexedDB with Deduplication
      const insertStats = await sqliteStorage.storeVerifiedRecords(ingestion.verifiedRecords);
      totalNewlyInserted += insertStats.inserted;
      totalDuplicatesSkipped += insertStats.duplicatesSkipped;

      dateBreakdown.push({
        date,
        status: ingestion.verifiedCount > 0 ? 'trading' : 'non-trading',
        rawCount: ingestion.rawCount,
        verifiedCount: ingestion.verifiedCount,
        rejectedCount: ingestion.rejectedCount,
        inserted: insertStats.inserted,
        duplicatesSkipped: insertStats.duplicatesSkipped,
        records: ingestion.verifiedRecords,
      });

      if (onProgress) {
        onProgress({
          currentDate: date,
          currentIndex: i + 1,
          totalDates: dates.length,
          status: 'verified',
          message: `${date}: အတည်ပြု ${ingestion.verifiedCount} ခု၊ ပယ်ဖျက် ${ingestion.rejectedCount} ခု၊ အသစ်သွင်း ${insertStats.inserted} ခု၊ ကျော်လွှား ${insertStats.duplicatesSkipped} ခု`,
          verifiedInDate: ingestion.verifiedCount,
          rejectedInDate: ingestion.rejectedCount,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failedDates.push(date);

      dateBreakdown.push({
        date,
        status: 'failed',
        rawCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
        inserted: 0,
        duplicatesSkipped: 0,
        errorMessage: errorMsg,
        records: [],
      });

      if (onProgress) {
        onProgress({
          currentDate: date,
          currentIndex: i + 1,
          totalDates: dates.length,
          status: 'failed',
          message: `${date} အားရယူစဉ် အမှားအယွင်းဖြစ်ပေါ်ခဲ့ပါသည်: ${errorMsg}`,
          verifiedInDate: 0,
          rejectedInDate: 0,
        });
      }
    }
  }

  // Get final database statistics
  const finalStats = await sqliteStorage.getStats();

  return {
    startDate,
    endDate,
    totalDatesAttempted: dates.length,
    tradingDatesFound,
    nonTradingDates,
    failedDates,
    totalRawRecords,
    totalVerifiedRecords,
    totalRejectedRecords,
    totalDuplicatesSkipped,
    totalNewlyInserted,
    finalDbTotal: finalStats.totalVerifiedCount,
    finalAmCount: finalStats.amCount,
    finalPmCount: finalStats.pmCount,
    executedAt: new Date().toISOString(),
    dateBreakdown,
  };
}
