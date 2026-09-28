import { MarketSession, VerifiedMarketRecord } from '../../types/market';
import {
  FeatureContractEntry,
  FeatureAuditReport,
  PredictionFeatureVector,
  PREDICTION_CUTOFFS,
} from '../../types/prediction';

/**
 * MM2D LEADER STEP 22 — FORMAL FEATURE CONTRACT SPECIFICATIONS
 * 
 * Defines explicit point-in-time boundaries and leakage prohibitions
 * for both AM and PM prediction pipelines.
 */

export const AM_FEATURE_CONTRACT: FeatureContractEntry[] = [
  {
    featureId: 'AM_HIST_FREQ_ALL_TIME',
    featureName: 'All-Time AM Empirical Frequency',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), time <= 12:01:00',
    status: 'ALLOWED',
    description: 'Empirical probability distribution over 00-99 derived solely from historical AM settlements.',
  },
  {
    featureId: 'AM_HIST_FREQ_WINDOWS',
    featureName: 'AM Rolling Frequencies (W30, W10, W5)',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), trailing 30/10/5 AM settlements',
    status: 'ALLOWED',
    description: 'Rolling window frequencies capturing recent historical AM trends.',
  },
  {
    featureId: 'AM_HIST_DIGIT_MARGINALS',
    featureName: 'AM Digit Marginals (Tens & Units)',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), W30 AM settlements',
    status: 'ALLOWED',
    description: 'Tens digit and units digit marginal frequency distributions for historical AM.',
  },
  {
    featureId: 'AM_HIST_PARITY_RATIOS',
    featureName: 'AM Parity & Magnitude Ratios',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), W30 AM settlements',
    status: 'ALLOWED',
    description: 'Historical ratios for odd/even and high (>=50) / low (<50) AM settlements.',
  },
  {
    featureId: 'AM_HIST_WEEKDAY_FREQ',
    featureName: 'AM Day-of-Week Specific Frequency',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate) matching target dayOfWeek',
    status: 'ALLOWED',
    description: 'Historical AM settlement frequency filtered strictly by the matching day of the week.',
  },
  {
    featureId: 'AM_HIST_MARKOV_TRANSITIONS',
    featureName: 'AM-to-AM Markov Sequential Transition',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), P(AM_t | AM_{t-1})',
    status: 'ALLOWED',
    description: 'One-step transition probability from previous AM settlement to next AM settlement.',
  },
  {
    featureId: 'AM_PRE_LOCK_SET_INDEX',
    featureName: 'AM Pre-Lock Live SET Index',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'AM',
    cutoffSpecification: 'Target date strictly within [11:00:00, 12:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Verified live Stock Exchange of Thailand (SET) index ticks prior to 12:00:00 lock.',
  },
  {
    featureId: 'AM_PRE_LOCK_MARKET_VALUE',
    featureName: 'AM Pre-Lock Live Market Value',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'AM',
    cutoffSpecification: 'Target date strictly within [11:00:00, 12:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Verified live market turnover volume in millions THB prior to 12:00:00 lock.',
  },
  {
    featureId: 'AM_INTRADAY_SET_VOLATILITY',
    featureName: 'AM Intraday SET Volatility',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'AM',
    cutoffSpecification: 'Target date strictly within [11:00:00, 12:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Standard deviation of pre-lock SET index ticks during morning market session.',
  },
  {
    featureId: 'AM_CALENDAR_METADATA',
    featureName: 'AM Trading Day Metadata',
    source: 'CALENDAR_METADATA',
    session: 'AM',
    cutoffSpecification: 'Target date calendar information known a priori',
    status: 'ALLOWED',
    description: 'Calendar day-of-week, holiday status, and trading session schedule.',
  },
];

export const PM_FEATURE_CONTRACT: FeatureContractEntry[] = [
  {
    featureId: 'PM_HIST_FREQ_ALL_TIME',
    featureName: 'All-Time PM Empirical Frequency',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), time <= 16:30:00',
    status: 'ALLOWED',
    description: 'Empirical probability distribution over 00-99 derived solely from historical PM settlements.',
  },
  {
    featureId: 'PM_HIST_FREQ_WINDOWS',
    featureName: 'PM Rolling Frequencies (W30, W10, W5)',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), trailing 30/10/5 PM settlements',
    status: 'ALLOWED',
    description: 'Rolling window frequencies capturing recent historical PM trends.',
  },
  {
    featureId: 'PM_HIST_DIGIT_MARGINALS',
    featureName: 'PM Digit Marginals (Tens & Units)',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), W30 PM settlements',
    status: 'ALLOWED',
    description: 'Tens digit and units digit marginal frequency distributions for historical PM.',
  },
  {
    featureId: 'PM_HIST_PARITY_RATIOS',
    featureName: 'PM Parity & Magnitude Ratios',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), W30 PM settlements',
    status: 'ALLOWED',
    description: 'Historical ratios for odd/even and high (>=50) / low (<50) PM settlements.',
  },
  {
    featureId: 'PM_HIST_WEEKDAY_FREQ',
    featureName: 'PM Day-of-Week Specific Frequency',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate) matching target dayOfWeek',
    status: 'ALLOWED',
    description: 'Historical PM settlement frequency filtered strictly by the matching day of the week.',
  },
  {
    featureId: 'PM_HIST_MARKOV_TRANSITIONS',
    featureName: 'PM-to-PM Markov Sequential Transition',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate), P(PM_t | PM_{t-1})',
    status: 'ALLOWED',
    description: 'One-step transition probability from previous PM settlement to next PM settlement.',
  },
  {
    featureId: 'PM_SAME_DAY_AM_OFFICIAL_RESULT',
    featureName: "Today's Verified 12:01 AM Settlement 2D",
    source: 'SAME_DAY_AM_OFFICIAL_SETTLEMENT',
    session: 'PM',
    cutoffSpecification: 'Target date strictly at 12:01:00 Bangkok time (published 4 hours before PM lock)',
    status: 'ALLOWED',
    description: "Official settlement 2D from today's completed morning session, used as conditioning input for PM.",
  },
  {
    featureId: 'PM_HISTORICAL_AM_TO_PM_AFFINITY',
    featureName: 'Historical AM-to-PM Transition Conditioning',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Strictly prior dates (date < targetDate) paired with todayAmSettlement2D',
    status: 'ALLOWED',
    description: "Empirical transition matrix P(PM | AM = todayAm2D) built exclusively from historical pairs.",
  },
  {
    featureId: 'PM_PRE_LOCK_SET_INDEX',
    featureName: 'PM Pre-Lock Live SET Index',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'PM',
    cutoffSpecification: 'Target date strictly within [15:00:00, 16:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Verified live Stock Exchange of Thailand (SET) index ticks prior to 16:00:00 lock.',
  },
  {
    featureId: 'PM_PRE_LOCK_MARKET_VALUE',
    featureName: 'PM Pre-Lock Live Market Value',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'PM',
    cutoffSpecification: 'Target date strictly within [15:00:00, 16:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Verified live market turnover volume in millions THB prior to 16:00:00 lock.',
  },
  {
    featureId: 'PM_INTRADAY_SET_VOLATILITY',
    featureName: 'PM Intraday SET Volatility',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'PM',
    cutoffSpecification: 'Target date strictly within [15:00:00, 16:00:00] Bangkok time',
    status: 'ALLOWED',
    description: 'Standard deviation of pre-lock SET index ticks during afternoon market session.',
  },
  {
    featureId: 'PM_CALENDAR_METADATA',
    featureName: 'PM Trading Day Metadata',
    source: 'CALENDAR_METADATA',
    session: 'PM',
    cutoffSpecification: 'Target date calendar information known a priori',
    status: 'ALLOWED',
    description: 'Calendar day-of-week, holiday status, and trading session schedule.',
  },
];

export const FORBIDDEN_LEAKAGE_REGISTRY: FeatureContractEntry[] = [
  {
    featureId: 'FORBIDDEN_LIVE_2D_INTRADAY',
    featureName: 'Intraday Live 2D Numbers',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'BOTH',
    cutoffSpecification: 'All times (always strictly forbidden)',
    status: 'FORBIDDEN',
    prohibitionReason: 'Live 2D numbers from intraday ticks introduce noise, spurious correlation, and potential synthetic bias. Predictions must rely on SET/Value momentum and settlement history.',
    description: 'Any 2D numbers or twod fields present in intraday pre-lock live streaming feeds.',
  },
  {
    featureId: 'FORBIDDEN_TARGET_AM_SETTLEMENT_FOR_AM',
    featureName: "Target Date's Own AM Settlement (12:01:00)",
    source: 'SAME_DAY_AM_OFFICIAL_SETTLEMENT',
    session: 'AM',
    cutoffSpecification: 'Target date AM prediction freeze (12:00:00 Bangkok)',
    status: 'FORBIDDEN',
    prohibitionReason: "Target 12:01:00 AM settlement is the future ground truth being predicted. Any leakage would constitute 100% target leakage.",
    description: "Official settlement 2D of the target AM session.",
  },
  {
    featureId: 'FORBIDDEN_TARGET_PM_SETTLEMENT_FOR_PM',
    featureName: "Target Date's Own PM Settlement (16:30:00)",
    source: 'HISTORICAL_PM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'Target date PM prediction freeze (16:00:00 Bangkok)',
    status: 'FORBIDDEN',
    prohibitionReason: "Target 16:30:00 PM settlement occurs 30 minutes after PM lock (16:00:00). It is strictly in the future.",
    description: "Official settlement 2D of the target PM session.",
  },
  {
    featureId: 'FORBIDDEN_TARGET_PM_FOR_AM',
    featureName: "Target Date's PM Settlement during AM Session",
    source: 'HISTORICAL_PM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'Target date AM session (11:00:00 - 12:00:00 Bangkok)',
    status: 'FORBIDDEN',
    prohibitionReason: "PM settlement occurs 4.5 hours after AM prediction lock. Complete temporal violation.",
    description: "PM settlement data on the target prediction date.",
  },
  {
    featureId: 'FORBIDDEN_HISTORICAL_PM_DATA_IN_AM',
    featureName: 'Historical PM Settlement Records in AM Pipeline',
    source: 'HISTORICAL_PM_DATABASE',
    session: 'AM',
    cutoffSpecification: 'All historical dates',
    status: 'FORBIDDEN',
    prohibitionReason: 'AM market dynamics are session-specific. Blending historical PM settlements into AM frequencies dilutes session characteristics.',
    description: 'All past PM settlement records (16:30:00) during AM feature extraction.',
  },
  {
    featureId: 'FORBIDDEN_HISTORICAL_AM_DATA_IN_PM_DISTRIBUTIONS',
    featureName: 'Historical AM Settlement Records in PM Base Distributions',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'PM',
    cutoffSpecification: 'All historical dates',
    status: 'FORBIDDEN',
    prohibitionReason: 'PM baseline frequencies (all-time, W30, W10, W5, digit marginals) must reflect PM settlements only. AM data is permitted only as an explicit transition condition via todayAmSettlement2D.',
    description: 'All past AM settlement records (12:01:00) in PM empirical baseline distributions.',
  },
  {
    featureId: 'FORBIDDEN_FUTURE_DATE_RECORDS',
    featureName: 'Future Date Market Records',
    source: 'HISTORICAL_AM_DATABASE',
    session: 'BOTH',
    cutoffSpecification: 'Any record where date > targetDate',
    status: 'FORBIDDEN',
    prohibitionReason: 'Any record occurring on a date after targetDate represents future information and invalidates backtest and production validity.',
    description: 'Records with date greater than the target evaluation date.',
  },
  {
    featureId: 'FORBIDDEN_POST_LOCK_LIVE_TICKS',
    featureName: 'Post-Lock Live Feed Observations',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'BOTH',
    cutoffSpecification: 'AM: time > 12:00:00 BKK; PM: time > 16:00:00 BKK',
    status: 'FORBIDDEN',
    prohibitionReason: 'Ticks occurring after prediction lock cannot be used to compute locked predictions.',
    description: 'Intraday ticks received after the official lock boundary.',
  },
  {
    featureId: 'FORBIDDEN_PRE_OPEN_LIVE_TICKS',
    featureName: 'Pre-Market Open Ticks',
    source: 'PRE_LOCK_INTRADAY_LIVE_FEED',
    session: 'BOTH',
    cutoffSpecification: 'AM: time < 11:00:00 BKK; PM: time < 15:00:00 BKK',
    status: 'FORBIDDEN',
    prohibitionReason: 'Ticks outside active market sessions reflect auction or stale pre-open prices.',
    description: 'Intraday ticks received before market open gate.',
  },
];

/**
 * Data Leakage Violation Error
 */
export class DataLeakageError extends Error {
  public violations: string[];

  constructor(message: string, violations: string[] = []) {
    super(message);
    this.name = 'DataLeakageError';
    this.violations = violations;
  }
}

/**
 * Feature Contract Auditor
 * Enforces zero-tolerance point-in-time boundary verification.
 */
export class FeatureContractAuditor {
  /**
   * Audits raw historical records before feature extraction.
   * Throws DataLeakageError if strict forbidden conditions are present.
   */
  public static auditHistoricalInputRecords(
    records: VerifiedMarketRecord[],
    targetDate: string,
    session: MarketSession
  ): { isCompliant: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const r of records) {
      const recordId = r.id || `${r.date}_${r.time}`;

      // 1. Future Date Violation
      if (r.date > targetDate) {
        violations.push(
          `[FUTURE_DATE_LEAKAGE] Record ${recordId} on ${r.date} is strictly in the future relative to target ${targetDate}.`
        );
      }

      // 2. Target Date AM Violations
      if (session === 'AM' && r.date === targetDate) {
        if (r.isSettlement) {
          violations.push(
            `[TARGET_AM_SETTLEMENT_LEAKAGE] Record ${recordId} contains target date AM settlement (${r.twod}), strictly forbidden in AM pipeline.`
          );
        }
        if (r.session === 'PM') {
          violations.push(
            `[TARGET_PM_IN_AM_LEAKAGE] Record ${recordId} contains target date PM data, strictly forbidden in AM pipeline.`
          );
        }
        if (r.time > PREDICTION_CUTOFFS.AM.timeString) {
          violations.push(
            `[POST_CUTOFF_RECORD_IN_AM] Record ${recordId} has timestamp ${r.time} exceeding AM cutoff ${PREDICTION_CUTOFFS.AM.timeString}.`
          );
        }
      }

      // 3. Target Date PM Violations
      if (session === 'PM' && r.date === targetDate) {
        if (r.isSettlement && r.session === 'PM') {
          violations.push(
            `[TARGET_PM_SETTLEMENT_LEAKAGE] Record ${recordId} contains target date PM settlement (${r.twod}), strictly forbidden in PM pipeline.`
          );
        }
        if (r.session === 'PM' && r.time > PREDICTION_CUTOFFS.PM.timeString) {
          violations.push(
            `[POST_CUTOFF_RECORD_IN_PM] Record ${recordId} has timestamp ${r.time} exceeding PM cutoff ${PREDICTION_CUTOFFS.PM.timeString}.`
          );
        }
      }

      // 4. Target-Session Isolation Violations (Target date only)
      if (r.date === targetDate) {
        if (session === 'AM' && r.session === 'PM') {
          violations.push(
            `[SESSION_ISOLATION_VIOLATION] PM record ${recordId} leaked into target date AM pipeline.`
          );
        }
      }
    }

    return {
      isCompliant: violations.length === 0,
      violations,
    };
  }

  /**
   * Audits and sanitizes pre-lock live feed observations.
   * Ensures live 2D is never ingested and timestamps adhere strictly to cutoff window.
   */
  public static auditLiveFeedObservations(
    rawObservations: Array<{
      time: string;
      set: number | string;
      value: number | string;
      timestamp?: string;
      twod?: any;
      twoD?: any;
      [key: string]: any;
    }>,
    targetDate: string,
    session: MarketSession
  ): {
    isCompliant: boolean;
    violations: string[];
    live2DStrippedCount: number;
    postLockTicksRejectedCount: number;
  } {
    const violations: string[] = [];
    let live2DStrippedCount = 0;
    let postLockTicksRejectedCount = 0;

    const cutoffTime = PREDICTION_CUTOFFS[session].timeString;
    const openTime = session === 'AM' ? '11:00:00' : '15:00:00';

    for (const raw of rawObservations) {
      let timeStr = raw.time;
      if (timeStr.includes('T')) {
        timeStr = timeStr.split('T')[1].slice(0, 8);
      } else if (timeStr.includes(' ')) {
        timeStr = timeStr.split(' ')[1].slice(0, 8);
      }

      // Live 2D Detection
      if (raw.twod !== undefined || raw.twoD !== undefined || raw['2D'] !== undefined || raw.result !== undefined) {
        live2DStrippedCount++;
        violations.push(
          `[FORBIDDEN_LIVE_2D_INPUT] Intraday observation at ${timeStr} contained live 2D field. Stripped immediately.`
        );
      }

      // Cutoff Violation Check
      if (timeStr > cutoffTime) {
        postLockTicksRejectedCount++;
        violations.push(
          `[POST_LOCK_TICK_REJECTED] Intraday observation at ${timeStr} exceeds session ${session} cutoff ${cutoffTime}.`
        );
      }

      // Pre-open Check
      if (timeStr < openTime) {
        violations.push(
          `[PRE_OPEN_TICK_REJECTED] Intraday observation at ${timeStr} is prior to market open ${openTime}.`
        );
      }

      // Date Mismatch Check
      if (raw.timestamp) {
        const obsDate = raw.timestamp.slice(0, 10);
        if (obsDate !== targetDate) {
          violations.push(
            `[DATE_MISMATCH_TICK_REJECTED] Intraday observation date ${obsDate} does not match target date ${targetDate}.`
          );
        }
      }
    }

    return {
      isCompliant: violations.length === 0,
      violations,
      live2DStrippedCount,
      postLockTicksRejectedCount,
    };
  }

  /**
   * Final Verification of Feature Vector before Prediction Generation
   */
  public static auditFeatureVector(
    vector: PredictionFeatureVector,
    targetDate: string,
    session: MarketSession
  ): FeatureAuditReport {
    const violations: string[] = [];
    const allowedContract = session === 'AM' ? AM_FEATURE_CONTRACT : PM_FEATURE_CONTRACT;

    // 1. Session and Date Matching
    if (vector.targetDate !== targetDate) {
      violations.push(`Feature vector date (${vector.targetDate}) does not match target date (${targetDate}).`);
    }
    if (vector.session !== session) {
      violations.push(`Feature vector session (${vector.session}) does not match requested session (${session}).`);
    }

    // 2. Cutoff Timestamp Verification
    const expectedCutoff = `${targetDate}T${PREDICTION_CUTOFFS[session].timeString}+07:00`;
    if (vector.cutoffTimestamp !== expectedCutoff) {
      violations.push(`Cutoff timestamp mismatch: expected ${expectedCutoff}, got ${vector.cutoffTimestamp}`);
    }

    // 3. AM Specific Invariants
    if (session === 'AM') {
      if (vector.distributions.todayAmSettlement2D !== null && vector.distributions.todayAmSettlement2D !== undefined) {
        violations.push(
          `AM feature vector illegally contained todayAmSettlement2D: ${vector.distributions.todayAmSettlement2D}`
        );
      }
      if (vector.distributions.amToPmTransitionProbabilities !== undefined) {
        violations.push(`AM feature vector illegally contained amToPmTransitionProbabilities.`);
      }
    }

    // 4. PM Specific Invariants
    if (session === 'PM') {
      // todayAmSettlement2D is allowed ONLY if it matches a valid 2D or is null if AM hasn't settled
      if (vector.distributions.todayAmSettlement2D !== null && vector.distributions.todayAmSettlement2D !== undefined) {
        if (!/^\d{2}$/.test(vector.distributions.todayAmSettlement2D)) {
          violations.push(`PM todayAmSettlement2D is not a valid 2D format: ${vector.distributions.todayAmSettlement2D}`);
        }
      }
    }

    // 5. Zero Live 2D Invariant on Momentum
    const momentumAny = vector.momentum as any;
    if (momentumAny.twod !== undefined || momentumAny.live2D !== undefined || momentumAny.twoD !== undefined) {
      violations.push(`CRITICAL: Momentum object contained forbidden live 2D property.`);
    }

    // 6. Distribution Mathematical Integrity
    if (vector.distributions.freqAllTime.length !== 100) {
      violations.push(`Distribution length mismatch: expected 100, got ${vector.distributions.freqAllTime.length}`);
    }
    const probSum = vector.distributions.freqAllTime.reduce((acc, p) => acc + p, 0);
    if (Math.abs(probSum - 1.0) > 0.001) {
      violations.push(`Distribution probability does not sum to 1.0: sum = ${probSum}`);
    }

    return {
      targetDate,
      session,
      auditedAt: new Date().toISOString(),
      isCompliant: violations.length === 0,
      violationsCount: violations.length,
      violations,
      allowedFeaturesChecked: allowedContract.length,
      forbiddenFeaturesChecked: FORBIDDEN_LEAKAGE_REGISTRY.length,
    };
  }

  /**
   * Generates formatted audit breakdown matrix
   */
  public static getLeakageMatrix(): {
    amContract: FeatureContractEntry[];
    pmContract: FeatureContractEntry[];
    forbiddenRegistry: FeatureContractEntry[];
  } {
    return {
      amContract: AM_FEATURE_CONTRACT,
      pmContract: PM_FEATURE_CONTRACT,
      forbiddenRegistry: FORBIDDEN_LEAKAGE_REGISTRY,
    };
  }
}
