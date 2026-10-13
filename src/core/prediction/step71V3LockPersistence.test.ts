import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Mm2dV3PredictionEngine } from './mm2dV3PredictionEngine';
import { AutoWeightedV2Engine } from './autoWeightedV2Engine';
import { AutoWeightedV2ShadowValidator } from './autoWeightedV2ShadowValidator';
import { AutoWeightedV2ShadowTracker } from './autoWeightedV2ShadowTracker';
import { LockEngine } from './lockEngine';
import { SetLastDigitSignalV1 } from './setLastDigitSignalV1';
import { VerifiedMarketRecord } from '../../types/market';

describe('MM2D V3 Step 71: Post-Lock Immutability, Ticks Invariance, and Reload Persistence', () => {
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

  it('1. V3 Trajectory Engine is 100% the sole production source of Top-10 and Top-1', () => {
    const history = createMockHistorical(25);
    const liveTicks = [
      { time: '11:15:00', set: 1581.45, value: 42152.10 },
      { time: '11:45:00', set: 1581.85, value: 42153.30 },
    ];
    const v3Direct = Mm2dV3PredictionEngine.predict({
      targetDate: '2026-10-09',
      session: 'AM',
      historicalRecords: history,
      liveObservations: liveTicks,
    });
    const prodEngineOut = AutoWeightedV2Engine.predict(history, '2026-10-09', 'AM', liveTicks);

    assert.equal(prodEngineOut.top1, v3Direct.top1, 'Production top1 must match V3 top1');
    assert.deepEqual(prodEngineOut.top5, v3Direct.top5, 'Production top5 must match V3 top5');
    assert.deepEqual(prodEngineOut.top10, v3Direct.top10, 'Production top10 must match V3 top10');
    for (let i = 0; i < 100; i++) {
      assert.equal(prodEngineOut.probabilities[i], v3Direct.probabilities[i]);
    }
  });

  it('2. AM Lock cutoff (12:00 BKK / 11:30 MMT) freezes V3 predictions permanently', () => {
    AutoWeightedV2ShadowValidator.clearFrozenSnapshotsForTesting();
    const history = createMockHistorical(25);
    const preLockTicks = [
      { time: '11:15:00', set: 1581.45, value: 42152.10 },
      { time: '11:50:00', set: 1581.85, value: 42153.30 },
    ];

    // Evaluate right at AM lock boundary (12:00:00 Bangkok)
    const lockClock = new Date('2026-10-09T12:00:00+07:00');
    assert.equal(LockEngine.isSessionLocked('2026-10-09', 'AM', lockClock), true);

    const frozenSnapshot = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
      history,
      '2026-10-09',
      'AM',
      preLockTicks,
      lockClock
    );

    assert.equal(frozenSnapshot.isFrozenAtLock, true);
    const frozenTop1 = frozenSnapshot.top1;
    const frozenTop5 = [...frozenSnapshot.top5];
    const frozenTop10 = [...frozenSnapshot.top10];

    // Ingest new post-lock live ticks after lock (e.g., 12:00:30 BKK)
    const postLockTicks = [
      ...preLockTicks,
      { time: '12:00:30', set: 1599.99, value: 99999.99 },
      { time: '12:01:00', set: 1599.99, value: 99999.99 },
    ];

    const afterLockClock = new Date('2026-10-09T12:00:35+07:00');
    const afterLockEval = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
      history,
      '2026-10-09',
      'AM',
      postLockTicks,
      afterLockClock
    );

    // Frozen prediction must NOT change
    assert.equal(afterLockEval.top1, frozenTop1, 'Top-1 must remain strictly unchanged after lock');
    assert.deepEqual(afterLockEval.top5, frozenTop5, 'Top-5 must remain strictly unchanged after lock');
    assert.deepEqual(afterLockEval.top10, frozenTop10, 'Top-10 must remain strictly unchanged after lock');
    assert.equal(afterLockEval.integrityHash, frozenSnapshot.integrityHash, 'Hash must remain strictly identical');
  });

  it('3. PM Lock cutoff (16:00 BKK / 15:30 MMT) freezes V3 predictions permanently', () => {
    AutoWeightedV2ShadowValidator.clearFrozenSnapshotsForTesting();
    const history = createMockHistorical(25);
    const preLockTicks = [
      { time: '15:15:00', set: 1583.20, value: 53100.10 },
      { time: '15:55:00', set: 1583.50, value: 53102.40 },
    ];

    const pmLockClock = new Date('2026-10-09T16:00:00+07:00');
    assert.equal(LockEngine.isSessionLocked('2026-10-09', 'PM', pmLockClock), true);

    const frozenSnapshot = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
      history,
      '2026-10-09',
      'PM',
      preLockTicks,
      pmLockClock
    );

    assert.equal(frozenSnapshot.isFrozenAtLock, true);
    const frozenTop1 = frozenSnapshot.top1;
    const frozenTop10 = [...frozenSnapshot.top10];

    // New ticks during PM post-lock window
    const postLockTicks = [
      ...preLockTicks,
      { time: '16:01:00', set: 1585.00, value: 54000.00 },
    ];
    const laterClock = new Date('2026-10-09T16:15:00+07:00');

    const evalLater = AutoWeightedV2ShadowValidator.getOrFreezeShadowPrediction(
      history,
      '2026-10-09',
      'PM',
      postLockTicks,
      laterClock
    );

    assert.equal(evalLater.top1, frozenTop1, 'PM Top-1 must remain identical after lock');
    assert.deepEqual(evalLater.top10, frozenTop10, 'PM Top-10 must remain identical after lock');
  });

  it('4. ShadowTracker simulates page reload and preserves frozen session across instances', () => {
    // Mock local storage in Node environment
    const storageMap = new Map<string, string>();
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => storageMap.get(k) || null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
      },
    };

    const tracker1 = new AutoWeightedV2ShadowTracker();
    const history = createMockHistorical(25);
    const ticks = [{ time: '11:45:00', set: 1581.85, value: 42153.30 }];
    const lockClock = new Date('2026-10-09T12:00:00+07:00');

    const frozen1 = tracker1.freezeLockSnapshot('2026-10-09', 'AM', history, ticks, lockClock);
    assert.equal(frozen1.isFrozenAtLock, true);

    // Simulate page reload by creating a brand new tracker instance
    const tracker2 = new AutoWeightedV2ShadowTracker();
    const loadedRec = tracker2.getEvaluation('2026-10-09', 'AM');

    assert(loadedRec !== null, 'Loaded record must exist on simulated reload');
    assert.equal(loadedRec.isFrozenAtLock, true);
    assert.equal(loadedRec.top1, frozen1.top1, 'Reloaded top1 must match original frozen top1');
    assert.deepEqual(loadedRec.top10, frozen1.top10, 'Reloaded top10 must match original frozen top10');

    // Clean up mock
    delete (globalThis as any).window;
  });

  it('5. SetLastDigitSignalV1 preserves frozen candidates and rejects live.twod', () => {
    const history = createMockHistorical(25);
    const liveTicks = [
      { time: '11:40:00', set: 1581.65, value: 42153.20 },
      { time: '11:58:00', set: 1581.67, value: 42154.50 },
    ];

    // 1. Before lock (11:50 BKK): Candidates must remain hidden (0 candidates)
    const preLockClock = new Date('2026-10-09T11:50:00+07:00');
    const eligPre = SetLastDigitSignalV1.resolveEligibility({
      currentTime: preLockClock,
      historicalRecords: history,
    });
    assert.equal(eligPre.isLocked, false);
    assert.equal(eligPre.eligibleSession, 'AM');

    // 2. At lock (12:00:00 BKK): Final signal freezes 1-3 candidates
    const lockClock = new Date('2026-10-09T12:00:00+07:00');
    const eligLock = SetLastDigitSignalV1.resolveEligibility({
      currentTime: lockClock,
      historicalRecords: history,
    });
    assert.equal(eligLock.isLocked, true);

    const lockedSignal = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-09',
      session: 'AM',
      historicalRecords: history,
      liveObservations: liveTicks,
      currentTime: lockClock,
    });

    assert.equal(lockedSignal.isLocked, true);
    assert(lockedSignal.candidates.length >= 1 && lockedSignal.candidates.length <= 3, 'Must have 1 to 3 candidates');
    assert.equal(lockedSignal.antiLeakageAudit.zeroLiveTwodUsed, true);
    assert.equal(lockedSignal.antiLeakageAudit.isolatedFromV2Ensemble, true);

    // 3. Post-lock ticks cannot change frozen candidates
    const postLockClock = new Date('2026-10-09T12:00:45+07:00');
    const postLockSignal = SetLastDigitSignalV1.predict({
      targetDate: '2026-10-09',
      session: 'AM',
      historicalRecords: history,
      liveObservations: [
        ...liveTicks,
        { time: '12:00:30', set: 1599.99, value: 99999.99 },
      ],
      currentTime: postLockClock,
    });

    // In SetLastDigitSignalV1, observations after 12:00:00 are filtered out
    assert.deepEqual(
      postLockSignal.candidates.map(c => c.digit),
      lockedSignal.candidates.map(c => c.digit),
      'SetLastDigitSignal candidates must remain identical after lock'
    );
  });
});
