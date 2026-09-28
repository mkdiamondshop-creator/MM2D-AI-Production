import { VerifiedMarketRecord } from '../src/types/market';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';

function generateHistoricalSeries(numDays: number): VerifiedMarketRecord[] {
  const records: VerifiedMarketRecord[] = [];
  const startDate = new Date('2022-01-03');
  
  let currentSet = 1650.0;
  let currentValue = 45000.0;

  for (let i = 0; i < numDays; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    const dayOfWeek = d.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = d.toISOString().slice(0, 10);
    
    const amDrift = (Math.sin(i * 0.15) * 3.5) + ((i % 5) - 2) * 0.8 + ((i % 7) * 0.13);
    const amValDrift = (Math.cos(i * 0.15) * 4000) + ((i % 6) * 320.5);
    
    const openSet = Math.round((currentSet + (i % 3) * 0.2) * 100) / 100;
    const openVal = Math.round((currentValue * 0.35 + amValDrift * 0.2) * 100) / 100;

    const amSettleSet = Math.round((openSet + amDrift) * 100) / 100;
    const amSettleVal = Math.round((openVal + 15000 + (i % 11) * 234.5) * 100) / 100;
    
    const amSetLast = amSettleSet.toFixed(2).slice(-1);
    const amValLast = Math.floor(amSettleVal).toString().slice(-1);
    const am2D = `${amSetLast}${amValLast}`;

    const pmOpenSet = Math.round((amSettleSet + ((i % 4) - 1.5) * 0.5) * 100) / 100;
    const pmOpenVal = Math.round((amSettleVal + 8000 + (i % 5) * 150) * 100) / 100;

    const pmDrift = (Math.sin(i * 0.22) * 4.2) + ((i % 9) - 4) * 0.6;
    const pmSettleSet = Math.round((pmOpenSet + pmDrift) * 100) / 100;
    const pmSettleVal = Math.round((pmOpenVal + 20000 + (i % 13) * 543.2) * 100) / 100;

    const pmSetLast = pmSettleSet.toFixed(2).slice(-1);
    const pmValLast = Math.floor(pmSettleVal).toString().slice(-1);
    const pm2D = `${pmSetLast}${pmValLast}`;

    currentSet = pmSettleSet;
    currentValue = pmSettleVal;

    records.push({
      id: `${dateStr}_1100`,
      date: dateStr,
      time: '11:00:00',
      session: 'AM',
      isSettlement: false,
      twod: am2D,
      setRaw: openSet.toFixed(2),
      valueRaw: openVal.toFixed(2),
      setNumeric: openSet,
      valueNumeric: openVal,
      historyId: `H_${i}_1`,
      verifiedAt: d.toISOString(),
      provenance: 'OFFICIAL_SET_MARKET_HISTORICAL',
      mathematicalCheck: {
        setLastDigit: amSetLast,
        valueLastDigitBeforeDecimal: amValLast,
        derived2D: am2D,
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      id: `${dateStr}_1201`,
      date: dateStr,
      time: '12:01:00',
      session: 'AM',
      isSettlement: true,
      twod: am2D,
      setRaw: amSettleSet.toFixed(2),
      valueRaw: amSettleVal.toFixed(2),
      setNumeric: amSettleSet,
      valueNumeric: amSettleVal,
      historyId: `H_${i}_2`,
      verifiedAt: d.toISOString(),
      provenance: 'OFFICIAL_SET_MARKET_HISTORICAL',
      mathematicalCheck: {
        setLastDigit: amSetLast,
        valueLastDigitBeforeDecimal: amValLast,
        derived2D: am2D,
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      id: `${dateStr}_1500`,
      date: dateStr,
      time: '15:00:00',
      session: 'PM',
      isSettlement: false,
      twod: pm2D,
      setRaw: pmOpenSet.toFixed(2),
      valueRaw: pmOpenVal.toFixed(2),
      setNumeric: pmOpenSet,
      valueNumeric: pmOpenVal,
      historyId: `H_${i}_3`,
      verifiedAt: d.toISOString(),
      provenance: 'OFFICIAL_SET_MARKET_HISTORICAL',
      mathematicalCheck: {
        setLastDigit: pmSetLast,
        valueLastDigitBeforeDecimal: pmValLast,
        derived2D: pm2D,
        isMathematicallyConsistent: true,
      },
    });

    records.push({
      id: `${dateStr}_1630`,
      date: dateStr,
      time: '16:30:00',
      session: 'PM',
      isSettlement: true,
      twod: pm2D,
      setRaw: pmSettleSet.toFixed(2),
      valueRaw: pmSettleVal.toFixed(2),
      setNumeric: pmSettleSet,
      valueNumeric: pmSettleVal,
      historyId: `H_${i}_4`,
      verifiedAt: d.toISOString(),
      provenance: 'OFFICIAL_SET_MARKET_HISTORICAL',
      mathematicalCheck: {
        setLastDigit: pmSetLast,
        valueLastDigitBeforeDecimal: pmValLast,
        derived2D: pm2D,
        isMathematicallyConsistent: true,
      },
    });
  }

  return records;
}

function evaluateCustomWeights(
  dataset: VerifiedMarketRecord[],
  amWeights: Record<string, number>,
  pmWeights: Record<string, number>
) {
  const allSettlements = dataset.filter((r) => r.isSettlement).sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();

  let top1 = 0, top3 = 0, top5 = 0, top10 = 0, total = 0;
  let amTop1 = 0, amTop3 = 0, amTop5 = 0, amTop10 = 0, amTotal = 0;
  let pmTop1 = 0, pmTop3 = 0, pmTop5 = 0, pmTop10 = 0, pmTotal = 0;

  for (const date of uniqueDates) {
    const prior = allSettlements.filter((r) => r.date < date);
    if (prior.length < 30) continue;

    const daySettles = allSettlements.filter((r) => r.date === date);
    const amSettle = daySettles.find((r) => r.session === 'AM');
    const pmSettle = daySettles.find((r) => r.session === 'PM');

    if (amSettle) {
      const featRes = FeatureEngine.extractFeatures(dataset, date, 'AM');
      if (featRes.success && featRes.featureVector) {
        const feat = featRes.featureVector;
        const pMomentum = (PredictionEngine as any).computeMomentumComponent(feat);
        const probs = new Array<number>(100).fill(0);
        for (let i = 0; i < 100; i++) {
          const d1 = Math.floor(i / 10);
          const d2 = i % 10;
          const digMarg = feat.distributions.firstDigitFreqW30[d1] * feat.distributions.secondDigitFreqW30[d2];
          probs[i] =
            amWeights.freqAllTime * feat.distributions.freqAllTime[i] +
            amWeights.freqW30 * feat.distributions.freqW30[i] +
            amWeights.freqW10 * feat.distributions.freqW10[i] +
            amWeights.freqW5 * feat.distributions.freqW5[i] +
            amWeights.digitMarginals * digMarg +
            amWeights.markovTransition * feat.distributions.markovTransitionProbabilities[i] +
            amWeights.weekdayPrior * feat.distributions.weekdayFreq[i] +
            amWeights.sessionPrior * feat.distributions.sessionFreq[i] +
            amWeights.momentumIntraday * pMomentum[i];
        }
        const sum = probs.reduce((a, b) => a + b, 0);
        const norm = probs.map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p: p / sum })).sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));
        const rank = norm.findIndex((c) => c.twod === amSettle.twod) + 1;
        if (rank === 1) { top1++; amTop1++; }
        if (rank <= 3) { top3++; amTop3++; }
        if (rank <= 5) { top5++; amTop5++; }
        if (rank <= 10) { top10++; amTop10++; }
        total++; amTotal++;
      }
    }

    if (pmSettle) {
      const featRes = FeatureEngine.extractFeatures(dataset, date, 'PM');
      if (featRes.success && featRes.featureVector) {
        const feat = featRes.featureVector;
        const pMomentum = (PredictionEngine as any).computeMomentumComponent(feat);
        const probs = new Array<number>(100).fill(0);
        for (let i = 0; i < 100; i++) {
          const d1 = Math.floor(i / 10);
          const d2 = i % 10;
          const digMarg = feat.distributions.firstDigitFreqW30[d1] * feat.distributions.secondDigitFreqW30[d2];
          const amPm = feat.distributions.amToPmTransitionProbabilities ? feat.distributions.amToPmTransitionProbabilities[i] : 1 / 100;
          probs[i] =
            pmWeights.freqAllTime * feat.distributions.freqAllTime[i] +
            pmWeights.freqW30 * feat.distributions.freqW30[i] +
            pmWeights.freqW10 * feat.distributions.freqW10[i] +
            pmWeights.freqW5 * feat.distributions.freqW5[i] +
            pmWeights.digitMarginals * digMarg +
            pmWeights.markovTransition * feat.distributions.markovTransitionProbabilities[i] +
            pmWeights.weekdayPrior * feat.distributions.weekdayFreq[i] +
            pmWeights.sessionPrior * feat.distributions.sessionFreq[i] +
            pmWeights.amToPmAffinity * amPm +
            pmWeights.momentumIntraday * pMomentum[i];
        }
        const sum = probs.reduce((a, b) => a + b, 0);
        const norm = probs.map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p: p / sum })).sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));
        const rank = norm.findIndex((c) => c.twod === pmSettle.twod) + 1;
        if (rank === 1) { top1++; pmTop1++; }
        if (rank <= 3) { top3++; pmTop3++; }
        if (rank <= 5) { top5++; pmTop5++; }
        if (rank <= 10) { top10++; pmTop10++; }
        total++; pmTotal++;
      }
    }
  }

  return {
    total,
    top1Rate: top1 / total,
    top3Rate: top3 / total,
    top5Rate: top5 / total,
    top10Rate: top10 / total,
    am: { total: amTotal, top1Rate: amTop1 / amTotal, top3Rate: amTop3 / amTotal, top5Rate: amTop5 / amTotal, top10Rate: amTop10 / amTotal },
    pm: { total: pmTotal, top1Rate: pmTop1 / pmTotal, top3Rate: pmTop3 / pmTotal, top5Rate: pmTop5 / pmTotal, top10Rate: pmTop10 / pmTotal },
  };
}

const dataset = generateHistoricalSeries(350);

console.log('--- SENSITIVITY TEST 1: Current Weights ---');
const currentRes = evaluateCustomWeights(
  dataset,
  { freqAllTime: 0.10, freqW30: 0.15, freqW10: 0.12, freqW5: 0.10, digitMarginals: 0.10, markovTransition: 0.15, weekdayPrior: 0.10, sessionPrior: 0.08, momentumIntraday: 0.10 },
  { freqAllTime: 0.08, freqW30: 0.12, freqW10: 0.10, freqW5: 0.08, digitMarginals: 0.08, markovTransition: 0.12, weekdayPrior: 0.08, sessionPrior: 0.06, amToPmAffinity: 0.18, momentumIntraday: 0.10 }
);
console.log(`Current: Top-1: ${(currentRes.top1Rate * 100).toFixed(2)}%, Top-3: ${(currentRes.top3Rate * 100).toFixed(2)}%, Top-5: ${(currentRes.top5Rate * 100).toFixed(2)}%, Top-10: ${(currentRes.top10Rate * 100).toFixed(2)}%`);
console.log(`  AM: Top-1: ${(currentRes.am.top1Rate * 100).toFixed(2)}%, Top-10: ${(currentRes.am.top10Rate * 100).toFixed(2)}%`);
console.log(`  PM: Top-1: ${(currentRes.pm.top1Rate * 100).toFixed(2)}%, Top-10: ${(currentRes.pm.top10Rate * 100).toFixed(2)}%`);

console.log('\n--- SENSITIVITY TEST 2: Prior-Dominant Ensemble (Dampened W5/W10 Noise) ---');
const robustRes = evaluateCustomWeights(
  dataset,
  { freqAllTime: 0.25, freqW30: 0.20, freqW10: 0.05, freqW5: 0.03, digitMarginals: 0.10, markovTransition: 0.10, weekdayPrior: 0.15, sessionPrior: 0.07, momentumIntraday: 0.05 },
  { freqAllTime: 0.20, freqW30: 0.15, freqW10: 0.05, freqW5: 0.03, digitMarginals: 0.08, markovTransition: 0.10, weekdayPrior: 0.12, sessionPrior: 0.07, amToPmAffinity: 0.15, momentumIntraday: 0.05 }
);
console.log(`Robust:  Top-1: ${(robustRes.top1Rate * 100).toFixed(2)}%, Top-3: ${(robustRes.top3Rate * 100).toFixed(2)}%, Top-5: ${(robustRes.top5Rate * 100).toFixed(2)}%, Top-10: ${(robustRes.top10Rate * 100).toFixed(2)}%`);
console.log(`  AM: Top-1: ${(robustRes.am.top1Rate * 100).toFixed(2)}%, Top-10: ${(robustRes.am.top10Rate * 100).toFixed(2)}%`);
console.log(`  PM: Top-1: ${(robustRes.pm.top1Rate * 100).toFixed(2)}%, Top-10: ${(robustRes.pm.top10Rate * 100).toFixed(2)}%`);

console.log('\n--- SENSITIVITY TEST 3: Empirical Long-Term & Context Focused ---');
const empRes = evaluateCustomWeights(
  dataset,
  { freqAllTime: 0.30, freqW30: 0.18, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.08, markovTransition: 0.08, weekdayPrior: 0.18, sessionPrior: 0.08, momentumIntraday: 0.04 },
  { freqAllTime: 0.22, freqW30: 0.14, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.08, markovTransition: 0.08, weekdayPrior: 0.14, sessionPrior: 0.08, amToPmAffinity: 0.16, momentumIntraday: 0.04 }
);
console.log(`Emp:     Top-1: ${(empRes.top1Rate * 100).toFixed(2)}%, Top-3: ${(empRes.top3Rate * 100).toFixed(2)}%, Top-5: ${(empRes.top5Rate * 100).toFixed(2)}%, Top-10: ${(empRes.top10Rate * 100).toFixed(2)}%`);
console.log(`  AM: Top-1: ${(empRes.am.top1Rate * 100).toFixed(2)}%, Top-10: ${(empRes.am.top10Rate * 100).toFixed(2)}%`);
console.log(`  PM: Top-1: ${(empRes.pm.top1Rate * 100).toFixed(2)}%, Top-10: ${(empRes.pm.top10Rate * 100).toFixed(2)}%`);
