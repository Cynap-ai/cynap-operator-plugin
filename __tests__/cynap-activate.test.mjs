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
