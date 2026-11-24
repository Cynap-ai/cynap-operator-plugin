// the CLI drives the proxy's activation run object with short calls, survives a
// dropped loopback connection, never reports a waiting run as failed, and follows a chain grant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveWorkingDir } from '../lib/connect.mjs';
import {
  callProxy, chainReport, followGrant, ProxyUnreachableError, runActivation,
} from '../lib/activation-run-client.mjs';
import {
  activateThrough, describeActivateCrash, describeRun, describeStep, parseActivateArgs, printChain, runThroughFlow,
  safeChainReport,
} from '../bin/cynap-activate.mjs';
import { CONTROL_HEADER } from '../bin/operator-proxy.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const noWait = async () => {};

async function withNonce(run) {
  const home = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), 'activation-run-client-'));
  process.env.HOME = tmpHome;
  try {
    const dir = resolveWorkingDir('cynap-e2e');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.operator-control'), 'nonce\n');
    return await run();
  } finally {
    process.env.HOME = home;
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
const dropped = (code) => new TypeError('fetch failed', { cause: { code } });

/** A scripted proxy: each call takes the next step; a step that is an Error is thrown. */
function scriptedProxy(steps) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const step = steps.shift();
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchImpl, calls };
}

test('a forced ECONNRESET on the first CLI call does not end the CLI', async () => {
  await withNonce(async () => {
    const { fetchImpl, calls } = scriptedProxy([
      dropped('ECONNRESET'),
      reply(202, { run_id: 'r1', attached: false, state: 'consent_pending' }),
      reply(200, { run_id: 'r1', state: 'consent_pending', review: 'opened' }),
      reply(200, { run_id: 'r1', state: 'activated', result: null }),
    ]);
    const run = await runActivation({ slug: 'cynap-e2e', body: { commit_sha: A }, fetchImpl, wait: noWait });
    assert.equal(run.state, 'activated');
    assert.deepEqual(calls.map((c) => c.method), ['POST', 'POST', 'GET', 'GET']);
    const attempts = calls.slice(0, 2).map((c) => JSON.parse(c.body).attempt_id);
    assert.match(attempts[0], /^[a-f0-9]{32}$/);
    assert.equal(attempts[1], attempts[0], 'a retried POST carries the same attempt id');
    assert.ok(calls.every((c) => c.headers[CONTROL_HEADER] === 'nonce'), 'the nonce rides every call');
    assert.match(calls[2].url, /\/activate\/r1$/);
  });
});

test('a dropped connection while the Owner is deciding is retried; the run stays consent_pending', async () => {
  await withNonce(async () => {
    const seen = [];
    const { fetchImpl } = scriptedProxy([
      reply(202, { run_id: 'r1', attached: false, state: 'consent_pending' }),
      dropped('UND_ERR_SOCKET'),
      reply(200, { run_id: 'r1', state: 'consent_pending', review: 'opened' }),
      reply(200, { run_id: 'r1', state: 'consent_denied' }),
    ]);
    const run = await runActivation({ slug: 'cynap-e2e', body: { commit_sha: A }, fetchImpl, wait: noWait,
      onProgress: (r) => seen.push(r.state) });
    assert.equal(run.state, 'consent_denied');
    assert.deepEqual(seen, ['consent_pending', 'consent_denied']);
  });
});

test('three retries exhausted is proxy_unreachable and the printed line carries error.cause.code', async () => {
  let calls = 0;
  const error = await callProxy(async () => { calls += 1; throw dropped('EPIPE'); }, { wait: noWait, runId: 'r9' })
    .catch((e) => e);
  assert.equal(calls, 4, 'one call plus at most three retries');
  assert.ok(error instanceof ProxyUnreachableError);
  assert.equal(error.code, 'proxy_unreachable');
  assert.equal(error.causeCode, 'EPIPE');
  const line = describeActivateCrash(error);
  assert.match(line, /^cynap-activate: proxy_unreachable \(EPIPE\): /);
  assert.match(line, /r9 may still be waiting for the Owner/);
  assert.doesNotMatch(line, /failed/);
});

test('retries stay inside the ten-second window', async () => {
  let clock = 0;
  let calls = 0;
  const error = await callProxy(async () => { calls += 1; throw dropped('ECONNREFUSED'); },
    { wait: async (ms) => { clock += ms; }, now: () => clock + (calls > 1 ? 9000 : 0) }).catch((e) => e);
  assert.equal(error.code, 'proxy_unreachable');
  assert.ok(calls < 4, `the window ended retries early (calls=${calls})`);
});

test('a non-connection error is not retried', async () => {
  let calls = 0;
  await assert.rejects(callProxy(async () => { calls += 1; throw new Error('boom'); }, { wait: noWait }), /boom/);
  assert.equal(calls, 1);
});

test('a different live run is refused with its run id; a waited-out run is consent_pending, never failed', async () => {
  await withNonce(async () => {
    const busy = scriptedProxy([reply(409, { error: 'activation_run_in_progress', run_id: 'r0' })]);
    assert.deepEqual(await runActivation({ slug: 'cynap-e2e', body: { commit_sha: A }, fetchImpl: busy.fetchImpl, wait: noWait }),
      { state: 'refused', code: 'activation_run_in_progress', run_id: 'r0' });
    let clock = 0;
    const waiting = { run_id: 'r1', state: 'consent_pending', review: 'opened' };
    const slow = scriptedProxy([reply(202, { run_id: 'r1', attached: true, state: 'consent_pending' }),
      reply(200, waiting), reply(200, waiting), reply(200, waiting)]);
    const run = await runActivation({ slug: 'cynap-e2e', body: { commit_sha: A }, fetchImpl: slow.fetchImpl,
      wait: async (ms) => { clock += ms; }, now: () => clock, pollMs: 10, waitMs: 25 });
    assert.equal(run.state, 'consent_pending');
    assert.equal(run.waited_out, true);
  });
});

test('parseActivateArgs: --through takes one sha and refuses --reconcile', () => {
  assert.deepEqual(parseActivateArgs(['--through', C]), { throughSha: C, reconcile: false, json: false });
  assert.deepEqual(parseActivateArgs(['--json', '--through', C.toUpperCase()]), { throughSha: C, reconcile: false, json: true });
  assert.throws(() => parseActivateArgs(['--through', C, '--reconcile']), /cannot be combined with --reconcile/);
  for (const argv of [['--through'], ['--through', 'abc'], ['--through', C, A], ['--through', C, '--through', C]]) {
    assert.throws(() => parseActivateArgs(argv), /Usage: cynap-activate\.mjs/);
  }
});

const grantRead = (grant) => reply(200, { result: { structuredContent: { ok: true, activation_grant: grant } } });

test('followGrant prints one line per step and stops on a terminal status', async () => {
  const steps = [];
  const base = { id: 'g1', total: 3, run_deadline: new Date(Date.now() + 60_000).toISOString() };
  const { fetchImpl, calls } = scriptedProxy([
    grantRead({ ...base, status: 'running', cursor: 0 }),
    grantRead({ ...base, status: 'running', cursor: 0 }),
    grantRead({ ...base, status: 'running', cursor: 1 }),
    grantRead({ ...base, status: 'stopped', cursor: 1, stopped_reason: 'chain_drift' }),
  ]);
  const grant = await followGrant({ slug: 'cynap-e2e', activationGrantId: 'g1', fetchImpl, wait: noWait,
    onStep: (g) => steps.push(describeStep(g)) });
  assert.equal(grant.status, 'stopped');
  assert.deepEqual(steps, ['activating commit 1 of 3', 'activating commit 2 of 3', 'stopped at commit 2 of 3 (chain_drift)']);
  assert.deepEqual(JSON.parse(calls[0].body).params, { name: 'workspace_status', arguments: { activation_grant_id: 'g1' } });
});

test('followGrant: the wait cap derives from run_deadline', async () => {
  let clock = Date.parse('2026-11-19T10:00:00Z');
  const running = { id: 'g1', total: 2, status: 'running', cursor: 0, run_deadline: '2026-11-19T10:01:00Z' };
  const steps = Array.from({ length: 100 }, () => grantRead(running));
  const { fetchImpl, calls } = scriptedProxy(steps);
  const grant = await followGrant({ slug: 'cynap-e2e', activationGrantId: 'g1', fetchImpl,
    wait: async (ms) => { clock += ms; }, now: () => clock, pollMs: 10_000 });
  assert.equal(grant.waited_out, true);
  assert.equal(grant.status, 'running');
  // deadline + 60 s slack = 120 s of 10 s polls.
  assert.ok(calls.length >= 11 && calls.length <= 13, `calls=${calls.length}`);
});

test('chainReport: the --json shape for completed and stopped grants', () => {
  assert.deepEqual(chainReport({ through: C, members: [A, B, C], grant: { cursor: 3, status: 'completed' }, state: 'completed' }), {
    state: 'completed', through: C,
    members: [{ sha: A, position: 0, outcome: 'activated' }, { sha: B, position: 1, outcome: 'activated' },
      { sha: C, position: 2, outcome: 'activated' }],
  });
  assert.deepEqual(chainReport({ through: C, members: [A, B, C],
    grant: { cursor: 1, status: 'stopped', stopped_reason: 'chain_drift' }, state: 'stopped' }), {
    state: 'stopped', through: C,
    members: [{ sha: A, position: 0, outcome: 'activated' }, { sha: B, position: 1, outcome: 'stopped' },
      { sha: C, position: 2, outcome: 'pending' }],
    stopped: { at_position: 1, reason: 'chain_drift', remaining: [B, C] },
  });
});

test('activateThrough: accepted follows the exact grant; consent outcomes and failures never follow', async () => {
  const followed = [];
  const accepted = await activateThrough({ slug: 'cynap-e2e', throughSha: C,
    settle: async () => { throw new Error('a grant is not settled per commit'); },
    follow: async ({ body }) => { assert.deepEqual(body, { through_sha: C }); return { state: 'accepted', activation_grant_id: 'g1', members: [A, B, C] }; },
    followGrantImpl: async ({ activationGrantId }) => { followed.push(activationGrantId); return { id: 'g1', status: 'expired', cursor: 2, stopped_reason: 'run_deadline_passed' }; } });
  assert.deepEqual(followed, ['g1']);
  assert.equal(accepted.state, 'expired');
  assert.deepEqual(accepted.stopped, { at_position: 2, reason: 'run_deadline_passed', remaining: [C] });
  assert.equal(accepted.activation_grant_id, 'g1');

  const neverFollow = async () => { throw new Error('must not follow a grant'); };
  assert.deepEqual(await activateThrough({ slug: 'cynap-e2e', throughSha: C, followGrantImpl: neverFollow,
    follow: async () => ({ state: 'consent_expired' }) }), { ok: false, code: 'consent_expired', commit_sha: C });
  assert.deepEqual(await activateThrough({ slug: 'cynap-e2e', throughSha: C, followGrantImpl: neverFollow,
    follow: async () => ({ run_id: 'r1', state: 'failed', reason: 'review_changed' }) }), { ok: false, code: 'review_changed', run_id: 'r1' });
  const waiting = await activateThrough({ slug: 'cynap-e2e', throughSha: C, followGrantImpl: neverFollow,
    follow: async () => ({ run_id: 'r1', state: 'consent_pending', waited_out: true }) });
  assert.equal(waiting.state, 'consent_pending');
});

test('activateThrough: a range of one on the test org settles like a single commit', async () => {
  const report = await activateThrough({ slug: 'cynap-e2e', throughSha: C,
    settle: async ({ commitSha }) => ({ ok: true, state: 'activated', commit_sha: commitSha }),
    follow: async () => ({ state: 'activated', step_up: 'automatic' }),
    followGrantImpl: async () => { throw new Error('no grant for an automatic single'); } });
  assert.deepEqual(report, { state: 'completed', through: C, members: [{ sha: C, position: 0, outcome: 'activated' }] });
});

test('runThroughFlow previews handler members in chain order and stops at the first non-pass', async () => {
  const preview = (sha) => ({ kind: 'handler_preview_required', preview_requests: [{ method: 'POST', route: '/preview/execute',
    body: { orgSlug: 'cynap-e2e', automationId: `h-${sha[0]}`, commitSha: sha } }] });
  const chainReader = async () => ({ orgSlug: 'cynap-e2e', pending: [
    { commit_sha: A, next_action: preview(A) }, { commit_sha: B, next_action: { kind: 'blocked_by_chain' } },
    { commit_sha: C, next_action: preview(C) }] });
  const previews = [];
  const failed = await runThroughFlow({ slug: 'cynap-e2e', throughSha: C, chainReader,
    previewRunner: async ({ automationId }) => { previews.push(automationId); return { status: automationId === 'h-c' ? 'fail' : 'pass' }; },
    activateFn: async () => { throw new Error('consent must not open after a failed preview'); } });
  assert.deepEqual(previews, ['h-a', 'h-c']);
  assert.equal(failed.status, 'fail');

  let activated = null;
  await runThroughFlow({ slug: 'cynap-e2e', throughSha: B, chainReader,
    previewRunner: async () => ({ status: 'pass' }), activateFn: async (args) => { activated = args.throughSha; return {}; } });
  assert.equal(activated, B);
  await assert.rejects(runThroughFlow({ slug: 'cynap-e2e', throughSha: 'd'.repeat(64), chainReader }), /not pending/);
});

test('printChain: a stopped or expired grant exits non-zero; a free-text stop reason never prints', () => {
  const write = process.stdout.write;
  const lines = [];
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  const exitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    printChain({ state: 'completed', through: C, members: [{ sha: C, position: 0, outcome: 'activated' }] }, false);
    assert.equal(process.exitCode, undefined);
    const stopped = safeChainReport({ state: 'stopped', through: C, members: [{ sha: C, position: 0, outcome: 'stopped' }],
      stopped: { at_position: 0, reason: 'Error: secret path /x', remaining: [C] } });
    printChain(stopped, true);
    assert.equal(process.exitCode, 1);
    assert.equal(JSON.parse(lines.at(-1)).stopped.reason, 'stopped');
  } finally {
    process.stdout.write = write;
    process.exitCode = exitCode;
  }
  assert.match(lines[0], /^completed: 1 of 1 commits through ccccccc activated/);
});

test('describeRun names where the approval stands', () => {
  assert.equal(describeRun({ state: 'consent_pending', review: 'preparing' }), 'preparing the review page');
  assert.equal(describeRun({ state: 'consent_pending', review: 'opened' }), "approval page opened; waiting for the Owner's approval");
  assert.equal(describeRun({ run_id: 'r1', attached: true }), 'attached to the activation already running (r1)');
});
