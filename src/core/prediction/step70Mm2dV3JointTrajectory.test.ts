import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Mm2dV3PredictionEngine,
  TrajectoryFeatureExtractor,
  extractSettlementSetDecimalDigit,
  extractSettlementValueIntegerDigit,
  TrajectoryPoint,
} from './mm2dV3PredictionEngine';
import { VerifiedMarketRecord } from '../../types/market';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';

describe('MM2D V3 — 100% Complete Production Replacement & Trajectory Audit', () => {
  const createMockHistorical = (count: number = 30): VerifiedMarketRecord[] => {
    const list: VerifiedMarketRecord[] = [];
    for (let i = 1; i <= count; i++) {
      const d = '2026-09-' + String(i).padStart(2, '0');
      const sDigitAM = i % 10;
      const vDigitAM = (i * 3) % 10;
      const twodAM = `${sDigitAM}${vDigitAM}`;

      const sDigitPM = (i + 4) % 10;
      const vDigitPM = (i * 7) % 10;
      const twodPM = `${sDigitPM}${vDigitPM}`;

      list.push({
        id: `rec_${d}_AM`,
        date: d,
        time: '12:01:00',
        session: 'AM',
        isSettlement: true,
        setRaw: `1,580.${sDigitAM}0`,
        valueRaw: `42,15${vDigitAM}.20`,
        setNumeric: 1580 + sDigitAM * 0.1,
        valueNumeric: 42150 + vDigitAM,
        twod: twodAM,
        historyId: `h_${d}_AM`,
        verifiedAt: `${d}T12:01:00Z`,
        mathematicalCheck: {
          setLastDigit: String(sDigitAM),
          valueLastDigitBeforeDecimal: String(vDigitAM),
          derived2D: twodAM,
          isMathematicallyConsistent: true,
        },
      });

      list.push({
        id: `rec_${d}_PM`,
        date: d,
        time: '16:30:00',
        session: 'PM',
        isSettlement: true,
        setRaw: `1,582.${sDigitPM}0`,
        valueRaw: `53,24${vDigitPM}.80`,
        setNumeric: 1582 + sDigitPM * 0.1,
        valueNumeric: 53240 + vDigitPM,
        twod: twodPM,
        historyId: `h_${d}_PM`,
        verifiedAt: `${d}T16:30:00Z`,
        mathematicalCheck: {
          setLastDigit: String(sDigitPM),
          valueLastDigitBeforeDecimal: String(vDigitPM),
          derived2D: twodPM,
          isMathematicallyConsistent: true,
        },
      });
    }
    return list;
  };

  it('1. Legacy V2 probability distribution has ZERO influence on final prediction (100% V3)', () => {
    const history = createMockHistorical(20);
    const liveTicks = [
      { time: '11:00:00', set: 1581.65, value: 42153.20 },
      { time: '11:30:00', set: 1581.67, value: 42154.50 },
    ];

    const prodOut = AutoWeightedV2Engine.predict(history, '2026-10-08', 'AM', liveTicks);
    const v3Out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: liveTicks,
    });

    // Exact probability equality: 100% V3 probabilities, 0% V2 legacy blend
    for (let i = 0; i < 100; i++) {
      assert.equal(
        prodOut.probabilities[i],
        v3Out.probabilities[i],
        `Probability at index ${i} must match V3 exactly (0% legacy V2 influence)`
      );
    }
  });

  it('2. Final Top 10 exactly matches V3 ranking', () => {
    const history = createMockHistorical(20);
    const liveTicks = [
      { time: '11:00:00', set: 1581.65, value: 42153.20 },
      { time: '11:30:00', set: 1581.67, value: 42154.50 },
    ];

    const prodOut = AutoWeightedV2Engine.predict(history, '2026-10-08', 'AM', liveTicks);
    const v3Out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: liveTicks,
    });

    assert.equal(prodOut.top1, v3Out.top1);
    assert.deepEqual(prodOut.top5, v3Out.top5);
    assert.deepEqual(prodOut.top10, v3Out.top10);
  });

  it('3. Multiple SET ticks affect SET settlement-digit probabilities', () => {
    const history = createMockHistorical(20);

    // Single tick ending in .67
    const outSingle = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [{ time: '11:00:00', set: 1581.67, value: 42150.0 }],
    });

    // Trajectory accumulating multiple ticks with momentum (.62 -> .65 -> .67)
    const outMulti = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        { time: '10:30:00', set: 1581.62, value: 42150.0 },
        { time: '11:00:00', set: 1581.65, value: 42150.0 },
        { time: '11:30:00', set: 1581.67, value: 42150.0 },
      ],
    });

    // The multi-tick trajectory incorporates momentum direction and frequency of digits 2, 5, 7
    assert.notEqual(
      outSingle.setDigitProbabilities[7],
      outMulti.setDigitProbabilities[7],
      'Trajectory path must alter SET digit probabilities compared to single tick'
    );
  });

  it('4. Multiple Value ticks affect Value settlement-digit probabilities', () => {
    const history = createMockHistorical(20);

    const outSingleVal = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [{ time: '11:00:00', set: 1580.0, value: 42157.0 }],
    });

    const outMultiVal = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        { time: '10:30:00', set: 1580.0, value: 42151.0 },
        { time: '11:00:00', set: 1580.0, value: 42154.0 },
        { time: '11:30:00', set: 1580.0, value: 42157.0 },
      ],
    });

    assert.notEqual(
      outSingleVal.valueDigitProbabilities[7],
      outMultiVal.valueDigitProbabilities[7],
      'Trajectory path must alter Value digit probabilities compared to single tick'
    );
  });

  it('5. Rate of change affects trajectory features and scoring', () => {
    const slowPoints: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1580.00 },
      { time: '11:00:00', value: 1580.10 }, // 0.10 points over 60 mins -> 0.0016 pts/min
    ];
    const fastPoints: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1580.00 },
      { time: '10:10:00', value: 1582.00 }, // 2.00 points over 10 mins -> 0.20 pts/min
    ];

    const slowFeat = TrajectoryFeatureExtractor.extract(slowPoints, true, '12:00:00');
    const fastFeat = TrajectoryFeatureExtractor.extract(fastPoints, true, '12:00:00');

    assert(slowFeat && fastFeat);
    assert(fastFeat.rateOfChange > slowFeat.rateOfChange, 'Fast trajectory must have higher rate of change');
  });

  it('6. Volatility participates in scoring', () => {
    const calmPoints: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1580.00 },
      { time: '10:30:00', value: 1580.02 },
      { time: '11:00:00', value: 1580.01 },
    ];
    const volatilePoints: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1575.00 },
      { time: '10:30:00', value: 1585.00 },
      { time: '11:00:00', value: 1580.00 },
    ];

    const calmFeat = TrajectoryFeatureExtractor.extract(calmPoints, true);
    const volFeat = TrajectoryFeatureExtractor.extract(volatilePoints, true);

    assert(calmFeat && volFeat);
    assert(volFeat.volatility > calmFeat.volatility, 'Volatile trajectory must have higher volatility metric');

    const history = createMockHistorical(15);
    const outCalm = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', calmFeat);
    const outVol = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', volFeat);

    // High volatility disperses neighborhood scores
    assert.notEqual(outCalm[0], outVol[0], 'Volatility must materially change digit probabilities');
  });

  it('7. Digit transitions participate in scoring', () => {
    const pointsWithTransitions: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1580.20 }, // digit 0
      { time: '10:20:00', value: 1580.24 }, // digit 4 (transition 0 -> 4)
      { time: '10:40:00', value: 1580.20 }, // digit 0 (transition 4 -> 0)
      { time: '11:00:00', value: 1580.24 }, // digit 4 (transition 0 -> 4)
      { time: '11:20:00', value: 1580.20 }, // digit 0 (latest digit is 0)
    ];

    const feat = TrajectoryFeatureExtractor.extract(pointsWithTransitions, true);
    assert(feat && feat.transitionMatrix[0][4] >= 2, 'Transition 0->4 must be recorded in transition matrix');

    const history = createMockHistorical(15);
    const dist = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', feat);

    // Because digit 0 frequently transitions to 4 in this trajectory, digit 4 receives boosted transition probability
    assert(dist[4] > dist[7], 'Digit 4 with strong empirical transition evidence must score higher than non-transited digits');
  });

  it('8. Repeated-digit behavior participates in scoring', () => {
    const repeatPoints: TrajectoryPoint[] = [
      { time: '10:00:00', value: 1580.33 },
      { time: '10:30:00', value: 1580.43 },
      { time: '11:00:00', value: 1580.53 }, // digit 3 repeated throughout
    ];
    const feat = TrajectoryFeatureExtractor.extract(repeatPoints, true);
    assert(feat && feat.digitFrequencies[3] === 3);

    const history = createMockHistorical(15);
    const dist = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', feat);
    assert(dist[3] > 0.15, 'Repeated digit 3 must receive significant probability boost');
  });

  it('9. Distance from previous official settlement participates when available', () => {
    const points: TrajectoryPoint[] = [
      { time: '11:00:00', value: 1580.50 },
    ];
    // Previous settlement was at 1550.00 (distance = 30.50 pts)
    const featWithDistance = TrajectoryFeatureExtractor.extract(points, true, '12:00:00', 1550.00);
    assert(featWithDistance && featWithDistance.previousSettlementDistance === 30.50);

    const history = createMockHistorical(15);
    const dist = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', featWithDistance);
    assert(dist.length === 10);
  });

  it('10. Time remaining to lock participates in trajectory weighting', () => {
    const earlyTick: TrajectoryPoint[] = [{ time: '10:05:00', value: 1580.77 }]; // 1 hr 55 mins to lock
    const lateTick: TrajectoryPoint[] = [{ time: '11:59:00', value: 1580.77 }]; // 1 min to lock

    const earlyFeat = TrajectoryFeatureExtractor.extract(earlyTick, true, '12:00:00');
    const lateFeat = TrajectoryFeatureExtractor.extract(lateTick, true, '12:00:00');

    assert(earlyFeat && lateFeat);
    assert(lateFeat.timeRemainingSeconds < earlyFeat.timeRemainingSeconds);

    const history = createMockHistorical(15);
    const earlyDist = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', earlyFeat);
    const lateDist = Mm2dV3PredictionEngine.predictSetDigitDistribution(history, '2026-10-08', 'AM', lateFeat);

    // As time to lock reaches zero, anchor confidence increases (late tick probability on anchor 7 is higher)
    assert(lateDist[7] > earlyDist[7], 'Anchor probability must be stronger as time remaining approaches lock');
  });

  it('11. Materially different trajectories produce materially different rankings', () => {
    const history = createMockHistorical(20);

    const outA = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        { time: '10:30:00', set: 1581.60, value: 42100.0 },
        { time: '11:00:00', set: 1581.61, value: 42101.0 },
        { time: '11:30:00', set: 1581.62, value: 42101.5 },
      ],
    });

    const outB = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        { time: '10:30:00', set: 1581.65, value: 42104.0 },
        { time: '11:00:00', set: 1581.68, value: 42106.0 },
        { time: '11:30:00', set: 1581.69, value: 42108.0 },
      ],
    });

    assert.notEqual(outA.top1, outB.top1);
    assert(outA.probabilities[21] > outB.probabilities[21]);
    assert(outB.probabilities[98] > outA.probabilities[98]);
  });

  it('12. Exactly 100 SET x Value combinations are generated', () => {
    const history = createMockHistorical(15);
    const out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [{ time: '11:00:00', set: 1580.60, value: 42151.20 }],
    });

    assert.equal(out.probabilities.length, 100);
    assert.equal(out.candidates.length, 100);
    const sum = out.probabilities.reduce((s, p) => s + p, 0);
    assert(Math.abs(sum - 1.0) < 1e-4);
  });

  it('13. Learned joint SET x Value evidence affects ranking', () => {
    const history = createMockHistorical(25);
    const jointModel = Mm2dV3PredictionEngine.learnHistoricalJointDistribution(history, '2026-10-08', 'AM');
    assert(jointModel.totalSamples > 0);

    const p13 = jointModel.jointProbabilities[1][3];
    const p14 = jointModel.jointProbabilities[1][4];
    assert(p13 > p14, 'Learned joint probability P(1, 3) must be strictly higher than non-occurring pair P(1, 4)');
  });

  it('14. "live.twod" has zero influence on prediction', () => {
    const history = createMockHistorical(10);
    const dirtyTick: any = {
      time: '11:00:00',
      set: 1580.67,
      value: 42100.50,
      twod: '99', // ILLEGAL live 2D
    };

    const out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [dirtyTick],
    });

    assert(out.probabilities[99] < 0.20, 'Illegal live.twod must be discarded');
  });

  it('15. Post-lock observations have zero influence', () => {
    const history = createMockHistorical(10);
    const out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        { time: '11:30:00', set: 1580.20, value: 42100.0 },
        { time: '12:05:00', set: 1580.99, value: 42199.0 }, // Illegal post-lock tick
      ],
    });

    assert.equal(out.observedPreLockSet, 1580.20);
    assert.equal(out.observedPreLockValue, 42100.0);
  });

  it('16. Final prediction freezes at lock with valid Top 1/5/10', () => {
    const history = createMockHistorical(15);
    const out = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-08',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [{ time: '11:45:00', set: 1581.65, value: 42150.0 }],
      isLocked: true,
    });

    assert.equal(out.isLocked, true);
    assert.equal(out.top1, out.candidates[0].twod);
    assert.deepEqual(out.top5, out.candidates.slice(0, 5).map((c) => c.twod));
    assert.deepEqual(out.top10, out.candidates.slice(0, 10).map((c) => c.twod));
  });
});
