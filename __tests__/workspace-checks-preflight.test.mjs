import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { fetchLiveCheckFiles, runChecksPreflight } from '../lib/workspace-checks-preflight.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const remoteText = (path) => `{"path":"${path}"}`;

/**
 * A fake MCP `call`. It records every call and how many `workspace_get_file` reads are in flight
 * at once. `hashed: false` drops the sha256 from the listing, the way an older server would.
 */
function fakeCall({ livePaths, refuse = new Set(), acceptedTip = 'tip-1', hashed = true }) {
  const stats = { inFlight: 0, maxInFlight: 0, gets: [], trees: [] };
  const call = async (name, args) => {
    if (name === 'workspace_tree') {
      stats.trees.push(args);
      return {
        accepted_tip: acceptedTip,
        entries: livePaths
          .filter((path) => path.startsWith(args.prefix ?? ''))
          .map((path) => ({ path, ...(hashed ? { sha256: sha(remoteText(path)) } : {}) })),
      };
    }
    assert.equal(name, 'workspace_get_file');
    stats.gets.push(`${args.commit}:${args.path}`);
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    stats.inFlight -= 1;
    if (refuse.has(args.path)) return { ok: false, code: 'not_found' };
    return { encoding: 'utf8', content: remoteText(args.path) };
  };
  return { call, stats };
}

/** A working directory: path -> text. `resolveLocal` hands back bytes only on a sha256 match. */
function localDir(files) {
  const asked = [];
  const resolveLocal = (path, sha256) => {
    asked.push(path);
    const text = files[path];
    return text !== undefined && sha(text) === sha256 ? new Uint8Array(Buffer.from(text)) : undefined;
  };
  return { resolveLocal, asked };
}

const text = (bytes) => Buffer.from(bytes).toString('utf8');
const suitePaths = Array.from({ length: 30 }, (_, i) => `checks/suite-${String(i).padStart(2, '0')}.check.json`);

test('the listing asks for the checks prefix with hashes, in one call', async () => {
  const { call, stats } = fakeCall({ livePaths: [...suitePaths, 'automations/a.json'] });
  await fetchLiveCheckFiles(call);
  assert.deepEqual(stats.trees, [{ commit: 'live', prefix: 'checks/', include_hashes: true }]);
});

test('a suite the working directory already holds is not read over the wire', async () => {
  const { call, stats } = fakeCall({ livePaths: [...suitePaths, 'checks/README.md'] });
  const local = Object.fromEntries(suitePaths.map((path) => [path, remoteText(path)]));
  local[suitePaths[4]] = '{"edited":"locally"}';
  delete local[suitePaths[9]];

  const { bytesByPath, acceptedTip } = await fetchLiveCheckFiles(call, localDir(local).resolveLocal);

  assert.equal(acceptedTip, 'tip-1');
  assert.deepEqual([...bytesByPath.keys()], suitePaths);
  for (const path of suitePaths) assert.equal(text(bytesByPath.get(path)), remoteText(path), path);
  assert.deepEqual(stats.gets.sort(), [`live:${suitePaths[4]}`, `live:${suitePaths[9]}`]);
});

test('with no usable local copy every suite is read, more than one and at most eight at a time', async () => {
  const { call, stats } = fakeCall({ livePaths: suitePaths, hashed: false });
  const { resolveLocal, asked } = localDir(Object.fromEntries(suitePaths.map((path) => [path, remoteText(path)])));
  const { bytesByPath } = await fetchLiveCheckFiles(call, resolveLocal);

  assert.deepEqual(asked, [], 'an unhashed listing must never trust a local file');
  assert.equal(stats.gets.length, suitePaths.length);
  for (const path of suitePaths) assert.equal(text(bytesByPath.get(path)), remoteText(path), path);
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

const tipPaths = Array.from({ length: 20 }, (_, i) => `automations/tip-${i}.json`);

/** Runs the preflight with a fingerprint set that covers every resolution branch. */
async function runWithFingerprints({ call, resolveLocal, base }) {
  const planned = new Uint8Array([1, 2, 3]);
  let resolved;
  const result = await runChecksPreflight({
    call,
    resolveLocal,
    base,
    resolvePlanned: (path) => (path === 'automations/planned.json' ? planned : path === 'automations/deleted.json' ? null : undefined),
    collectFingerprintPaths: () => [
      suitePaths[0],
      'automations/planned.json',
      'automations/deleted.json',
      'automations/never-existed.json',
      'package.json',
      ...tipPaths,
    ],
    evaluateChecks: (_suites, resolve) => {
      resolved = resolve;
      return { suites: [{ assertions: [{ passed: true }] }] };
    },
  });
  return { result, resolved, planned };
}

test('while the tip is the last pull, fingerprint paths come from the working directory', async () => {
  const { call, stats } = fakeCall({ livePaths: suitePaths.slice(0, 2), refuse: new Set(['package.json']) });
  const files = Object.fromEntries([...suitePaths.slice(0, 2), ...tipPaths].map((path) => [path, remoteText(path)]));
  // One tracked file changed on disk since the hash was taken: it must be read, never trusted.
  const dir = { ...files, [tipPaths[3]]: 'raced' };
  const base = { sha: 'tip-1', files: new Map(Object.entries(files).map(([path, t]) => [path, sha(t)])) };

  const { result, resolved, planned } = await runWithFingerprints({ call, resolveLocal: localDir(dir).resolveLocal, base });

  assert.equal(result.ran, true);
  assert.equal(result.firstFailure, undefined);
  assert.equal(resolved('automations/planned.json'), planned);
  assert.equal(resolved('automations/deleted.json'), null);
  assert.equal(resolved('automations/never-existed.json'), null);
  assert.equal(resolved('package.json'), null);
  for (const path of tipPaths) assert.equal(text(resolved(path)), remoteText(path), path);
  // The plugin-owned root file is never tracked by a pull, so it is always asked of the server.
  assert.deepEqual(stats.gets.sort(), ['tip:package.json', `tip:${tipPaths[3]}`].sort());
});

test('after the tip moved past the last pull, every untouched fingerprint path is read at the tip', async () => {
  const { call, stats } = fakeCall({ livePaths: suitePaths.slice(0, 2), acceptedTip: 'tip-2', refuse: new Set([tipPaths[3], 'package.json', 'automations/never-existed.json']) });
  const files = Object.fromEntries([...suitePaths.slice(0, 2), ...tipPaths].map((path) => [path, remoteText(path)]));
  const base = { sha: 'tip-1', files: new Map(Object.entries(files).map(([path, t]) => [path, sha(t)])) };

  const { resolved } = await runWithFingerprints({ call, resolveLocal: localDir(files).resolveLocal, base });

  assert.equal(resolved(tipPaths[3]), null);
  assert.equal(text(resolved(tipPaths[4])), remoteText(tipPaths[4]));
  assert.deepEqual(
    stats.gets.sort(),
    [...tipPaths, 'package.json', 'automations/never-existed.json'].map((path) => `tip:${path}`).sort()
  );
  assert.ok(stats.maxInFlight > 1 && stats.maxInFlight <= 8, `max in flight ${stats.maxInFlight}`);
});

test('with no pull state the preflight reads the tip, as before', async () => {
  const { call, stats } = fakeCall({ livePaths: suitePaths.slice(0, 2), refuse: new Set(['package.json', 'automations/never-existed.json']) });
  const { resolved } = await runWithFingerprints({ call });
  assert.equal(text(resolved(tipPaths[0])), remoteText(tipPaths[0]));
  assert.equal(stats.gets.filter((get) => get.startsWith('tip:')).length, tipPaths.length + 2);
});

test('no live checks means the preflight does not run', async () => {
  const { call, stats } = fakeCall({ livePaths: ['automations/a.json'] });
  assert.deepEqual(await runChecksPreflight({ call }), { ran: false });
  assert.equal(stats.gets.length, 0);
});

test('planned check creates and updates replace live suites, and planned deletes are omitted', async () => {
  const livePaths = ['checks/update.json', 'checks/delete.json', 'checks/untouched.json'];
  const { call } = fakeCall({ livePaths });
  const plannedBytes = new Map([
    ['checks/update.json', Buffer.from('{"id":"updated"}')],
    ['checks/delete.json', null],
    ['checks/create.json', Buffer.from('{"id":"created"}')],
  ]);
  let evaluatedIds;
  const result = await runChecksPreflight({
    call,
    plannedPaths: [...plannedBytes.keys()],
    resolvePlanned: (path) => plannedBytes.has(path) ? plannedBytes.get(path) : undefined,
    collectFingerprintPaths: () => [],
    evaluateChecks: (suites) => {
      evaluatedIds = suites.map(({ id, path }) => id ?? path);
      return { status: 'pass', suites: suites.map(({ id }) => ({ id, assertions: [{ passed: true }] })) };
    },
  });
  assert.equal(result.ran, true);
  assert.deepEqual(evaluatedIds, ['checks/untouched.json', 'updated', 'created']);
});

test('a failure identifies the check and whether its bytes are live or planned', async () => {
  const livePath = 'checks/live.json';
  const plannedPath = 'checks/planned.json';
  const { call } = fakeCall({ livePaths: [livePath] });
  const result = await runChecksPreflight({
    call,
    plannedPaths: [plannedPath],
    resolvePlanned: (path) => path === plannedPath ? Buffer.from('{"id":"planned-check"}') : undefined,
    collectFingerprintPaths: () => [],
    evaluateChecks: (suites) => ({
      status: 'fail',
      suites: suites.map(({ id, path }) => ({
        id: id ?? path,
        assertions: [{ op: 'file_exists', file: 'automations/a.json', passed: false, detail: 'file not found' }],
      })),
    }),
  });
  assert.equal(result.firstFailure.check, 'checks/live.json');
  assert.equal(result.firstFailure.source, 'live');
  assert.equal(result.firstFailure.guidance, 'this check is already accepted; change it in its own push first');
});

test('planned bytes for a changed check file win over live bytes in the fingerprint snapshot', async () => {
  const { call } = fakeCall({ livePaths: ['checks/update.json', 'checks/gone.json'] });
  const plannedBytes = new Map([
    ['checks/update.json', Buffer.from('{"id":"updated"}')],
    ['checks/gone.json', null],
  ]);
  let seen;
  await runChecksPreflight({
    call,
    plannedPaths: [...plannedBytes.keys()],
    resolvePlanned: (path) => plannedBytes.has(path) ? plannedBytes.get(path) : undefined,
    collectFingerprintPaths: () => ['checks/update.json', 'checks/gone.json'],
    evaluateChecks: (suites, resolve) => {
      seen = { update: Buffer.from(resolve('checks/update.json')).toString('utf8'), gone: resolve('checks/gone.json') };
      return { status: 'pass', suites: suites.map(({ id }) => ({ id, assertions: [{ passed: true }] })) };
    },
  });
  assert.deepEqual(seen, { update: '{"id":"updated"}', gone: null });
});
