import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatStatus, status } from '../bin/cynap-status.mjs';
import { writeStateAtomic } from '../lib/workspace-sync.mjs';

const SHA = 'a'.repeat(64);
const TIP = 'b'.repeat(64);

test('status reads the chain through MCP, shows degraded cause and stale local base', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cyn-status-'));
  const dir = join(root, 'CynapOperator', 'cynap-e2e');
  mkdirSync(dir, { recursive: true });
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: SHA, files: {} });
    const calls = [];
    const fetchImpl = async (_url, init) => {
      const name = JSON.parse(init.body).params.name;
      calls.push(name);
      assert.equal(name, 'workspace_status');
      return { ok: true, json: async () => ({ result: { structuredContent: {
        ok: true, accepted_tip: TIP, live_digest: null, deployment_state: 'degraded', frozen: { reason: 'manual' },
        chain: [{ sha: TIP, author_id: 'operator-1' }], pending: [{ commit_sha: TIP, state: 'pending_activation',
          next_action: { kind: 'blocked_by_chain', next_commit_sha: SHA } }],
      } } }) };
    };
    const result = await status({ cwd: dir, fetchImpl, probe: async () => ({ ok: true, pluginVersion: '0.19.30' }) });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['workspace_status']);
    const output = formatStatus(result);
    assert.match(output, /cynap-e2e: UP.*plugin 0\.19\.30/);
    assert.match(output, /deployment: degraded — the live deployment identity could not be read reliably/);
    assert.match(output, /blocked by a{64}/);
    assert.match(output, /chain frozen: recovery currently needs a platform admin/);
    assert.match(output, /pull before editing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('status --dir cannot query another org: a workspace saved for a different org is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cyn-status-'));
  const cwd = join(root, 'CynapOperator', 'cynap-e2e');
  const other = join(root, 'CynapOperator', 'other', 'cynap-other');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(other, { recursive: true });
  try {
    writeStateAtomic(other, { org: 'other', base: SHA, files: {} });
    const fetchImpl = async () => assert.fail('no platform call may be made for a mismatched workspace');
    await assert.rejects(
      status({ cwd, argv: ['--dir', other], fetchImpl, probe: async () => ({ ok: true }) }),
      /workspace mismatch.*"other".*connected org is "cynap-e2e"/
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('status finds the default cynap-<org> workspace under the connect directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cyn-status-'));
  const cwd = join(root, 'CynapOperator', 'cynap-e2e');
  const child = join(cwd, 'cynap-cynap-e2e');
  mkdirSync(child, { recursive: true });
  try {
    writeStateAtomic(child, { org: 'cynap-e2e', base: SHA, files: {} });
    const fetchImpl = async () => ({ ok: true, json: async () => ({ result: { structuredContent: {
      ok: true, accepted_tip: TIP, deployment_state: 'ok', chain: [], pending: [] } } }) });
    const result = await status({ cwd, fetchImpl, probe: async () => ({ ok: true }) });
    assert.equal(result.workspace.root, child);
    assert.equal(result.localBase, SHA);
    assert.equal(result.behind, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
