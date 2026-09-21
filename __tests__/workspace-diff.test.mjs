// Unit tests for the pure three-way diff / plan-building logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { threeWayDiff, buildPushPlan } from '../lib/workspace-diff.mjs';

function m(obj) {
  return new Map(Object.entries(obj));
}

// ---------------------------------------------------------------------------
// threeWayDiff — spec §7.2 step 2/3
// ---------------------------------------------------------------------------

test('threeWayDiff: a remote-only change is taken', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's1' }), remote: m({ a: 's2' }) });
  assert.deepEqual(result.takeRemote, ['a']);
  assert.deepEqual(result.conflicts, []);
});

test('threeWayDiff: a local-only change is kept', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's2' }), remote: m({ a: 's1' }) });
  assert.deepEqual(result.keepLocal, ['a']);
  assert.deepEqual(result.conflicts, []);
});

test('threeWayDiff: both changed to DIFFERENT bytes is a conflict', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's2' }), remote: m({ a: 's3' }) });
  assert.deepEqual(result.conflicts, [{ path: 'a', localSha: 's2', remoteSha: 's3' }]);
});

test('threeWayDiff: both changed to the SAME bytes converges, not a conflict', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's2' }), remote: m({ a: 's2' }) });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.unchanged, ['a']);
});

test('threeWayDiff: --take-remote resolves one conflict in the remote\'s favor', () => {
  const result = threeWayDiff({
    base: m({ a: 's1' }),
    local: m({ a: 's2' }),
    remote: m({ a: 's3' }),
    takeRemoteOverrides: new Set(['a']),
  });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.takeRemote, ['a']);
});

test('threeWayDiff: remote deleted a file the local side never touched — remote-only change', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's1' }), remote: m({}) });
  assert.deepEqual(result.takeRemote, ['a']);
});

test('threeWayDiff: an untracked new local file (no base, no remote) is kept, not flagged', () => {
  const result = threeWayDiff({ base: m({}), local: m({ a: 's1' }), remote: m({}) });
  assert.deepEqual(result.keepLocal, ['a']);
  assert.deepEqual(result.conflicts, []);
});

test('threeWayDiff: untouched path is unchanged', () => {
  const result = threeWayDiff({ base: m({ a: 's1' }), local: m({ a: 's1' }), remote: m({ a: 's1' }) });
  assert.deepEqual(result.unchanged, ['a']);
});

// ---------------------------------------------------------------------------
// buildPushPlan — spec §7.3 step 1
// ---------------------------------------------------------------------------

test('buildPushPlan: a local file with no base entry is a create', () => {
  const plan = buildPushPlan({ base: m({}), local: m({ a: 's1' }) });
  assert.deepEqual(plan, { creates: ['a'], updates: [], deletes: [] });
});

test('buildPushPlan: a local file whose hash differs from base is an update', () => {
  const plan = buildPushPlan({ base: m({ a: 's1' }), local: m({ a: 's2' }) });
  assert.deepEqual(plan, { creates: [], updates: ['a'], deletes: [] });
});

test('buildPushPlan: a base entry missing locally is a delete', () => {
  const plan = buildPushPlan({ base: m({ a: 's1' }), local: m({}) });
  assert.deepEqual(plan, { creates: [], updates: [], deletes: ['a'] });
});

test('buildPushPlan: unchanged files produce no operation', () => {
  const plan = buildPushPlan({ base: m({ a: 's1' }), local: m({ a: 's1' }) });
  assert.deepEqual(plan, { creates: [], updates: [], deletes: [] });
});
