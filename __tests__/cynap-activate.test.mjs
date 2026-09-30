// /cynap-activate --reconcile arg parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivateArgs } from '../bin/cynap-activate.mjs';

const SHA = 'c'.repeat(64);

test('parseActivateArgs: --reconcile sets reconcile, its absence leaves it false', () => {
  assert.deepEqual(parseActivateArgs([SHA]), { commitSha: SHA, reconcile: false });
  assert.deepEqual(parseActivateArgs([SHA, '--reconcile']), { commitSha: SHA, reconcile: true });
  assert.deepEqual(parseActivateArgs(['--reconcile', SHA]), { commitSha: SHA, reconcile: true });
});

test('parseActivateArgs: refuses unknown flags, duplicates and a missing sha', () => {
  for (const argv of [[], ['--reconcile'], [SHA, '--force'], [SHA, '--reconcile', '--reconcile'], [SHA, SHA]]) {
    assert.throws(() => parseActivateArgs(argv), /Usage: cynap-activate\.mjs/);
  }
});
