import { VerifiedMarketRecord, MarketSession } from '../../types/market';

export type HistoricalResolutionClassification =
  | 'CANONICAL_CHECKPOINT_AVAILABLE'
  | 'SETTLEMENT_AVAILABLE'
  | 'UNTESTABLE_MISSING_HISTORICAL_RESOLUTION';

export interface ResolutionAuditResult {
  targetDate: string;
  session: MarketSession;
  requestedTime: string;
  classification: HistoricalResolutionClassification;
  exactRecordFound: boolean;
  interpolatedRecordSynthesized: false; // Invariant: Zero interpolation guarantee
  record?: VerifiedMarketRecord;
}

/**
 * Historical Resolution Auditor
 * Enforces zero-fabrication and zero-interpolation on historical datasets.
 * Explicitly flags missing intraday tick intervals as UNTESTABLE_MISSING_HISTORICAL_RESOLUTION.
 */
export class HistoricalResolutionAuditor {
  /**
   * Known canonical daily checkpoints in historical archive:
   * 11:00 AM Bangkok — Morning session open checkpoint
   * 12:01 PM Bangkok — Morning session official settlement
   * 15:00 PM Bangkok — Afternoon session open checkpoint
   * 16:30 PM Bangkok — Afternoon session official settlement
   */
  public static readonly CANONICAL_CHECKPOINTS = ['11:00:00', '12:01:00', '15:00:00', '16:30:00'] as const;

  /**
   * Audits if an exact historical timestamp exists in the verified dataset.
   * NEVER synthesizes, interpolates, or creates proxy ticks.
   */
  public static auditTimestampResolution(
    records: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    requestedTime: string
  ): ResolutionAuditResult {
    const cleanTime = requestedTime.length === 5 ? `${requestedTime}:00` : requestedTime;
    
    // Exact match search
    const matched = records.find(
      (r) => r.date === targetDate && r.session === session && (r.time === cleanTime || r.time === requestedTime)
    );

    if (matched) {
      const isSettlement = matched.isSettlement || matched.time === '12:01:00' || matched.time === '16:30:00';
      return {
        targetDate,
        session,
        requestedTime: cleanTime,
        classification: isSettlement ? 'SETTLEMENT_AVAILABLE' : 'CANONICAL_CHECKPOINT_AVAILABLE',
        exactRecordFound: true,
        interpolatedRecordSynthesized: false,
        record: matched,
      };
    }

    // Explicitly classify missing intermediate ticks as UNTESTABLE_MISSING_HISTORICAL_RESOLUTION
    return {
      targetDate,
      session,
      requestedTime: cleanTime,
      classification: 'UNTESTABLE_MISSING_HISTORICAL_RESOLUTION',
      exactRecordFound: false,
      interpolatedRecordSynthesized: false,
    };
  }
}
