import {
  fetch2DResultByDate,
  validateThaiStockResponse,
  isValidThaiStockDateGroup,
} from '../src/core/api/thaistockClient';
import { parseAndVerify2DResult } from '../src/core/integrity/parser';

async function runParserTests() {
  console.log('===============================================================');
  console.log('       THAISTOCK2D RESPONSE PARSER FOCUSED TEST SUITE        ');
  console.log('===============================================================');

  const originalFetch = globalThis.fetch;

  try {
    // -------------------------------------------------------------
    // TEST 1: Exact 2023-02-01 PHP Warning + Embedded JSON Extraction
    // -------------------------------------------------------------
    console.log('\n--- [TEST 1] Exact 2023-02-01 PHP Warning + Embedded JSON ---');
    const phpWarning20230201 = `2, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 382, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 392, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 382, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 392, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 382, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 39[{"child":[{"time":"11:00:00","set":null,"value":null,"twod":"--","history_id":"708220"},{"time":"12:00:00","set":null,"value":null,"twod":"--","history_id":"708220"},{"time":"15:00:00","set":null,"value":null,"twod":"--","history_id":"708220"},{"time":"16:30:00","set":"1,685.75","value":"63,790.96","twod":"50","history_id":"708334"}],"date":"2023-02-01"}]`;

    globalThis.fetch = async () => new Response(phpWarning20230201, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const res1 = await fetch2DResultByDate('2023-02-01');
    if (res1.length !== 1 || res1[0].date !== '2023-02-01' || res1[0].child?.length !== 4) {
      throw new Error(`TEST 1 FAILED: Unexpected parsed result: ${JSON.stringify(res1)}`);
    }
    console.log('PASS: TEST 1 Raw payload successfully extracted with all 4 child records present.');

    // -------------------------------------------------------------
    // TEST 2: Pass 2023-02-01 Payload to Integrity Parser
    // -------------------------------------------------------------
    console.log('\n--- [TEST 2] Integrity Parser on 2023-02-01 Payload ---');
    const integrityRes = parseAndVerify2DResult(res1, '2023-02-01');
    if (integrityRes.verifiedCount !== 1 || integrityRes.rejectedCount !== 3) {
      throw new Error(`TEST 2 FAILED: Expected 1 verified and 3 rejected, got ${integrityRes.verifiedCount} verified and ${integrityRes.rejectedCount} rejected`);
    }
    const verifiedRecord = integrityRes.verifiedRecords[0];
    if (
      verifiedRecord.time !== '16:30:00' ||
      verifiedRecord.twod !== '50' ||
      verifiedRecord.historyId !== '708334' ||
      verifiedRecord.mathematicalCheck.isMathematicallyConsistent !== true ||
      verifiedRecord.provenance !== 'OFFICIAL_SET_MARKET_LIVE'
    ) {
      throw new Error(`TEST 2 FAILED: Verified record properties mismatch: ${JSON.stringify(verifiedRecord)}`);
    }
    console.log('PASS: TEST 2 3 placeholder records rejected, exactly 1 authentic 16:30 record verified (twod=50, math=true, provenance=OFFICIAL_SET_MARKET_LIVE).');

    // -------------------------------------------------------------
    // TEST 3: 2023-05-05 Malformed/Null Payload Remains Protected
    // -------------------------------------------------------------
    console.log('\n--- [TEST 3] 2023-05-05 Malformed Payload Protection ---');
    const phpWarning20230505 = `2, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 382, number_format() expects parameter 1 to be float, string given, /var/www/thaistock2d/api/2d_result.php, 38[{"child":[{"time":"11:00:00","set":null,"value":"0.00","twod":"0","history_id":"850637"},{"time":"12:00:00","set":null,"value":"0.00","twod":"0","history_id":"850638"},{"time":"15:00:00","set":"1,533.30","value":"0.00","twod":"30","history_id":"850698"},{"time":"16:30:00","set":"1,533.30","value":"0.00","twod":"30","history_id":"850698"}],"date":"2023-05-05"}]`;

    globalThis.fetch = async () => new Response(phpWarning20230505, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const res3 = await fetch2DResultByDate('2023-05-05');
    const integrityRes3 = parseAndVerify2DResult(res3, '2023-05-05');
    // Modern epoch (2023-05-05 >= 2023-02-02) requires valueNumeric >= 100.0 and twod 2 digits.
    // 11:00 (set=null) -> rejected
    // 12:00 (set=null) -> rejected
    // 15:00 (value="0.00" < 100) -> rejected
    // 16:30 (value="0.00" < 100) -> rejected
    if (integrityRes3.verifiedCount !== 0 || integrityRes3.rejectedCount !== 4) {
      throw new Error(`TEST 3 FAILED: Expected 0 verified and 4 rejected, got ${integrityRes3.verifiedCount} verified and ${integrityRes3.rejectedCount} rejected`);
    }
    console.log('PASS: TEST 3 2023-05-05 malformed/null records rejected strictly (0 verified, 4 rejected, zero synthetic data).');

    // -------------------------------------------------------------
    // TEST 4: Existing Clean JSON Market Responses Still Parse
    // -------------------------------------------------------------
    console.log('\n--- [TEST 4] Existing Clean JSON Response ---');
    const validMarketJson = JSON.stringify([
      {
        date: '2026-08-26',
        child: [
          { time: '11:00:00', set: '1,607.61', value: '32,871.48', twod: '11', history_id: '2765893' },
          { time: '12:01:00', set: '1,608.37', value: '40,068.01', twod: '78', history_id: '2766328' },
        ],
      },
    ]);

    globalThis.fetch = async () => new Response(validMarketJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const res4 = await fetch2DResultByDate('2026-08-26');
    if (res4.length !== 1 || res4[0].date !== '2026-08-26' || res4[0].child?.length !== 2) {
      throw new Error(`TEST 4 FAILED: Unexpected parsed result: ${JSON.stringify(res4)}`);
    }
    console.log('PASS: TEST 4 Clean JSON response parsed accurately.');

    // -------------------------------------------------------------
    // TEST 5: Existing [] Non-Trading Responses Still Parse
    // -------------------------------------------------------------
    console.log('\n--- [TEST 5] Existing [] Non-Trading Response ---');
    globalThis.fetch = async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const res5 = await fetch2DResultByDate('2026-08-23');
    if (!Array.isArray(res5) || res5.length !== 0) {
      throw new Error(`TEST 5 FAILED: Expected empty array, got ${JSON.stringify(res5)}`);
    }
    console.log('PASS: TEST 5 Empty array [] preserved for non-trading days.');

    // -------------------------------------------------------------
    // TEST 6: Existing SafeMySQL / Diagnostic-Only Error Fails Safely
    // -------------------------------------------------------------
    console.log('\n--- [TEST 6] Diagnostic-Only Error Fails Safely ---');
    const safeMySqlError = `256, SafeMySQL: Error in query. Full query: [SET_sql_mode=foo]. Error initiated in /var/www/thaistock2d/api/2d_result.php on line 30, thrown, /var/www/thaistock2d/lib/safemysql.class.php, 739`;

    globalThis.fetch = async () => new Response(safeMySqlError, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    let caught6 = false;
    try {
      await fetch2DResultByDate('2026-08-26');
    } catch (err: any) {
      caught6 = true;
      if (!err.message.includes('SafeMySQL') && !err.message.includes('upstream server error')) {
        throw new Error(`TEST 6 FAILED: Expected upstream server error message, got: ${err.message}`);
      }
      console.log(`Caught expected error: ${err.message}`);
    }
    if (!caught6) {
      throw new Error('TEST 6 FAILED: Expected fetch2DResultByDate to throw on SafeMySQL error, but it succeeded.');
    }
    console.log('PASS: TEST 6 Diagnostic-only error fails safely and never produces fake data.');

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n===============================================================');
  console.log('       ALL THAISTOCK2D PARSER TESTS PASSED (1 - 6)!           ');
  console.log('===============================================================\n');
}

runParserTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
