import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { FeatureContractAuditor } from '../src/core/prediction/featureContract';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
import { fetch2DResultByDate } from '../src/core/api/thaistockClient';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';
import { VerifiedMarketRecord } from '../src/types/market';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${description}`);
  } else {
    console.error(`  ❌ [FAIL] ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runStep28Evaluation() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 28: PRODUCTION FREEZE & REAL-DAY EVALUATION');
  console.log('================================================================\n');

  // Initialize storage and load verified dataset
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  const allHistoricalRecords = await globalDatasetStorage.queryAllVerifiedRecords();

  console.log(`Verified historical dataset records loaded: ${allHistoricalRecords.length}\n`);

  // ---------------------------------------------------------------------------
  // SECTION 1: PRODUCTION CHAMPION & LAB FREEZE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('--- [SECTION 1] Production Model Freeze & Invariant Audits ---');
  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '1a. PredictionEngine.PRODUCTION_MODEL strictly frozen at ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    PRODUCTION_MODEL_VERSION === 'ALL_TIME_FREQUENCY_V1',
    '1b. PRODUCTION_MODEL_VERSION constant strictly equals ALL_TIME_FREQUENCY_V1.'
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: REAL TRADING DAYS AM/PM EVALUATION AGAINST THAISTOCK2D
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] Real Trading-Day Immutable Snapshot vs Official Settlements ---');

  const testTradingDays = ['2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09'];

  for (const date of testTradingDays) {
    console.log(`\n  >> Evaluating Real Trading Day: ${date}`);
    LockEngine.clearFrozenSnapshotsForTesting();

    const rawData = await fetch2DResultByDate(date);
    const child = rawData[0]?.child || [];

    // Prior records strictly before this day
    const priorHistorical = allHistoricalRecords.filter((r) => r.date < date);

    // AM Pre-lock live feed (< 12:00:00)
    const amPreLockFeed = child
      .filter((c) => c.time < '12:00:00')
      .map((c) => ({
        time: c.time,
        set: c.set,
        value: c.value,
      }));

    // Check AM Publish Time (11:55 Bangkok)
    const amPublishTime = new Date(`${date}T11:55:00+07:00`);
    const amPublished = LockEngine.getOrFreezePrediction(
      priorHistorical,
      date,
      'AM',
      amPreLockFeed,
      amPublishTime
    );

    assert(
      amPublished.output.status === 'PREDICTION_READY',
      `AM [${date}] at publish time (11:55:00 BKK) has status PREDICTION_READY.`
    );
    assert(
      amPublished.output.top1 !== '--',
      `AM [${date}] at publish time has valid top1 prediction: "${amPublished.output.top1}".`
    );

    // Check AM Lock Time (12:00 Bangkok)
    const amLockTime = new Date(`${date}T12:00:00+07:00`);
    const amLocked = LockEngine.getOrFreezePrediction(
      priorHistorical,
      date,
      'AM',
      amPreLockFeed,
      amLockTime
    );

    assert(
      amLocked.isLocked === true && amLocked.output.isFrozen === true,
      `AM [${date}] at lock time (12:00:00 BKK) is immutably frozen.`
    );
    assert(
      amLocked.output.top1 === amPublished.output.top1,
      `AM [${date}] top1 did not fluctuate between publish and lock (${amLocked.output.top1}).`
    );
    assert(
      Boolean(amLocked.output.featureIntegrityHash && amLocked.output.featureIntegrityHash.length > 4),
      `AM [${date}] snapshot contains valid featureIntegrityHash (${amLocked.output.featureIntegrityHash}).`
    );

    // Post-Lock Anti-Mutation Test: Ensure later live data or settlements cannot mutate locked AM snapshot
    const amPostLockFeed = [
      ...amPreLockFeed,
      { time: '12:00:30', set: '9999.99', value: '999999.99' },
    ];
    const amPostLockCheck = LockEngine.getOrFreezePrediction(
      priorHistorical,
      date,
      'AM',
      amPostLockFeed,
      new Date(`${date}T12:05:00+07:00`)
    );
    assert(
      amPostLockCheck.output.top1 === amLocked.output.top1 &&
        amPostLockCheck.output.featureIntegrityHash === amLocked.output.featureIntegrityHash,
      `AM [${date}] post-lock live feed updates cannot mutate frozen snapshot.`
    );

    // Compare with official AM settlement
    const amSettlement = child.find((c) => c.time === '12:01:00');
    if (amSettlement) {
      const hitTop1 = amLocked.output.top1 === amSettlement.twod;
      const hitTop5 = amLocked.output.top5.includes(amSettlement.twod);
      const hitTop10 = amLocked.output.top10.includes(amSettlement.twod);
      const rank = amLocked.output.candidates.findIndex((c) => c.twod === amSettlement.twod) + 1;
      console.log(
        `    AM Settlement: "${amSettlement.twod}" | Top-1: "${amLocked.output.top1}" | Hit Top-1: ${hitTop1} | Hit Top-5: ${hitTop5} | Rank: ${rank}`
      );
      assert(
        rank > 0 && rank <= 100,
        `AM [${date}] candidate rank for official settlement (${amSettlement.twod}) is valid (rank: ${rank}).`
      );
    } else {
      console.log(`    AM Settlement: PENDING / NOT PRESENT upstream for ${date}`);
    }

    // --- PM SESSION ---
    // Pre-lock live feed (< 16:00:00)
    const pmPreLockFeed = child
      .filter((c) => c.time < '16:00:00')
      .map((c) => ({
        time: c.time,
        set: c.set,
        value: c.value,
      }));

    // For PM: Prior records can include AM settlement if settled
    const priorHistoricalPm: VerifiedMarketRecord[] = [...priorHistorical];
    const existingAmVerified = allHistoricalRecords.find(
      (r) => r.date === date && r.session === 'AM' && r.isSettlement
    );
    if (existingAmVerified) {
      priorHistoricalPm.push(existingAmVerified);
    } else if (amSettlement) {
      const setClean = amSettlement.set.replace(/,/g, '');
      const valClean = amSettlement.value.replace(/,/g, '');
      priorHistoricalPm.push({
        id: `${date}_12:01:00_${amSettlement.history_id || 'manual'}`,
        date,
        time: '12:01:00',
        session: 'AM',
        isSettlement: true,
        twod: amSettlement.twod,
        setRaw: amSettlement.set,
        valueRaw: amSettlement.value,
        setNumeric: parseFloat(setClean),
        valueNumeric: parseFloat(valClean),
        historyId: String(amSettlement.history_id || 'manual'),
        verifiedAt: `${date}T12:01:00+07:00`,
        mathematicalCheck: {
          setLastDigit: setClean.charAt(setClean.length - 1),
          valueLastDigitBeforeDecimal: valClean.split('.')[0].slice(-1),
          derived2D: amSettlement.twod,
          isMathematicallyConsistent: true,
        },
      });
    }

    // Check PM Publish Time (15:55 Bangkok)
    const pmPublishTime = new Date(`${date}T15:55:00+07:00`);
    const pmPublished = LockEngine.getOrFreezePrediction(
      priorHistoricalPm,
      date,
      'PM',
      pmPreLockFeed,
      pmPublishTime
    );

    assert(
      pmPublished.output.status === 'PREDICTION_READY',
      `PM [${date}] at publish time (15:55:00 BKK) has status PREDICTION_READY.`
    );
    assert(
      pmPublished.output.top1 !== '--',
      `PM [${date}] at publish time has valid top1 prediction: "${pmPublished.output.top1}".`
    );

    // Check PM Lock Time (16:00 Bangkok)
    const pmLockTime = new Date(`${date}T16:00:00+07:00`);
    const pmLocked = LockEngine.getOrFreezePrediction(
      priorHistoricalPm,
      date,
      'PM',
      pmPreLockFeed,
      pmLockTime
    );

    assert(
      pmLocked.isLocked === true && pmLocked.output.isFrozen === true,
      `PM [${date}] at lock time (16:00:00 BKK) is immutably frozen.`
    );
    assert(
      pmLocked.output.top1 === pmPublished.output.top1,
      `PM [${date}] top1 did not fluctuate between publish and lock (${pmLocked.output.top1}).`
    );

    // Post-Lock Anti-Mutation Test for PM
    const pmPostLockCheck = LockEngine.getOrFreezePrediction(
      priorHistoricalPm,
      date,
      'PM',
      [...pmPreLockFeed, { time: '16:10:00', set: '8888.88', value: '888888.88' }],
      new Date(`${date}T16:20:00+07:00`)
    );
    assert(
      pmPostLockCheck.output.top1 === pmLocked.output.top1 &&
        pmPostLockCheck.output.featureIntegrityHash === pmLocked.output.featureIntegrityHash,
      `PM [${date}] post-lock live feed updates cannot mutate frozen snapshot.`
    );

    // Compare with official PM settlement
    const pmSettlement = child.find((c) => c.time === '16:30:00');
    if (pmSettlement) {
      const hitTop1 = pmLocked.output.top1 === pmSettlement.twod;
      const hitTop5 = pmLocked.output.top5.includes(pmSettlement.twod);
      const hitTop10 = pmLocked.output.top10.includes(pmSettlement.twod);
      const rank = pmLocked.output.candidates.findIndex((c) => c.twod === pmSettlement.twod) + 1;
      console.log(
        `    PM Settlement: "${pmSettlement.twod}" | Top-1: "${pmLocked.output.top1}" | Hit Top-1: ${hitTop1} | Hit Top-5: ${hitTop5} | Rank: ${rank}`
      );
      assert(
        rank > 0 && rank <= 100,
        `PM [${date}] candidate rank for official settlement (${pmSettlement.twod}) is valid (rank: ${rank}).`
      );
    } else {
      console.log(`    PM Settlement: PENDING / NOT PRESENT upstream for ${date}`);
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: FEATURE EXTRACTION ANTI-LEAKAGE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] Feature Vector Integrity & Anti-Leakage Audits ---');

  const refDate = '2026-09-08';
  const amEligible = FeatureEngine.filterEligibleHistoricalRecords(allHistoricalRecords, refDate, 'AM');
  const amAudit = FeatureContractAuditor.auditHistoricalInputRecords(amEligible.eligibleRecords, refDate, 'AM');
  assert(amAudit.isCompliant === true, '3a. AM historical inputs are 100% compliant with Feature Contract.');
  assert(amAudit.violations.length === 0, '3b. AM historical input has zero contract violations.');

  // Verify that raw un-filtered records correctly trigger anti-leakage audit violations
  const rawAudit = FeatureContractAuditor.auditHistoricalInputRecords(allHistoricalRecords, refDate, 'AM');
  assert(rawAudit.isCompliant === false, '3c. Anti-leakage auditor correctly flags unfiltered historical records.');
  assert(rawAudit.violations.length > 0, '3d. Anti-leakage auditor correctly detects cross-session and future/target records in raw pool.');

  const amFeat = FeatureEngine.extractAmFeatures(allHistoricalRecords, refDate);
  assert(amFeat.success === true, '3e. AM features extracted successfully.');
  assert(amFeat.featureVector?.session === 'AM', '3f. AM feature vector session strictly AM.');
  assert(amFeat.featureVector?.distributions.todayAmSettlement2D === null, '3g. AM feature vector todayAmSettlement2D is null (no leakage).');

  const pmEligible = FeatureEngine.filterEligibleHistoricalRecords(allHistoricalRecords, refDate, 'PM');
  const pmAudit = FeatureContractAuditor.auditHistoricalInputRecords(pmEligible.eligibleRecords, refDate, 'PM');
  assert(pmAudit.isCompliant === true, '3h. PM historical inputs are 100% compliant with Feature Contract.');
  assert(pmAudit.violations.length === 0, '3i. PM historical input has zero contract violations.');

  const pmFeat = FeatureEngine.extractPmFeatures(allHistoricalRecords, refDate);
  assert(pmFeat.success === true, '3j. PM features extracted successfully.');
  assert(pmFeat.featureVector?.session === 'PM', '3k. PM feature vector session strictly PM.');
  assert(
    pmFeat.featureVector?.distributions.todayAmSettlement2D === '38',
    '3l. PM feature vector correctly uses confirmed AM settlement (38) from today 12:01.'
  );

  console.log('\n================================================================');
  console.log(`  STEP 28 AUDIT SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');
}

runStep28Evaluation().catch((err) => {
  console.error('\n❌ STEP 28 AUDIT FAILED:', err);
  process.exit(1);
});
