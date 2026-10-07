// /cynap-activate: arg parsing, the activation flow, and its typed outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activatedOnChain, describeReady, parseActivateArgs, readActivationAction, readinessOf, runActivationFlow, settleActivation,
} from '../bin/cynap-activate.mjs';
import { ACTIVATE_RESPONSE_BUDGET_MS, ACTIVATION_CALL_TIMEOUT_MS, AUTO_CONSENT_TIMEOUT_MS, TOKEN_EXCHANGE_TIMEOUT_MS } from '../bin/operator-proxy.mjs';

const SHA = 'c'.repeat(64);

test('parseActivateArgs: --reconcile sets reconcile, its absence leaves it false', () => {
  assert.deepEqual(parseActivateArgs([SHA]), { commitSha: SHA, reconcile: false, json: false });
  assert.deepEqual(parseActivateArgs([SHA, '--reconcile']), { commitSha: SHA, reconcile: true, json: false });
  assert.deepEqual(parseActivateArgs(['--reconcile', SHA]), { commitSha: SHA, reconcile: true, json: false });
  assert.deepEqual(parseActivateArgs([SHA, '--json']), { commitSha: SHA, reconcile: false, json: true });
});

test('parseActivateArgs: refuses unknown flags, duplicates and a missing sha', () => {
  for (const argv of [[], ['--reconcile'], [SHA, '--force'], [SHA, '--reconcile', '--reconcile'], [SHA, SHA]]) {
    assert.throws(() => parseActivateArgs(argv), /Usage: cynap-activate\.mjs/);
  }
});

test('readActivationAction selects the committed SHA from workspace_status', async () => {
  const status = { ok: true, org_slug: 'cynap-e2e', pending: [
    { commit_sha: 'a'.repeat(64), next_action: { kind: 'blocked_by_chain' } },
    { commit_sha: SHA, next_action: { kind: 'step_up_and_activate' } },
  ] };
  const fetchImpl = async (_url, request) => {
    const call = JSON.parse(request.body);
    assert.equal(call.params.name, 'workspace_status');
    return { ok: true, json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify(status) }] } }) };
  };
  assert.deepEqual(await readActivationAction({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl }),
    { orgSlug: 'cynap-e2e', nextAction: { kind: 'step_up_and_activate' } });
});

test('handler_preview_required previews the commit, then rechecks status before owner step-up', async () => {
  const calls = [];
  const statusReader = async () => {
    calls.push('status');
    return { orgSlug: 'cynap-e2e', nextAction: calls.length === 1
      ? { kind: 'handler_preview_required', preview_requests: [{ method: 'POST', route: '/preview/execute',
        body: { orgSlug: 'cynap-e2e', automationId: 'a1', commitSha: SHA } }] }
      : { kind: 'step_up_and_activate' } };
  };
  const result = await runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA, statusReader,
    previewRunner: async (args) => { calls.push('preview'); assert.equal(args.commitSha, SHA); return { status: 'pass' }; },
    activateFn: async () => { calls.push('activate'); return { activated: true }; } });
  assert.deepEqual(calls, ['status', 'preview', 'status', 'activate']);
  assert.deepEqual(result, { activated: true });
});

test('a pass that leaves the same preview gate stops after one status recheck', async () => {
  const calls = [];
  const nextAction = { kind: 'handler_preview_required', preview_requests: [{
    method: 'POST', route: '/preview/execute',
    body: { orgSlug: 'cynap-e2e', automationId: 'a1', commitSha: SHA },
  }] };
  await assert.rejects(runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA,
    statusReader: async () => { calls.push('status'); return { orgSlug: 'cynap-e2e', nextAction }; },
    previewRunner: async () => { calls.push('preview'); return { status: 'pass' }; },
    activateFn: async () => { calls.push('activate'); },
  }), /preview gate still requires a preview.*same commit/);
  assert.deepEqual(calls, ['status', 'preview', 'status']);
});

test('failed preview prints only its safe summary and never starts owner approval', async () => {
  const calls = [];
  const progress = [];
  const result = await runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA,
    statusReader: async () => ({ orgSlug: 'cynap-e2e', nextAction: { kind: 'handler_preview_required',
      preview_requests: [{ method: 'POST', route: '/preview/execute', body: {
        orgSlug: 'cynap-e2e', automationId: 'a1', commitSha: SHA,
      } }] } }),
    previewRunner: async () => ({ status: 'fail', failureCode: 'handler_runtime_error',
      operatorText: 'The candidate handler failed at runtime.', effectKinds: [{ kind: 'message', count: 1 }] }),
    activateFn: async () => { calls.push('activate'); }, onProgress: (value) => progress.push(value),
  });
  assert.equal(result.failureCode, 'handler_runtime_error');
  assert.deepEqual(progress, [result]);
  assert.deepEqual(calls, []);
});

test('activation output uses the same closed disclosure for progress and JSON', async () => {
  const { operatorEffectOutput } = await import('../lib/effect-disclosure.mjs');
  const { formatRefusal } = await import('../lib/format-refusal.mjs');
  const hostile = { ok: false, code: 'preview_ack_required', message: 'private-recipient',
    effects: ['private-recipient'], sample: [{ body: 'private-recipient' }], acknowledgements: ['private-recipient'],
    effectKinds: [{ kind: 'message', count: 1, target: 'private-recipient' }, { kind: 'private-recipient', count: 1 }],
    next_action: { kind: 'step_up_and_activate', reason: 'private-recipient' } };
  const projected = operatorEffectOutput(hostile);
  assert.deepEqual(projected.effectKinds, [{ kind: 'message', count: 1 }]);
  assert.ok(!JSON.stringify(projected).includes('private-recipient'));
  for (const command of ['cynap-preview', 'cynap-activate']) {
    assert.ok(!formatRefusal(hostile, { command }).includes('private-recipient'));
  }
});

test('operatorEffectOutput keeps the step_up mode so --json shows how consent was given', async () => {
  const { operatorEffectOutput } = await import('../lib/effect-disclosure.mjs');
  assert.equal(operatorEffectOutput({ ok: true, state: 'activated', step_up: 'automatic' }).step_up, 'automatic');
  assert.equal(operatorEffectOutput({ ok: true, step_up: 'something-else' }).step_up, undefined);
});

test('a free-text activation error reaches the user instead of request_refused', async () => {
  const { operatorEffectOutput } = await import('../lib/effect-disclosure.mjs');
  const { formatRefusal } = await import('../lib/format-refusal.mjs');
  const failed = { ok: false, code: 'HTTP 403', message: 'private-recipient' };
  const safe = operatorEffectOutput(failed);
  assert.equal(safe.detail, 'HTTP 403');
  assert.ok(!JSON.stringify(safe).includes('private-recipient'));
  const text = formatRefusal(failed, { command: 'cynap-activate' });
  assert.match(text, /cynap-activate: HTTP 403/);
  assert.ok(!text.includes('request_refused'));
  assert.ok(!text.includes('private-recipient'));
  // identifier codes keep their existing path; control characters and length are bounded
  assert.equal(operatorEffectOutput({ ok: false, code: 'plugin_outdated' }).detail, undefined);
  const long = operatorEffectOutput({ ok: false, code: `bad\u0007\nthing ${'x'.repeat(500)}` });
  assert.equal(long.detail.length <= 200, true);
  assert.ok(!/[\u0000-\u001f]/.test(long.detail));
});

test('an error thrown before any refusal names its cause instead of a bare activation_failed', async () => {
  const { describeActivateCrash } = await import('../bin/cynap-activate.mjs');
  const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  assert.match(describeActivateCrash(refused), /^cynap-activate: failed \(proxy_unreachable\): .*Run \/cynap-status/);
  assert.equal(describeActivateCrash(new Error('preview request does not match the commit')),
    'cynap-activate: failed (activation_failed): preview request does not match the commit\n');
  const long = describeActivateCrash(new Error(`bad\u0007\nthing ${'x'.repeat(500)}`));
  assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(long) && long.length < 260);
  assert.equal(describeActivateCrash(new Error('')), 'cynap-activate: failed (activation_failed)\n');
});

test('a next action instead of an activation says nothing was activated', async () => {
  const { describeNotActivated } = await import('../bin/cynap-activate.mjs');
  assert.equal(describeNotActivated('baseline_required', 'a'.repeat(64)),
    `not activated (baseline_required): the live files this commit changes carry no provenance stamp. Re-run /cynap-activate ${'a'.repeat(64)} --reconcile to adopt them.\n`);
  assert.match(describeNotActivated('blocked_by_chain', 'x'), /^not activated \(blocked_by_chain\): an earlier pending commit/);
});

// ── the outcome is typed by the proxy, success read from the chain, readiness from the marker ──

const statusAnswer = (value) => ({ ok: true, json: async () => ({ result: { structuredContent: value } }) });
const B = 'b'.repeat(64);

test('activatedOnChain: the live ref is C, or C is an activated ancestor, and C is not the claimed head', () => {
  assert.equal(activatedOnChain({ base_ref: { kind: 'commit', value: SHA } }, SHA), true);
  assert.equal(activatedOnChain({ base_ref: { kind: 'commit', value: B },
    recent: [{ sha: B, outcome: 'activated' }, { sha: SHA, outcome: 'activated' }] }, SHA), true);
  assert.equal(activatedOnChain({ base_ref: { kind: 'commit', value: B }, recent: [{ sha: SHA, outcome: 'orphaned' }] }, SHA), false);
  assert.equal(activatedOnChain({ base_ref: { kind: 'commit', value: SHA }, head_state: { activating: SHA } }, SHA), false);
  // The deleted live_digest inference: a live digest equal to C proves nothing.
  assert.equal(activatedOnChain({ live_digest: SHA, base_ref: { kind: 'digest', value: SHA } }, SHA), false);
});

test('readinessOf: only the marker for C says ready; an older server or another commit is unknown', () => {
  assert.equal(readinessOf({ readiness: { commit_sha: SHA, state: 'yes' } }, SHA), 'yes');
  assert.equal(readinessOf({ readiness: { commit_sha: SHA, state: 'projecting' } }, SHA), 'projecting');
  assert.equal(readinessOf({ readiness: { commit_sha: SHA, state: 'failed' } }, SHA), 'failed');
  assert.equal(readinessOf({}, SHA), 'unknown'); // older server: no field
  assert.equal(readinessOf({ readiness: null }, SHA), 'unknown');
  assert.equal(readinessOf({ readiness: { commit_sha: B, state: 'yes' } }, SHA), 'unknown');
  assert.equal(describeReady('unknown'), 'ready: unknown');
});

test('settleActivation: success only from base_ref, then waits for the projected marker', async () => {
  const reads = [];
  const answers = [
    { ok: true, base_ref: { kind: 'commit', value: B }, head_state: { activating: SHA }, pending: [{ commit_sha: SHA, state: 'activating' }] },
    { ok: true, base_ref: { kind: 'commit', value: SHA }, head_state: null, pending: [], readiness: { commit_sha: SHA, state: 'projecting' } },
    { ok: true, base_ref: { kind: 'commit', value: SHA }, head_state: null, pending: [], readiness: { commit_sha: SHA, state: 'yes' } },
  ];
  const result = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, intervalMs: 10, wait: async () => {},
    fetchImpl: async () => { reads.push(1); return statusAnswer(answers[Math.min(reads.length - 1, answers.length - 1)]); } });
  assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA, ready: 'yes' });
  assert.equal(reads.length, 3);
});

test('settleActivation: an older server without readiness reports ready unknown, never yes', async () => {
  const result = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, wait: async () => {},
    fetchImpl: async () => statusAnswer({ ok: true, base_ref: { kind: 'commit', value: SHA }, live_digest: SHA, pending: [] }) });
  assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA, ready: 'unknown' });
});

test('settleActivation: the readiness wait is bounded and reports projecting when it runs out', async () => {
  let reads = 0;
  const result = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, intervalMs: 10, readyWaitMs: 30, wait: async () => {},
    fetchImpl: async () => { reads += 1; return statusAnswer({ ok: true, base_ref: { kind: 'commit', value: SHA }, pending: [],
      readiness: { commit_sha: SHA, state: 'projecting' } }); } });
  assert.equal(result.ready, 'projecting');
  assert.equal(reads, 4);
});

test('settleActivation: a recorded failure names its code; an unsettled commit is outcome unknown', async () => {
  const failed = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async () => statusAnswer({ ok: true,
    base_ref: { kind: 'commit', value: B }, last_failure: { sha: SHA, code: 'preview_ack_required', message: 'ack' }, pending: [] }) });
  assert.deepEqual(failed, { ok: false, code: 'activation_failed', commit_sha: SHA, failure_code: 'preview_ack_required', failure_message: 'ack' });
  const pendingFailed = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async () => statusAnswer({ ok: true,
    base_ref: { kind: 'commit', value: B }, pending: [{ commit_sha: SHA, state: 'failed', failure_code: 'post_deploy_failed' }] }) });
  assert.equal(pendingFailed.failure_code, 'post_deploy_failed');
  const unknown = await settleActivation({ slug: 'cynap-e2e', commitSha: SHA, intervalMs: 10, waitMs: 20, wait: async () => {},
    fetchImpl: async () => statusAnswer({ ok: true, base_ref: { kind: 'commit', value: B }, pending: [{ commit_sha: SHA, state: 'activating' }] }) });
  assert.deepEqual(unknown, { ok: false, code: 'activation_outcome_unknown', commit_sha: SHA });
});

test('the CLI budget is computed from the proxy deadlines, so the proxy outcome arrives first', () => {
  assert.ok(ACTIVATE_RESPONSE_BUDGET_MS > AUTO_CONSENT_TIMEOUT_MS + TOKEN_EXCHANGE_TIMEOUT_MS + ACTIVATION_CALL_TIMEOUT_MS);
});

async function withNonce(run) {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveWorkingDir } = await import('../lib/connect.mjs');
  const home = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'activate-outcome-'));
  try {
    const dir = resolveWorkingDir('cynap-e2e');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.operator-control'), 'nonce\n');
    return await run();
  } finally {
    process.env.HOME = home;
  }
}

test('activate renders the proxy outcome and derives nothing from timing', async () => {
  const { activate } = await import('../bin/cynap-activate.mjs');
  const answer = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  await withNonce(async () => {
    const neverSettle = async () => { throw new Error('a consent outcome must not read the chain'); };
    assert.deepEqual(await activate({ slug: 'cynap-e2e', commitSha: SHA, settle: neverSettle,
      fetchImpl: answer(400, { outcome: 'consent_expired', error: 'consent_expired' }) }),
    { ok: false, code: 'consent_expired', commit_sha: SHA });
    assert.deepEqual(await activate({ slug: 'cynap-e2e', commitSha: SHA, settle: neverSettle,
      fetchImpl: answer(400, { outcome: 'consent_denied', error: 'consent_denied' }) }),
    { ok: false, code: 'consent_denied', commit_sha: SHA });
    const failed = await activate({ slug: 'cynap-e2e', commitSha: SHA, settle: neverSettle,
      fetchImpl: answer(200, { ok: false, outcome: 'failed', reason: 'checks_failed',
        result: { result: { structuredContent: { ok: false, code: 'checks_failed' } } } }) });
    assert.equal(failed.code, 'checks_failed');
    const settled = await activate({ slug: 'cynap-e2e', commitSha: SHA,
      settle: async () => ({ ok: true, state: 'activated', commit_sha: SHA, ready: 'yes' }),
      fetchImpl: answer(200, { ok: true, outcome: 'activating', reason: 'http_504', result: null, step_up: 'browser' }) });
    assert.deepEqual(settled, { ok: true, state: 'activated', commit_sha: SHA, ready: 'yes', step_up: 'browser' });
    // An old proxy (no outcome field) is not guessed at.
    assert.deepEqual(await activate({ slug: 'cynap-e2e', commitSha: SHA, settle: neverSettle,
      fetchImpl: answer(200, { ok: true, result: {} }) }), { ok: false, code: 'activation_outcome_unknown', commit_sha: SHA });
  });
});

test('activate: a CLI abort is "outcome unknown", never a guessed cause', async () => {
  const { activate } = await import('../bin/cynap-activate.mjs');
  await withNonce(async () => {
    const result = await activate({ slug: 'cynap-e2e', commitSha: SHA, budgetMs: 5,
      settle: async () => { throw new Error('must not settle'); },
      // AbortSignal.timeout's timer is unref'd; a real fetch holds a socket open, so this
      // stand-in holds a ref'd timer until the abort, or the runner sees an empty loop.
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        const keepAlive = setInterval(() => {}, 1000);
        init.signal.addEventListener('abort', () => {
          clearInterval(keepAlive);
          reject(init.signal.reason);
        });
      }) });
    assert.deepEqual(result, { ok: false, code: 'activation_outcome_unknown', commit_sha: SHA });
  });
});
