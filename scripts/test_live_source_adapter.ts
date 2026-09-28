import { LiveSourceAdapter } from '../src/core/market/liveSourceAdapter';
import { ThaiStock2dSource } from '../src/core/market/thaistock2dSource';
import { SetOfficialSource } from '../src/core/market/setOfficialSource';
import { ILiveMarketSource, LiveSourceResult } from '../src/types/liveSource';

async function runLiveSourceAdapterTests() {
  console.log('================================================================');
  console.log('       OFFICIAL LIVE SOURCE ADAPTER TEST SUITE                  ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      console.log(`PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`FAIL: ${message}`);
      process.exitCode = 1;
    }
  }

  // --- MOCK PROVIDERS FOR CONTROLLED ADAPTER TESTING ---
  class MockThaiStockSuccess implements ILiveMarketSource {
    public readonly sourceType = 'THAISTOCK_2D_PRIMARY' as const;
    public readonly sourceName = 'Mock ThaiStock2D Success Feed';
    public isConfigured() { return true; }
    public async fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult> {
      return {
        success: true,
        status: 'SUCCESS',
        sourceUsed: this.sourceType,
        totalLatencyMs: 45,
        snapshot: {
          source: this.sourceType,
          sourceName: this.sourceName,
          timestamp: '2026-08-27T11:00:00+07:00',
          date: '2026-08-27',
          time: '11:00:00',
          setNumeric: 1612.45,
          valueNumeric: 34120.50,
          setRaw: '1,612.45',
          valueRaw: '34,120.50',
          isCheckpoint1100: true,
          isCheckpoint1500: false,
          provenance: 'THAISTOCK_2D_LIVE_HTTP:https://api.thaistock2d.com/live',
          quality: 'OFFICIAL_VERIFIED',
          latencyMs: 45,
        },
        sourceAttempts: [{
          source: this.sourceType,
          sourceName: this.sourceName,
          attemptedAt: '2026-08-27T11:00:00+07:00',
          status: 'AVAILABLE',
          latencyMs: 45,
        }],
      };
    }
  }

  class MockThaiStockFailure implements ILiveMarketSource {
    public readonly sourceType = 'THAISTOCK_2D_PRIMARY' as const;
    public readonly sourceName = 'Mock ThaiStock2D Failure Feed';
    public isConfigured() { return true; }
    public async fetchLiveSnapshot(): Promise<LiveSourceResult> {
      return {
        success: false,
        status: 'SOURCE_UNAVAILABLE',
        sourceUsed: this.sourceType,
        totalLatencyMs: 120,
        errorDetails: 'HTTP 503 Service Unavailable',
        sourceAttempts: [{
          source: this.sourceType,
          sourceName: this.sourceName,
          attemptedAt: new Date().toISOString(),
          status: 'UNAVAILABLE',
          latencyMs: 120,
          error: 'HTTP 503 Service Unavailable',
        }],
      };
    }
  }

  class MockSetOfficialSuccess implements ILiveMarketSource {
    public readonly sourceType = 'SET_OFFICIAL_FALLBACK' as const;
    public readonly sourceName = 'Mock SET Official Success Feed';
    public isConfigured() { return true; }
    public async fetchLiveSnapshot(targetDate?: string): Promise<LiveSourceResult> {
      return {
        success: true,
        status: 'SUCCESS',
        sourceUsed: this.sourceType,
        totalLatencyMs: 80,
        snapshot: {
          source: this.sourceType,
          sourceName: this.sourceName,
          timestamp: '2026-08-27T11:00:00+07:00',
          date: '2026-08-27',
          time: '11:00:00',
          setNumeric: 1612.40,
          valueNumeric: 34118.00,
          setRaw: '1612.40',
          valueRaw: '34118.00',
          isCheckpoint1100: true,
          isCheckpoint1500: false,
          provenance: 'SET_OFFICIAL_DIRECT_API:https://api.set.or.th/v1/market',
          quality: 'FALLBACK_VERIFIED',
          latencyMs: 80,
        },
        sourceAttempts: [{
          source: this.sourceType,
          sourceName: this.sourceName,
          attemptedAt: '2026-08-27T11:00:00+07:00',
          status: 'AVAILABLE',
          latencyMs: 80,
        }],
      };
    }
  }

  // --- TEST 1: Primary Source Selection (ThaiStock2D Available) ---
  console.log('--- [TEST 1] Primary Source Selection ---');
  const primaryAdapter = new LiveSourceAdapter({
    primarySource: new MockThaiStockSuccess(),
    fallbackSource: new MockSetOfficialSuccess(),
  });

  const res1 = await primaryAdapter.getLiveMarketSnapshot('2026-08-27');
  assert(res1.success === true, '1a. Adapter successfully returned live snapshot when Primary is healthy.');
  assert(res1.sourceUsed === 'THAISTOCK_2D_PRIMARY', '1b. Source used is strictly THAISTOCK_2D_PRIMARY.');
  assert(res1.snapshot?.provenance.includes('THAISTOCK_2D_LIVE_HTTP') === true, '1c. Provenance accurately references Primary source.');
  assert(res1.snapshot?.setNumeric === 1612.45, '1d. SET numeric value matches primary upstream feed (1612.45).');
  assert(res1.snapshot?.valueNumeric === 34120.50, '1e. Market Value matches primary upstream feed (34120.50).');

  // --- TEST 2: Fallback Switching (Primary Down, Secondary Configured) ---
  console.log('\n--- [TEST 2] Secondary Fallback Source Switching ---');
  const fallbackAdapter = new LiveSourceAdapter({
    primarySource: new MockThaiStockFailure(),
    fallbackSource: new MockSetOfficialSuccess(),
  });

  const res2 = await fallbackAdapter.getLiveMarketSnapshot('2026-08-27');
  assert(res2.success === true, '2a. Adapter successfully fell back to SET Official when Primary failed.');
  assert(res2.sourceUsed === 'SET_OFFICIAL_FALLBACK', '2b. Source used is strictly SET_OFFICIAL_FALLBACK.');
  assert(res2.snapshot?.provenance.includes('SET_OFFICIAL_DIRECT_API') === true, '2c. Provenance accurately references SET Official source.');
  assert(res2.sourceAttempts.length === 2, '2d. Both Primary and Fallback attempts logged in audit trail.');
  assert(res2.sourceAttempts[0].status === 'UNAVAILABLE', '2e. Primary attempt recorded as UNAVAILABLE.');
  assert(res2.sourceAttempts[1].status === 'AVAILABLE', '2f. Secondary attempt recorded as AVAILABLE.');

  // --- TEST 3: Zero-Fabrication on Total Outage / Unconfigured Fallback ---
  console.log('\n--- [TEST 3] Zero-Fabrication on Total Live Outage ---');
  const unconfiguredSetOfficial = new SetOfficialSource({ apiUrl: undefined, apiKey: undefined });
  assert(unconfiguredSetOfficial.isConfigured() === false, '3a. Unconfigured SET Official returns isConfigured() === false.');

  const outageAdapter = new LiveSourceAdapter({
    primarySource: new MockThaiStockFailure(),
    fallbackSource: unconfiguredSetOfficial,
  });

  const res3 = await outageAdapter.getLiveMarketSnapshot('2026-08-27');
  assert(res3.success === false, '3b. Adapter returns success = false when no verified live sources exist.');
  assert(res3.status === 'INSUFFICIENT_LIVE_DATA', '3c. Status is strictly INSUFFICIENT_LIVE_DATA.');
  assert(res3.snapshot === undefined, '3d. No fabricated, estimated, or mock snapshot is returned.');
  assert(res3.errorDetails?.includes('Zero-fabrication policy active') === true, '3e. Zero-fabrication error policy explicitly declared.');

  // --- TEST 4: No Live 2D Contamination Proof ---
  console.log('\n--- [TEST 4] No Live 2D Contamination Invariant ---');
  // Confirm snapshot schema contains only SET/Value and NO 2D output
  if (res1.snapshot) {
    const rawSnapshotObj = res1.snapshot as unknown as Record<string, unknown>;
    assert(rawSnapshotObj.twod === undefined, '4a. LiveMarketSnapshot contains no "twod" property.');
    assert(rawSnapshotObj.derived2D === undefined, '4b. LiveMarketSnapshot contains no "derived2D" property.');
    assert(typeof res1.snapshot.setNumeric === 'number' && res1.snapshot.setNumeric >= 100, '4c. Authentic SET index provided.');
    assert(typeof res1.snapshot.valueNumeric === 'number' && res1.snapshot.valueNumeric >= 100, '4d. Authentic Market Value provided.');
  }

  // --- TEST 5: Source Diagnostics Integrity ---
  console.log('\n--- [TEST 5] Source Diagnostics Integrity ---');
  const defaultAdapter = new LiveSourceAdapter();
  const diags = defaultAdapter.getSourceDiagnostics();
  assert(diags.primary.type === 'THAISTOCK_2D_PRIMARY', '5a. Default Primary source is THAISTOCK_2D_PRIMARY.');
  assert(diags.primary.configured === true, '5b. Default Primary source is configured.');
  assert(diags.fallback.type === 'SET_OFFICIAL_FALLBACK', '5c. Default Fallback source is SET_OFFICIAL_FALLBACK.');

  console.log('\n================================================================');
  console.log(`   LIVE SOURCE ADAPTER TEST RESULTS: ${passedTests} / ${totalTests} PASSED `);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runLiveSourceAdapterTests().catch((err) => {
  console.error('Test execution failed with error:', err);
  process.exit(1);
});
