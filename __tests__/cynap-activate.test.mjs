// /cynap-activate --reconcile arg parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivateArgs, readActivationAction, reconcileActivation, runActivationFlow } from '../bin/cynap-activate.mjs';

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

test('a timed-out activation is reconciled against the live digest before any retry', async () => {
  const calls = [];
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (_url, init) => {
    const name = JSON.parse(init.body).params.name;
    calls.push(name);
    return { ok: true, json: async () => ({ result: { structuredContent: { ok: true, live_digest: SHA, pending: [] } } }) };
  } });
  assert.deepEqual(calls, ['workspace_status']);
  assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA });
});

test('reconciliation reads the commit log when status has no pending or live match', async () => {
  const calls = [];
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (_url, init) => {
    const name = JSON.parse(init.body).params.name;
    calls.push(name);
    const value = name === 'workspace_status' ? { ok: true, live_digest: null, pending: [] } :
      { ok: true, commits: [{ commit_sha: SHA, outcome: 'orphaned' }] };
    return { ok: true, json: async () => ({ result: { structuredContent: value } }) };
  } });
  assert.deepEqual(calls, ['workspace_status', 'workspace_log']);
  assert.equal(result.state, 'orphaned');
  assert.equal(result.ok, false);
  assert.match(result.message, /activation not confirmed: orphaned/);
});

test('reconciliation confirms only an activated or ancestor log outcome', async () => {
  for (const outcome of ['activated', 'ancestor']) {
    const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (_url, init) => {
      const value = JSON.parse(init.body).params.name === 'workspace_status' ? { ok: true, live_digest: null, pending: [] } :
        { ok: true, commits: [{ commit_sha: SHA, outcome }] };
      return { ok: true, json: async () => ({ result: { structuredContent: value } }) };
    } });
    assert.deepEqual(result, { ok: true, state: outcome, commit_sha: SHA });
  }
});

test('reconciliation of a still-pending commit is not a confirmed activation', async () => {
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async () => ({
    ok: true, json: async () => ({ result: { structuredContent: { ok: true, live_digest: null,
      pending: [{ commit_sha: SHA, state: 'awaiting_owner' }] } } }),
  }) });
  assert.equal(result.ok, false);
  assert.match(result.message, /activation not confirmed: awaiting_owner/);
});

test('reconciliation with no recorded outcome is not confirmed', async () => {
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (_url, init) => {
    const value = JSON.parse(init.body).params.name === 'workspace_status' ? { ok: true, live_digest: null, pending: [] } :
      { ok: true, commits: [] };
    return { ok: true, json: async () => ({ result: { structuredContent: value } }) };
  } });
  assert.equal(result.ok, false);
  assert.match(result.message, /activation not confirmed: unknown/);
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

test('reconciliation waits, bounded, while the commit is still activating', async () => {
  let reads = 0;
  const waits = [];
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, intervalMs: 10, waitMs: 100,
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      reads += 1;
      const value = reads < 3
        ? { ok: true, live_digest: null, pending: [{ commit_sha: SHA, state: 'activating' }] }
        : { ok: true, live_digest: SHA, pending: [] };
      return { ok: true, json: async () => ({ result: { structuredContent: value } }) };
    } });
  assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA });
  assert.equal(reads, 3);
  assert.deepEqual(waits, [10, 10]);
});

test('reconciliation stops waiting at its budget and reports the commit as still activating', async () => {
  let reads = 0;
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, intervalMs: 10, waitMs: 30,
    wait: async () => {},
    fetchImpl: async () => {
      reads += 1;
      return { ok: true, json: async () => ({ result: { structuredContent: { ok: true, live_digest: null,
        pending: [{ commit_sha: SHA, state: 'activating' }] } } }) };
    } });
  assert.equal(reads, 4);
  assert.equal(result.ok, false);
  assert.match(result.message, /activation not confirmed: activating/);
});

test('an upstream gateway timeout from the proxy is reconciled, not reported as a failure', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { activate } = await import('../bin/cynap-activate.mjs');
  const { resolveWorkingDir } = await import('../lib/connect.mjs');
  const home = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'activate-504-'));
  try {
    const dir = resolveWorkingDir('cynap-e2e');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.operator-control'), 'nonce\n');
    const urls = [];
    const result = await activate({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).endsWith('/activate')) {
        return { ok: false, status: 400, json: async () => ({ error: 'activation_failed', failureCode: 'http_504' }) };
      }
      return { ok: true, json: async () => ({ result: { structuredContent: { ok: true, live_digest: SHA, pending: [] } } }) };
    } });
    assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA });
    assert.ok(urls.some((url) => url.endsWith('/mcp')));
  } finally {
    process.env.HOME = home;
  }
});

test('an unpreviewable browser handler opens the owner step-up with a notice, never a preview', async () => {
  const calls = [];
  const notices = [];
  const nextAction = { kind: 'handler_unpreviewable_ack_required', command: `/cynap-activate ${SHA}`,
    handlers: [{ automation_id: 'writeupp-invoice-write', handler_hash: 'b'.repeat(64), proof: 'owner_acknowledgement' }] };
  const result = await runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA,
    statusReader: async () => { calls.push('status'); return { orgSlug: 'cynap-e2e', nextAction }; },
    previewRunner: async () => { throw new Error('a browser handler must never be previewed'); },
    activateFn: async () => { calls.push('activate'); return { activated: true }; },
    onNotice: (line) => notices.push(line) });
  assert.deepEqual(calls, ['status', 'activate']);
  assert.deepEqual(result, { activated: true });
  assert.match(notices[0], /writeupp-invoice-write declares the browser capability/);
  assert.match(notices[0], /acknowledge activating it without a preview/);
});

test('an unpreviewable browser handler for another caller does not step up', async () => {
  const nextAction = { kind: 'handler_unpreviewable_ack_required', portal_path: '/cynap-e2e/settings/operators', handlers: [] };
  const result = await runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA,
    statusReader: async () => ({ orgSlug: 'cynap-e2e', nextAction }),
    activateFn: async () => { throw new Error('only the author-owner steps up'); } });
  assert.deepEqual(result, { next_action: nextAction, state: 'handler_unpreviewable_ack_required' });
});

test('an accepted (activation_pending) activation is polled to its real outcome, never reported as pending', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { activate } = await import('../bin/cynap-activate.mjs');
  const { resolveWorkingDir } = await import('../lib/connect.mjs');
  const home = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'activate-async-'));
  try {
    const dir = resolveWorkingDir('cynap-e2e');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.operator-control'), 'nonce\n');
    let statusReads = 0;
    const result = await activate({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async (url) => {
      if (String(url).endsWith('/activate')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, step_up: 'automatic',
          result: { structuredContent: { ok: false, code: 'activation_pending', commit_sha: SHA } } }) };
      }
      statusReads += 1;
      const value = statusReads < 2
        ? { ok: true, live_digest: null, pending: [{ commit_sha: SHA, state: 'activating' }] }
        : { ok: true, live_digest: SHA, pending: [] };
      return { ok: true, json: async () => ({ result: { structuredContent: value } }) };
    } });
    assert.deepEqual(result, { ok: true, state: 'activated', commit_sha: SHA, step_up: 'automatic' });
    assert.equal(statusReads, 2);
  } finally {
    process.env.HOME = home;
  }
});

test('reconciliation reports a failed background activation with its failure code', async () => {
  const result = await reconcileActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: async () => ({
    ok: true, json: async () => ({ result: { structuredContent: { ok: true, live_digest: null,
      pending: [{ commit_sha: SHA, state: 'failed', failure_code: 'post_deploy_failed' }] } } }),
  }) });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.failure_code, 'post_deploy_failed');
});
