import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import { D1StorageAdapter, D1V2PredictionRecord, D1V2PredictionInput, v2PredictionRecordToShadowRecord } from '../storage/d1StorageAdapter';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { TimezoneContract } from '../market/timezoneUtils';

export interface CoordinatorSessionOptions {
  targetDate?: string;
  session?: MarketSession;
  simulatedClock?: Date | string;
  forceLock?: boolean;
  overrideMarketGate?: boolean;
}

export interface ServerSidePredictionResult {
  success: boolean;
  date: string;
  session: MarketSession;
  status:
    | 'MARKET_NOT_OPEN'
    | 'AWAITING_DATA'
    | 'EARLY_PREDICTION'
    | 'REFINING'
    | 'PREDICTION_LOCKED'
    | 'OFFICIAL_RESULT_AVAILABLE'
    | 'ALREADY_FROZEN'
    | 'ERROR';
  message?: string;
  isFrozen: boolean;
  frozenAt?: string | null;
  top1?: string;
  top5?: readonly string[];
  top10?: readonly string[];
  liveObservationsCount: number;
  integrityHash?: string;
  settlementComparison?: unknown | null;
  prediction?: D1V2PredictionRecord | null;
}

/**
 * Server-Side V2 Prediction Coordinator (Step 56)
 *
 * Autonomously manages the production prediction lifecycle inside Cloudflare Worker:
 * 1. Reads stored live SET + Value observations from D1 (Zero Live 2D).
 * 2. Reads verified historical records strictly with anti-leakage isolation.
 *    - AM: Historical data before today, strictly excluding today's AM settlement.
 *    - PM: Historical data before today + today's verified AM settlement (for cross-session learning),
 *          strictly excluding today's target PM settlement.
 * 3. Coordinates AUTO_WEIGHTED_V2 engine:
 *    - Early Prediction (first live tick)
 *    - Refining (subsequent pre-lock ticks)
 *    - Final Lock at AM 11:30 MMT (12:00:00 BKK) / PM 15:30 MMT (16:00:00 BKK)
 * 4. Freezes distribution, Top1, Top5, Top10, engine weights, live observation snapshot, and integrity hash.
 * 5. Strictly guarantees immutability: locked predictions are NEVER recalculated or altered by new ticks.
 * 6. Official settlement evaluation uses ONLY the frozen snapshot.
 */
export class ServerSideV2Coordinator {
  /**
   * Executes prediction cycle for a specific session (AM or PM).
   */
  public static async coordinateSession(
    d1: D1StorageAdapter,
    session: MarketSession,
    options?: CoordinatorSessionOptions
  ): Promise<ServerSidePredictionResult> {
    const clockInput = options?.simulatedClock || new Date();
    const nowBkk = TimezoneContract.toBangkok(clockInput);
    const targetDate = options?.targetDate || nowBkk.dateStr;
    const currentTime = nowBkk.timeStr;

    const openTime = session === 'AM' ? '10:00:00' : '14:00:00';
    const cutoffTime = session === 'AM' ? '12:00:00' : '16:00:00';

    try {
      // 1. Check if prediction is already stored in D1
      const existing = await d1.getV2Prediction(targetDate, session);

      // Check if official settlement record exists in D1
      const settlements = await d1.queryVerifiedRecords({ date: targetDate, session, limit: 10 });
      const officialSettlement = settlements.find((r) => Boolean(r.isSettlement) && r.twod && r.twod.length === 2);

      // If existing prediction is already frozen
      if (existing && existing.isFrozen === 1) {
        // If settlement record arrived and comparison has not yet been computed:
        if (officialSettlement && !existing.settlementComparisonJson) {
          const shadowRecord = v2PredictionRecordToShadowRecord(existing);
          const evaluated = AutoWeightedV2ShadowValidator.evaluateSettlement(
            shadowRecord,
            settlements
          );

          await d1.storeV2Prediction({
            date: targetDate,
            session,
            status: 'OFFICIAL_RESULT_AVAILABLE',
            isFrozen: true,
            frozenAt: existing.frozenAt,
            top1: existing.top1,
            top5: JSON.parse(existing.top5Json),
            top10: JSON.parse(existing.top10Json),
            candidates: JSON.parse(existing.candidatesJson),
            probabilities: JSON.parse(existing.probabilitiesJson),
            engineWeights: JSON.parse(existing.engineWeightsJson),
            observedSet: existing.observedSet,
            observedValue: existing.observedValue,
            liveObservationsCount: existing.liveObservationsCount,
            liveSnapshot: JSON.parse(existing.liveSnapshotJson),
            integrityHash: existing.integrityHash,
            settlementComparison: evaluated.settlementComparison,
          });

          const updated = await d1.getV2Prediction(targetDate, session);
          return {
            success: true,
            date: targetDate,
            session,
            status: 'OFFICIAL_RESULT_AVAILABLE',
            message: `Official settlement verified for ${session} (${officialSettlement.twod}) using frozen snapshot`,
            isFrozen: true,
            frozenAt: existing.frozenAt,
            top1: existing.top1,
            top5: JSON.parse(existing.top5Json),
            top10: JSON.parse(existing.top10Json),
            liveObservationsCount: existing.liveObservationsCount,
            integrityHash: existing.integrityHash,
            settlementComparison: evaluated.settlementComparison,
            prediction: updated,
          };
        }

        // Return already frozen prediction. Never recalculate!
        return {
          success: true,
          date: targetDate,
          session,
          status: existing.settlementComparisonJson ? 'OFFICIAL_RESULT_AVAILABLE' : 'ALREADY_FROZEN',
          message: `Prediction for ${targetDate} ${session} is frozen at lock; recalculation prevented`,
          isFrozen: true,
          frozenAt: existing.frozenAt,
          top1: existing.top1,
          top5: JSON.parse(existing.top5Json),
          top10: JSON.parse(existing.top10Json),
          liveObservationsCount: existing.liveObservationsCount,
          integrityHash: existing.integrityHash,
          settlementComparison: existing.settlementComparisonJson ? JSON.parse(existing.settlementComparisonJson) : null,
          prediction: existing,
        };
      }

      // 2. Market Open Gate: Do not predict before session market open unless overridden
      const isBeforeOpen = nowBkk.dateStr === targetDate && currentTime < openTime;
      if (isBeforeOpen && !options?.overrideMarketGate && !options?.forceLock) {
        return {
          success: false,
          date: targetDate,
          session,
          status: 'MARKET_NOT_OPEN',
          message: `Bangkok time ${currentTime} is before ${session} market open (${openTime})`,
          isFrozen: false,
          liveObservationsCount: 0,
        };
      }

      // 3. Query stored live observations from D1 (Zero Live 2D)
      const observations = await d1.queryLiveObservations({ date: targetDate, session });
      if (!observations || observations.length === 0) {
        return {
          success: false,
          date: targetDate,
          session,
          status: 'AWAITING_DATA',
          message: `No stored live observations in D1 for ${targetDate} ${session}`,
          isFrozen: false,
          liveObservationsCount: 0,
        };
      }

      // 4. Filter live observations strictly pre-lock (<= cutoffTime)
      const isPastCutoff =
        nowBkk.dateStr > targetDate ||
        (nowBkk.dateStr === targetDate && currentTime >= cutoffTime) ||
        Boolean(options?.forceLock);

      const validObservations = isPastCutoff
        ? observations.filter((o) => o.time <= cutoffTime)
        : observations;

      if (validObservations.length === 0) {
        return {
          success: false,
          date: targetDate,
          session,
          status: 'AWAITING_DATA',
          message: `No pre-lock observations found before ${cutoffTime}`,
          isFrozen: false,
          liveObservationsCount: 0,
        };
      }

      const feedArray = validObservations.map((o) => ({
        time: o.time,
        set: o.set,
        value: o.value,
        timestamp: o.timestamp,
      }));

      // 5. Query historical verified market records for learning
      const allHistorical = await d1.queryVerifiedRecords({ limit: 2000 });

      // Strict Anti-Leakage Filtering:
      // AM: only records strictly before targetDate (or pre-open records from targetDate < 10:00). Zero AM settlement!
      // PM: records before targetDate + verified same-day AM settlement. Zero PM settlement!
      const eligibleHistorical: VerifiedMarketRecord[] = allHistorical.filter((r) => {
        if (r.date < targetDate) return true;
        if (r.date === targetDate) {
          if (session === 'AM') {
            // Strictly exclude today's settlement for AM
            return r.time < '10:00:00' && !r.isSettlement;
          } else {
            // For PM: Allow verified same-day AM settlement for cross-session learning
            return r.session === 'AM' && Boolean(r.isSettlement);
          }
        }
        return false;
      });

      // 6. Generate V2 Shadow Prediction using Point-in-Time Shadow Validator
      const clockDate = options?.simulatedClock
        ? new Date(options.simulatedClock)
        : isPastCutoff
        ? new Date(`${targetDate}T${cutoffTime}+07:00`)
        : new Date();

      const shadowRecord = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
        eligibleHistorical,
        targetDate,
        session,
        feedArray,
        clockDate
      );

      // Determine Lock State
      const isLocked = isPastCutoff || shadowRecord.isFrozenAtLock;
      const status: ServerSidePredictionResult['status'] = isLocked
        ? 'PREDICTION_LOCKED'
        : feedArray.length <= 1
        ? 'EARLY_PREDICTION'
        : 'REFINING';

      const frozenAt = isLocked ? shadowRecord.frozenAtTimestamp || `${targetDate}T${cutoffTime}+07:00` : null;

      // Check if official settlement already exists in D1 and evaluate if locking
      let settlementComparison = null;
      let finalStatus: ServerSidePredictionResult['status'] = status;
      if (isLocked && officialSettlement) {
        const evaluated = AutoWeightedV2ShadowValidator.evaluateSettlement(
          shadowRecord,
          settlements
        );
        settlementComparison = evaluated.settlementComparison;
        finalStatus = 'OFFICIAL_RESULT_AVAILABLE';
      }

      // 7. Persist to D1
      const predictionInput: D1V2PredictionInput = {
        date: targetDate,
        session,
        status: finalStatus,
        isFrozen: isLocked,
        frozenAt,
        top1: shadowRecord.top1,
        top5: shadowRecord.top5,
        top10: shadowRecord.top10,
        candidates: shadowRecord.immutableV2Output?.candidates || [],
        probabilities: shadowRecord.immutableV2Output?.probabilities || [],
        engineWeights: shadowRecord.engineWeights as Record<string, number>,
        observedSet: shadowRecord.observedPreLockSet,
        observedValue: shadowRecord.observedPreLockValue,
        liveObservationsCount: feedArray.length,
        liveSnapshot: feedArray,
        integrityHash: shadowRecord.integrityHash,
        settlementComparison,
      };

      await d1.storeV2Prediction(predictionInput);
      const saved = await d1.getV2Prediction(targetDate, session);

      return {
        success: true,
        date: targetDate,
        session,
        status: finalStatus,
        message: isLocked
          ? `Prediction frozen at lock (${finalStatus})`
          : `Prediction updated with ${feedArray.length} live ticks (${finalStatus})`,
        isFrozen: isLocked,
        frozenAt,
        top1: shadowRecord.top1,
        top5: shadowRecord.top5,
        top10: shadowRecord.top10,
        liveObservationsCount: feedArray.length,
        integrityHash: shadowRecord.integrityHash,
        settlementComparison,
        prediction: saved,
      };
    } catch (err) {
      return {
        success: false,
        date: targetDate,
        session,
        status: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
        isFrozen: false,
        liveObservationsCount: 0,
      };
    }
  }

  /**
   * Runs the coordinator across active sessions for the current day.
   */
  public static async coordinateActiveCycle(
    d1: D1StorageAdapter,
    options?: CoordinatorSessionOptions
  ): Promise<{
    date: string;
    amResult?: ServerSidePredictionResult;
    pmResult?: ServerSidePredictionResult;
  }> {
    const clockInput = options?.simulatedClock || new Date();
    const nowBkk = TimezoneContract.toBangkok(clockInput);
    const targetDate = options?.targetDate || nowBkk.dateStr;
    const time = nowBkk.timeStr;

    // If session is explicitly forced in options, coordinate only that session
    if (options?.session) {
      const res = await this.coordinateSession(d1, options.session, options);
      return {
        date: targetDate,
        amResult: options.session === 'AM' ? res : undefined,
        pmResult: options.session === 'PM' ? res : undefined,
      };
    }

    let amResult: ServerSidePredictionResult | undefined;
    let pmResult: ServerSidePredictionResult | undefined;

    // AM Window & Post-AM settlement check (10:00 - 13:00)
    if (time >= '10:00:00' || options?.overrideMarketGate) {
      amResult = await this.coordinateSession(d1, 'AM', options);
    }

    // PM Window (13:30 - 17:00)
    if (time >= '13:30:00' || options?.overrideMarketGate) {
      pmResult = await this.coordinateSession(d1, 'PM', options);
    }

    return { date: targetDate, amResult, pmResult };
  }
}
