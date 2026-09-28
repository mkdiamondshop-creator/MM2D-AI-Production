export type MarketSession = 'AM' | 'PM';

export interface RawThaiStockResultChild {
  time?: string | null;
  set?: string | null;
  value?: string | null;
  twod?: string | null;
  history_id?: string | number | null;
}

export interface RawThaiStockResultDateGroup {
  date: string;
  child?: RawThaiStockResultChild[];
}

export interface VerifiedMarketRecord {
  id: string; // Unique deduplication key: e.g. "2026-08-20_12:01:00_2756641"
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm:ss"
  session: MarketSession; // 'AM' (11:00, 12:01) or 'PM' (15:00, 16:30)
  isSettlement: boolean; // true for 12:01:00 (AM settlement) and 16:30:00 (PM settlement)
  setRaw: string; // "1,616.80"
  valueRaw: string; // "31,121.43"
  setNumeric: number; // 1616.8
  valueNumeric: number; // 31121.43
  twod: string; // "01"
  historyId: string; // "2756225"
  verifiedAt: string; // ISO string
  provenance?: string; // e.g. 'LEGACY_2D_CALIBRATION_EPOCH' or 'OFFICIAL_SET_MARKET_LIVE'
  discrepancyDetails?: string | null;
  mathematicalCheck: {
    setLastDigit: string;
    valueLastDigitBeforeDecimal: string;
    derived2D: string;
    isMathematicallyConsistent: boolean;
  };
}

export interface IngestionResult {
  dateQueried: string;
  rawCount: number;
  verifiedCount: number;
  rejectedCount: number;
  verifiedRecords: VerifiedMarketRecord[];
  rejectedRecords: Array<{
    reason: string;
    raw: unknown;
  }>;
}
