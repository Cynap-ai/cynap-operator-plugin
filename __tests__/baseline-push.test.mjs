// /cynap-push --baseline. Every MCP call is a fake; no test waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parsePushArgs, push, VALID_INTENTS } from '../bin/cynap-push.mjs';
import { BASELINE_WAIT_MS, formatBaselineResult, pushBaseline } from '../lib/baseline-push.mjs';
import { writeStateAtomic } from '../lib/workspace-sync.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BASE = 'b'.repeat(64);
const COMMIT = 'c'.repeat(64);
const REQUEST = '11111111-2222-4333-8444-555555555555';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'cyn3236-baseline-'));
  writeStateAtomic(dir, { org: 'cynap-e2e', base: BASE, files: {} });
  // A local file the baseline must never read or send.
  writeFileSync(join(dir, 'local-edit.md'), 'not sent');
  return dir;
}

function fakeFetch(handlers, calls) {
  return async (_url, init) => {
    const { name, arguments: args } = JSON.parse(init.body).params;
    calls.push({ name, args });
    const result = await handlers[name](args);
    return { ok: true, json: async () => ({ result: { structuredContent: result } }) };
  };
}

const accepted = {
  baseline: { state: 'accepted', commit_sha: COMMIT, snapshot_digest: 'e'.repeat(64), next_action: 'The Org Owner approves the baseline in the portal review pane (Settings, Operators, Pending changes).' },
};
const readBack = {
  next_action: { kind: 'owner_approval_required', portal_path: '/cynap-e2e/settings/operators' },
  surface_approval: { baseline: { snapshot: {
    entries: [{}, {}, {}],
    consent: { head_lacks: ['a'], head_only: [], bytes_differ: ['b', 'c'], action_configs_failing: [{ path: 'automations/x.json', code: 'x' }] },
  } } },
};

test('--baseline refuses every flag that would shape a push, and --intent baseline is refused', () => {
  for (const flag of [['-m', 'm'], ['--rebuild', 'ops'], ['--dry-run'], ['--intent', 'edit']]) {
    assert.throws(() => parsePushArgs(['--baseline', ...flag]), /--baseline takes no other flag/);
  }
  assert.deepEqual(parsePushArgs(['--baseline', '--dir', '/w', '--json']).baseline, true);
  assert.throws(() => parsePushArgs(['--intent', 'baseline', '-m', 'm']), /--baseline alone/);
});

test('the command doc names every intent and --baseline', () => {
  const doc = readFileSync(join(HERE, '..', 'commands', 'cynap-push.md'), 'utf8');
  for (const intent of [...VALID_INTENTS].filter((intent) => intent !== 'baseline')) assert.match(doc, new RegExp(`\\b${intent}\\b`));
  assert.match(doc, /--baseline/);
});

test('push --baseline sends only the intent and the pulled tip, then prints counts and the approval link', async () => {
  const dir = workspace();
  const calls = [];
  try {
    let polls = 0;
    const fetchImpl = fakeFetch({
      workspace_commit: async () => ({ ok: true, status: 'assembling', baseline_request_id: REQUEST }),
      workspace_status: async () => (++polls < 2 ? { baseline: { state: 'assembling' } } : accepted),
      workspace_get_commit: async () => readBack,
    }, calls);
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--baseline', '--dir', dir, '--proxy-url', 'http://127.0.0.1:1/mcp'], fetchImpl, sleepImpl: async () => {} });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls[0], { name: 'workspace_commit', args: { intent: 'baseline', expected_head_sha: BASE } });
    assert.deepEqual(calls[1].args, { baseline_request_id: REQUEST });
    assert.deepEqual(result.counts, { files: 3, head_lacks: 1, head_only: 0, bytes_differ: 2, action_configs_failing: 1 });
    const printed = formatBaselineResult(result, 'https://app.cynap.ai');
    assert.match(printed, new RegExp(`baseline committed ${COMMIT}`));
    assert.match(printed, /approve: https:\/\/app\.cynap\.ai\/cynap-e2e\/settings\/operators/);
    assert.match(printed, /first checkpoint only; drift is repaired with \/cynap-activate --reconcile/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('past the bounded wait it prints the readback command and never re-sends', async () => {
  const dir = workspace();
  const sent = [];
  let now = 0;
  try {
    const result = await pushBaseline({
      dir, org: 'cynap-e2e',
      call: async (name, args) => {
        sent.push(name);
        return name === 'workspace_commit' ? { ok: true, baseline_request_id: REQUEST, args } : { baseline: { state: 'assembling' } };
      },
      sleepImpl: async () => { now += BASELINE_WAIT_MS / 2; },
      nowImpl: () => now,
    });
    assert.equal(result.pending, true);
    assert.equal(result.readback, `/cynap-status --baseline ${REQUEST}`);
    assert.equal(sent.filter((name) => name === 'workspace_commit').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a server that predates the intent gets a version-skew message, not the raw enum error', async () => {
  const dir = workspace();
  try {
    const result = await pushBaseline({
      dir, org: 'cynap-e2e',
      call: async () => { throw new Error('MCP workspace_commit error: {"code":-32602,"message":"Invalid enum value for intent"}'); },
    });
    assert.equal(result.reason, 'baseline_unsupported_server');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refused assembly names its code, path and the next step', async () => {
  const dir = workspace();
  try {
    const result = await pushBaseline({
      dir, org: 'cynap-e2e',
      call: async (name) => (name === 'workspace_commit'
        ? { ok: true, baseline_request_id: REQUEST }
        : { baseline: { state: 'refused', code: 'baseline_tree_moved', path: 'context/a.md', next_action: 'Run /cynap-push --baseline again.' } }),
      sleepImpl: async () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'baseline_tree_moved');
    assert.match(result.message, /context\/a\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
