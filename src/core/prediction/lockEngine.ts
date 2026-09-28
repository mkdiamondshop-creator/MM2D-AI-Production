import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  PREDICTION_CUTOFFS,
  PredictionFeatureVector,
  SessionPredictionOutput,
  FrozenPredictionSnapshot,
  StoredModelPrediction,
  PRODUCTION_MODEL_VERSION,
  PredictionModelVersion,
  PredictionStatus,
} from '../../types/prediction';
import { FeatureEngine } from './featureEngine';
import { PredictionEngine } from './predictionEngine';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { MarketCalendar } from '../market/marketCalendar';
import { MarketOpenGate } from '../market/marketOpenGate';
import { TimezoneContract } from '../market/timezoneUtils';

/**
 * Bangkok Timezone-Aware Prediction Lock & Snapshot Engine
 * 
 * Invariant Guarantees:
 * - Lock Times: AM = 12:00:00 Bangkok Time (11:30:00 Yangon MMT), PM = 16:00:00 Bangkok Time (15:30:00 Yangon MMT)
 * - Immutability: Once Bangkok time >= cutoff, the prediction snapshot is frozen permanently.
 * - Post-lock live updates or settlements NEVER mutate a locked prediction.
 * - Separation: Official results and statistical model predictions are stored in separate logical records.
 * - Trading-Day Gate: Never generates predictions on Saturday, Sunday, or official holidays.
 */
export class LockEngine {
  private static frozenSnapshots: Map<string, FrozenPredictionSnapshot> = new Map();
  private static publishedSnapshots: Map<string, SessionPredictionOutput> = new Map();
  private static persistenceHandler?: (pred: StoredModelPrediction) => void;

  public static setPersistenceHandler(handler: (pred: StoredModelPrediction) => void): void {
    this.persistenceHandler = handler;
  }

  /**
   * Generates a unique key for a date-session snapshot and model version
   */
  public static getSnapshotKey(
    targetDate: string,
    session: MarketSession,
    modelVersion: string = PRODUCTION_MODEL_VERSION
  ): string {
    return `${targetDate}_${session}_${modelVersion}`;
  }

  /**
   * Gets the current Bangkok time components (Hours, Minutes, Seconds)
   */
  public static getBangkokTime(customDate?: Date | string | number): {
    dateStr: string;
    timeStr: string;
    totalMinutes: number;
    totalSeconds: number;
    hours: number;
    minutes: number;
    seconds: number;
  } {
    const bkk = TimezoneContract.toBangkok(customDate);
    return {
      dateStr: bkk.dateStr,
      timeStr: bkk.timeStr,
      totalMinutes: bkk.totalMinutes,
      totalSeconds: bkk.totalSeconds,
      hours: bkk.hours,
      minutes: bkk.minutes,
      seconds: bkk.seconds,
    };
  }

  /**
   * Evaluates if a given date & session is currently locked in Bangkok time.
   * Compares at second-level precision:
   * AM Lock: 12:00:00 Bangkok (11:30:00 Yangon)
   * PM Lock: 16:00:00 Bangkok (15:30:00 Yangon)
   */
  public static isSessionLocked(
    targetDate: string,
    session: MarketSession,
    currentBangkokTime?: Date | string | number
  ): boolean {
    const bkk = this.getBangkokTime(currentBangkokTime);

    // If targetDate is strictly in the past, it is locked
    if (targetDate < bkk.dateStr) {
      return true;
    }

    // If targetDate is in the future, it is not locked
    if (targetDate > bkk.dateStr) {
      return false;
    }

    // Today's session: Check exact cutoff seconds
    const cutoff = PREDICTION_CUTOFFS[session];
    const cutoffSeconds = cutoff.hour * 3600 + cutoff.minute * 60; // AM: 12*3600=43200, PM: 16*3600=57600

    return bkk.totalSeconds >= cutoffSeconds;
  }

  /**
   * Retrieves or computes a locked prediction snapshot.
   * If the session is locked, retrieves the immutable frozen snapshot or freezes it atomically.
   */
  public static getOrFreezePrediction(
    allHistoricalRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    preLockLiveFeed?: Array<{ time: string; set: number | string; value: number | string; timestamp?: string }>,
    currentBangkokTime?: Date,
    modelVersion: PredictionModelVersion = PRODUCTION_MODEL_VERSION
  ): {
    output: SessionPredictionOutput;
    isLocked: boolean;
    isFreshlyLocked: boolean;
    snapshot?: FrozenPredictionSnapshot;
  } {
    const key = this.getSnapshotKey(targetDate, session, modelVersion);
    const locked = this.isSessionLocked(targetDate, session, currentBangkokTime);
    const bkk = this.getBangkokTime(currentBangkokTime);

    // 1. Trading-Day Gate: Block prediction calculation on weekends & official holidays
    const tradingDayEval = MarketCalendar.isTradingDay(targetDate, allHistoricalRecords, bkk.dateStr);
    if (!tradingDayEval.isTradingDay) {
      const nonTradingOutput: SessionPredictionOutput = {
        recordType: 'MODEL_PREDICTION',
        modelVersion,
        targetDate,
        session,
        generatedAt: new Date().toISOString(),
        cutoffTime: `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`,
        isFrozen: false,
        status: 'NON_TRADING_DAY',
        candidates: [],
        top1: '--',
        top3: [],
        top5: [],
        top10: [],
        entropy: 0,
        topMargin: 0,
        confidenceScore: 0,
        featureIntegrityHash: 'NON_TRADING_DAY',
      };

      return {
        output: nonTradingOutput,
        isLocked: false,
        isFreshlyLocked: false,
      };
    }

    // 2. If snapshot already frozen in memory, return immutable cached output
    const existing = this.frozenSnapshots.get(key);
    if (existing) {
      return {
        output: existing.predictionOutput,
        isLocked: true,
        isFreshlyLocked: false,
        snapshot: existing,
      };
    }

    // 3. Extract Point-in-Time Features with Strict Anti-Leakage (Check Historical Data Sufficiency)
    const extractResult = FeatureEngine.extractFeatures(
      allHistoricalRecords,
      targetDate,
      session,
      preLockLiveFeed
    );

    if (!extractResult.success || !extractResult.featureVector) {
      let status: PredictionStatus = 'INSUFFICIENT_HISTORICAL_DATA';
      if (extractResult.status === 'MARKET_CLOSED') {
        status = 'MARKET_CLOSED';
      }

      const fallbackOutput: SessionPredictionOutput = {
        recordType: 'MODEL_PREDICTION',
        modelVersion,
        targetDate,
        session,
        generatedAt: new Date().toISOString(),
        cutoffTime: `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`,
        isFrozen: locked,
        status,
        candidates: [],
        top1: '--',
        top3: [],
        top5: [],
        top10: [],
        entropy: 0,
        topMargin: 0,
        confidenceScore: 0,
        featureIntegrityHash: 'NONE',
      };

      return {
        output: fallbackOutput,
        isLocked: locked,
        isFreshlyLocked: false,
      };
    }

    // 4. Active / Pre-Lock Session Gates (AUTHORITATIVE STEP 14 RULE)
    // Rule 1: Historical Dataset alone is NOT sufficient to display a new user-facing prediction.
    // Rule 2: During an active session, prediction number must remain hidden until VALID CURRENT LIVE SET + VALUE is received.
    // Rule 5 & 6: AM before 10:00 BKK and PM before 14:00 BKK must be MARKET_NOT_OPEN with "--".
    if (!locked) {
      const isSessionOpen = targetDate < bkk.dateStr || (targetDate === bkk.dateStr && MarketOpenGate.isMarketOpen(session, currentBangkokTime));
      if (!isSessionOpen) {
        const notOpenOutput: SessionPredictionOutput = {
          recordType: 'MODEL_PREDICTION',
          modelVersion,
          targetDate,
          session,
          generatedAt: new Date().toISOString(),
          cutoffTime: `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`,
          isFrozen: false,
          status: 'MARKET_NOT_OPEN',
          candidates: [],
          top1: '--',
          top3: [],
          top5: [],
          top10: [],
          entropy: 0,
          topMargin: 0,
          confidenceScore: 0,
          featureIntegrityHash: 'MARKET_NOT_OPEN',
        };

        return {
          output: notOpenOutput,
          isLocked: false,
          isFreshlyLocked: false,
        };
      }

      // Session is open, but pre-lock: Verify valid live SET + Value observation
      const validLiveSnapshot = preLockLiveFeed && preLockLiveFeed.length > 0
        ? FeatureEngine.filterPreLockObservations(targetDate, session, preLockLiveFeed)
        : undefined;

      const hasValidLive = Boolean(validLiveSnapshot && validLiveSnapshot.observations.length > 0);

      if (!hasValidLive) {
        const waitingOutput: SessionPredictionOutput = {
          recordType: 'MODEL_PREDICTION',
          modelVersion,
          targetDate,
          session,
          generatedAt: new Date().toISOString(),
          cutoffTime: `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`,
          isFrozen: false,
          status: 'WAITING_FOR_LIVE_DATA',
          candidates: [],
          top1: '--',
          top3: [],
          top5: [],
          top10: [],
          entropy: 0,
          topMargin: 0,
          confidenceScore: 0,
          featureIntegrityHash: 'WAITING_FOR_LIVE_DATA',
        };

        return {
          output: waitingOutput,
          isLocked: false,
          isFreshlyLocked: false,
        };
      }

      // Valid live SET + Value exists!
      // STEP 15 RULE: Stable Prediction Display & Publish Delay Gate
      // AM: 09:30-11:25 Myanmar (10:00-11:55 Bangkok) => keep prediction number hidden ("--"), status: ANALYZING_LIVE_DATA
      // PM: 13:30-15:25 Myanmar (14:00-15:55 Bangkok) => keep prediction number hidden ("--"), status: ANALYZING_LIVE_DATA
      const cutoff = PREDICTION_CUTOFFS[session];
      const publishSeconds = cutoff.publishHour * 3600 + cutoff.publishMinute * 60;
      const isBeforePublish = targetDate === bkk.dateStr && bkk.totalSeconds < publishSeconds;

      if (isBeforePublish) {
        const analyzingOutput: SessionPredictionOutput = {
          recordType: 'MODEL_PREDICTION',
          modelVersion,
          targetDate,
          session,
          generatedAt: new Date().toISOString(),
          cutoffTime: `${targetDate}T${cutoff.timeString}+07:00`,
          isFrozen: false,
          status: 'ANALYZING_LIVE_DATA',
          candidates: [],
          top1: '--',
          top3: [],
          top5: [],
          top10: [],
          entropy: 0,
          topMargin: 0,
          confidenceScore: 0,
          featureIntegrityHash: 'ANALYZING_LIVE_DATA',
        };

        return {
          output: analyzingOutput,
          isLocked: false,
          isFreshlyLocked: false,
        };
      }
    }

    // 5. Stable Prediction Snapshot Generation (STEP 15 RULE):
    // At 11:25 Myanmar (11:55 Bangkok) / 15:25 Myanmar (15:55 Bangkok), compute and publish once.
    // Between publish time and lock time, the displayed prediction MUST NOT change (single stable snapshot).
    let predictionOutput: SessionPredictionOutput;
    const existingPublished = this.publishedSnapshots.get(key);

    if (existingPublished) {
      predictionOutput = existingPublished;
    } else {
      if (modelVersion === 'AUTO_WEIGHTED_V2') {
        const v2Out = AutoWeightedV2Engine.predict(allHistoricalRecords, targetDate, session, preLockLiveFeed);
        predictionOutput = {
          recordType: 'MODEL_PREDICTION',
          modelVersion: 'AUTO_WEIGHTED_V2',
          targetDate,
          session,
          generatedAt: new Date().toISOString(),
          cutoffTime: `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`,
          isFrozen: locked,
          status: locked ? 'PREDICTION_LOCKED' : 'PREDICTION_READY',
          candidates: v2Out.candidates,
          top1: v2Out.top1,
          top3: v2Out.candidates.slice(0, 3).map((c) => c.twod),
          top5: v2Out.top5,
          top10: v2Out.top10,
          entropy: v2Out.entropy,
          topMargin: v2Out.topMargin,
          confidenceScore: v2Out.confidenceScore,
          featureIntegrityHash: v2Out.inputIntegrityHash,
        };
      } else {
        predictionOutput = session === 'AM'
          ? PredictionEngine.generateAmPrediction(extractResult.featureVector, modelVersion)
          : PredictionEngine.generatePmPrediction(extractResult.featureVector, modelVersion);
      }
      predictionOutput.isFrozen = locked;
      predictionOutput.status = locked ? 'PREDICTION_LOCKED' : 'PREDICTION_READY';
      this.publishedSnapshots.set(key, predictionOutput);
    }

    // 6. If session is locked, freeze snapshot permanently into immutable storage
    let freshlyLocked = false;
    let snapshot: FrozenPredictionSnapshot | undefined;

    if (locked) {
      snapshot = {
        targetDate,
        session,
        modelVersion,
        cutoffTimestamp: extractResult.featureVector.cutoffTimestamp,
        frozenAt: new Date().toISOString(),
        featureVector: extractResult.featureVector,
        predictionOutput: { ...predictionOutput, isFrozen: true, status: 'PREDICTION_LOCKED' },
        featureIntegrityHash: extractResult.featureVector.featureIntegrityHash,
        isLocked: true,
      };

      this.frozenSnapshots.set(key, snapshot);
      freshlyLocked = true;

      // Asynchronously persist to isolated model prediction store (fire-and-forget safe)
      const storedPred: StoredModelPrediction = {
        id: `pred_${targetDate}_${session}_${modelVersion}`,
        recordType: 'MODEL_PREDICTION',
        targetDate,
        session,
        modelVersion,
        status: 'PREDICTION_LOCKED',
        top1: snapshot.predictionOutput.top1,
        top3Json: JSON.stringify(snapshot.predictionOutput.top3),
        top5Json: JSON.stringify(snapshot.predictionOutput.top5),
        top10Json: JSON.stringify(snapshot.predictionOutput.top10),
        candidatesJson: JSON.stringify(snapshot.predictionOutput.candidates),
        entropy: snapshot.predictionOutput.entropy,
        topMargin: snapshot.predictionOutput.topMargin,
        confidenceScore: snapshot.predictionOutput.confidenceScore,
        featureIntegrityHash: snapshot.predictionOutput.featureIntegrityHash,
        cutoffTime: snapshot.predictionOutput.cutoffTime,
        generatedAt: snapshot.predictionOutput.generatedAt,
        isFrozen: 1,
        frozenAt: snapshot.frozenAt,
        preLockSourceUsed: snapshot.predictionOutput.preLockSourceUsed,
      };

      if (this.persistenceHandler) {
        try {
          this.persistenceHandler(storedPred);
        } catch (err) {
          console.warn('Could not persist frozen model prediction to storage:', err);
        }
      }
    }

    return {
      output: snapshot ? snapshot.predictionOutput : predictionOutput,
      isLocked: locked,
      isFreshlyLocked: freshlyLocked,
      snapshot,
    };
  }

  /**
   * Resets cached memory snapshots (Used exclusively in test suites)
   */
  public static clearFrozenSnapshotsForTesting(): void {
    this.frozenSnapshots.clear();
    this.publishedSnapshots.clear();
  }

  /**
   * Diagnostic inspector for active frozen snapshots
   */
  public static getFrozenSnapshotsCount(): number {
    return this.frozenSnapshots.size;
  }
}

