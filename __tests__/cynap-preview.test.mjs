import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  failureCode, failureReason, parsePreviewArgs, previewSummary, readPreviewStatus, runPreview, stillRunningHint,
} from '../bin/cynap-preview.mjs';
import { forwardPreviewRequest } from '../bin/operator-proxy.mjs';

const SHA = 'a'.repeat(64);

test('preview_unavailable explains the blocked chain and status route', async () => {
  await assert.rejects(runPreview({ slug: 'cynap-e2e', automationId: 'invoice-sync', commitSha: SHA,
    nonceOverride: 'test-nonce', fetchImpl: async () => ({ ok: false, status: 403,
      json: async () => ({ error: 'preview_unavailable' }) }) }),
  /preview admission is not open.*chain stays blocked.*check \/cynap-status/);
});

test('parsePreviewArgs requires a committed SHA and one automation id', () => {
  assert.deepEqual(parsePreviewArgs(['invoice-sync', SHA]), { command: 'start', automationId: 'invoice-sync', commitSha: SHA });
  assert.throws(() => parsePreviewArgs(['invoice-sync', 'HEAD']), /Usage/);
  assert.throws(() => parsePreviewArgs(['../invoice', SHA]), /Usage/);
});

test('previewSummary exposes only verdict, fixed text, and effect kinds with counts', () => {
  assert.deepEqual(previewSummary({
    previewId: 'id', status: 'fail', failureCode: 'copy_create_failed', operatorText: 'The handler was not run.',
    effectKinds: [{ kind: 'message', count: 2, targetRef: 'patient-1' }], rows: [{ patient: 'private' }],
  }), {
    status: 'fail', attemptId: 'id', failureCode: 'copy_create_failed',
    effectKinds: [{ kind: 'message', count: 2 }],
  });
});

test('plugin proxy sends the commit-based body with its member workspace token and keeps that token local', async () => {
  const calls = [];
  const options = {
    mcpHost: 'https://staging.mcp.cynap.ai', mcpPath: '/mcp/operator', orgSlug: 'cynap-e2e', orgId: 'org-1',
    tokenManager: { getToken: async () => 'member-execute-preview' }, controlNonce: 'nonce',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 202, json: async () => ({ previewId: '0b0f3a52-5b1c-4f3e-9a55-0d1c2e3f4a5b', status: 'pending', rows: ['secret'] }) };
    },
  };
  const response = await forwardPreviewRequest({
    ...options, method: 'POST', input: { automationId: 'invoice-sync', commitSha: SHA, orgSlug: 'forged' },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { previewId: '0b0f3a52-5b1c-4f3e-9a55-0d1c2e3f4a5b', status: 'pending' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { orgSlug: 'cynap-e2e', automationId: 'invoice-sync', commitSha: SHA });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer member-execute-preview');
});

test('preview disclosure drops hostile fields, unknown kinds, negative counts and nested targets', () => {
  const output = previewSummary({ status: 'pass', previewId: 'id', operatorText: 'private-recipient',
    target: 'private-recipient', effectKinds: [{ kind: 'secret-recipient', count: 1 }, { kind: 'message', count: -1 },
      { kind: 'money', count: 2, nested: { targetRef: 'private-recipient' } }] });
  assert.deepEqual(output.effectKinds, [{ kind: 'money', count: 2 }]);
  assert.ok(!JSON.stringify(output).includes('private-recipient'));
});


test('capture tool failure survives the counts-and-kinds projection without error details', () => {
  assert.deepEqual(previewSummary({ previewId: 'id', status: 'fail', failureCode: 'capture_tool_failed',
    error: 'private', toolOutcomes: [{ targetRef: 'private' }], effectKinds: [{ kind: 'message', count: 0, body: 'private' }] }),
    { status: 'fail', attemptId: 'id', failureCode: 'capture_tool_failed', effectKinds: [{ kind: 'message', count: 0 }] });
});

test('a runtime failure keeps only a validated error name and handler.js site', async () => {
  const response = await forwardPreviewRequest({
    method: 'GET', previewId: '0b0f3a52-5b1c-4f3e-9a55-0d1c2e3f4a5b', orgSlug: 'cynap-e2e', mcpHost: 'https://mcp.example',
    tokenManager: { getToken: async () => 't' }, pluginVersion: '0.0.0',
    fetchImpl: async () => ({ status: 200, json: async () => ({ previewId: '0b0f3a52-5b1c-4f3e-9a55-0d1c2e3f4a5b',
      status: 'fail', failureCode: 'handler_runtime_error',
      failureLocation: { errorName: 'TypeError', site: 'handler.js:271:15', message: 'private' } }) }),
  });
  assert.deepEqual(response.body.failureLocation, { errorName: 'TypeError', site: 'handler.js:271:15' });
  const summary = previewSummary(response.body);
  assert.deepEqual(summary.failureLocation, { errorName: 'TypeError', site: 'handler.js:271:15' });
  assert.ok(!JSON.stringify(summary).includes('private'));
  assert.equal(previewSummary({ status: 'fail', failureLocation: { errorName: 'PrivateError', site: 'handler.js:1:1' } }).failureLocation, undefined);
  assert.deepEqual(previewSummary({ status: 'fail', failureLocation: { errorName: 'Error', site: '/var/task/x.js:1:1' } }).failureLocation,
    { errorName: 'Error' });
});

test('a failure prints its underlying cause, including the socket error fetch hides', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4100'), { code: 'ECONNREFUSED' }) });
  assert.equal(failureReason(refused), ': fetch failed: ECONNREFUSED');
  assert.equal(failureReason(new Error('operator preview status failed:\n HTTP 502')), ': operator preview status failed: HTTP 502');
  assert.equal(failureReason({}), '');
  assert.ok(failureReason(new Error('x'.repeat(1000))).length <= 302);
});

test('a local failure prints a named code instead of a bare preview_failed', () => {
  let usage;
  try { parsePreviewArgs(['only-one-arg']); } catch (error) { usage = error; }
  assert.equal(failureCode(usage), 'usage');
  const refused = new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  assert.equal(failureCode(refused), 'proxy_unreachable');
  assert.equal(failureCode(Object.assign(new Error('x'), { code: 'status_http_502' })), 'status_http_502');
  assert.equal(failureCode(new Error('unknown')), 'preview_failed');
});

test('a failed status read carries its HTTP status as the code', async () => {
  const fetchImpl = async (url) => (String(url).includes('/status/')
    ? { ok: false, status: 503, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ previewId: 'p1' }) });
  await assert.rejects(
    runPreview({ slug: 's', automationId: 'a', commitSha: 'a'.repeat(64), fetchImpl, wait: async () => {}, nonceOverride: 'n' }),
    (error) => error.code === 'status_http_503',
  );
});

test('The status summary keeps the closed failure facts and the proxy forwards only those', async () => {
  assert.deepEqual(previewSummary({ previewId: 'id', status: 'fail', failureCode: 'handler_runtime_error',
    failureLocation: { errorName: 'TypeError', site: 'handler.js:4:9', stack: 'private' }, baselineOutcome: 'failed', effectKinds: [] }),
  { status: 'fail', attemptId: 'id', failureCode: 'handler_runtime_error',
    failureLocation: { errorName: 'TypeError', site: 'handler.js:4:9' }, baselineOutcome: 'failed', effectKinds: [] });

  const forward = (answer) => forwardPreviewRequest({
    method: 'GET', previewId: '0b0f3a52-5b1c-4f3e-9a55-0d1c2e3f4a5b', orgSlug: 'cynap-e2e', mcpHost: 'https://staging.mcp.cynap.ai',
    tokenManager: { getToken: async () => 't' }, fetchImpl: async () => ({ status: 200, json: async () => answer }),
  });
  const ok = await forward({ status: 'fail', failureCode: 'handler_runtime_error', baselineOutcome: 'succeeded',
    failureLocation: { errorName: 'TypeError', site: 'handler.js:4:9', message: 'private' } });
  assert.deepEqual(ok.body.failureLocation, { errorName: 'TypeError', site: 'handler.js:4:9' });
  assert.equal(ok.body.baselineOutcome, 'succeeded');
  const hostile = await forward({ status: 'fail', baselineOutcome: 'private', failureLocation: { errorName: 'private text' } });
  assert.ok(!('failureLocation' in hostile.body) && !('baselineOutcome' in hostile.body));
});

// An attempt that outlives the bounded poll can be read later.
const ATTEMPT = '03ce78d0-c71f-436d-aab1-ddbb0db8965e';

test('parsePreviewArgs reads `status <attempt-id>` and still previews an automation named status', () => {
  assert.deepEqual(parsePreviewArgs(['status', ATTEMPT.toUpperCase()]), { command: 'status', attemptId: ATTEMPT });
  assert.deepEqual(parsePreviewArgs(['status', SHA]), { command: 'start', automationId: 'status', commitSha: SHA });
  assert.throws(() => parsePreviewArgs(['status', '../x']), /Usage: .*status <attempt-id>/);
  assert.throws(() => parsePreviewArgs(['status']), /Usage/);
});

test('status reads GET /preview/status/{previewId} once through the local proxy and projects the verdict', async () => {
  const calls = [];
  const result = await readPreviewStatus({ slug: 'cynap-e2e', attemptId: ATTEMPT, nonceOverride: 'n',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: 'fail', failureCode: 'capture_tool_failed',
        baselineOutcome: 'failed', operatorText: 'fixed', effectKinds: [] }) };
    } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/preview/status/${ATTEMPT}$`));
  assert.equal(calls[0].init.method, undefined);
  assert.deepEqual(result, { status: 'fail', attemptId: ATTEMPT, failureCode: 'capture_tool_failed', baselineOutcome: 'failed', effectKinds: [] });
});

test('status of an absent, expired or cross-org attempt is preview_not_found', async () => {
  await assert.rejects(readPreviewStatus({ slug: 's', attemptId: ATTEMPT, nonceOverride: 'n',
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) }) }),
  (error) => error.code === 'preview_not_found' && failureCode(error) === 'preview_not_found');
});

test('a preview that outlives the bounded poll returns preview_running, and the hint names the status command', async () => {
  const fetchImpl = async (url) => (String(url).includes('/status/')
    ? { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) }
    : { ok: true, status: 202, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) });
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl, wait: async () => {}, maxPolls: 2, nonceOverride: 'n' });
  assert.equal(result.status, 'preview_running');
  assert.equal(stillRunningHint(result.attemptId),
    `cynap-preview: the preview is still running after the bounded wait. Read its verdict later with /cynap-preview status ${ATTEMPT}`);
});

// A refusal because another preview runs names that attempt, its automation, its start and the rule.
test('preview_running names the running attempt, its automation and start, and the one-at-a-time rule', async () => {
  const running = '77777777-7777-4777-8777-777777777777';
  await assert.rejects(runPreview({ slug: 'cynap-e2e', automationId: 'invoice-sync', commitSha: SHA, nonceOverride: 'n',
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: 'preview_running', rule: 'one_preview_per_org',
      previewId: running, automationId: 'clinician-sync', startedAt: '2026-10-07T17:20:00.123+00:00' }) }) }),
  (error) => {
    assert.equal(error.code, 'preview_running');
    assert.equal(error.message, `cynap-preview: preview_running: an org runs one preview at a time, and attempt ${running} `
      + '(automation clinician-sync, started 2026-10-07T17:20:00.123+00:00) is still running. '
      + `Wait for its verdict with /cynap-preview status ${running}, then preview again.`);
    return true;
  });
});

test('the proxy forwards the running attempt fields only in their closed shapes', async () => {
  const forward = (answer) => forwardPreviewRequest({
    method: 'POST', input: { automationId: 'invoice-sync', commitSha: SHA }, orgSlug: 'cynap-e2e', mcpHost: 'https://staging.mcp.cynap.ai',
    tokenManager: { getToken: async () => 't' }, fetchImpl: async () => ({ status: 409, json: async () => answer }),
  });
  const ok = await forward({ error: 'preview_running', rule: 'one_preview_per_org', previewId: 'p1', automationId: 'clinician-sync', startedAt: '2026-10-07T17:20:00Z' });
  assert.deepEqual(ok.body, { previewId: 'p1', error: 'preview_running', rule: 'one_preview_per_org', automationId: 'clinician-sync', startedAt: '2026-10-07T17:20:00Z' });
  const hostile = await forward({ error: 'preview_running', rule: 'patient Jo', automationId: '../patient Jo', startedAt: 'yesterday, patient Jo' });
  assert.ok(!JSON.stringify(hostile.body).includes('patient Jo'));
});
