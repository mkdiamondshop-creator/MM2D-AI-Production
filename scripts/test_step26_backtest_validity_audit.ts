import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { BenchmarkEngine } from '../src/core/prediction/benchmarkEngine';
import { PredictionEngine } from '../src/core/prediction/predictionEngine';
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

async function runStep26Audit() {
  console.log('================================================================');
  console.log('  MM2D LEADER — STEP 26: BACKTEST DATA VALIDITY AUDIT TEST      ');
  console.log('================================================================\n');

  // Initialize and load dataset
  await globalDatasetStorage.init();
  await globalOfficialResultAdapter.getRecentOfficialResults(30);
  // Scope to the Step 26 audited evaluation window (up to 2026-09-08)
  const allRecords = (await globalDatasetStorage.queryAllVerifiedRecords()).filter(
    (r) => r.date <= '2026-09-08'
  );

  // ---------------------------------------------------------------------------
  // TEST SECTION 1: INVENTORY OF VERIFIED HISTORICAL RECORDS
  // ---------------------------------------------------------------------------
  console.log('--- [TEST 1] Verified Dataset Inventory & Classification ---');
  assert(allRecords.length === 82, `1a. Total verified records in storage = 82 (got ${allRecords.length})`);

  const settlements = allRecords
    .filter((r) => r.isSettlement)
    .sort((a, b) => a.date.localeCompare(b.date) || a.session.localeCompare(b.session));
  assert(settlements.length === 40, `1b. Total verified settlement records = 40 (got ${settlements.length})`);

  const amSettlements = settlements.filter((r) => r.session === 'AM');
  const pmSettlements = settlements.filter((r) => r.session === 'PM');
  assert(amSettlements.length === 21, `1c. Total AM settlements = 21 (got ${amSettlements.length})`);
  assert(pmSettlements.length === 19, `1d. Total PM settlements = 19 (got ${pmSettlements.length})`);

  const nonSettlements = allRecords.filter((r) => !r.isSettlement);
  assert(nonSettlements.length === 42, `1e. Total non-settlement checkpoint records = 42 (got ${nonSettlements.length})`);

  // Verify all 21 trading dates are represented
  const uniqueDates = Array.from(new Set(settlements.map((r) => r.date))).sort();
  assert(uniqueDates.length === 21, `1f. Total unique trading dates = 21 (from ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]})`);

  // Verify missing PM settlements are genuine upstream omissions (not ingestion bugs)
  const d0811 = allRecords.filter((r) => r.date === '2026-08-11');
  const d0903 = allRecords.filter((r) => r.date === '2026-09-03');
  assert(
    d0811.some((r) => r.time === '11:00:00') &&
      d0811.some((r) => r.time === '12:01:00') &&
      d0811.some((r) => r.time === '15:00:00') &&
      !d0811.some((r) => r.time === '16:30:00'),
    '1g. 2026-08-11 correctly contains 3 records (11:00, 12:01, 15:00) with 16:30 absent upstream.'
  );
  assert(
    d0903.some((r) => r.time === '11:00:00') &&
      d0903.some((r) => r.time === '12:01:00') &&
      d0903.some((r) => r.time === '15:00:00') &&
      !d0903.some((r) => r.time === '16:30:00'),
    '1h. 2026-09-03 correctly contains 3 records (11:00, 12:01, 15:00) with 16:30 absent upstream.'
  );

  // ---------------------------------------------------------------------------
  // TEST SECTION 2: AUDIT WHY STEP 25 EVALUATED 19 SESSIONS (IDENTIFY FILTERING DEFECT)
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 2] Step 25 Filtering Defect Root-Cause Audit ---');

  // Explain: On 2026-08-24:
  // priorAmSettlements = 10 (dates 08-10, 08-11, 08-12, 08-13, 08-14, 08-17, 08-18, 08-19, 08-20, 08-21)
  // priorPmSettlements = 9  (dates 08-10, 08-12, 08-13, 08-14, 08-17, 08-18, 08-19, 08-20, 08-21; 08-11 had no PM)
  const priorToAug24 = settlements.filter((r) => r.date < '2026-08-24');
  const priorAmToAug24 = priorToAug24.filter((r) => r.session === 'AM');
  const priorPmToAug24 = priorToAug24.filter((r) => r.session === 'PM');
  assert(priorAmToAug24.length === 10, `2a. Prior AM settlements before 2026-08-24 = 10 (got ${priorAmToAug24.length})`);
  assert(priorPmToAug24.length === 9, `2b. Prior PM settlements before 2026-08-24 = 9 (got ${priorPmToAug24.length})`);

  // Show that date-level OR filtering (priorAm < 10 || priorPm < 10) skipped 2026-08-24 AM
  const dateLevelOrCondition = priorAmToAug24.length < 10 || priorPmToAug24.length < 10;
  assert(dateLevelOrCondition === true, '2c. Confirmed: Date-level OR condition (priorAm < 10 || priorPm < 10) evaluates to TRUE, causing 2026-08-24 AM to be dropped.');

  // Verify that AM feature extraction on 2026-08-24 was actually 100% valid
  const amAug24Features = FeatureEngine.extractAmFeatures(allRecords, '2026-08-24');
  assert(amAug24Features.success === true, '2d. 2026-08-24 AM features extraction succeeds (sample count = 10, status = READY).');
  assert(amAug24Features.featureVector?.distributions.sampleCountAllTime === 10, '2e. 2026-08-24 AM sampleCountAllTime = 10.');

  // Verify that PM feature extraction on 2026-08-24 correctly fails due to 9 < 10
  const pmAug24Features = FeatureEngine.extractPmFeatures(allRecords, '2026-08-24');
  assert(pmAug24Features.success === false, '2f. 2026-08-24 PM features extraction correctly reports insufficient historical data (9 < 10).');
  assert(pmAug24Features.status === 'INSUFFICIENT_HISTORICAL_DATA', '2g. 2026-08-24 PM status = INSUFFICIENT_HISTORICAL_DATA.');

  // ---------------------------------------------------------------------------
  // TEST SECTION 3: WALK-FORWARD BENCHMARK WITH FIXED SESSION ISOLATION
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 3] Walk-Forward Benchmark Coverage with Session Isolation ---');
  const benchmarkReport = BenchmarkEngine.runStep25Benchmark(allRecords, {
    minTrainingSettlements: 10,
    recentSessionsCount: 15,
  });

  const { evaluationPeriod } = benchmarkReport;
  assert(
    evaluationPeriod.totalEvaluatedSessions === 20,
    `3a. Maximum valid out-of-sample evaluated sessions = 20 (AM: ${evaluationPeriod.amEvaluatedSessions}, PM: ${evaluationPeriod.pmEvaluatedSessions}) (got ${evaluationPeriod.totalEvaluatedSessions})`
  );
  assert(evaluationPeriod.amEvaluatedSessions === 11, `3b. Total evaluated AM sessions = 11 (got ${evaluationPeriod.amEvaluatedSessions})`);
  assert(evaluationPeriod.pmEvaluatedSessions === 9, `3c. Total evaluated PM sessions = 9 (got ${evaluationPeriod.pmEvaluatedSessions})`);
  assert(evaluationPeriod.startDate === '2026-08-24', `3d. Evaluation start date expanded to 2026-08-24 (got ${evaluationPeriod.startDate})`);
  assert(evaluationPeriod.endDate === '2026-09-07', `3e. Evaluation end date = 2026-09-07 (got ${evaluationPeriod.endDate})`);
  assert(evaluationPeriod.totalTargetDates === 11, `3f. Total evaluated target dates = 11 (got ${evaluationPeriod.totalTargetDates})`);

  // ---------------------------------------------------------------------------
  // TEST SECTION 4: EXHAUSTIVE SESSION EXCLUSION AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 4] Exhaustive Session Accounting (40 Total = 20 Evaluated + 20 Excluded) ---');

  let auditedEvaluatedCount = 0;
  let auditedExcludedCount = 0;

  for (const s of settlements) {
    const prior = settlements.filter((r) => r.date < s.date);
    const priorForSession = prior.filter((r) => r.session === s.session);

    if (priorForSession.length >= 10) {
      auditedEvaluatedCount++;
    } else {
      auditedExcludedCount++;
    }
  }

  assert(auditedEvaluatedCount === 20, `4a. Exactly 20 settlement sessions meet >= 10 prior training requirement (got ${auditedEvaluatedCount})`);
  assert(auditedExcludedCount === 20, `4b. Exactly 20 settlement sessions fail < 10 prior training requirement (got ${auditedExcludedCount})`);
  assert(auditedEvaluatedCount + auditedExcludedCount === 40, '4c. Evaluated + Excluded = 40 total verified settlements.');

  // ---------------------------------------------------------------------------
  // TEST SECTION 5: STRICT POINT-IN-TIME ANTI-LEAKAGE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 5] Strict Anti-Leakage & Contract Compliance Verification ---');

  // Verify all 11 AM evaluations strictly adhered to point-in-time rules
  const evaluatedDates = [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
    '2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02',
    '2026-09-03', '2026-09-04', '2026-09-07'
  ];

  for (const d of evaluatedDates) {
    const amFeat = FeatureEngine.extractAmFeatures(allRecords, d);
    assert(amFeat.success === true, `5a. AM features for ${d} valid and leak-free`);
    // Sample count must strictly equal number of historical AM settlements strictly before d
    const expectedPriorAm = settlements.filter((r) => r.date < d && r.session === 'AM').length;
    assert(
      amFeat.featureVector?.distributions.sampleCountAllTime === expectedPriorAm,
      `5b. AM ${d} sampleCountAllTime (${amFeat.featureVector?.distributions.sampleCountAllTime}) strictly matches prior count (${expectedPriorAm})`
    );
  }

  // Verify all 9 PM evaluations strictly adhered to point-in-time rules
  const pmEvaluatedDates = evaluatedDates.filter((d) => d !== '2026-08-24' && d !== '2026-09-03');
  for (const d of pmEvaluatedDates) {
    const pmFeat = FeatureEngine.extractPmFeatures(allRecords, d);
    assert(pmFeat.success === true, `5c. PM features for ${d} valid and leak-free`);
    const expectedPriorPm = settlements.filter((r) => r.date < d && r.session === 'PM').length;
    assert(
      pmFeat.featureVector?.distributions.sampleCountAllTime === expectedPriorPm,
      `5d. PM ${d} sampleCountAllTime (${pmFeat.featureVector?.distributions.sampleCountAllTime}) strictly matches prior count (${expectedPriorPm})`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST SECTION 6: PRODUCTION SAFETY & CHAMPION INTEGRITY
  // ---------------------------------------------------------------------------
  console.log('\n--- [TEST 6] Production Champion Safety & Invariant Freezing ---');
  assert(
    PredictionEngine.PRODUCTION_MODEL === 'ALL_TIME_FREQUENCY_V1',
    '6a. PredictionEngine.PRODUCTION_MODEL remains strictly frozen at ALL_TIME_FREQUENCY_V1.'
  );
  assert(
    benchmarkReport.governance.frozenProductionChampion === 'ALL_TIME_FREQUENCY_V1',
    '6b. Benchmark governance confirms ALL_TIME_FREQUENCY_V1 as frozen champion.'
  );
  assert(
    benchmarkReport.governance.promotedToProduction === false,
    '6c. Promoted to production flag remains FALSE.'
  );

  console.log('\n================================================================');
  console.log(`  STEP 26 AUDIT TEST SUITE PASSED: ${passedTests} / ${totalTests} ASSERTIONS OK `);
  console.log('================================================================\n');
}

runStep26Audit().catch((err) => {
  console.error('\n❌ STEP 26 AUDIT FAILED:', err);
  process.exit(1);
});
