// CYN-1094 / ADR-0059 — drift guard for the operator-local checks core.
//
// bin/cynap-checks-core.mjs is a builtins-only MIRROR of the operator tool contract This test
// PINS it to golden vectors computed from the SDK (the source of truth). If the plugin core drifts
// from the SDK's canonical fingerprint rule, this REDs — and since the backend recomputes the SAME
// fingerprint server-side (W2) and refuses on mismatch, a drift would silently brick every
// activation. The GOLDEN_FP constants below were captured by running the SDK's
// computeResultantFingerprint over these exact fixtures; the SDK-side test independently recomputes
// the canonical string, so the two ends can never quietly diverge to a new-but-agreeing algorithm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeResultantFingerprint,
  MISSING_SENTINEL,
  memberDigest,
  parseJsonPath,
  evaluateChecks,
  collectFingerprintPaths,
} from '../bin/cynap-checks-core.mjs';

const enc = (s) => new TextEncoder().encode(s);

test('fingerprint matches the SDK golden vectors (drift guard)', () => {
  // { b:'B', a:'A', gone:null } — byte-sorted, MISSING sentinel
  assert.equal(
    computeResultantFingerprint([
      { path: 'b.json', bytes: enc('B') },
      { path: 'a.json', bytes: enc('A') },
      { path: 'gone.json', bytes: null },
    ]),
    '5970c7bc8ea76c28aa8bb79f5269107a1535da412551f6ee1aeb195ec0ba8683'
  );
  // NFD café path normalizes to NFC before hashing
  assert.equal(
    computeResultantFingerprint([{ path: 'context/café.json'.normalize('NFD'), bytes: enc('x') }]),
    'b7ebe22bf6d42229e719226cb0a1b5fb0669c09be1034fbd4943c2d1666bdfe4'
  );
  // empty F → sha256('')
  assert.equal(
    computeResultantFingerprint([]),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('fingerprint is order-independent and MISSING-consistent', () => {
  const a = computeResultantFingerprint([
    { path: 'a.json', bytes: enc('A') },
    { path: 'b.json', bytes: enc('B') },
  ]);
  const b = computeResultantFingerprint([
    { path: 'b.json', bytes: enc('B') },
    { path: 'a.json', bytes: enc('A') },
  ]);
  assert.equal(a, b);
  assert.equal(memberDigest(null), MISSING_SENTINEL);
  assert.notEqual(memberDigest(enc('')), MISSING_SENTINEL);
});

test('parseJsonPath handles the closed subset and rejects malformed', () => {
  assert.deepEqual(parseJsonPath('$.a.b'), [
    { kind: 'key', key: 'a' },
    { kind: 'key', key: 'b' },
  ]);
  assert.equal(parseJsonPath('a.b'), null);
  assert.equal(parseJsonPath('$.a['), null);
});

test('evaluateChecks passes and fails as the SDK does', () => {
  const pricing = enc(
    JSON.stringify({ commission_rates: { therapy: 0.3 }, arr: [1, 2, 3], tz: 'Europe/London' })
  );
  const resolve = (p) => (p === 'context/pricing_rules.json' ? pricing : null);
  const okSuite = {
    id: 's',
    assertions: [
      { op: 'json_path_equals', file: 'context/pricing_rules.json', path: '$.commission_rates.therapy', equals: 0.3 },
      { op: 'json_array_length', file: 'context/pricing_rules.json', path: '$.arr', length: 3 },
      { op: 'json_path_matches', file: 'context/pricing_rules.json', path: '$.tz', matches: '^Europe/London$' },
    ],
  };
  assert.equal(evaluateChecks([okSuite], resolve).status, 'pass');

  const changed = (p) =>
    p === 'context/pricing_rules.json' ? enc(JSON.stringify({ commission_rates: { therapy: 0.35 } })) : null;
  const badSuite = {
    id: 's',
    assertions: [{ op: 'json_path_equals', file: 'context/pricing_rules.json', path: '$.commission_rates.therapy', equals: 0.3 }],
  };
  const result = evaluateChecks([badSuite], changed);
  assert.equal(result.status, 'fail');
  assert.equal(result.failed, 1);
});

test('collectFingerprintPaths unions asserted files with suite paths', () => {
  const s = {
    id: 's',
    assertions: [
      { op: 'file_exists', file: 'context/a.json' },
      { op: 'file_exists', file: 'communication/bots.json' },
    ],
  };
  assert.deepEqual(collectFingerprintPaths([s], ['checks/x.check.json']).sort(), [
    'checks/x.check.json',
    'communication/bots.json',
    'context/a.json',
  ]);
});
