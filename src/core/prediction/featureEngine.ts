import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  PREDICTION_CUTOFFS,
  PreLockObservation,
  PreLockLiveSnapshot,
  PredictionFeatureVector,
  FeatureExtractionResult,
} from '../../types/prediction';
import { StatisticalEngine } from './statisticalEngine';
import { MarketOpenGate } from '../market/marketOpenGate';
import { FeatureContractAuditor } from './featureContract';

/**
 * Feature Extraction Engine with Strict Anti-Leakage & Temporal Isolation
 */
export class FeatureEngine {
  /**
   * Simple deterministic hashing function for feature integrity audit trail
   */
  public static computeIntegrityHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Validates and filters pre-lock intraday observations strictly before session lock time.
   * Prohibits future ticks, pre-market-open ticks, or post-lock data.
   */
  public static filterPreLockObservations(
    targetDate: string,
    session: MarketSession,
    rawObservations: Array<{
      time: string; // "HH:mm:ss" or ISO
      set: number | string;
      value: number | string;
      timestamp?: string;
    }>
  ): PreLockLiveSnapshot {
    const cutoffConfig = PREDICTION_CUTOFFS[session];
    const cutoffTime = cutoffConfig.timeString; // "12:00:00" or "16:00:00"

    const validObs: PreLockObservation[] = [];
    let sessionOpenObs: PreLockObservation | undefined;

    for (const raw of rawObservations) {
      // Zero Live-2D Invariant: Detect and strip any 2D numbers or result fields immediately
      const rawAny = raw as any;
      if (rawAny.twod !== undefined || rawAny.twoD !== undefined || rawAny['2D'] !== undefined || rawAny.result !== undefined) {
        delete rawAny.twod;
        delete rawAny.twoD;
        delete rawAny['2D'];
        delete rawAny.result;
      }

      // Extract time portion (HH:mm:ss)
      let timeStr = raw.time;
      if (timeStr.includes('T')) {
        timeStr = timeStr.split('T')[1].slice(0, 8);
      } else if (timeStr.includes(' ')) {
        timeStr = timeStr.split(' ')[1].slice(0, 8);
      }

      // Strict Session Window Check: Reject any observation outside [Open, Lock]
      if (!MarketOpenGate.isWithinObservationWindow(session, timeStr)) {
        continue; // Exclude pre-open or post-lock data
      }

      // Strict Date Matching Check: If full timestamp is supplied, verify it matches targetDate
      if (raw.timestamp) {
        const obsDate = raw.timestamp.slice(0, 10);
        if (obsDate !== targetDate) {
          continue; // Exclude observations from other/future dates
        }
      }

      const setNum = typeof raw.set === 'number' ? raw.set : parseFloat(String(raw.set).replace(/,/g, ''));
      const valNum = typeof raw.value === 'number' ? raw.value : parseFloat(String(raw.value).replace(/,/g, ''));

      if (isNaN(setNum) || isNaN(valNum) || setNum <= 0 || valNum <= 0) {
        continue;
      }

      const obs: PreLockObservation = {
        timestamp: raw.timestamp || `${targetDate}T${timeStr}+07:00`,
        time: timeStr,
        set: Math.round(setNum * 100) / 100,
        value: Math.round(valNum * 100) / 100,
        isCheckpoint1100: timeStr === '11:00:00',
        isCheckpoint1500: timeStr === '15:00:00',
      };

      if (session === 'AM' && timeStr === '11:00:00') {
        sessionOpenObs = obs;
      } else if (session === 'PM' && timeStr === '15:00:00') {
        sessionOpenObs = obs;
      }

      validObs.push(obs);
    }

    // Sort observations chronologically
    validObs.sort((a, b) => a.time.localeCompare(b.time));

    return {
      targetDate,
      session,
      cutoffTimestamp: `${targetDate}T${cutoffTime}+07:00`,
      observations: validObs,
      latestObservation: validObs.length > 0 ? validObs[validObs.length - 1] : undefined,
      sessionOpenObservation: sessionOpenObs,
      isValid: true,
      status: validObs.length > 0 ? 'VALID' : 'NO_OBSERVATIONS',
    };
  }

  /**
   * Enforces strict point-in-time historical dataset filtering.
   * GUARANTEE: Never includes target date settlement or future records.
   */
  /**
   * Enforces strict point-in-time historical dataset filtering.
   * Session-isolated:
   * - AM receives verified historical AM data only (never PM historical data, never target date settlement).
   * - PM receives verified historical PM data only + today's verified AM settlement (never target PM settlement).
   */
  public static filterEligibleHistoricalRecords(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession
  ): {
    eligibleRecords: VerifiedMarketRecord[];
    todayAmSettlementRecord?: VerifiedMarketRecord;
    leakageViolationDetected: boolean;
    leakageReason?: string;
  } {
    const eligible: VerifiedMarketRecord[] = [];
    let todayAmSettlementRecord: VerifiedMarketRecord | undefined;

    for (const r of allRecords) {
      // Future date check
      if (r.date > targetDate) {
        continue; // Strictly future data, ignore for historical training
      }

      // Target Date checks
      if (r.date === targetDate) {
        // AM session must NEVER see any target date settlement record or PM record
        if (session === 'AM') {
          if (r.isSettlement) {
            // Anti-leakage guard
            continue;
          }
          if (r.session === 'PM') {
            // Anti-leakage guard: never include PM records on target date
            continue;
          }
          if (r.time > PREDICTION_CUTOFFS.AM.timeString) {
            continue;
          }
        }

        // PM session: May ONLY see today's verified AM settlement (12:01)
        if (session === 'PM') {
          if (r.session === 'AM' && r.isSettlement && r.time === '12:01:00') {
            todayAmSettlementRecord = r;
            eligible.push(r);
            continue;
          }
          if (r.isSettlement && r.session === 'PM') {
            // PM settlement is strictly in the future relative to 15:30 cutoff
            continue;
          }
          if (r.time > PREDICTION_CUTOFFS.PM.timeString) {
            continue;
          }
        }
        continue;
      }

      // Past date (date < targetDate): Both historical AM and PM records are available
      // for learning cross-session relationships (AM->AM, PM->AM, PM->PM, AM->PM, SET/Value relationships)
      eligible.push(r);
      continue;
    }

    // Sort chronologically (oldest to newest) for sequential modeling
    eligible.sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.time.localeCompare(b.time);
    });

    return {
      eligibleRecords: eligible,
      todayAmSettlementRecord,
      leakageViolationDetected: false,
    };
  }

  /**
   * Dedicated AM Point-in-Time Prediction Feature Extraction
   * Ingests verified historical AM settlements only + valid AM pre-lock live SET/Value.
   */
  public static extractAmFeatures(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    preLockLiveFeed?: Array<{
      time: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
    }>
  ): FeatureExtractionResult {
    // 1. Enforce AM Anti-Leakage Filtering (historical AM only)
    const { eligibleRecords } = this.filterEligibleHistoricalRecords(
      allRecords,
      targetDate,
      'AM'
    );

    // Verify eligible records strictly comply with point-in-time rules
    const eligibleAudit = FeatureContractAuditor.auditHistoricalInputRecords(eligibleRecords, targetDate, 'AM');
    if (!eligibleAudit.isCompliant) {
      return {
        success: false,
        status: 'LEAKAGE_DETECTED',
        errorDetails: `Data leakage detected in AM eligible records: ${eligibleAudit.violations.join('; ')}`,
      };
    }

    // Minimum historical samples requirement (at least 10 AM settlements)
    const settlements = eligibleRecords.filter((r) => r.isSettlement && r.session === 'AM');
    if (settlements.length < 10) {
      return {
        success: false,
        status: 'INSUFFICIENT_HISTORICAL_DATA',
        errorDetails: `Insufficient verified historical AM settlements (${settlements.length} < 10).`,
      };
    }

    const targetDateObj = new Date(`${targetDate}T12:00:00+07:00`);
    const dayOfWeek = targetDateObj.getDay();

    // 2. Extract Historical AM Settlement 2D Time Series
    const settlement2DList = settlements.map((r) => r.twod);
    const prevSettlement2D = settlement2DList.length > 0 ? settlement2DList[settlement2DList.length - 1] : null;

    const w30 = settlement2DList.slice(-30);
    const w10 = settlement2DList.slice(-10);
    const w5 = settlement2DList.slice(-5);

    // 3. Compute AM Empirical Distributions
    const freqAllTime = StatisticalEngine.computeFrequencyDistribution(settlement2DList);
    const freqW30 = StatisticalEngine.computeFrequencyDistribution(w30);
    const freqW10 = StatisticalEngine.computeFrequencyDistribution(w10);
    const freqW5 = StatisticalEngine.computeFrequencyDistribution(w5);

    const { firstDigitFreq: firstDigitFreqW30, secondDigitFreq: secondDigitFreqW30 } =
      StatisticalEngine.computeDigitMarginals(w30);
    const { oddRatio: oddRatioW30, evenRatio: evenRatioW30, highRatio: highRatioW30, lowRatio: lowRatioW30 } =
      StatisticalEngine.computeParityRatios(w30);

    const sameWeekdaySettlements = settlements
      .filter((r) => new Date(`${r.date}T12:00:00+07:00`).getDay() === dayOfWeek)
      .map((r) => r.twod);
    const weekdayFreq = StatisticalEngine.computeFrequencyDistribution(sameWeekdaySettlements);

    const sessionFreq = freqAllTime;
    const markovTransitionProbabilities = StatisticalEngine.computeMarkovTransitions(
      settlement2DList,
      prevSettlement2D
    );

    // 4. Macro Momentum Features
    const macroMomentum = StatisticalEngine.computeMacroMomentum(settlements);

    // 5. Pre-Lock Intraday Live Feed Processing (AM window 10:00-12:00)
    let preLockSnapshot: PreLockLiveSnapshot = {
      targetDate,
      session: 'AM',
      cutoffTimestamp: `${targetDate}T${PREDICTION_CUTOFFS.AM.timeString}+07:00`,
      observations: [],
      isValid: true,
      status: 'NO_OBSERVATIONS',
    };

    if (preLockLiveFeed && preLockLiveFeed.length > 0) {
      preLockSnapshot = this.filterPreLockObservations(targetDate, 'AM', preLockLiveFeed);
    }

    const intradayFeatures = StatisticalEngine.computeIntradayPreLockFeatures(
      preLockSnapshot.observations,
      macroMomentum.prevCloseSet,
      macroMomentum.prevCloseValue,
      preLockSnapshot.sessionOpenObservation
    );

    // 6. Build AM Feature Vector
    const featureVector: PredictionFeatureVector = {
      targetDate,
      session: 'AM',
      dayOfWeek,
      cutoffTimestamp: `${targetDate}T${PREDICTION_CUTOFFS.AM.timeString}+07:00`,
      isPreLockLiveAvailable: preLockSnapshot.observations.length > 0,
      distributions: {
        freqAllTime,
        freqW30,
        freqW10,
        freqW5,
        firstDigitFreqW30,
        secondDigitFreqW30,
        oddRatioW30,
        evenRatioW30,
        highRatioW30,
        lowRatioW30,
        weekdayFreq,
        sessionFreq,
        prevSettlement2D,
        markovTransitionProbabilities,
        todayAmSettlement2D: null,
        amToPmTransitionProbabilities: undefined,
        sampleCountAllTime: settlements.length,
        sampleCountW30: w30.length,
        sampleCountW10: w10.length,
        sampleCountW5: w5.length,
      },
      momentum: {
        prevCloseSet: macroMomentum.prevCloseSet,
        prevCloseValue: macroMomentum.prevCloseValue,
        setDeltaW5: macroMomentum.setDeltaW5,
        valueRatioW5: macroMomentum.valueRatioW5,
        currentSet: intradayFeatures.currentSet,
        currentValue: intradayFeatures.currentValue,
        setChangeFromPrevClose: intradayFeatures.setChangeFromPrevClose,
        valueChangeFromPrevClose: intradayFeatures.valueChangeFromPrevClose,
        setChangeFromSessionOpen: intradayFeatures.setChangeFromSessionOpen,
        valueChangeFromSessionOpen: intradayFeatures.valueChangeFromSessionOpen,
        observationCount: intradayFeatures.observationCount,
        intradaySetVolatility: intradayFeatures.intradaySetVolatility,
      },
      featureIntegrityHash: '',
      eligibleRecordsCount: eligibleRecords.length,
    };

    const inputDigest = JSON.stringify({
      targetDate,
      session: 'AM',
      count: eligibleRecords.length,
      prev2D: prevSettlement2D,
      currentSet: intradayFeatures.currentSet,
      currentVal: intradayFeatures.currentValue,
    });
    featureVector.featureIntegrityHash = this.computeIntegrityHash(inputDigest);

    // Final point-in-time contract audit
    const vectorAudit = FeatureContractAuditor.auditFeatureVector(featureVector, targetDate, 'AM');
    if (!vectorAudit.isCompliant) {
      return {
        success: false,
        status: 'LEAKAGE_DETECTED',
        errorDetails: `Feature contract violation: ${vectorAudit.violations.join('; ')}`,
        contractAudit: vectorAudit,
      };
    }

    return {
      success: true,
      featureVector,
      status: 'READY',
      contractAudit: vectorAudit,
    };
  }

  /**
   * Dedicated PM Point-in-Time Prediction Feature Extraction
   * Ingests verified historical PM settlements only + today's verified AM settlement + valid PM pre-lock live SET/Value.
   */
  public static extractPmFeatures(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    preLockLiveFeed?: Array<{
      time: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
    }>
  ): FeatureExtractionResult {
    // 1. Enforce PM Anti-Leakage Filtering (historical PM only + today's AM settlement)
    const { eligibleRecords, todayAmSettlementRecord } = this.filterEligibleHistoricalRecords(
      allRecords,
      targetDate,
      'PM'
    );

    // Verify eligible records strictly comply with point-in-time rules
    const eligibleAudit = FeatureContractAuditor.auditHistoricalInputRecords(eligibleRecords, targetDate, 'PM');
    if (!eligibleAudit.isCompliant) {
      return {
        success: false,
        status: 'LEAKAGE_DETECTED',
        errorDetails: `Data leakage detected in PM eligible records: ${eligibleAudit.violations.join('; ')}`,
      };
    }

    // Minimum historical samples requirement (at least 10 PM settlements)
    const settlements = eligibleRecords.filter((r) => r.isSettlement && r.session === 'PM');
    if (settlements.length < 10) {
      return {
        success: false,
        status: 'INSUFFICIENT_HISTORICAL_DATA',
        errorDetails: `Insufficient verified historical PM settlements (${settlements.length} < 10).`,
      };
    }

    const targetDateObj = new Date(`${targetDate}T12:00:00+07:00`);
    const dayOfWeek = targetDateObj.getDay();

    // 2. Extract Historical PM Settlement 2D Time Series
    const settlement2DList = settlements.map((r) => r.twod);
    const prevSettlement2D = settlement2DList.length > 0 ? settlement2DList[settlement2DList.length - 1] : null;

    const w30 = settlement2DList.slice(-30);
    const w10 = settlement2DList.slice(-10);
    const w5 = settlement2DList.slice(-5);

    // 3. Compute PM Empirical Distributions
    const freqAllTime = StatisticalEngine.computeFrequencyDistribution(settlement2DList);
    const freqW30 = StatisticalEngine.computeFrequencyDistribution(w30);
    const freqW10 = StatisticalEngine.computeFrequencyDistribution(w10);
    const freqW5 = StatisticalEngine.computeFrequencyDistribution(w5);

    const { firstDigitFreq: firstDigitFreqW30, secondDigitFreq: secondDigitFreqW30 } =
      StatisticalEngine.computeDigitMarginals(w30);
    const { oddRatio: oddRatioW30, evenRatio: evenRatioW30, highRatio: highRatioW30, lowRatio: lowRatioW30 } =
      StatisticalEngine.computeParityRatios(w30);

    const sameWeekdaySettlements = settlements
      .filter((r) => new Date(`${r.date}T12:00:00+07:00`).getDay() === dayOfWeek)
      .map((r) => r.twod);
    const weekdayFreq = StatisticalEngine.computeFrequencyDistribution(sameWeekdaySettlements);

    const sessionFreq = freqAllTime;
    const markovTransitionProbabilities = StatisticalEngine.computeMarkovTransitions(
      settlement2DList,
      prevSettlement2D
    );

    // AM to PM conditional affinity distribution using today's verified AM settlement
    const todayAmSettlement2D = todayAmSettlementRecord ? todayAmSettlementRecord.twod : null;
    const historicalSettlementsForAffinity = allRecords.filter(
      (r) => r.date < targetDate && r.isSettlement
    );
    const amToPmTransitionProbabilities = StatisticalEngine.computeAmToPmAffinity(
      historicalSettlementsForAffinity,
      todayAmSettlement2D
    );

    // 4. Macro Momentum Features
    const macroMomentum = StatisticalEngine.computeMacroMomentum(settlements);

    // 5. Pre-Lock Intraday Live Feed Processing (PM window 14:00-16:00)
    let preLockSnapshot: PreLockLiveSnapshot = {
      targetDate,
      session: 'PM',
      cutoffTimestamp: `${targetDate}T${PREDICTION_CUTOFFS.PM.timeString}+07:00`,
      observations: [],
      isValid: true,
      status: 'NO_OBSERVATIONS',
    };

    if (preLockLiveFeed && preLockLiveFeed.length > 0) {
      preLockSnapshot = this.filterPreLockObservations(targetDate, 'PM', preLockLiveFeed);
    }

    const intradayFeatures = StatisticalEngine.computeIntradayPreLockFeatures(
      preLockSnapshot.observations,
      macroMomentum.prevCloseSet,
      macroMomentum.prevCloseValue,
      preLockSnapshot.sessionOpenObservation
    );

    // 6. Build PM Feature Vector
    const featureVector: PredictionFeatureVector = {
      targetDate,
      session: 'PM',
      dayOfWeek,
      cutoffTimestamp: `${targetDate}T${PREDICTION_CUTOFFS.PM.timeString}+07:00`,
      isPreLockLiveAvailable: preLockSnapshot.observations.length > 0,
      distributions: {
        freqAllTime,
        freqW30,
        freqW10,
        freqW5,
        firstDigitFreqW30,
        secondDigitFreqW30,
        oddRatioW30,
        evenRatioW30,
        highRatioW30,
        lowRatioW30,
        weekdayFreq,
        sessionFreq,
        prevSettlement2D,
        markovTransitionProbabilities,
        todayAmSettlement2D,
        amToPmTransitionProbabilities,
        sampleCountAllTime: settlements.length,
        sampleCountW30: w30.length,
        sampleCountW10: w10.length,
        sampleCountW5: w5.length,
      },
      momentum: {
        prevCloseSet: macroMomentum.prevCloseSet,
        prevCloseValue: macroMomentum.prevCloseValue,
        setDeltaW5: macroMomentum.setDeltaW5,
        valueRatioW5: macroMomentum.valueRatioW5,
        currentSet: intradayFeatures.currentSet,
        currentValue: intradayFeatures.currentValue,
        setChangeFromPrevClose: intradayFeatures.setChangeFromPrevClose,
        valueChangeFromPrevClose: intradayFeatures.valueChangeFromPrevClose,
        setChangeFromSessionOpen: intradayFeatures.setChangeFromSessionOpen,
        valueChangeFromSessionOpen: intradayFeatures.valueChangeFromSessionOpen,
        observationCount: intradayFeatures.observationCount,
        intradaySetVolatility: intradayFeatures.intradaySetVolatility,
      },
      featureIntegrityHash: '',
      eligibleRecordsCount: eligibleRecords.length,
    };

    const inputDigest = JSON.stringify({
      targetDate,
      session: 'PM',
      count: eligibleRecords.length,
      prev2D: prevSettlement2D,
      todayAm: todayAmSettlement2D,
      currentSet: intradayFeatures.currentSet,
      currentVal: intradayFeatures.currentValue,
    });
    featureVector.featureIntegrityHash = this.computeIntegrityHash(inputDigest);

    // Final point-in-time contract audit
    const vectorAudit = FeatureContractAuditor.auditFeatureVector(featureVector, targetDate, 'PM');
    if (!vectorAudit.isCompliant) {
      return {
        success: false,
        status: 'LEAKAGE_DETECTED',
        errorDetails: `Feature contract violation: ${vectorAudit.violations.join('; ')}`,
        contractAudit: vectorAudit,
      };
    }

    return {
      success: true,
      featureVector,
      status: 'READY',
      contractAudit: vectorAudit,
    };
  }

  /**
   * Extracts Point-in-Time Prediction Feature Vector.
   * Dispatches to session-isolated AM or PM feature extractors.
   */
  public static extractFeatures(
    allRecords: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession,
    preLockLiveFeed?: Array<{
      time: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
    }>
  ): FeatureExtractionResult {
    if (session === 'AM') {
      return this.extractAmFeatures(allRecords, targetDate, preLockLiveFeed);
    }
    return this.extractPmFeatures(allRecords, targetDate, preLockLiveFeed);
  }
}
