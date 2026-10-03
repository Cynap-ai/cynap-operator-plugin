// /cynap-pull never destroys local bytes: a file the remote tip no longer holds is MOVED to
// .cynap/discarded/<stamp>/ and reported, never unlinked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { pull } from '../bin/cynap-pull.mjs';
import { sha256Hex, writeStateAtomic } from '../lib/workspace-sync.mjs';

const TIP_SHA = 'c'.repeat(64);
const H_OLD = sha256Hex(Buffer.from('{"a":1}'));
const H_KEEP = sha256Hex(Buffer.from('{"b":2}'));

function fakeFetch(handlers) {
  return async (_url, init) => {
    const { name, arguments: args } = JSON.parse(init.body).params;
    const toolResult = await handlers[name](args);
    return { ok: true, json: async () => ({ result: { structuredContent: toolResult } }) };
  };
}

test('pull: a file the remote tip no longer holds is moved to .cynap/discarded, never unlinked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-pull-discarded-'));
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'b'.repeat(64), files: { 'checks/old.mjs': H_OLD, 'keep.json': H_KEEP } });
    mkdirSync(join(dir, 'checks'), { recursive: true });
    writeFileSync(join(dir, 'checks', 'old.mjs'), '{"a":1}');
    writeFileSync(join(dir, 'keep.json'), '{"b":2}');

    const fetchImpl = fakeFetch({
      workspace_tree: () => ({
        ok: true,
        commit_sha: TIP_SHA,
        entries: [{ path: 'keep.json', kind: 'context-doc', type: 'file', size_bytes: 7, sha256: H_KEEP }],
      }),
      workspace_get_file: () => {
        throw new Error('nothing to fetch');
      },
    });

    const result = await pull({ cwd: '/tmp/op/cynap-e2e', argv: ['--dir', dir], fetchImpl });

    assert.equal(result.ok, true);
    assert.deepEqual(result.deleted, ['checks/old.mjs']);
    assert.equal(existsSync(join(dir, 'checks', 'old.mjs')), false);
    assert.equal(result.discarded.length, 1);
    assert.equal(result.discarded[0].path, 'checks/old.mjs');
    assert.equal(readFileSync(result.discarded[0].backup, 'utf8'), '{"a":1}');
    assert.ok(result.discarded[0].backup.includes(join('.cynap', 'discarded')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
