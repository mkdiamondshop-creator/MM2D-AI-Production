import { RawThaiStockResultDateGroup } from '../../types/market';

export const THAISTOCK_BASE_URL = 'https://api.thaistock2d.com';

/**
 * Validates that an item conforms to RawThaiStockResultDateGroup structure.
 * The wire validator determines general object structure and accepts nullable upstream fields.
 * Domain/mathematical validity is strictly handled by parseAndVerify2DResult().
 */
export function isValidThaiStockDateGroup(item: unknown): item is RawThaiStockResultDateGroup {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.date !== 'string') return false;
  if (obj.child !== undefined) {
    if (!Array.isArray(obj.child)) return false;
    for (const c of obj.child) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
      const childObj = c as Record<string, unknown>;
      if (childObj.time !== undefined && childObj.time !== null && typeof childObj.time !== 'string') {
        return false;
      }
      if (childObj.set !== undefined && childObj.set !== null && typeof childObj.set !== 'string') {
        return false;
      }
      if (childObj.value !== undefined && childObj.value !== null && typeof childObj.value !== 'string') {
        return false;
      }
      if (childObj.twod !== undefined && childObj.twod !== null && typeof childObj.twod !== 'string') {
        return false;
      }
      if (
        childObj.history_id !== undefined &&
        childObj.history_id !== null &&
        typeof childObj.history_id !== 'string' &&
        typeof childObj.history_id !== 'number'
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Validates that the parsed data is an array of valid ThaiStock2dDateGroup objects.
 * An empty array [] is valid (representing weekends or market holidays).
 */
export function validateThaiStockResponse(data: unknown): data is RawThaiStockResultDateGroup[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;
  return data.every(isValidThaiStockDateGroup);
}

/**
 * Parses and validates raw ThaiStock2D response text body.
 * Robust against PHP runtime notices, SafeMySQL error strings, and malformed HTML.
 */
export function parseThaiStockRawText(responseText: string): RawThaiStockResultDateGroup[] {
  const trimmed = (responseText || '').trim();

  // 1. Direct check for empty array or blank string
  if (trimmed === '' || trimmed === '[]') {
    return [];
  }

  // 2. Direct parse attempt for clean JSON responses
  try {
    const directParsed = JSON.parse(trimmed);
    if (validateThaiStockResponse(directParsed)) {
      return directParsed;
    }
    throw new Error('ThaiStock2D API returned unexpected structure or invalid schema');
  } catch (directErr) {
    // If direct parse failed due to schema invalidity (already valid JSON), propagate error
    if (directErr instanceof Error && directErr.message.includes('unexpected structure')) {
      throw directErr;
    }
    // Otherwise direct JSON.parse failed syntax check; proceed to inspect body
  }

  // 3. Detect unrecoverable upstream PHP/database diagnostic errors
  const isUpstreamDiagnostic = /^\d+,\s*|SafeMySQL|Fatal error|Uncaught Exception|Warning:|Notice:|number_format/i.test(trimmed);

  // 4. Fallback: Check if valid JSON array of objects is embedded after legacy warning/notice text
  const match = trimmed.match(/\[\s*\{.*\}\s*\]/s);
  if (match) {
    try {
      const candidateParsed = JSON.parse(match[0]);
      if (Array.isArray(candidateParsed) && candidateParsed.length > 0 && validateThaiStockResponse(candidateParsed)) {
        return candidateParsed;
      }
    } catch {
      // Candidate parsing failed
    }
  }

  // 5. If upstream diagnostic was detected and no valid candidate was recovered, throw clear upstream server error
  if (isUpstreamDiagnostic) {
    const snippet = trimmed.length > 200 ? `${trimmed.substring(0, 200)}...` : trimmed;
    throw new Error(`ThaiStock2D upstream server error (PHP/SafeMySQL diagnostic output): ${snippet}`);
  }

  const snippet = trimmed.length > 150 ? `${trimmed.substring(0, 150)}...` : trimmed;
  throw new Error(`Failed to parse ThaiStock2D API JSON response: ${snippet}`);
}

/**
 * Real API client for ThaiStock2D /2d_result endpoint.
 * Robust against PHP runtime notices, SafeMySQL error strings, and malformed HTML.
 * No mock data, no synthetic responses.
 */
export async function fetch2DResultByDate(date: string): Promise<RawThaiStockResultDateGroup[]> {
  const trimmedDate = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new Error(`Invalid date format: "${date}". Expected format: YYYY-MM-DD`);
  }

  const endpoint = `${THAISTOCK_BASE_URL}/2d_result?date=${encodeURIComponent(trimmedDate)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ThaiStock2D API responded with HTTP status ${response.status}: ${response.statusText}`);
  }

  const responseText = await response.text();
  return parseThaiStockRawText(responseText);
}

/**
 * Real API client for ThaiStock2D /2d_result endpoint to fetch latest recent confirmed results.
 * When called without a date parameter, ThaiStock2D returns recent date groups in descending order.
 */
export async function fetchRecent2DResults(): Promise<RawThaiStockResultDateGroup[]> {
  const endpoint = `${THAISTOCK_BASE_URL}/2d_result`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ThaiStock2D API responded with HTTP status ${response.status}: ${response.statusText}`);
  }

  const responseText = await response.text();
  return parseThaiStockRawText(responseText);
}

