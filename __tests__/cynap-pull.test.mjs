// Integration-style tests for /cynap-pull. Every MCP call is a
// fake fetch — no network, no real proxy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { pull } from '../bin/cynap-pull.mjs';
import { readState, sha256Hex, writeStateAtomic, WorkspaceSyncError } from '../lib/workspace-sync.mjs';

const TIP_SHA = 'c'.repeat(64);
// Real hashes of the fixture bytes: pull verifies every fetched file against the tree's sha256,
// so a made-up hash here would encode the very assumption the check exists to catch.
const H_A = sha256Hex(Buffer.from('{"a":1}'));
const H_B = sha256Hex(Buffer.from('{"b":2}'));
const H_REMOTE = sha256Hex(Buffer.from('remote-content'));

function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'cyn1998-c2p-pull-'));
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

test('pull: first pull with no prior state creates every remote file and writes state', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [
          { path: 'a.json', kind: 'automation', type: 'file', size_bytes: 2, sha256: H_A },
          { path: 'b.json', kind: 'context-doc', type: 'file', size_bytes: 2, sha256: H_B },
        ],
      }),
      workspace_get_file: ({ path }) => ({
        ok: true,
        commit_sha: TIP_SHA,
        path,
        kind: 'automation',
        encoding: 'utf8',
        content: path === 'a.json' ? '{"a":1}' : '{"b":2}',
        sha256: path === 'a.json' ? H_A : H_B,
      }),
    });

    const result = await pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl });

    assert.equal(result.ok, true);
    assert.deepEqual(result.written, ['a.json', 'b.json']);
    assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), '{"a":1}');
    assert.equal(readFileSync(join(dir, 'b.json'), 'utf8'), '{"b":2}');

    const state = readState(dir);
    assert.equal(state.base, TIP_SHA);
    assert.deepEqual(state.files, { 'a.json': H_A, 'b.json': H_B });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: a conflicting path writes NOTHING and reports both shas', async () => {
  const dir = scratchDir();
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: { 'a.json': 'sha-base' } });
    writeFileSync(join(dir, 'a.json'), 'local-edit');
    const localSha = sha256Hex(Buffer.from('local-edit'));

    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [{ path: 'a.json', kind: 'automation', type: 'file', size_bytes: 4, sha256: 'sha-remote-different' }],
      }),
      workspace_get_file: () => {
        throw new Error('workspace_get_file must not be called before conflicts are resolved');
      },
    });

    const result = await pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'conflicts');
    assert.deepEqual(result.conflicts, [{ path: 'a.json', localSha, remoteSha: 'sha-remote-different' }]);

    // All-or-nothing: local content and state are UNTOUCHED.
    assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), 'local-edit');
    const state = readState(dir);
    assert.equal(state.base, 'b'.repeat(64));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An HTTP-layer failure on workspace_get_file used to surface as
// bare "MCP workspace_get_file HTTP 500" — no way to tell WHICH of N
// in-flight fetches (concurrency 8) failed. The message must name the tool
// AND the failing path.
test('pull: an HTTP error from workspace_get_file names the tool AND the failing path', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      const { name } = body.params;
      if (name === 'workspace_tree') {
        return {
          ok: true,
          json: async () => ({
            result: {
              structuredContent: {
                ok: true,
                commit_sha: TIP_SHA,
                entries: [{ path: 'context/profile.md', kind: 'context-doc', type: 'file', size_bytes: 1, sha256: H_REMOTE }],
              },
            },
          }),
        };
      }
      if (name === 'workspace_get_file') {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      throw new Error(`unexpected tool "${name}"`);
    };

    await assert.rejects(
      pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }),
      /workspace_get_file\(context\/profile\.md\) HTTP 500/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: --take-remote resolves one conflict and writes the remote bytes', async () => {
  const dir = scratchDir();
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: { 'a.json': 'sha-base' } });
    writeFileSync(join(dir, 'a.json'), 'local-edit');

    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [{ path: 'a.json', kind: 'automation', type: 'file', size_bytes: 4, sha256: H_REMOTE }],
      }),
      workspace_get_file: () => ({
        ok: true,
        path: 'a.json',
        kind: 'automation',
        encoding: 'utf8',
        content: 'remote-content',
        sha256: H_REMOTE,
      }),
    });

    const result = await pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir, '--take-remote', 'a.json'], fetchImpl });

    assert.equal(result.ok, true);
    assert.deepEqual(result.written, ['a.json']);
    assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), 'remote-content');
    const state = readState(dir);
    assert.equal(state.base, TIP_SHA);
    assert.deepEqual(state.files, { 'a.json': H_REMOTE });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: two remote paths that collide once case-folded refuse on every filesystem', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [
          { path: 'Context/Profile.md', kind: 'context-doc', type: 'file', size_bytes: 1, sha256: 'sha-1' },
          { path: 'context/profile.md', kind: 'context-doc', type: 'file', size_bytes: 1, sha256: 'sha-2' },
        ],
      }),
      workspace_get_file: () => {
        throw new Error('must not fetch content before the collision check');
      },
    });

    const result = await pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'case_collision');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: a remote path under the reserved .cynap/ directory refuses the WHOLE pull', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [{ path: '.cynap/state.json', kind: 'unknown', type: 'file', size_bytes: 1, sha256: 'sha-1' }],
      }),
    });

    await assert.rejects(
      pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }),
      WorkspaceSyncError
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: a directory that already holds state.json for a DIFFERENT org refuses', async () => {
  const dir = scratchDir();
  try {
    writeStateAtomic(dir, { org: 'some-other-org', base: 'b'.repeat(64), files: {} });
    const fetchImpl = fakeFetch({ workspace_tree: () => ({ ok: true, commit_sha: TIP_SHA, entries: [] }) });
    await assert.rejects(pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }), WorkspaceSyncError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function twoFileTree() {
  return {
    ok: true,
    commit_sha: TIP_SHA,
    entries: [
      { path: 'a.json', kind: 'automation', type: 'file', size_bytes: 7, sha256: H_A },
      { path: 'b.json', kind: 'context-doc', type: 'file', size_bytes: 7, sha256: H_B },
    ],
  };
}

test('pull: a fetched file whose bytes do not match the tree sha256 refuses and writes NOTHING', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = fakeFetch({
      workspace_tree: twoFileTree,
      workspace_get_file: ({ path }) => ({
        ok: true,
        path,
        encoding: 'utf8',
        content: path === 'a.json' ? '{"a":1}' : '{"b":"tampered"}',
      }),
    });
    await assert.rejects(pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }), /do not match the tree's sha256/);
    assert.equal(existsSync(join(dir, 'a.json')), false);
    assert.equal(existsSync(join(dir, 'b.json')), false);
    assert.equal(readState(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: a refused fetch of one file writes NOTHING, not the files fetched before it', async () => {
  const dir = scratchDir();
  try {
    const fetchImpl = fakeFetch({
      workspace_tree: twoFileTree,
      workspace_get_file: ({ path }) =>
        path === 'a.json'
          ? { ok: true, path, encoding: 'utf8', content: '{"a":1}' }
          : { ok: false, code: 'storage_unavailable' },
    });
    await assert.rejects(pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }), /storage_unavailable/);
    assert.equal(existsSync(join(dir, 'a.json')), false);
    assert.equal(readState(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: a symlinked .cynap/ directory refuses before any state is read or written', async () => {
  const dir = scratchDir();
  const outside = scratchDir();
  try {
    symlinkSync(outside, join(dir, '.cynap'));
    const fetchImpl = fakeFetch({
      workspace_tree: twoFileTree,
      workspace_get_file: ({ path }) => ({ ok: true, path, encoding: 'utf8', content: path === 'a.json' ? '{"a":1}' : '{"b":2}' }),
    });
    await assert.rejects(pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl }), WorkspaceSyncError);
    assert.equal(existsSync(join(outside, 'state.json')), false);
    assert.equal(existsSync(join(dir, 'a.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
