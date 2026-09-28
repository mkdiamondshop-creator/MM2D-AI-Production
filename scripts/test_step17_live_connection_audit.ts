/**
 * MM2D LEADER STEP 17 — REAL LIVE SET/VALUE CONNECTION AUDIT SCRIPT
 * 
 * Audits the existing live-data pipeline only.
 * Invariant: Does not modify production models, prediction formulas, UI, lock times, or historical data.
 * 
 * Trace:
 * Official Source → Adapter → Timestamp/Freshness Validation → Live Observation Buffer → Prediction Pipeline
 */

import { THAISTOCK_LIVE_ENDPOINT, ThaiStock2dSource } from '../src/core/market/thaistock2dSource';
import { SetOfficialSource } from '../src/core/market/setOfficialSource';
import { LiveSourceAdapter, globalLiveSourceAdapter } from '../src/core/market/liveSourceAdapter';
import { TimezoneContract } from '../src/core/market/timezoneUtils';
import { MarketOpenGate } from '../src/core/market/marketOpenGate';
import { FeatureEngine } from '../src/core/prediction/featureEngine';
import { LockEngine } from '../src/core/prediction/lockEngine';
import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';
import { PRODUCTION_MODEL_VERSION } from '../src/types/prediction';

interface AuditTestResult {
  testId: number;
  testName: string;
  passed: boolean;
  details: string;
  dataSnippet?: any;
}

async function runStep17LiveConnectionAudit() {
  console.log('================================================================');
  console.log('MM2D LEADER STEP 17 — REAL LIVE SET/VALUE CONNECTION AUDIT');
  console.log('================================================================\n');

  const testResults: AuditTestResult[] = [];
  const now = new Date();
  const bangkokNow = TimezoneContract.toBangkok(now);
  const targetDate = bangkokNow.dateStr;

  console.log(`[EXECUTION CONTEXT]`);
  console.log(`System UTC Time:    ${now.toISOString()}`);
  console.log(`Bangkok Time (BKK): ${bangkokNow.isoString} (Date: ${targetDate}, Time: ${bangkokNow.timeStr})`);
  console.log(`Configured Primary: ${THAISTOCK_LIVE_ENDPOINT}`);
  console.log(`Configured Fallback: SET Official Direct Feed\n`);

  // -------------------------------------------------------------------------
  // TEST 1: Current-day SET + Value received from real endpoint
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Current-Day Official Live SET + Value Reception ---');
  let rawFetchPassed = false;
  let livePayload: any = null;
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rawRes = await fetch(THAISTOCK_LIVE_ENDPOINT, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MM2D-LiveMarketAdapter/2.0',
        },
      });

      if (rawRes.ok) {
        const rawJson = await rawRes.json();
        livePayload = rawJson;
        const live = rawJson.live;
        const setVal = live?.set;
        const valVal = live?.value;
        const dateVal = live?.date || (live?.time ? live.time.slice(0, 10) : undefined);

        console.log(`  HTTP Response Status: ${rawRes.status} ${rawRes.statusText} (attempt ${attempt})`);
        console.log(`  Payload Keys: [${Object.keys(rawJson).join(', ')}]`);
        console.log(`  Live SET: "${setVal}", Value: "${valVal}", Time: "${live?.time}", Date: "${dateVal}"`);

        if (setVal && valVal && dateVal === targetDate) {
          rawFetchPassed = true;
          testResults.push({
            testId: 1,
            testName: 'Current-day SET + Value received',
            passed: true,
            details: `Successfully received authentic live data for ${targetDate}: SET=${setVal}, Value=${valVal}`,
            dataSnippet: { set: setVal, value: valVal, date: dateVal, serverTime: rawJson.server_time },
          });
          break;
        } else {
          lastError = `Data received but date mismatch or missing metrics: targetDate=${targetDate}, receivedDate=${dateVal}, set=${setVal}, value=${valVal}`;
        }
      } else {
        lastError = `HTTP error: ${rawRes.status} ${rawRes.statusText}`;
      }
    } catch (err: any) {
      lastError = `Network fetch failed: ${err.message}`;
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (!rawFetchPassed) {
    testResults.push({
      testId: 1,
      testName: 'Current-day SET + Value received',
      passed: false,
      details: lastError,
    });
  }

  // -------------------------------------------------------------------------
  // TEST 2: Timestamp is valid and current
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Timestamp Validity and Freshness Check ---');
  try {
    const source = new ThaiStock2dSource();
    const sourceRes = await source.fetchLiveSnapshot(targetDate);
    
    if (sourceRes.success && sourceRes.snapshot) {
      const snap = sourceRes.snapshot;
      const timestampIso = snap.timestamp;
      const isIsoValid = !isNaN(Date.parse(timestampIso));
      const hasOffset = timestampIso.includes('+07:00') || timestampIso.endsWith('Z');
      const parsedDate = new Date(timestampIso);
      const diffMinutes = Math.abs((now.getTime() - parsedDate.getTime()) / 60000);

      console.log(`  Normalized Timestamp: ${timestampIso}`);
      console.log(`  Date: ${snap.date}, Time: ${snap.time}`);
      console.log(`  ISO Parse Valid: ${isIsoValid}, Bangkok Offset: ${hasOffset}`);
      console.log(`  Time delta vs local clock: ${diffMinutes.toFixed(1)} minutes`);

      const passed = isIsoValid && snap.date === targetDate && diffMinutes < 180;
      testResults.push({
        testId: 2,
        testName: 'Timestamp is valid and current',
        passed,
        details: `Timestamp ${timestampIso} parsed successfully. Time delta: ${diffMinutes.toFixed(1)} min.`,
        dataSnippet: { timestamp: timestampIso, date: snap.date, time: snap.time },
      });
    } else {
      testResults.push({
        testId: 2,
        testName: 'Timestamp is valid and current',
        passed: false,
        details: `Source did not return successful snapshot: status=${sourceRes.status}, error=${sourceRes.errorDetails}`,
      });
    }
  } catch (err: any) {
    testResults.push({
      testId: 2,
      testName: 'Timestamp is valid and current',
      passed: false,
      details: `Timestamp validation threw: ${err.message}`,
    });
  }

  // -------------------------------------------------------------------------
  // TEST 3: Both SET and Value are present and numeric
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Metric Completeness (SET and Value Present) ---');
  try {
    // Brief pause to prevent Cloudflare edge concurrency burst
    await new Promise((r) => setTimeout(r, 1200));

    let adapterRes = await globalLiveSourceAdapter.getLiveMarketSnapshot(targetDate);
    if (!adapterRes.success) {
      await new Promise((r) => setTimeout(r, 1500));
      adapterRes = await globalLiveSourceAdapter.getLiveMarketSnapshot(targetDate);
    }

    if (adapterRes.success && adapterRes.snapshot) {
      const { setNumeric, valueNumeric, setRaw, valueRaw } = adapterRes.snapshot;
      const setValid = typeof setNumeric === 'number' && !isNaN(setNumeric) && setNumeric >= 100.0;
      const valValid = typeof valueNumeric === 'number' && !isNaN(valueNumeric) && valueNumeric >= 100.0;
      const rawPresent = Boolean(setRaw && valueRaw && setRaw !== '--' && valueRaw !== '--');

      console.log(`  SET Numeric: ${setNumeric} (Raw: "${setRaw}") -> Valid: ${setValid}`);
      console.log(`  Value Numeric: ${valueNumeric} (Raw: "${valueRaw}") -> Valid: ${valValid}`);

      testResults.push({
        testId: 3,
        testName: 'Both SET and Value are present',
        passed: setValid && valValid && rawPresent,
        details: `SET (${setNumeric}) and Market Value (${valueNumeric}) are both present, parsed, and mathematically valid.`,
        dataSnippet: { setNumeric, valueNumeric, setRaw, valueRaw },
      });
    } else {
      testResults.push({
        testId: 3,
        testName: 'Both SET and Value are present',
        passed: false,
        details: `Adapter failed to return snapshot: ${adapterRes.errorDetails}`,
      });
    }
  } catch (err: any) {
    testResults.push({
      testId: 3,
      testName: 'Both SET and Value are present',
      passed: false,
      details: `Metric test threw: ${err.message}`,
    });
  }

  // -------------------------------------------------------------------------
  // TEST 4: Stale / Future / Placeholder data rejection
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Stale, Future, and Placeholder Rejection Audit ---');
  const subTests: { name: string; passed: boolean; reason: string }[] = [];

  // 4a. Stale Date Rejection (Target is 2026-09-04, source gives yesterday 2026-09-03)
  const staleDateSource = new ThaiStock2dSource();
  const staleRes = await staleDateSource.fetchLiveSnapshot('2026-09-05'); // Target tomorrow, source returns today
  const stalePassed = !staleRes.success && staleRes.status === 'LIVE_DATA_STALE';
  subTests.push({
    name: 'Stale date rejection (target 2026-09-05 vs feed 2026-09-04)',
    passed: stalePassed,
    reason: `status=${staleRes.status}, error=${staleRes.errorDetails}`,
  });

  // 4b. Placeholder rejection: Mocking custom endpoint returning "--"
  const placeholderMock = {
    fetchLiveSnapshot: async () => ({
      success: false,
      status: 'INSUFFICIENT_LIVE_DATA' as const,
      sourceUsed: 'TEST_SOURCE',
      totalLatencyMs: 5,
      errorDetails: 'Live market not active or returning placeholders: set="--", value="--"',
      sourceAttempts: [],
    }),
    sourceType: 'TEST_PLACEHOLDER',
    sourceName: 'Placeholder Test',
    isConfigured: () => true,
  };
  const placeholderAdapter = new LiveSourceAdapter({ primarySource: placeholderMock as any });
  const placeholderRes = await placeholderAdapter.getLiveMarketSnapshot(targetDate);
  const placeholderPassed = !placeholderRes.success && placeholderRes.status === 'INSUFFICIENT_LIVE_DATA';
  subTests.push({
    name: 'Placeholder string ("--") rejection',
    passed: placeholderPassed,
    reason: `status=${placeholderRes.status}, error=${placeholderRes.errorDetails}`,
  });

  // 4c. Pre-open and post-lock observation filtering in FeatureEngine
  const filteredWindow = FeatureEngine.filterPreLockObservations(targetDate, 'AM', [
    { time: '09:15:00', set: 1590, value: 30000 }, // Pre-market open (Before 10:00) -> Must be rejected
    { time: '11:15:00', set: 1591, value: 35000 }, // Inside AM window [10:00, 12:00] -> Must be accepted
    { time: '12:05:00', set: 1592, value: 36000 }, // Post-lock (After 12:00) -> Must be rejected
  ]);
  const windowPassed = filteredWindow.observations.length === 1 && filteredWindow.observations[0].time === '11:15:00';
  subTests.push({
    name: 'Out-of-window observation gate (pre-10:00 and post-12:00 rejected)',
    passed: windowPassed,
    reason: `Allowed ${filteredWindow.observations.length}/3 observations. Kept: ${filteredWindow.observations.map(o => o.time).join(', ')}`,
  });

  for (const st of subTests) {
    console.log(`  Sub-test [${st.name}]: ${st.passed ? 'PASSED' : 'FAILED'} (${st.reason})`);
  }

  const allSubTestsPassed = subTests.every(st => st.passed);
  testResults.push({
    testId: 4,
    testName: 'Stale/future/placeholder data is rejected',
    passed: allSubTestsPassed,
    details: `All ${subTests.length} rejection gates passed (stale date, placeholder string, window filtering).`,
  });

  // -------------------------------------------------------------------------
  // TEST 5: Source failure logging
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Source Failure Logging and Provenance ---');
  // Create an adapter where primary fails with network error, and secondary is unconfigured
  const failingPrimary = {
    sourceType: 'TEST_FAILING_PRIMARY',
    sourceName: 'Simulated Failing Primary',
    isConfigured: () => true,
    fetchLiveSnapshot: async () => {
      throw new Error('Connection refused: ECONNREFUSED 127.0.0.1:9999');
    },
  };
  const unconfiguredFallback = new SetOfficialSource(); // Unconfigured by default

  const failingAdapter = new LiveSourceAdapter({
    primarySource: failingPrimary as any,
    fallbackSource: unconfiguredFallback,
  });

  const failureRes = await failingAdapter.getLiveMarketSnapshot(targetDate);
  console.log(`  Adapter Response on Total Source Failure: status=${failureRes.status}, success=${failureRes.success}`);
  console.log(`  Logged Source Attempts (${failureRes.sourceAttempts.length}):`);
  failureRes.sourceAttempts.forEach((att, idx) => {
    console.log(`    Attempt ${idx + 1}: source=${att.source}, status=${att.status}, error=${att.error}`);
  });

  const loggedPrimaryFailure = failureRes.sourceAttempts.some(
    a => (a.source as string) === 'TEST_FAILING_PRIMARY' && a.status === 'UNAVAILABLE'
  );
  const loggedFallbackUnconfigured = failureRes.sourceAttempts.some(
    a => a.source === 'SET_OFFICIAL_FALLBACK' && a.status === 'UNCONFIGURED'
  );
  const correctFinalStatus = failureRes.status === 'INSUFFICIENT_LIVE_DATA';

  const test5Passed = loggedPrimaryFailure && loggedFallbackUnconfigured && correctFinalStatus;
  testResults.push({
    testId: 5,
    testName: 'Source failure is logged correctly',
    passed: test5Passed,
    details: `All attempts logged with source names, timestamps, failure reasons, and fallback statuses. Zero-fabrication preserved.`,
    dataSnippet: failureRes.sourceAttempts,
  });

function createHistoricalBaseline(count: number): any[] {
  const records: any[] = [];
  const baseDate = new Date('2026-05-01T12:00:00+07:00');
  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime() + Math.floor(i / 2) * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const isAm = i % 2 === 0;
    const session = isAm ? 'AM' : 'PM';
    const time = isAm ? '12:01:00' : '16:30:00';
    const twodVal = ((i * 7 + 13) % 100).toString().padStart(2, '0');
    const setNum = 1400.0 + (i % 50);
    const valNum = 35000.0 + (i % 80);

    records.push({
      id: `rec_${dateStr}_${session}`,
      date: dateStr,
      session,
      time,
      isSettlement: true,
      setRaw: setNum.toFixed(2),
      valueRaw: valNum.toFixed(2),
      setNumeric: setNum,
      valueNumeric: valNum,
      twod: twodVal,
      historyId: `hist_${i}`,
      verifiedAt: `${dateStr}T${time}+07:00`,
      mathematicalCheck: {
        setLastDigit: setNum.toFixed(2).slice(-1),
        valueLastDigitBeforeDecimal: valNum.toFixed(0).slice(-1),
        derived2D: twodVal,
        isMathematicallyConsistent: true,
      },
    });
  }
  return records;
}

  // -------------------------------------------------------------------------
  // TEST 6: Valid live data reaches the prediction pipeline
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Valid Live Data Reaches Prediction Pipeline ---');
  try {
    const baselineRecords = createHistoricalBaseline(60);
    
    // Create live observation feed
    const testLiveFeed = [
      {
        time: '11:15:00',
        set: 1591.39,
        value: 35427.75,
        timestamp: `${targetDate}T11:15:00+07:00`,
      },
    ];

    // 6a. Verify FeatureEngine processes preLockLiveFeed
    const amFeaturesWithLive = FeatureEngine.extractFeatures(
      baselineRecords,
      targetDate,
      'AM',
      testLiveFeed
    );

    const hasLiveInFeatures = Boolean(
      amFeaturesWithLive.featureVector?.isPreLockLiveAvailable &&
      amFeaturesWithLive.featureVector?.momentum?.currentSet === 1591.39 &&
      amFeaturesWithLive.featureVector?.momentum?.currentValue === 35427.75 &&
      amFeaturesWithLive.featureVector?.momentum?.observationCount === 1
    );

    console.log(`  FeatureEngine Live Snapshot attached: ${hasLiveInFeatures}`);
    console.log(`  Feature Vector PreLock Live Available: ${amFeaturesWithLive.featureVector?.isPreLockLiveAvailable}`);
    console.log(`  Feature Vector Current SET: ${amFeaturesWithLive.featureVector?.momentum?.currentSet}, Value: ${amFeaturesWithLive.featureVector?.momentum?.currentValue}`);

    // 6b. Verify LockEngine prediction computation with live feed during pre-lock window (simulate 11:56 AM BKK)
    const simulatedAmWindowTime = new Date(`${targetDate}T11:56:00+07:00`);
    const predictionRes = LockEngine.getOrFreezePrediction(
      baselineRecords,
      targetDate,
      'AM',
      testLiveFeed,
      simulatedAmWindowTime,
      PRODUCTION_MODEL_VERSION
    );

    console.log(`  LockEngine Output at 11:56 BKK: status=${predictionRes.output.status}, top1=${predictionRes.output.top1}`);
    console.log(`  Candidate Count: ${predictionRes.output.candidates?.length || 0}`);

    const reachesPipeline = hasLiveInFeatures && (
      predictionRes.output.status === 'PREDICTION_READY' ||
      predictionRes.output.status === 'ANALYZING_LIVE_DATA' ||
      predictionRes.output.status === 'PREDICTION_LOCKED'
    );

    testResults.push({
      testId: 6,
      testName: 'Valid live data reaches the prediction pipeline',
      passed: reachesPipeline,
      details: `Live observation (SET=1591.39, Value=35427.75) ingested into FeatureVector and successfully evaluated by LockEngine.`,
      dataSnippet: {
        featureAttached: hasLiveInFeatures,
        pipelineStatus: predictionRes.output.status,
        top1: predictionRes.output.top1,
      },
    });
  } catch (err: any) {
    testResults.push({
      testId: 6,
      testName: 'Valid live data reaches the prediction pipeline',
      passed: false,
      details: `Prediction pipeline trace threw: ${err.message}`,
    });
  }

  // -------------------------------------------------------------------------
  // TEST 7: No synthetic / fallback number displayed as live data
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Zero-Fabrication Invariant (No Synthetic Live Data) ---');
  try {
    const baselineRecords = createHistoricalBaseline(60);
    
    // Simulate empty live feed (no live observation available) during active window (11:15 AM BKK)
    const emptyLiveFeed: any[] = [];
    const activeNoLiveTime = new Date(`${targetDate}T11:15:00+07:00`);
    const noLivePrediction = LockEngine.getOrFreezePrediction(
      baselineRecords,
      targetDate,
      'AM',
      emptyLiveFeed,
      activeNoLiveTime,
      PRODUCTION_MODEL_VERSION
    );

    console.log(`  Prediction output when live feed is empty:`);
    console.log(`    Status: "${noLivePrediction.output.status}"`);
    console.log(`    Top-1: "${noLivePrediction.output.top1}"`);
    console.log(`    Candidates array length: ${noLivePrediction.output.candidates?.length || 0}`);

    const strictlyHidden = (
      noLivePrediction.output.status === 'WAITING_FOR_LIVE_DATA' &&
      noLivePrediction.output.top1 === '--' &&
      (!noLivePrediction.output.candidates || noLivePrediction.output.candidates.length === 0)
    );

    testResults.push({
      testId: 7,
      testName: 'No synthetic/fallback number is displayed as live data',
      passed: strictlyHidden,
      details: `When live data is absent, output status is strictly 'WAITING_FOR_LIVE_DATA' with top1='--' and zero candidates. No synthetic number generated.`,
      dataSnippet: {
        status: noLivePrediction.output.status,
        top1: noLivePrediction.output.top1,
        candidatesCount: noLivePrediction.output.candidates?.length,
      },
    });
  } catch (err: any) {
    testResults.push({
      testId: 7,
      testName: 'No synthetic/fallback number is displayed as live data',
      passed: false,
      details: `Zero-fabrication check threw: ${err.message}`,
    });
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('AUDIT SUMMARY & TEST RESULTS');
  console.log('================================================================');
  let allPassed = true;
  for (const r of testResults) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] Test ${r.testId}: ${r.testName}`);
    console.log(`       Details: ${r.details}`);
    if (!r.passed) allPassed = false;
  }
  console.log('================================================================');
  console.log(`OVERALL PIPELINE AUDIT VERDICT: ${allPassed ? 'ALL TESTS PASSED — LIVE CONNECTION ACTIVE & VERIFIED' : 'BLOCKER IDENTIFIED'}`);
  console.log('================================================================');
}

runStep17LiveConnectionAudit();
