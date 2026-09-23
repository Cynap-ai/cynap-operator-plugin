// Integration-style tests for /cynap-push. Every MCP call is a
// fake fetch — no network, no real proxy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { formatSurfaceRefusal, push } from '../bin/cynap-push.mjs';
import { readState, sha256Hex, writeStateAtomic, WorkspaceSyncError } from '../lib/workspace-sync.mjs';

const NEW_SHA = 'd'.repeat(64);

function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'cyn1998-c2p-push-'));
}

function fakeFetch(handlers) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const { name, arguments: args } = body.params;
    const handler = handlers[name];
    if (!handler) throw new Error(`fakeFetch: no handler registered for tool "${name}"`);
    const toolResult = await handler(args);
    return { ok: true, json: async () => ({ result: { structuredContent: toolResult } }) };
  };
}

function noChecksOnLive() {
  return { workspace_tree: ({ commit }) => (commit === 'live' ? { ok: true, commit_sha: 'live-sha', entries: [] } : (() => { throw new Error('unexpected workspace_tree call'); })()) };
}

test('push: no .cynap/state.json refuses with a clear message', async () => {
  const dir = scratchDir();
  try {
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl: fakeFetch({}) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_state');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: local tree matching the base exactly is a no-op — no MCP calls made', async () => {
  const dir = scratchDir();
  try {
    writeFileSync(join(dir, 'a.json'), '{}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: { 'a.json': sha256Hex(Buffer.from('{}')) } });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl: fakeFetch({}) });
    assert.equal(result.ok, true);
    assert.equal(result.noop, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: refuses locally on a git-entrance-only kind, naming the entrance — no MCP calls made', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{}'); // org-manifest → DEFERRED_ACTIVATION_KINDS
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl: fakeFetch({}) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'kind_not_activatable');
    assert.deepEqual(result.refusals, [{ path: 'manifest.json', kind: 'org-manifest', entrance: 'git' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: a checks/ failure against the PLANNED bytes refuses, with no skip flag', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'sync.json'), JSON.stringify({ enabled: false }));
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });

    const suite = JSON.stringify({
      id: 's1',
      assertions: [{ op: 'json_path_equals', file: 'automations/sync.json', path: '$.enabled', equals: true }],
    });

    const fetchImpl = fakeFetch({
      workspace_tree: ({ commit }) => {
        assert.equal(commit, 'live');
        return { ok: true, commit_sha: 'live-sha', entries: [{ path: 'checks/suite.json', kind: 'checks', type: 'file' }] };
      },
      workspace_get_file: ({ path, commit }) => {
        assert.equal(path, 'checks/suite.json');
        assert.equal(commit, 'live');
        return { ok: true, path, kind: 'checks', encoding: 'utf8', content: suite };
      },
      workspace_validate: () => {
        throw new Error('workspace_validate must not be called after a checks failure');
      },
      workspace_commit: () => {
        throw new Error('workspace_commit must not be called after a checks failure');
      },
    });

    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'checks_failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: workspace_validate refusal stops before any commit', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'a.json'), '{"x":1}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ ok: false, code: 'validation_failed' }),
      workspace_commit: () => {
        throw new Error('workspace_commit must not be called after a validate refusal');
      },
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation_failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: --dry-run stops after validate — workspace_commit is never called', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'a.json'), '{"x":1}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ ok: true, status: 'passed' }),
      workspace_commit: () => {
        throw new Error('workspace_commit must not be called during --dry-run');
      },
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '--dry-run'], fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.plan.creates, ['automations/a.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: a successful commit updates state and reports the chain position, with no activation yet', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'a.json'), '{"x":1}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ ok: true, status: 'passed' }),
      workspace_commit: (args) => {
        assert.equal(args.expected_head_sha, 'b'.repeat(64));
        assert.equal(args.message, 'edit');
        return { ok: true, commit: { commit_sha: NEW_SHA, parent_commit_sha: args.expected_head_sha, created_at: '2026-09-21T00:00:00Z' } };
      },
      workspace_get_commit: ({ sha }) => {
        assert.equal(sha, NEW_SHA);
        return { ok: true, commit: {}, state: 'pending', position: 0, operations: [] };
      },
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.commitSha, NEW_SHA);
    assert.equal(result.replayed, false);
    assert.equal(result.state, 'pending');
    assert.equal(result.position, 0);
    assert.equal(result.activation, null);

    const state = readState(dir);
    assert.equal(state.base, NEW_SHA);
    assert.deepEqual(state.files, { 'automations/a.json': sha256Hex(Buffer.from('{"x":1}')) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: parent_mismatch names the current tip and tells the caller to pull', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'a.json'), '{"x":1}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ ok: true, status: 'passed' }),
      workspace_commit: () => ({
        ok: false,
        code: 'parent_mismatch',
        message: 'expected_head_sha does not match the accepted tip.',
        tip: { sha: 'e'.repeat(64), author_id: 'roee', message: 'a prior commit' },
      }),
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'parent_mismatch');
    assert.equal(result.tip.sha, 'e'.repeat(64));
    assert.match(result.message, /cynap-pull/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: chain_full names the depth and the incoming commit sha', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'a.json'), '{"x":1}');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ ok: true, status: 'passed' }),
      workspace_commit: () => ({
        ok: false,
        code: 'chain_full',
        message: 'The accepted chain already holds 10 pending commits.',
        depth: 10,
        next_commit_sha: 'f'.repeat(64),
      }),
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'chain_full');
    assert.equal(result.depth, 10);
    assert.equal(result.nextCommitSha, 'f'.repeat(64));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: a symlink anywhere in the local tree refuses', async () => {
  const dir = scratchDir();
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    writeFileSync(join(dir, 'a.json'), '{}');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(join(dir, 'a.json'), join(dir, 'evil.json'));
    await assert.rejects(
      push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'edit'], fetchImpl: fakeFetch({}) }),
      (error) => error instanceof WorkspaceSyncError && error.path === 'evil.json'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Surface refusals and the no-change rebuild commit.

test('push: a surface gate refusal returns its code, findings, hint and retryability', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'surfaces', 'ops-board'), { recursive: true });
    writeFileSync(join(dir, 'surfaces', 'ops-board', 'index.tsx'), 'window.parent.postMessage(1)');
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: {} });
    const findings = [{ rule: 'raw_post_message', file: 'index.tsx', line: 1, column: 1, message: 'postMessage is not allowed.' }];
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ status: 'passed' }),
      workspace_commit: () => ({ ok: false, code: 'surface_lint_failed', message: 'workspace_commit refused: surface_lint_failed', hint: 'Use the SDK hooks.', findings, retryable: false }),
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'surface'], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'surface_lint_failed');
    assert.deepEqual(result.findings, findings);
    assert.equal(result.hint, 'Use the SDK hooks.');
    assert.equal(result.retryable, false);
    const block = formatSurfaceRefusal(result);
    assert.match(block, /index\.tsx:1:1: postMessage is not allowed\. \[raw_post_message\]/);
    assert.match(block, /Fix: Use the SDK hooks\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: --rebuild commits with no file changes and names the surface', async () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'surfaces', 'ops-board'), { recursive: true });
    writeFileSync(join(dir, 'surfaces', 'ops-board', 'index.tsx'), 'export default () => null;');
    writeStateAtomic(dir, {
      org: 'cynap-e2e',
      base: 'b'.repeat(64),
      files: { 'surfaces/ops-board/index.tsx': sha256Hex(Buffer.from('export default () => null;')) },
    });
    let committedArgs = null;
    const fetchImpl = fakeFetch({
      ...noChecksOnLive(),
      workspace_validate: () => ({ status: 'passed' }),
      workspace_commit: (args) => {
        committedArgs = args;
        return { ok: true, commit: { commit_sha: NEW_SHA, parent_commit_sha: 'b'.repeat(64), created_at: 'now' } };
      },
      workspace_get_commit: () => ({ ok: true, state: 'pending', position: 1 }),
    });
    const result = await push({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '-m', 'rebuild', '--rebuild', 'ops-board'], fetchImpl });
    assert.equal(result.ok, true);
    assert.deepEqual(committedArgs.changes, { operations: [] });
    assert.equal(committedArgs.rebuild_surface_id, 'ops-board');
    assert.equal(readState(dir).base, NEW_SHA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('push: --rebuild refuses a value that is not a surface id', async () => {
  await assert.rejects(
    push({ cwd: '/tmp/op/cynap-e2e', argv: ['-m', 'x', '--rebuild', '../etc'], fetchImpl: fakeFetch({}) }),
    /--rebuild needs a surface id/
  );
});
