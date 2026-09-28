import { VerifiedMarketRecord } from '../../types/market';
import { HistoricalDistributions, PreLockObservation, MarketMomentumFeatures } from '../../types/prediction';

/**
 * Pure Mathematical & Statistical Engine for 2D Market Analysis
 * All functions are strictly deterministic, stateless, and mathematically grounded.
 */
export class StatisticalEngine {
  /**
   * Generates formatted two-digit strings ("00" to "99")
   */
  public static readonly ALL_2D_STRINGS: string[] = Array.from({ length: 100 }, (_, i) =>
    i.toString().padStart(2, '0')
  );

  /**
   * Computes normalized empirical frequency distribution over 00..99 with Laplace smoothing.
   * @param twodList Array of 2D string records (e.g. ["84", "01", "35"])
   * @param smoothingAlpha Laplace smoothing constant (default 0.1 to avoid zero probabilities)
   * @returns Array of 100 probabilities summing to 1.0
   */
  public static computeFrequencyDistribution(twodList: string[], smoothingAlpha: number = 0.1): number[] {
    const counts = new Array<number>(100).fill(0);
    for (const item of twodList) {
      const idx = parseInt(item, 10);
      if (!isNaN(idx) && idx >= 0 && idx < 100) {
        counts[idx]++;
      }
    }

    const totalObs = twodList.length;
    const denominator = totalObs + 100 * smoothingAlpha;

    const probabilities = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      probabilities[i] = (counts[i] + smoothingAlpha) / denominator;
    }
    return probabilities;
  }

  /**
   * Computes marginal digit distributions (Tens 0-9 and Units 0-9)
   */
  public static computeDigitMarginals(twodList: string[]): {
    firstDigitFreq: number[];
    secondDigitFreq: number[];
  } {
    const tensCounts = new Array<number>(10).fill(0);
    const unitsCounts = new Array<number>(10).fill(0);

    for (const item of twodList) {
      if (item.length === 2) {
        const d1 = parseInt(item[0], 10);
        const d2 = parseInt(item[1], 10);
        if (!isNaN(d1) && d1 >= 0 && d1 < 10) tensCounts[d1]++;
        if (!isNaN(d2) && d2 >= 0 && d2 < 10) unitsCounts[d2]++;
      }
    }

    const n = Math.max(1, twodList.length);
    return {
      firstDigitFreq: tensCounts.map((c) => (c + 0.1) / (n + 1.0)),
      secondDigitFreq: unitsCounts.map((c) => (c + 0.1) / (n + 1.0)),
    };
  }

  /**
   * Computes parity ratios (Odd/Even, High/Low) over a sample of 2D records
   */
  public static computeParityRatios(twodList: string[]): {
    oddRatio: number;
    evenRatio: number;
    highRatio: number;
    lowRatio: number;
  } {
    if (twodList.length === 0) {
      return { oddRatio: 0.5, evenRatio: 0.5, highRatio: 0.5, lowRatio: 0.5 };
    }

    let oddCount = 0;
    let highCount = 0;

    for (const item of twodList) {
      const val = parseInt(item, 10);
      if (!isNaN(val)) {
        if (val % 2 !== 0) oddCount++;
        if (val >= 50) highCount++;
      }
    }

    const n = twodList.length;
    return {
      oddRatio: oddCount / n,
      evenRatio: (n - oddCount) / n,
      highRatio: highCount / n,
      lowRatio: (n - highCount) / n,
    };
  }

  /**
   * Computes empirical Markov transition distribution: P(Y_t = d | Y_{t-1} = prev2D)
   * Evaluates sequential transitions between consecutive historical settlements.
   */
  public static computeMarkovTransitions(
    orderedSettlement2D: string[],
    prev2D: string | null,
    smoothingAlpha: number = 0.05
  ): number[] {
    if (!prev2D || orderedSettlement2D.length < 2) {
      return this.computeFrequencyDistribution(orderedSettlement2D, smoothingAlpha);
    }

    const targetIdx = parseInt(prev2D, 10);
    if (isNaN(targetIdx) || targetIdx < 0 || targetIdx >= 100) {
      return this.computeFrequencyDistribution(orderedSettlement2D, smoothingAlpha);
    }

    const transitionCounts = new Array<number>(100).fill(0);
    let matchedTransitions = 0;

    // orderedSettlement2D is in chronological order [oldest ... newest]
    for (let i = 0; i < orderedSettlement2D.length - 1; i++) {
      if (orderedSettlement2D[i] === prev2D) {
        const nextVal = parseInt(orderedSettlement2D[i + 1], 10);
        if (!isNaN(nextVal) && nextVal >= 0 && nextVal < 100) {
          transitionCounts[nextVal]++;
          matchedTransitions++;
        }
      }
    }

    // If historical occurrences of prev2D are scarce, blend with base frequency
    if (matchedTransitions < 3) {
      const baseFreq = this.computeFrequencyDistribution(orderedSettlement2D, smoothingAlpha);
      if (matchedTransitions === 0) return baseFreq;
      
      const transProb = transitionCounts.map((c) => (c + smoothingAlpha) / (matchedTransitions + 100 * smoothingAlpha));
      return transProb.map((p, i) => 0.5 * p + 0.5 * baseFreq[i]);
    }

    const denominator = matchedTransitions + 100 * smoothingAlpha;
    return transitionCounts.map((c) => (c + smoothingAlpha) / denominator);
  }

  /**
   * Computes historical empirical AM->PM conditional transition distribution.
   * Evaluates historical pairing of AM settlement (12:01) to PM settlement (16:30) on the same day.
   */
  public static computeAmToPmAffinity(
    historicalRecords: VerifiedMarketRecord[],
    todayAm2D: string | null,
    smoothingAlpha: number = 0.05
  ): number[] {
    if (!todayAm2D) {
      return new Array<number>(100).fill(1 / 100);
    }

    // Group verified settlements by date
    const dayMap = new Map<string, { am?: string; pm?: string }>();
    for (const r of historicalRecords) {
      if (!r.isSettlement) continue;
      const entry = dayMap.get(r.date) || {};
      if (r.session === 'AM') entry.am = r.twod;
      if (r.session === 'PM') entry.pm = r.twod;
      dayMap.set(r.date, entry);
    }

    const transitionCounts = new Array<number>(100).fill(0);
    let pairedCount = 0;

    for (const [, pair] of dayMap.entries()) {
      if (pair.am === todayAm2D && pair.pm !== undefined) {
        const pmIdx = parseInt(pair.pm, 10);
        if (!isNaN(pmIdx) && pmIdx >= 0 && pmIdx < 100) {
          transitionCounts[pmIdx]++;
          pairedCount++;
        }
      }
    }

    if (pairedCount < 3) {
      // Fallback blend with all PM settlements
      const allPm = historicalRecords.filter((r) => r.isSettlement && r.session === 'PM').map((r) => r.twod);
      const basePmFreq = this.computeFrequencyDistribution(allPm, smoothingAlpha);
      if (pairedCount === 0) return basePmFreq;

      const condProb = transitionCounts.map((c) => (c + smoothingAlpha) / (pairedCount + 100 * smoothingAlpha));
      return condProb.map((p, i) => 0.6 * p + 0.4 * basePmFreq[i]);
    }

    const denominator = pairedCount + 100 * smoothingAlpha;
    return transitionCounts.map((c) => (c + smoothingAlpha) / denominator);
  }

  /**
   * Computes Macro SET & Value Momentum Features
   */
  public static computeMacroMomentum(
    chronologicalSettlements: VerifiedMarketRecord[]
  ): {
    prevCloseSet: number | null;
    prevCloseValue: number | null;
    setDeltaW5: number | null;
    valueRatioW5: number | null;
  } {
    if (chronologicalSettlements.length === 0) {
      return { prevCloseSet: null, prevCloseValue: null, setDeltaW5: null, valueRatioW5: null };
    }

    // Filter for settlement close records in the provided chronological settlements
    const settlementCloses = chronologicalSettlements.filter((r) => r.isSettlement);
    const lastClose = settlementCloses.length > 0 ? settlementCloses[settlementCloses.length - 1] : null;

    const prevCloseSet = lastClose ? lastClose.setNumeric : null;
    const prevCloseValue = lastClose ? lastClose.valueNumeric : null;

    // Multi-period net SET change: SET(T-1) - SET(T-6)
    let setDeltaW5: number | null = null;
    if (settlementCloses.length >= 6) {
      const t1 = settlementCloses[settlementCloses.length - 1].setNumeric;
      const t6 = settlementCloses[settlementCloses.length - 6].setNumeric;
      if (!isNaN(t1) && !isNaN(t6)) {
        setDeltaW5 = Math.round((t1 - t6) * 100) / 100;
      }
    }

    // Average Value vs 30-period baseline ratio
    let valueRatioW5: number | null = null;
    if (settlementCloses.length >= 5) {
      const last5 = settlementCloses.slice(-5).map((r) => r.valueNumeric).filter((v) => !isNaN(v) && v > 0);
      const last30 = settlementCloses.slice(-30).map((r) => r.valueNumeric).filter((v) => !isNaN(v) && v > 0);
      if (last5.length > 0 && last30.length > 0) {
        const avg5 = last5.reduce((a, b) => a + b, 0) / last5.length;
        const avg30 = last30.reduce((a, b) => a + b, 0) / last30.length;
        if (avg30 > 0) {
          valueRatioW5 = Math.round((avg5 / avg30) * 1000) / 1000;
        }
      }
    }

    return { prevCloseSet, prevCloseValue, setDeltaW5, valueRatioW5 };
  }

  /**
   * Computes Intraday Pre-Lock Movements and Volatility from valid pre-lock observations
   */
  public static computeIntradayPreLockFeatures(
    observations: PreLockObservation[],
    prevCloseSet: number | null,
    prevCloseValue: number | null,
    sessionOpenObs?: PreLockObservation
  ): {
    currentSet: number | null;
    currentValue: number | null;
    setChangeFromPrevClose: number | null;
    valueChangeFromPrevClose: number | null;
    setChangeFromSessionOpen: number | null;
    valueChangeFromSessionOpen: number | null;
    observationCount: number;
    intradaySetVolatility: number | null;
  } {
    const count = observations.length;
    if (count === 0) {
      return {
        currentSet: null,
        currentValue: null,
        setChangeFromPrevClose: null,
        valueChangeFromPrevClose: null,
        setChangeFromSessionOpen: null,
        valueChangeFromSessionOpen: null,
        observationCount: 0,
        intradaySetVolatility: null,
      };
    }

    const latest = observations[observations.length - 1];
    const currentSet = latest.set;
    const currentValue = latest.value;

    let setChangeFromPrevClose: number | null = null;
    let valueChangeFromPrevClose: number | null = null;
    if (prevCloseSet !== null && !isNaN(prevCloseSet)) {
      setChangeFromPrevClose = Math.round((currentSet - prevCloseSet) * 100) / 100;
    }
    if (prevCloseValue !== null && !isNaN(prevCloseValue)) {
      valueChangeFromPrevClose = Math.round((currentValue - prevCloseValue) * 100) / 100;
    }

    let setChangeFromSessionOpen: number | null = null;
    let valueChangeFromSessionOpen: number | null = null;
    if (sessionOpenObs) {
      setChangeFromSessionOpen = Math.round((currentSet - sessionOpenObs.set) * 100) / 100;
      valueChangeFromSessionOpen = Math.round((currentValue - sessionOpenObs.value) * 100) / 100;
    }

    // Sample Standard Deviation of SET observations
    let intradaySetVolatility: number | null = null;
    if (count >= 2) {
      const setValues = observations.map((o) => o.set);
      const mean = setValues.reduce((a, b) => a + b, 0) / count;
      const variance = setValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (count - 1);
      intradaySetVolatility = Math.round(Math.sqrt(variance) * 10000) / 10000;
    } else {
      intradaySetVolatility = 0;
    }

    return {
      currentSet,
      currentValue,
      setChangeFromPrevClose,
      valueChangeFromPrevClose,
      setChangeFromSessionOpen,
      valueChangeFromSessionOpen,
      observationCount: count,
      intradaySetVolatility,
    };
  }

  /**
   * Computes Shannon Entropy for a probability distribution vector
   * H(P) = - sum(p_i * log2(p_i))
   */
  public static computeShannonEntropy(probabilities: number[]): number {
    let entropy = 0;
    for (const p of probabilities) {
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    return Math.round(entropy * 1000) / 1000;
  }
}
