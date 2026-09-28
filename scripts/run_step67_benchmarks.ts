import { VerifiedMarketRecord } from '../src/types/market';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { StatisticalEngine } from '../src/core/prediction/statisticalEngine';
import { BacktestEngine } from '../src/core/prediction/backtestEngine';

/**
 * Step 6.7 Comprehensive Evaluation Framework
 */
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

export interface MetricSummary {
  name: string;
  sampleCount: number;
  top1: number;
  top1Rate: number;
  top3: number;
  top3Rate: number;
  top5: number;
  top5Rate: number;
  top10: number;
  top10Rate: number;
  avgRank: number;
}

export function evaluateDistributionExtractor(
  dataset: VerifiedMarketRecord[],
  name: string,
  extractor: (feat: any, session: 'AM' | 'PM') => number[]
): { am: MetricSummary; pm: MetricSummary; combined: MetricSummary } {
  const allSettlements = dataset.filter((r) => r.isSettlement).sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();

  let amT1 = 0, amT3 = 0, amT5 = 0, amT10 = 0, amTotal = 0, amRankSum = 0;
  let pmT1 = 0, pmT3 = 0, pmT5 = 0, pmT10 = 0, pmTotal = 0, pmRankSum = 0;

  for (const date of uniqueDates) {
    const prior = allSettlements.filter((r) => r.date < date);
    if (prior.length < 30) continue;

    const daySettles = allSettlements.filter((r) => r.date === date);
    const amSettle = daySettles.find((r) => r.session === 'AM');
    const pmSettle = daySettles.find((r) => r.session === 'PM');

    if (amSettle) {
      const featRes = FeatureEngine.extractFeatures(dataset, date, 'AM');
      if (featRes.success && featRes.featureVector) {
        const probs = extractor(featRes.featureVector, 'AM');
        const sorted = probs
          .map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p }))
          .sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));
        const rank = sorted.findIndex((c) => c.twod === amSettle.twod) + 1;
        amRankSum += rank;
        if (rank === 1) amT1++;
        if (rank <= 3) amT3++;
        if (rank <= 5) amT5++;
        if (rank <= 10) amT10++;
        amTotal++;
      }
    }

    if (pmSettle) {
      const featRes = FeatureEngine.extractFeatures(dataset, date, 'PM');
      if (featRes.success && featRes.featureVector) {
        const probs = extractor(featRes.featureVector, 'PM');
        const sorted = probs
          .map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p }))
          .sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));
        const rank = sorted.findIndex((c) => c.twod === pmSettle.twod) + 1;
        pmRankSum += rank;
        if (rank === 1) pmT1++;
        if (rank <= 3) pmT3++;
        if (rank <= 5) pmT5++;
        if (rank <= 10) pmT10++;
        pmTotal++;
      }
    }
  }

  const combTotal = amTotal + pmTotal;
  const combT1 = amT1 + pmT1;
  const combT3 = amT3 + pmT3;
  const combT5 = amT5 + pmT5;
  const combT10 = amT10 + pmT10;
  const combRankSum = amRankSum + pmRankSum;

  return {
    am: {
      name,
      sampleCount: amTotal,
      top1: amT1,
      top1Rate: amTotal > 0 ? amT1 / amTotal : 0,
      top3: amT3,
      top3Rate: amTotal > 0 ? amT3 / amTotal : 0,
      top5: amT5,
      top5Rate: amTotal > 0 ? amT5 / amTotal : 0,
      top10: amT10,
      top10Rate: amTotal > 0 ? amT10 / amTotal : 0,
      avgRank: amTotal > 0 ? amRankSum / amTotal : 0,
    },
    pm: {
      name,
      sampleCount: pmTotal,
      top1: pmT1,
      top1Rate: pmTotal > 0 ? pmT1 / pmTotal : 0,
      top3: pmT3,
      top3Rate: pmTotal > 0 ? pmT3 / pmTotal : 0,
      top5: pmT5,
      top5Rate: pmTotal > 0 ? pmT5 / pmTotal : 0,
      top10: pmT10,
      top10Rate: pmTotal > 0 ? pmT10 / pmTotal : 0,
      avgRank: pmTotal > 0 ? pmRankSum / pmTotal : 0,
    },
    combined: {
      name,
      sampleCount: combTotal,
      top1: combT1,
      top1Rate: combTotal > 0 ? combT1 / combTotal : 0,
      top3: combT3,
      top3Rate: combTotal > 0 ? combT3 / combTotal : 0,
      top5: combT5,
      top5Rate: combTotal > 0 ? combT5 / combTotal : 0,
      top10: combT10,
      top10Rate: combTotal > 0 ? combT10 / combTotal : 0,
      avgRank: combTotal > 0 ? combRankSum / combTotal : 0,
    },
  };
}

async function runStep67Audit() {
  console.log('================================================================');
  console.log('       LEADER STEP 6.7: MODEL CALIBRATION & BENCHMARK AUDIT     ');
  console.log('================================================================\n');

  const dataset = generateHistoricalSeries(350);

  // 1. Baselines & Components
  const evaluations = [
    {
      name: 'Uniform Random Benchmark',
      fn: () => new Array<number>(100).fill(1 / 100),
    },
    {
      name: 'All-Time Frequency (Laplace)',
      fn: (f: any) => f.distributions.freqAllTime,
    },
    {
      name: 'Component: W30 Window',
      fn: (f: any) => f.distributions.freqW30,
    },
    {
      name: 'Component: W10 Window',
      fn: (f: any) => f.distributions.freqW10,
    },
    {
      name: 'Component: W5 Window',
      fn: (f: any) => f.distributions.freqW5,
    },
    {
      name: 'Component: Digit Marginals',
      fn: (f: any) => {
        const res = new Array<number>(100);
        for (let i = 0; i < 100; i++) {
          const d1 = Math.floor(i / 10);
          const d2 = i % 10;
          res[i] = f.distributions.firstDigitFreqW30[d1] * f.distributions.secondDigitFreqW30[d2];
        }
        const sum = res.reduce((a, b) => a + b, 0);
        return res.map((r) => r / sum);
      },
    },
    {
      name: 'Component: Markov 1st-Order',
      fn: (f: any) => f.distributions.markovTransitionProbabilities,
    },
    {
      name: 'Component: Weekday Prior',
      fn: (f: any) => f.distributions.weekdayFreq,
    },
    {
      name: 'Component: Session Prior',
      fn: (f: any) => f.distributions.sessionFreq,
    },
    {
      name: 'Component: PM AM->PM Affinity',
      fn: (f: any, s: 'AM' | 'PM') =>
        s === 'PM' && f.distributions.amToPmTransitionProbabilities
          ? f.distributions.amToPmTransitionProbabilities
          : new Array<number>(100).fill(1 / 100),
    },
    {
      name: 'Component: SET/Val Momentum',
      fn: (f: any) => (PredictionEngine as any).computeMomentumComponent(f),
    },
    {
      name: 'Current Production Ensemble',
      fn: (f: any, session: 'AM' | 'PM') => {
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
          if (session === 'PM' && (w as any).amToPmAffinity) {
            score += (w as any).amToPmAffinity * amPm;
          }
          probs[i] = score;
        }
        const sum = probs.reduce((a, b) => a + b, 0);
        return probs.map((p) => p / sum);
      },
    },
    {
      name: 'Calibrated Conservative Ensemble',
      fn: (f: any, session: 'AM' | 'PM') => {
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
          if (session === 'PM' && (w as any).amToPmAffinity) {
            score += (w as any).amToPmAffinity * amPm;
          }
          probs[i] = score;
        }
        const sum = probs.reduce((a, b) => a + b, 0);
        return probs.map((p) => p / sum);
      },
    },
  ];

  console.log('### COMBINED (AM + PM) PERFORMANCE TABLE ###');
  console.log('| Model / Component | Sample Count | Top-1 | Top-3 | Top-5 | Top-10 | Avg Rank |');
  console.log('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const item of evaluations) {
    const res = evaluateDistributionExtractor(dataset, item.name, item.fn);
    console.log(
      `| ${res.combined.name.padEnd(30)} | ${res.combined.sampleCount} | ${(res.combined.top1Rate * 100).toFixed(2)}% (${res.combined.top1}) | ${(res.combined.top3Rate * 100).toFixed(2)}% (${res.combined.top3}) | ${(res.combined.top5Rate * 100).toFixed(2)}% (${res.combined.top5}) | ${(res.combined.top10Rate * 100).toFixed(2)}% (${res.combined.top10}) | ${res.combined.avgRank.toFixed(1)} |`
    );
  }

  console.log('\n### AM SESSION PERFORMANCE TABLE ###');
  console.log('| Model / Component | Sample Count | Top-1 | Top-3 | Top-5 | Top-10 | Avg Rank |');
  console.log('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const item of evaluations) {
    const res = evaluateDistributionExtractor(dataset, item.name, item.fn);
    console.log(
      `| ${res.am.name.padEnd(30)} | ${res.am.sampleCount} | ${(res.am.top1Rate * 100).toFixed(2)}% (${res.am.top1}) | ${(res.am.top3Rate * 100).toFixed(2)}% (${res.am.top3}) | ${(res.am.top5Rate * 100).toFixed(2)}% (${res.am.top5}) | ${(res.am.top10Rate * 100).toFixed(2)}% (${res.am.top10}) | ${res.am.avgRank.toFixed(1)} |`
    );
  }

  console.log('\n### PM SESSION PERFORMANCE TABLE ###');
  console.log('| Model / Component | Sample Count | Top-1 | Top-3 | Top-5 | Top-10 | Avg Rank |');
  console.log('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');
  for (const item of evaluations) {
    const res = evaluateDistributionExtractor(dataset, item.name, item.fn);
    console.log(
      `| ${res.pm.name.padEnd(30)} | ${res.pm.sampleCount} | ${(res.pm.top1Rate * 100).toFixed(2)}% (${res.pm.top1}) | ${(res.pm.top3Rate * 100).toFixed(2)}% (${res.pm.top3}) | ${(res.pm.top5Rate * 100).toFixed(2)}% (${res.pm.top5}) | ${(res.pm.top10Rate * 100).toFixed(2)}% (${res.pm.top10}) | ${res.pm.avgRank.toFixed(1)} |`
    );
  }
}

runStep67Audit().catch(console.error);
