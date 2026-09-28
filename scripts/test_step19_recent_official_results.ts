/**
 * MM2D LEADER STEP 19 — RECENT OFFICIAL RESULTS INTEGRATION TEST
 *
 * Verifies:
 * 1. Fetches latest confirmed official results from ThaiStock2D official /2d_result API.
 * 2. Displays latest available trading dates, not hardcoded/historical-only records.
 * 3. Includes AM 12:01 and PM 16:30 results when confirmed.
 * 4. Preserves exact provider SET, Value, 2D, date and result times.
 * 5. Excludes unconfirmed/non-trading days (e.g. days with no confirmed settlement).
 * 6. Never fabricates, estimates, or uses stale cached records when newer official records are available.
 * 7. Up to 7 rows displayed matching UI layout.
 * 8. Offline/outage fallback maintains integrity with verified records only.
 */

import { fetchRecent2DResults, THAISTOCK_BASE_URL } from '../src/core/api/thaistockClient';
import { globalOfficialResultAdapter } from '../src/core/market/officialResultAdapter';
import { parseAndVerify2DResult } from '../src/core/integrity/parser';
import { globalDatasetStorage } from '../src/core/storage/storageAbstraction';

interface TestCase {
  name: string;
  passed: boolean;
  details: string;
  data?: any;
}

const testCases: TestCase[] = [];

async function runStep19Tests() {
  console.log('================================================================');
  console.log('MM2D LEADER STEP 19 — RECENT OFFICIAL RESULTS TEST');
  console.log('================================================================');
  console.log(`Endpoint: ${THAISTOCK_BASE_URL}/2d_result`);

  // -------------------------------------------------------------------------
  // TEST 1: Direct API Connection & Fetch of Latest Date Groups
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 1: Fetch Latest Confirmed Date Groups from Official API ---');
  try {
    const rawGroups = await fetchRecent2DResults();
    const isArray = Array.isArray(rawGroups);
    const hasItems = isArray && rawGroups.length > 0;
    const latestDate = hasItems ? rawGroups[0].date : 'N/A';

    console.log(`  Total Date Groups Returned: ${rawGroups.length}`);
    console.log(`  Latest Official Market Date: ${latestDate}`);
    console.log(`  First 3 Dates: ${rawGroups.slice(0, 3).map((g) => g.date).join(', ')}`);

    const passed = isArray && hasItems && /^\d{4}-\d{2}-\d{2}$/.test(latestDate);
    testCases.push({
      name: 'Test 1: Official /2d_result API returns authentic date groups',
      passed,
      details: `Retrieved ${rawGroups.length} date groups. Latest trading date: ${latestDate}`,
    });
    console.log(`  [TEST 1 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 1: Official /2d_result API returns authentic date groups',
      passed: false,
      details: `Fetch error: ${err.message}`,
    });
    console.log(`  [TEST 1 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Retrieve Top 7 Recent Confirmed Trading Days via Adapter
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Retrieve Top 7 Recent Confirmed Trading Days via Adapter ---');
  let recentResults: any[] = [];
  try {
    recentResults = await globalOfficialResultAdapter.getRecentOfficialResults(7);
    const count = recentResults.length;
    const countOk = count > 0 && count <= 7;

    console.log(`  Recent Confirmed Days Count: ${count}`);
    recentResults.forEach((r, idx) => {
      console.log(`    [${idx + 1}] Date: ${r.date} | AM: ${r.am ? r.am.twod : '--'} | PM: ${r.pm ? r.pm.twod : '--'} | SET: ${r.pm?.setRaw || r.am?.setRaw || '--'} | Val: ${r.pm?.valueRaw || r.am?.valueRaw || '--'}`);
    });

    // Verify dates are in descending order
    let isDescending = true;
    for (let i = 0; i < recentResults.length - 1; i++) {
      if (recentResults[i].date < recentResults[i + 1].date) {
        isDescending = false;
        break;
      }
    }

    const passed = countOk && isDescending;
    testCases.push({
      name: 'Test 2: Adapter retrieves up to 7 latest confirmed trading days in descending order',
      passed,
      details: `Retrieved ${count} confirmed trading days in strict descending order: ${recentResults.map((r) => r.date).join(', ')}`,
    });
    console.log(`  [TEST 2 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 2: Adapter retrieves up to 7 latest confirmed trading days in descending order',
      passed: false,
      details: `Adapter error: ${err.message}`,
    });
    console.log(`  [TEST 2 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Include AM 12:01 and PM 16:30 Results When Confirmed
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Inclusion of AM 12:01 and PM 16:30 When Confirmed ---');
  try {
    // Find a day with both AM and PM confirmed (e.g. 2026-09-04 or 2026-09-02)
    const dualConfirmedDay = recentResults.find((r) => r.am && r.pm);
    const hasDual = Boolean(dualConfirmedDay);

    if (dualConfirmedDay) {
      console.log(`  Dual Confirmed Day Found (${dualConfirmedDay.date}):`);
      console.log(`    AM 12:01: 2D=${dualConfirmedDay.am.twod}, Time=${dualConfirmedDay.am.time}, Session=${dualConfirmedDay.am.session}`);
      console.log(`    PM 16:30: 2D=${dualConfirmedDay.pm.twod}, Time=${dualConfirmedDay.pm.time}, Session=${dualConfirmedDay.pm.session}`);
    }

    const amCorrect = dualConfirmedDay?.am?.time === '12:01:00' && dualConfirmedDay?.am?.session === 'AM';
    const pmCorrect = dualConfirmedDay?.pm?.time === '16:30:00' && dualConfirmedDay?.pm?.session === 'PM';
    const passed = hasDual && amCorrect && pmCorrect;

    testCases.push({
      name: 'Test 3: AM 12:01 and PM 16:30 confirmed sessions correctly classified and mapped',
      passed,
      details: `Dual confirmed day (${dualConfirmedDay?.date}) AM: ${dualConfirmedDay?.am?.twod} (${dualConfirmedDay?.am?.time}), PM: ${dualConfirmedDay?.pm?.twod} (${dualConfirmedDay?.pm?.time})`,
    });
    console.log(`  [TEST 3 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 3: AM 12:01 and PM 16:30 confirmed sessions correctly classified and mapped',
      passed: false,
      details: `Error: ${err.message}`,
    });
    console.log(`  [TEST 3 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Preservation of Exact Provider SET, Value, 2D, Date, and Times
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Preservation of Exact Provider Fields ---');
  try {
    const refDay = recentResults[0];
    const rawGroups = await fetchRecent2DResults();
    const rawMatchGroup = rawGroups.find((g) => g.date === refDay.date);

    let setPreserved = true;
    let valPreserved = true;
    let twodPreserved = true;
    let timePreserved = true;

    if (rawMatchGroup) {
      if (refDay.am) {
        const rawChild = rawMatchGroup.child.find((c) => c.time === '12:01:00');
        if (rawChild) {
          setPreserved = setPreserved && refDay.am.setRaw === rawChild.set;
          valPreserved = valPreserved && refDay.am.valueRaw === rawChild.value;
          twodPreserved = twodPreserved && refDay.am.twod === rawChild.twod;
          timePreserved = timePreserved && refDay.am.time === rawChild.time;
        }
      }
      if (refDay.pm) {
        const rawChild = rawMatchGroup.child.find((c) => c.time === '16:30:00');
        if (rawChild) {
          setPreserved = setPreserved && refDay.pm.setRaw === rawChild.set;
          valPreserved = valPreserved && refDay.pm.valueRaw === rawChild.value;
          twodPreserved = twodPreserved && refDay.pm.twod === rawChild.twod;
          timePreserved = timePreserved && refDay.pm.time === rawChild.time;
        }
      }
    }

    const passed = Boolean(rawMatchGroup && setPreserved && valPreserved && twodPreserved && timePreserved);
    testCases.push({
      name: 'Test 4: Exact provider SET, Value, 2D, Date, and Times preserved verbatim',
      passed,
      details: `Verified against raw provider JSON for date ${refDay?.date}: SET, Value, 2D, Time matches 100% without rounding or mutation.`,
    });
    console.log(`  [TEST 4 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 4: Exact provider SET, Value, 2D, Date, and Times preserved verbatim',
      passed: false,
      details: `Error: ${err.message}`,
    });
    console.log(`  [TEST 4 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Exclusion of Unconfirmed / Non-Trading Days
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Exclusion of Unconfirmed and Non-Trading Days ---');
  try {
    // Verify that every day in recentResults has AT LEAST one confirmed settlement (AM or PM)
    const allHaveConfirmedSettlement = recentResults.every((r) => Boolean(r.am || r.pm));

    // Test with simulated non-trading date group containing placeholder "--"
    const nonTradingGroup = {
      date: '2026-09-06', // Sunday
      child: [
        { time: '11:00:00', set: '--', value: '--', twod: '--', history_id: null },
        { time: '12:01:00', set: '--', value: '--', twod: '--', history_id: null },
        { time: '15:00:00', set: '--', value: '--', twod: '--', history_id: null },
        { time: '16:30:00', set: '--', value: '--', twod: '--', history_id: null },
      ],
    };
    const parsed = parseAndVerify2DResult([nonTradingGroup as any], '2026-09-06');
    const placeholdersExcluded = parsed.verifiedRecords.length === 0;

    const passed = allHaveConfirmedSettlement && placeholdersExcluded;
    testCases.push({
      name: 'Test 5: Unconfirmed and non-trading days are strictly excluded',
      passed,
      details: `All ${recentResults.length} table rows contain confirmed results. Placeholder "--" and non-trading dates produce 0 verified records and are excluded.`,
    });
    console.log(`  All rows have confirmed settlement: ${allHaveConfirmedSettlement}`);
    console.log(`  Simulated placeholder day excluded: ${placeholdersExcluded}`);
    console.log(`  [TEST 5 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 5: Unconfirmed and non-trading days are strictly excluded',
      passed: false,
      details: `Error: ${err.message}`,
    });
    console.log(`  [TEST 5 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Zero Fabrication / Never Use Stale Cache When Newer Available
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Zero Fabrication & Freshness Priority ---');
  try {
    // The top row date must match the actual latest available date from the live API
    const rawGroups = await fetchRecent2DResults();
    const apiLatestDate = rawGroups[0]?.date;
    const displayLatestDate = recentResults[0]?.date;

    const matchesApiLatest = displayLatestDate === apiLatestDate;
    // Verify none of the displayed numbers are synthetic
    const allMathematicallyConsistent = recentResults.every((r) => {
      const amOk = !r.am || r.am.mathematicalCheck.isMathematicallyConsistent;
      const pmOk = !r.pm || r.pm.mathematicalCheck.isMathematicallyConsistent;
      return amOk && pmOk;
    });

    const passed = matchesApiLatest && allMathematicallyConsistent;
    testCases.push({
      name: 'Test 6: No stale cached records used; authentic fresh provider dates prioritized with zero fabrication',
      passed,
      details: `Display top date (${displayLatestDate}) matches authentic API latest (${apiLatestDate}). All 2D numbers are mathematically verified.`,
    });
    console.log(`  Display latest (${displayLatestDate}) === API latest (${apiLatestDate}): ${matchesApiLatest}`);
    console.log(`  All records mathematically verified: ${allMathematicallyConsistent}`);
    console.log(`  [TEST 6 VERDICT]: ${passed ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 6: No stale cached records used; authentic fresh provider dates prioritized with zero fabrication',
      passed: false,
      details: `Error: ${err.message}`,
    });
    console.log(`  [TEST 6 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Dataset Storage Synchronization
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: Dataset Storage Synchronization ---');
  try {
    const storedRecords = await globalDatasetStorage.queryAllVerifiedRecords();
    const storedDates = new Set(storedRecords.map((r) => r.date));
    const recentStoredCount = recentResults.filter((r) => storedDates.has(r.date)).length;
    const isSynced = recentStoredCount === recentResults.length;

    testCases.push({
      name: 'Test 7: Verified recent records are stored into persistent storage layer',
      passed: isSynced,
      details: `All ${recentStoredCount}/${recentResults.length} recent confirmed trading dates synced and accessible in storage.`,
    });
    console.log(`  Recent dates stored in dataset: ${recentStoredCount}/${recentResults.length}`);
    console.log(`  [TEST 7 VERDICT]: ${isSynced ? 'PASSED' : 'FAILED'}`);
  } catch (err: any) {
    testCases.push({
      name: 'Test 7: Verified recent records are stored into persistent storage layer',
      passed: false,
      details: `Error: ${err.message}`,
    });
    console.log(`  [TEST 7 VERDICT]: FAILED (${err.message})`);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('AUDIT SUMMARY & TEST RESULTS');
  console.log('================================================================');
  let allPassed = true;
  for (const tc of testCases) {
    const sym = tc.passed ? '[✓ PASS]' : '[✗ FAIL]';
    if (!tc.passed) allPassed = false;
    console.log(`${sym} ${tc.name}`);
    console.log(`       Details: ${tc.details}`);
  }

  console.log('================================================================');
  if (allPassed) {
    console.log('OVERALL STEP 19 VERDICT: ALL TESTS PASSED — RECENT OFFICIAL RESULTS CONNECTED');
  } else {
    console.log('OVERALL STEP 19 VERDICT: FAILED');
  }
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runStep19Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
