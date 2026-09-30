import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchLiveCheckFiles, runChecksPreflight } from '../lib/workspace-checks-preflight.mjs';

/** A fake MCP `call` that records how many `workspace_get_file` reads are in flight at once. */
function fakeCall({ livePaths, files = {}, refuse = new Set() }) {
  const stats = { inFlight: 0, maxInFlight: 0, gets: [] };
  const call = async (name, args) => {
    if (name === 'workspace_tree') return { entries: livePaths.map((path) => ({ path })) };
    assert.equal(name, 'workspace_get_file');
    stats.gets.push(`${args.commit}:${args.path}`);
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    stats.inFlight -= 1;
    if (refuse.has(args.path)) return { ok: false, code: 'not_found' };
    return { encoding: 'utf8', content: files[args.path] ?? `{"path":"${args.path}"}` };
  };
  return { call, stats };
}

const suitePaths = Array.from({ length: 30 }, (_, i) => `checks/suite-${String(i).padStart(2, '0')}.check.json`);

test('live check files are read with bounded concurrency, and every file lands under its own path', async () => {
  const { call, stats } = fakeCall({ livePaths: [...suitePaths, 'automations/a.json', 'checks/README.md'] });
  const bytesByPath = await fetchLiveCheckFiles(call);

  assert.deepEqual([...bytesByPath.keys()], suitePaths);
  for (const path of suitePaths) {
    assert.equal(Buffer.from(bytesByPath.get(path)).toString('utf8'), `{"path":"${path}"}`);
  }
  assert.equal(stats.gets.length, suitePaths.length);
  assert.ok(stats.maxInFlight > 1, `reads ran one at a time (max in flight ${stats.maxInFlight})`);
  assert.ok(stats.maxInFlight <= 8, `reads exceeded the bound (max in flight ${stats.maxInFlight})`);
});

test('a refused live check read fails the preflight', async () => {
  const { call } = fakeCall({ livePaths: suitePaths, refuse: new Set([suitePaths[7]]) });
  await assert.rejects(fetchLiveCheckFiles(call), /workspace_get_file\(checks\/suite-07\.check\.json\) refused: not_found/);
});

test('a live check reply without content fails the preflight', async () => {
  const call = async (name) => (name === 'workspace_tree' ? { entries: [{ path: suitePaths[0] }] } : { encoding: 'utf8' });
  await assert.rejects(fetchLiveCheckFiles(call), /reply has no \{encoding, content\}/);
});

test('fingerprint paths come from live checks, then planned bytes, then bounded tip reads', async () => {
  const tipPaths = Array.from({ length: 20 }, (_, i) => `automations/tip-${i}.json`);
  const { call, stats } = fakeCall({ livePaths: suitePaths.slice(0, 2), refuse: new Set([tipPaths[3]]) });
  const planned = new Uint8Array([1, 2, 3]);
  let resolved;

  const result = await runChecksPreflight({
    call,
    resolvePlanned: (path) => (path === 'automations/planned.json' ? planned : path === 'automations/deleted.json' ? null : undefined),
    collectFingerprintPaths: () => [suitePaths[0], 'automations/planned.json', 'automations/deleted.json', ...tipPaths],
    evaluateChecks: (_suites, resolve) => {
      resolved = resolve;
      return { suites: [{ assertions: [{ passed: true }] }] };
    },
  });

  assert.equal(result.ran, true);
  assert.equal(result.firstFailure, undefined);
  assert.equal(resolved('automations/planned.json'), planned);
  assert.equal(resolved('automations/deleted.json'), null);
  assert.equal(resolved(tipPaths[3]), null);
  assert.equal(Buffer.from(resolved(tipPaths[4])).toString('utf8'), `{"path":"${tipPaths[4]}"}`);
  assert.deepEqual(
    stats.gets.filter((get) => get.startsWith('tip:')).sort(),
    tipPaths.map((path) => `tip:${path}`).sort()
  );
  assert.ok(stats.maxInFlight > 1 && stats.maxInFlight <= 8, `max in flight ${stats.maxInFlight}`);
});

test('no live checks means the preflight does not run', async () => {
  const { call, stats } = fakeCall({ livePaths: ['automations/a.json'] });
  assert.deepEqual(await runChecksPreflight({ call }), { ran: false });
  assert.equal(stats.gets.length, 0);
});
