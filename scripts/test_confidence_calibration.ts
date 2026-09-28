import { VerifiedMarketRecord } from '../src/types/market';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { StatisticalEngine } from '../src/core/prediction/statisticalEngine';

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

function getRankInDistribution(dist: number[], targetTwod: string): number {
  const sorted = dist
    .map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p }))
    .sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));
  return sorted.findIndex((c) => c.twod === targetTwod) + 1;
}

function testConfidenceCalibration() {
  const dataset = generateHistoricalSeries(350);
  const allSettlements = dataset.filter((r) => r.isSettlement).sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = Array.from(new Set(allSettlements.map((r) => r.date))).sort();

  interface EvalRecord {
    date: string;
    session: 'AM' | 'PM';
    actual: string;
    top1: string;
    isTop1: boolean;
    isTop10: boolean;
    rank: number;
    oldConf: number;
    newConf: number;
  }

  const evals: EvalRecord[] = [];

  const amWeights = { freqAllTime: 0.28, freqW30: 0.16, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.06, markovTransition: 0.12, weekdayPrior: 0.16, sessionPrior: 0.08, momentumIntraday: 0.08 };
  const pmWeights = { freqAllTime: 0.22, freqW30: 0.14, freqW10: 0.04, freqW5: 0.02, digitMarginals: 0.05, markovTransition: 0.10, weekdayPrior: 0.14, sessionPrior: 0.07, amToPmAffinity: 0.18, momentumIntraday: 0.08 };

  for (const date of uniqueDates) {
    const prior = allSettlements.filter((r) => r.date < date);
    if (prior.length < 30) continue;

    const daySettles = allSettlements.filter((r) => r.date === date);
    const amSettle = daySettles.find((r) => r.session === 'AM');
    const pmSettle = daySettles.find((r) => r.session === 'PM');

    for (const session of ['AM', 'PM'] as const) {
      const targetSettle = session === 'AM' ? amSettle : pmSettle;
      if (!targetSettle) continue;

      const featRes = FeatureEngine.extractFeatures(dataset, date, session);
      if (!featRes.success || !featRes.featureVector) continue;

      const f = featRes.featureVector;
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
      const normProbs = probs.map((p) => p / sum);
      const sorted = normProbs
        .map((p, idx) => ({ twod: idx.toString().padStart(2, '0'), p, idx }))
        .sort((a, b) => b.p - a.p || a.twod.localeCompare(b.twod));

      const rank = sorted.findIndex((c) => c.twod === targetSettle.twod) + 1;
      const top1 = sorted[0].twod;
      const topMargin = sorted[0].p - sorted[1].p;
      const entropy = StatisticalEngine.computeShannonEntropy(normProbs);

      // OLD CONFIDENCE
      const oldSampleFactor = Math.min(1.0, f.distributions.sampleCountAllTime / 100);
      const oldLiveFactor = f.isPreLockLiveAvailable ? 1.0 : 0.75;
      const oldMarginFactor = Math.min(1.0, topMargin * 50);
      const oldEntropyFactor = Math.max(0.0, (6.64 - entropy) / 2.0);
      const oldRaw = (oldSampleFactor * 0.4 + oldLiveFactor * 0.2 + oldMarginFactor * 0.2 + oldEntropyFactor * 0.2) * 100;
      const oldConf = Math.min(99, Math.max(15, Math.round(oldRaw)));

      // REVISED CONFIDENCE (Consensus across stable components + Sample Depth + Distribution Stability)
      const depthFactor = Math.min(1.0, Math.max(0.0, (f.distributions.sampleCountAllTime - 10) / 140));
      const liveFactor = f.isPreLockLiveAvailable ? 1.0 : 0.65;

      const rAll = getRankInDistribution(f.distributions.freqAllTime, top1);
      const rDay = getRankInDistribution(f.distributions.weekdayFreq, top1);
      const rW30 = getRankInDistribution(f.distributions.freqW30, top1);
      const rMarkov = getRankInDistribution(f.distributions.markovTransitionProbabilities, top1);

      const scoreAll = Math.max(0, 1 - (rAll - 1) / 30);
      const scoreDay = Math.max(0, 1 - (rDay - 1) / 30);
      const scoreW30 = Math.max(0, 1 - (rW30 - 1) / 30);
      const scoreMarkov = Math.max(0, 1 - (rMarkov - 1) / 30);

      const consensus = (scoreAll * 0.35 + scoreDay * 0.30 + scoreW30 * 0.20 + scoreMarkov * 0.15);
      const entropyFactor = Math.min(1.0, Math.max(0.0, (6.6438 - entropy) / 0.35));

      const newRaw = (depthFactor * 0.30 + consensus * 0.40 + entropyFactor * 0.15 + liveFactor * 0.15) * 100;
      const newConf = Math.min(85, Math.max(15, Math.round(newRaw)));

      evals.push({
        date,
        session,
        actual: targetSettle.twod,
        top1,
        isTop1: rank === 1,
        isTop10: rank <= 10,
        rank,
        oldConf,
        newConf,
      });
    }
  }

  console.log('--- OLD CONFIDENCE BINNING ---');
  printBinStats(evals, (e) => e.oldConf);

  console.log('\n--- REVISED CONFIDENCE BINNING ---');
  printBinStats(evals, (e) => e.newConf);
}

function printBinStats(evals: any[], confFn: (e: any) => number) {
  const low = evals.filter((e) => confFn(e) < 55);
  const med = evals.filter((e) => confFn(e) >= 55 && confFn(e) < 70);
  const high = evals.filter((e) => confFn(e) >= 70);

  function fmt(bin: any[]) {
    if (bin.length === 0) return 'N=0';
    const t1 = bin.filter((e) => e.isTop1).length;
    const t10 = bin.filter((e) => e.isTop10).length;
    const avgRank = bin.reduce((a, b) => a + b.rank, 0) / bin.length;
    return `N=${bin.length}, Top-1=${((t1 / bin.length) * 100).toFixed(2)}% (${t1}), Top-10=${((t10 / bin.length) * 100).toFixed(2)}% (${t10}), AvgRank=${avgRank.toFixed(1)}`;
  }

  console.log(`Low  (<55):   ${fmt(low)}`);
  console.log(`Med  (55-69): ${fmt(med)}`);
  console.log(`High (>=70):  ${fmt(high)}`);
}

testConfidenceCalibration();
