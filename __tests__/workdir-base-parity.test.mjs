// CYN-1080 — cross-file parity gate: connect.mjs and operator-proxy.mjs each
// hardcode their OWN copy of the working-dir base name (`CynapOperator`).
// They can't share an import across the build-copy byte-parity boundary (see
// the comments on both consts), so nothing else stops the two literals
// drifting apart the way the ~/.cynap-operator -> ~/CynapOperator move itself
// almost did. This test is the standing invariant: it resolves a path via
// EACH module independently and asserts they land under the exact same
// `<homedir>/CynapOperator/<slug>` prefix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveWorkingDir } from '../lib/connect.mjs';
import { markerPath } from '../bin/operator-proxy.mjs';

test('resolveWorkingDir (connect.mjs) and markerPath (operator-proxy.mjs) resolve under the same visible base dir', () => {
  const slug = 'acme';
  const expected = join(homedir(), 'CynapOperator', slug);

  const workingDir = resolveWorkingDir(slug);
  assert.equal(workingDir, expected, 'resolveWorkingDir must materialize under <homedir>/CynapOperator/<slug>');

  // markerPath('acme', 'sess') === <workingDir>/session-markers/sess.json —
  // walk back up two segments (session-markers/, <sessionId>.json) to recover
  // the per-org working dir markerPath's default baseDir resolved to.
  const marker = markerPath(slug, 'sess');
  const markerWorkingDir = dirname(dirname(marker));
  assert.equal(markerWorkingDir, expected, 'markerPath default baseDir must resolve under <homedir>/CynapOperator/<slug>');

  // Transitively: the two independently-hardcoded base dirs agree with each other.
  assert.equal(workingDir, markerWorkingDir, 'connect.mjs and operator-proxy.mjs must agree on the working-dir base');
});
