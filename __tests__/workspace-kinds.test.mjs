// Unit tests for the /cynap-push local kind_not_activatable pre-check.
// classifyPath comes from the REAL bundled checks core (cynap-checks-core.mjs), built off the
// same KIND_REGISTRY the backend enforces — see build-checks-core.mjs / mirror-entry.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPath } from '../bin/cynap-checks-core.mjs';
import { classifyForPush, entranceForKind, COMMIT_ONLY_KINDS, DEFERRED_ACTIVATION_KINDS, OWN_ENTRANCE_KINDS } from '../lib/workspace-kinds.mjs';

test('classifyPath is reachable from the bundled checks core (not tree-shaken away)', () => {
  assert.equal(typeof classifyPath, 'function');
  assert.equal(classifyPath('automations/foo.json'), 'automation');
});

test('classifyForPush refuses a generated path', () => {
  const refusal = classifyForPush('automations/metrics/whatever.json', classifyPath);
  assert.deepEqual(refusal, { path: 'automations/metrics/whatever.json', kind: 'generated', entrance: null });
});

test('classifyForPush refuses an unknown path', () => {
  const refusal = classifyForPush('not-a-managed-path.txt', classifyPath);
  assert.deepEqual(refusal, { path: 'not-a-managed-path.txt', kind: 'unknown', entrance: null });
});

test('classifyForPush refuses a git-entrance-only kind, naming the entrance', () => {
  const refusal = classifyForPush('manifest.json', classifyPath); // org-manifest, DEFERRED
  assert.equal(refusal.kind, 'org-manifest');
  assert.equal(refusal.entrance, 'git');
});

test('classifyForPush refuses checks/** — the exact reason /cynap-checks reads HEAD, never pending', () => {
  const refusal = classifyForPush('checks/suite.json', classifyPath);
  assert.equal(refusal.kind, 'checks');
  assert.equal(refusal.entrance, 'git');
});

test('classifyForPush refuses handler source with the handler_upload entrance', () => {
  const refusal = classifyForPush('automations/handlers/foo/handler.ts', classifyPath);
  assert.equal(refusal.kind, 'handler-source');
  assert.equal(refusal.entrance, 'handler_upload');
});

test('classifyForPush allows a commit-only operator note (never refused locally)', () => {
  assert.equal(classifyPath('operator/README.md'), 'operator-note');
  assert.equal(classifyForPush('operator/README.md', classifyPath), null);
  assert.equal(entranceForKind('operator-note'), null);
});

test('commit-only kinds are disjoint from the refused kinds', () => {
  for (const kind of COMMIT_ONLY_KINDS) {
    assert.ok(!DEFERRED_ACTIVATION_KINDS.has(kind) && !OWN_ENTRANCE_KINDS.has(kind), kind);
  }
});

test('classifyForPush allows an ordinary activatable kind (no refusal)', () => {
  assert.equal(classifyForPush('automations/sync.json', classifyPath), null);
  assert.equal(classifyForPush('context/profile.md', classifyPath), null);
});

test('every DEFERRED_ACTIVATION_KINDS / OWN_ENTRANCE_KINDS member maps to a non-null entrance', () => {
  for (const kind of [...DEFERRED_ACTIVATION_KINDS, ...OWN_ENTRANCE_KINDS]) {
    assert.ok(entranceForKind(kind), `expected an entrance for ${kind}`);
  }
});

test('entranceForKind returns null for an ordinary activatable kind', () => {
  assert.equal(entranceForKind('automation'), null);
});
