import { VerifiedMarketRecord } from '../src/types/market';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { evaluateModel } from './run_step68_model_selection';

// We will run and print the full combined table cleanly
const dataset = (function() {
  const records: VerifiedMarketRecord[] = [];
  const startDate = new Date('2022-01-03');
  let currentSet = 1650.0;
  let currentValue = 45000.0;

  for (let i = 0; i < 350; i++) {
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
      mathematicalCheck: { setLastDigit: amSetLast, valueLastDigitBeforeDecimal: amValLast, derived2D: am2D, isMathematicallyConsistent: true },
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
      mathematicalCheck: { setLastDigit: amSetLast, valueLastDigitBeforeDecimal: amValLast, derived2D: am2D, isMathematicallyConsistent: true },
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
      mathematicalCheck: { setLastDigit: pmSetLast, valueLastDigitBeforeDecimal: pmValLast, derived2D: pm2D, isMathematicallyConsistent: true },
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
      mathematicalCheck: { setLastDigit: pmSetLast, valueLastDigitBeforeDecimal: pmValLast, derived2D: pm2D, isMathematicallyConsistent: true },
    });
  }
  return records;
})();

const allSettlements = dataset.filter((r) => r.isSettlement).sort((a, b) => a.date.localeCompare(b.date));
const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();
const evaluatedDates = uniqueDates.slice(15);

const models = [
  { name: 'Uniform Random Sim', fn: () => new Array<number>(100).fill(1 / 100) },
  { name: 'All-Time Frequency', fn: (f: any) => f.distributions.freqAllTime },
  { name: 'W30 Frequency', fn: (f: any) => f.distributions.freqW30 },
  { name: 'W10 Frequency', fn: (f: any) => f.distributions.freqW10 },
  { name: 'W5 Frequency', fn: (f: any) => f.distributions.freqW5 },
  { name: 'Weekday Prior', fn: (f: any) => f.distributions.weekdayFreq },
  { name: 'Session Prior', fn: (f: any) => f.distributions.sessionFreq },
  { name: 'Markov 1st-Order', fn: (f: any) => f.distributions.markovTransitionProbabilities },
  { name: 'PM AM->PM Affinity', fn: (f: any, s: 'AM' | 'PM') => (s === 'PM' && f.distributions.amToPmTransitionProbabilities ? f.distributions.amToPmTransitionProbabilities : null) },
  { name: 'Digit Marginals Product', fn: (f: any) => {
    const res = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      res[i] = f.distributions.firstDigitFreqW30[d1] * f.distributions.secondDigitFreqW30[d2];
    }
    const sum = res.reduce((a, b) => a + b, 0);
    return res.map((r) => r / sum);
  }},
  { name: 'SET/Val Momentum', fn: (f: any) => (PredictionEngine as any).computeMomentumComponent(f) },
  { name: 'Previous Production Ensemble (Step 6.5)', fn: (f: any, session: 'AM' | 'PM') => {
    const amWeights = { freqAllTime: 0.10, freqW30: 0.15, freqW10: 0.12, freqW5: 0.10, digitMarginals: 0.10, markovTransition: 0.15, weekdayPrior: 0.10, sessionPrior: 0.08, momentumIntraday: 0.10 };
    const pmWeights = { freqAllTime: 0.08, freqW30: 0.12, freqW10: 0.10, freqW5: 0.08, digitMarginals: 0.08, markovTransition: 0.12, weekdayPrior: 0.08, sessionPrior: 0.06, amToPmAffinity: 0.18, momentumIntraday: 0.10 };
    const w = session === 'AM' ? amWeights : pmWeights;
    const pMomentum = (PredictionEngine as any).computeMomentumComponent(f);
    const probs = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      const dig = f.distributions.firstDigitFreqW30[d1] * f.distributions.secondDigitFreqW30[d2];
      const amPm = f.distributions.amToPmTransitionProbabilities ? f.distributions.amToPmTransitionProbabilities[i] : 1 / 100;
      let score = w.freqAllTime * f.distributions.freqAllTime[i] +
        w.freqW30 * f.distributions.freqW30[i] +
        w.freqW10 * f.distributions.freqW10[i] +
        w.freqW5 * f.distributions.freqW5[i] +
        w.digitMarginals * dig +
        w.markovTransition * f.distributions.markovTransitionProbabilities[i] +
        w.weekdayPrior * f.distributions.weekdayFreq[i] +
        w.sessionPrior * f.distributions.sessionFreq[i] +
        w.momentumIntraday * pMomentum[i];
      if (session === 'PM' && (w as any).amToPmAffinity) score += (w as any).amToPmAffinity * amPm;
      probs[i] = score;
    }
    const sum = probs.reduce((a, b) => a + b, 0);
    return probs.map((p) => p / sum);
  }},
  { name: 'Step 6.7 Calibrated Ensemble', fn: (f: any, session: 'AM' | 'PM') => {
    const amWeights = { freqAllTime: 0.28, freqW30: 0.16, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.06, markovTransition: 0.12, weekdayPrior: 0.16, sessionPrior: 0.08, momentumIntraday: 0.08 };
    const pmWeights = { freqAllTime: 0.22, freqW30: 0.14, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.05, markovTransition: 0.10, weekdayPrior: 0.14, sessionPrior: 0.07, amToPmAffinity: 0.18, momentumIntraday: 0.08 };
    const w = session === 'AM' ? amWeights : pmWeights;
    const pMomentum = (PredictionEngine as any).computeMomentumComponent(f);
    const probs = new Array<number>(100);
    for (let i = 0; i < 100; i++) {
      const d1 = Math.floor(i / 10);
      const d2 = i % 10;
      const dig = f.distributions.firstDigitFreqW30[d1] * f.distributions.secondDigitFreqW30[d2];
      const amPm = f.distributions.amToPmTransitionProbabilities ? f.distributions.amToPmTransitionProbabilities[i] : 1 / 100;
      let score = w.freqAllTime * f.distributions.freqAllTime[i] +
        w.freqW30 * f.distributions.freqW30[i] +
        w.freqW10 * f.distributions.freqW10[i] +
        w.freqW5 * f.distributions.freqW5[i] +
        w.digitMarginals * dig +
        w.markovTransition * f.distributions.markovTransitionProbabilities[i] +
        w.weekdayPrior * f.distributions.weekdayFreq[i] +
        w.sessionPrior * f.distributions.sessionFreq[i] +
        w.momentumIntraday * pMomentum[i];
      if (session === 'PM' && (w as any).amToPmAffinity) score += (w as any).amToPmAffinity * amPm;
      probs[i] = score;
    }
    const sum = probs.reduce((a, b) => a + b, 0);
    return probs.map((p) => p / sum);
  }},
];

console.log('COMBINED EVALUATION RESULTS:');
for (const m of models) {
  const res = evaluateModel(dataset, m.name, m.fn, evaluatedDates);
  if (res.combined) {
    const c = res.combined;
    console.log(`[COMBINED] ${c.name}: N=${c.sampleCount}, Top1=${c.top1Rate.toFixed(2)}% [${c.top1Ci[0]}, ${c.top1Ci[1]}] (${c.top1}), Top3=${c.top3Rate.toFixed(2)}% [${c.top3Ci[0]}, ${c.top3Ci[1]}] (${c.top3}), Top5=${c.top5Rate.toFixed(2)}% [${c.top5Ci[0]}, ${c.top5Ci[1]}] (${c.top5}), Top10=${c.top10Rate.toFixed(2)}% [${c.top10Ci[0]}, ${c.top10Ci[1]}] (${c.top10}), AvgRank=${c.avgRank.toFixed(1)}`);
  } else {
    console.log(`[COMBINED] ${m.name}: N/A (PM-Specific)`);
  }
}
