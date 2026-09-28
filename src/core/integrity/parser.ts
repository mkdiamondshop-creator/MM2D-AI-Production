import {
  RawThaiStockResultDateGroup,
  RawThaiStockResultChild,
  VerifiedMarketRecord,
  MarketSession,
  IngestionResult,
} from '../../types/market';

export const LEGACY_CALIBRATION_EPOCH_END = '2023-01-31';

/**
 * Normalizes number string by removing commas and leading/trailing whitespace.
 */
export function normalizeNumericString(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const sanitized = raw.replace(/,/g, '').trim();
  if (sanitized === '' || sanitized === '--') return null;
  const parsed = parseFloat(sanitized);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Maps time slot to AM or PM session.
 * 11:00 and 12:01 (or 12:00) -> AM
 * 15:00 and 16:30 -> PM
 */
export function deriveSessionAndTimeProperties(timeStr: string): {
  session: MarketSession;
  isSettlement: boolean;
  normalizedTime: string;
} | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  
  // Normalize "11:00" to "11:00:00" if needed
  const parts = trimmed.split(':');
  if (parts.length < 2) return null;
  
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  const second = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
  
  const normalizedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

  if (hour === 11 && minute === 0) {
    return { session: 'AM', isSettlement: false, normalizedTime };
  }
  if (hour === 12 && (minute === 0 || minute === 1)) {
    return { session: 'AM', isSettlement: true, normalizedTime };
  }
  if (hour === 15 && minute === 0) {
    return { session: 'PM', isSettlement: false, normalizedTime };
  }
  if (hour === 16 && minute === 30) {
    return { session: 'PM', isSettlement: true, normalizedTime };
  }

  // Fallback based on hour boundaries if minor seconds discrepancy occurs
  if (hour < 13) {
    return { session: 'AM', isSettlement: hour >= 12, normalizedTime };
  } else {
    return { session: 'PM', isSettlement: hour >= 16, normalizedTime };
  }
}

/**
 * Derives mathematical 2D: SET last digit + Value last digit before decimal point.
 * Example:
 * SET: "1,616.80" -> last digit is '0'
 * Value: "31,121.43" -> integer part "31121" -> last digit is '1'
 * Result: "01"
 */
export function computeMathematical2D(setStr: string, valueStr: string): {
  setLastDigit: string;
  valueLastDigitBeforeDecimal: string;
  derived2D: string;
} {
  const cleanSet = setStr.replace(/,/g, '').trim();
  const cleanVal = valueStr.replace(/,/g, '').trim();

  // Extract SET last digit (including after decimal if present)
  // E.g., "1616.80" -> last character is '0'
  const setDigitsOnly = cleanSet.replace(/[^\d]/g, '');
  const setLastDigit = setDigitsOnly.length > 0 ? setDigitsOnly.slice(-1) : '';

  // Extract Value integer part last digit before decimal
  // E.g., "31121.43" -> split on '.' gives "31121" -> last digit is '1'
  const valIntegerPart = cleanVal.split('.')[0].replace(/[^\d]/g, '');
  const valueLastDigitBeforeDecimal = valIntegerPart.length > 0 ? valIntegerPart.slice(-1) : '';

  const derived2D = `${setLastDigit}${valueLastDigitBeforeDecimal}`;
  return { setLastDigit, valueLastDigitBeforeDecimal, derived2D };
}

/**
 * Parses raw ThaiStock2D /2d_result payload, applies strict validation,
 * rejects malformed or legacy test records, and deduplicates using stable keys.
 */
export function parseAndVerify2DResult(
  rawGroups: RawThaiStockResultDateGroup[],
  targetDate?: string
): IngestionResult {
  const verifiedMap = new Map<string, VerifiedMarketRecord>();
  const rejectedRecords: Array<{ reason: string; raw: unknown }> = [];
  let totalRawCount = 0;

  for (const group of rawGroups) {
    const recordDate = (group.date || targetDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) {
      rejectedRecords.push({
        reason: `Invalid group date format: "${group.date}"`,
        raw: group,
      });
      continue;
    }

    if (!Array.isArray(group.child) || group.child.length === 0) {
      rejectedRecords.push({
        reason: `Group for date "${recordDate}" has no child records`,
        raw: group,
      });
      continue;
    }

    const isLegacyEpoch = recordDate <= LEGACY_CALIBRATION_EPOCH_END;

    for (const child of group.child) {
      totalRawCount++;

      // 1. Reject placeholder "--" or empty fields
      const effectiveTime = typeof child.time === 'string' && child.time.trim() !== ''
        ? child.time
        : (typeof (child as Record<string, unknown>).open_time === 'string'
            ? (child as Record<string, unknown>).open_time as string
            : null);

      if (!effectiveTime || !child.set || !child.value || !child.twod) {
        rejectedRecords.push({
          reason: 'Missing required field (time, set, value, or twod)',
          raw: child,
        });
        continue;
      }

      if (child.set === '--' || child.value === '--' || child.twod === '--') {
        rejectedRecords.push({
          reason: 'Pending/unsettled placeholder values ("--")',
          raw: child,
        });
        continue;
      }

      // 2. Reject null or empty history_id (Note: "0" is allowed in legacy epoch)
      const historyIdStr = child.history_id !== null && child.history_id !== undefined ? String(child.history_id).trim() : '';
      if (historyIdStr === '') {
        rejectedRecords.push({
          reason: 'Null or missing history_id',
          raw: child,
        });
        continue;
      }

      // 3. Parse numbers safely
      const setNumeric = normalizeNumericString(child.set);
      const valueNumeric = normalizeNumericString(child.value);

      if (setNumeric === null || valueNumeric === null) {
        rejectedRecords.push({
          reason: `Malformed numeric strings: set="${child.set}", value="${child.value}"`,
          raw: child,
        });
        continue;
      }

      // 4. Epoch-aware numeric range check
      if (isLegacyEpoch) {
        // In legacy calibration epoch (<= 2023-01-31):
        // Upstream ThaiStock2D preserved genuine official winning 2D draws,
        // but SET was recorded as 1.00 and Value as nominal numbers.
        // We ensure numbers are valid non-negative values.
        if (setNumeric < 0 || valueNumeric < 0) {
          rejectedRecords.push({
            reason: `Invalid negative numeric values in legacy epoch: set=${setNumeric}, value=${valueNumeric}`,
            raw: child,
          });
          continue;
        }
      } else {
        // In modern live market epoch (>= 2023-02-02):
        // Strictly require authentic live SET index (>= 100.0) and trading volume (>= 100.0).
        if (setNumeric < 100.0 || valueNumeric < 100.0) {
          rejectedRecords.push({
            reason: `Rejected placeholder test values in modern epoch: set=${setNumeric}, value=${valueNumeric}`,
            raw: child,
          });
          continue;
        }
      }

      // 5. Validate 2D format (must be 2 digits)
      const twodClean = child.twod.trim();
      if (!/^\d{2}$/.test(twodClean)) {
        rejectedRecords.push({
          reason: `Invalid 2D format: "${child.twod}". Must be exactly 2 digits.`,
          raw: child,
        });
        continue;
      }

      // 6. Derive session and normalized time
      const sessionInfo = deriveSessionAndTimeProperties(effectiveTime);
      if (!sessionInfo) {
        rejectedRecords.push({
          reason: `Unable to derive session from time: "${effectiveTime}"`,
          raw: child,
        });
        continue;
      }

      // 7. Compute mathematical check and provenance
      const math = computeMathematical2D(child.set, child.value);
      // In legacy epoch, SET/Value were not preserved by upstream, so do NOT claim mathematical consistency.
      const isConsistent = isLegacyEpoch ? false : math.derived2D === twodClean;
      const provenance = isLegacyEpoch ? 'LEGACY_2D_CALIBRATION_EPOCH' : 'OFFICIAL_SET_MARKET_LIVE';
      const discrepancyDetails = isLegacyEpoch ? 'LEGACY_2D_CALIBRATION_EPOCH' : (isConsistent ? null : 'Discrepancy detected');

      // 8. Construct unique stable deduplication key
      // Stable composite key: ${date}_${normalizedTime}_${historyId}
      const uniqueKey = `${recordDate}_${sessionInfo.normalizedTime}_${historyIdStr}`;

      const verifiedRecord: VerifiedMarketRecord = {
        id: uniqueKey,
        date: recordDate,
        time: sessionInfo.normalizedTime,
        session: sessionInfo.session,
        isSettlement: sessionInfo.isSettlement,
        setRaw: child.set.trim(),
        valueRaw: child.value.trim(),
        setNumeric,
        valueNumeric,
        twod: twodClean,
        historyId: historyIdStr,
        verifiedAt: new Date().toISOString(),
        provenance,
        discrepancyDetails,
        mathematicalCheck: {
          setLastDigit: math.setLastDigit,
          valueLastDigitBeforeDecimal: math.valueLastDigitBeforeDecimal,
          derived2D: math.derived2D,
          isMathematicallyConsistent: isConsistent,
        },
      };

      // Prevent duplicate insertion
      if (!verifiedMap.has(uniqueKey)) {
        verifiedMap.set(uniqueKey, verifiedRecord);
      }
    }
  }

  const verifiedList = Array.from(verifiedMap.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });

  return {
    dateQueried: targetDate || (rawGroups[0]?.date ?? 'UNKNOWN'),
    rawCount: totalRawCount,
    verifiedCount: verifiedList.length,
    rejectedCount: rejectedRecords.length,
    verifiedRecords: verifiedList,
    rejectedRecords,
  };
}
