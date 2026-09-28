import { fetch2DResultByDate, fetchRecent2DResults, THAISTOCK_BASE_URL } from '../api/thaistockClient';
import { parseAndVerify2DResult } from '../integrity/parser';
import { VerifiedMarketRecord, RawThaiStockResultDateGroup } from '../../types/market';
import { globalDatasetStorage } from '../storage/storageAbstraction';
import { globalShadowTracker } from '../prediction/autoWeightedV2ShadowTracker';

export type OfficialResultStatus =
  | 'CONFIRMED'
  | 'PARTIALLY_CONFIRMED'
  | 'PENDING_CONFIRMATION'
  | 'API_UNAVAILABLE'
  | 'NON_TRADING_DAY';

export interface RecentDayResult {
  date: string;
  am?: VerifiedMarketRecord;
  pm?: VerifiedMarketRecord;
}

export interface OfficialSettlementResultResponse {
  success: boolean;
  status: OfficialResultStatus;
  targetDate: string;
  amResult: VerifiedMarketRecord | null;
  pmResult: VerifiedMarketRecord | null;
  allVerifiedRecords: VerifiedMarketRecord[];
  providerEndpoint: string;
  providerRawCount: number;
  providerTimestamp?: string;
  errorMessage?: string;
}

export class OfficialResultAdapter {
  private readonly primaryEndpointBase = `${THAISTOCK_BASE_URL}/2d_result`;
  private readonly fallbackLiveEndpoint = `${THAISTOCK_BASE_URL}/live`;

  /**
   * Fetches and verifies official 2D results from ThaiStock2D for a given market date.
   * Enforces zero-fabrication:
   * - Result date MUST strictly match targetDate.
   * - Provider timestamp (12:01:00 for AM, 16:30:00 for PM) is preserved exactly.
   * - Unconfirmed or placeholder ("--") values are strictly rejected.
   * - If API is unavailable, returns null records with status API_UNAVAILABLE (no fallback/synthetic results).
   */
  public async getOfficialResults(targetDate: string): Promise<OfficialSettlementResultResponse> {
    const cleanDate = targetDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return {
        success: false,
        status: 'API_UNAVAILABLE',
        targetDate: cleanDate,
        amResult: null,
        pmResult: null,
        allVerifiedRecords: [],
        providerEndpoint: this.primaryEndpointBase,
        providerRawCount: 0,
        errorMessage: `Invalid target date format: "${cleanDate}". Expected YYYY-MM-DD.`,
      };
    }

    let rawGroups: RawThaiStockResultDateGroup[] | null = null;
    let endpointUsed = `${this.primaryEndpointBase}?date=${cleanDate}`;
    let fetchError: string | null = null;

    // 1. Primary Attempt: Official 2D Result endpoint
    try {
      rawGroups = await fetch2DResultByDate(cleanDate);
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }

    // 2. Fallback Attempt: If primary failed, check /live endpoint result array
    if (!rawGroups || rawGroups.length === 0) {
      try {
        const liveRes = await fetch(this.fallbackLiveEndpoint, {
          headers: { 'Accept': 'application/json' },
        });
        if (liveRes.ok) {
          const liveJson = await liveRes.json();
          if (Array.isArray(liveJson.result) && liveJson.result.length > 0) {
            // Verify date matches targetDate
            const sampleDate = liveJson.result[0]?.stock_date || liveJson.live?.date;
            if (sampleDate === cleanDate) {
              rawGroups = [
                {
                  date: cleanDate,
                  child: liveJson.result.map((item: any) => ({
                    time: item.open_time || item.time,
                    set: item.set,
                    value: item.value,
                    twod: item.twod,
                    history_id: item.history_id,
                  })),
                },
              ];
              endpointUsed = this.fallbackLiveEndpoint;
              fetchError = null;
            }
          }
        }
      } catch {
        // Fallback also failed or unavailable
      }
    }

    // 3. Handle total API failure
    if (!rawGroups) {
      return {
        success: false,
        status: 'API_UNAVAILABLE',
        targetDate: cleanDate,
        amResult: null,
        pmResult: null,
        allVerifiedRecords: [],
        providerEndpoint: endpointUsed,
        providerRawCount: 0,
        errorMessage: fetchError || 'Official ThaiStock2D Result API unavailable',
      };
    }

    // 4. Handle non-trading day (empty array)
    if (rawGroups.length === 0 || !rawGroups[0]?.child || rawGroups[0].child.length === 0) {
      return {
        success: true,
        status: 'NON_TRADING_DAY',
        targetDate: cleanDate,
        amResult: null,
        pmResult: null,
        allVerifiedRecords: [],
        providerEndpoint: endpointUsed,
        providerRawCount: 0,
      };
    }

    // 5. Parse and mathematically verify using integrity parser
    const parseResult = parseAndVerify2DResult(rawGroups, cleanDate);

    // 6. Filter strictly for current market date (reject any cross-date contamination)
    const verifiedToday = parseResult.verifiedRecords.filter((r) => r.date === cleanDate);

    // 7. Locate confirmed settlement records
    // AM Settlement: 12:01:00 (or AM settlement flag)
    const amResult = verifiedToday.find(
      (r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement)
    ) || null;

    // PM Settlement: 16:30:00 (or PM settlement flag)
    const pmResult = verifiedToday.find(
      (r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement)
    ) || null;

    // Determine status
    let status: OfficialResultStatus = 'PENDING_CONFIRMATION';
    if (amResult && pmResult) {
      status = 'CONFIRMED';
    } else if (amResult || pmResult) {
      status = 'PARTIALLY_CONFIRMED';
    }

    return {
      success: true,
      status,
      targetDate: cleanDate,
      amResult,
      pmResult,
      allVerifiedRecords: verifiedToday,
      providerEndpoint: endpointUsed,
      providerRawCount: parseResult.rawCount,
      providerTimestamp: (amResult || pmResult)?.verifiedAt,
    };
  }

  /**
   * Syncs official results into local dataset storage for display in the application.
   */
  public async syncOfficialResults(targetDate: string): Promise<OfficialSettlementResultResponse> {
    const result = await this.getOfficialResults(targetDate);
    if (result.success && result.allVerifiedRecords.length > 0) {
      try {
        await globalDatasetStorage.init();
        await globalDatasetStorage.storeVerifiedRecords(result.allVerifiedRecords);
        const allStored = await globalDatasetStorage.queryAllVerifiedRecords();
        globalShadowTracker.syncAndRecordAllSettlements(allStored);
      } catch (err) {
        console.warn('Failed to cache verified official results into storage:', err);
      }
    }
    return result;
  }

  /**
   * Fetches the latest confirmed official results directly from ThaiStock2D /2d_result.
   * - Traverses recent date groups in descending order.
   * - Validates each group via parseAndVerify2DResult.
   * - Identifies confirmed AM 12:01 and PM 16:30 settlement records.
   * - Excludes unconfirmed/non-trading days (where neither AM nor PM is confirmed).
   * - Never fabricates or estimates results.
   * - Synchronizes new verified records into storage.
   * - Falls back cleanly to verified stored records if API is unavailable.
   */
  public async getRecentOfficialResults(limit = 30): Promise<RecentDayResult[]> {
    try {
      const rawGroups = await fetchRecent2DResults();
      if (Array.isArray(rawGroups) && rawGroups.length > 0) {
        const results: RecentDayResult[] = [];
        const recordsToStore: VerifiedMarketRecord[] = [];

        for (const group of rawGroups) {
          if (!group.date || !Array.isArray(group.child) || group.child.length === 0) {
            continue;
          }

          const parseRes = parseAndVerify2DResult([group], group.date);
          const verified = parseRes.verifiedRecords.filter((r) => r.date === group.date);

          const am = verified.find(
            (r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement)
          );
          const pm = verified.find(
            (r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement)
          );

          // Exclude unconfirmed / non-trading days where neither AM nor PM settlement is confirmed
          if (am || pm) {
            results.push({
              date: group.date,
              am,
              pm,
            });
            recordsToStore.push(...verified);

            if (results.length >= limit) {
              break;
            }
          }
        }

        // Backfill older dates using fetch2DResultByDate if results are below limit
        if (results.length < limit && results.length > 0) {
          const sortedLoadedDates = results.map((r) => r.date).sort();
          const earliestDateStr = sortedLoadedDates[0];
          const curDate = new Date(earliestDateStr);
          let consecutiveEmptyDays = 0;
          let lookbackCount = 0;
          const maxLookbackDays = 60;

          while (results.length < limit && consecutiveEmptyDays < 7 && lookbackCount < maxLookbackDays) {
            curDate.setDate(curDate.getDate() - 1);
            lookbackCount++;
            const dow = curDate.getDay();
            if (dow === 0 || dow === 6) {
              // Skip weekends (Saturday and Sunday)
              continue;
            }

            const yyyy = curDate.getFullYear();
            const mm = String(curDate.getMonth() + 1).padStart(2, '0');
            const dd = String(curDate.getDate()).padStart(2, '0');
            const dStr = `${yyyy}-${mm}-${dd}`;

            if (results.some((r) => r.date === dStr)) {
              continue;
            }

            try {
              const olderGroups = await fetch2DResultByDate(dStr);
              if (Array.isArray(olderGroups) && olderGroups.length > 0 && olderGroups[0].child && olderGroups[0].child.length > 0) {
                const parseRes = parseAndVerify2DResult(olderGroups, dStr);
                const verified = parseRes.verifiedRecords.filter((r) => r.date === dStr);
                const am = verified.find(
                  (r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement)
                );
                const pm = verified.find(
                  (r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement)
                );

                if (am || pm) {
                  results.push({
                    date: dStr,
                    am,
                    pm,
                  });
                  recordsToStore.push(...verified);
                  consecutiveEmptyDays = 0;
                } else {
                  consecutiveEmptyDays++;
                }
              } else {
                consecutiveEmptyDays++;
              }
            } catch {
              consecutiveEmptyDays++;
            }
          }

          // Sort in descending order by date (most recent first)
          results.sort((a, b) => b.date.localeCompare(a.date));
        }

        // Cache confirmed verified records into local dataset storage
        if (recordsToStore.length > 0) {
          try {
            await globalDatasetStorage.init();
            await globalDatasetStorage.storeVerifiedRecords(recordsToStore);
            const allStored = await globalDatasetStorage.queryAllVerifiedRecords();
            globalShadowTracker.syncAndRecordAllSettlements(allStored);
          } catch (err) {
            console.warn('Failed to cache verified recent results into storage:', err);
          }
        }

        if (results.length > 0) {
          return results;
        }
      }
    } catch (apiErr) {
      console.warn('Failed to fetch recent official results from API, checking verified storage fallback:', apiErr);
    }

    // Offline / API unavailable fallback: query verified records from storage
    try {
      await globalDatasetStorage.init();
      const allStored = await globalDatasetStorage.queryAllVerifiedRecords();
      const distinctDates = Array.from(new Set(allStored.map((r) => r.date))).sort((a, b) => b.localeCompare(a));
      const fallbackResults: RecentDayResult[] = [];

      for (const date of distinctDates) {
        const dayRecords = allStored.filter((r) => r.date === date);
        const am = dayRecords.find((r) => r.time === '12:01:00' || (r.session === 'AM' && r.isSettlement));
        const pm = dayRecords.find((r) => r.time === '16:30:00' || (r.session === 'PM' && r.isSettlement));

        if (am || pm) {
          fallbackResults.push({ date, am, pm });
          if (fallbackResults.length >= limit) {
            break;
          }
        }
      }

      return fallbackResults;
    } catch (storageErr) {
      console.error('Storage fallback query error for recent official results:', storageErr);
      return [];
    }
  }
}

export const globalOfficialResultAdapter = new OfficialResultAdapter();
