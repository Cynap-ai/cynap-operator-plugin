import { test } from 'node:test';
import assert from 'node:assert/strict';

import { failureCode, failureReason, parsePreviewArgs, previewSummary, runPreview } from '../bin/cynap-preview.mjs';
import { forwardPreviewRequest } from '../bin/operator-proxy.mjs';

const SHA = 'a'.repeat(64);

test('preview_unavailable explains the blocked chain and status route', async () => {
  await assert.rejects(runPreview({ slug: 'cynap-e2e', automationId: 'invoice-sync', commitSha: SHA,
    nonceOverride: 'test-nonce', fetchImpl: async () => ({ ok: false, status: 403,
      json: async () => ({ error: 'preview_unavailable' }) }) }),
  /preview admission is not open.*chain stays blocked.*check \/cynap-status/);
});

test('parsePreviewArgs requires a committed SHA and one automation id', () => {
  assert.deepEqual(parsePreviewArgs(['invoice-sync', SHA]), { automationId: 'invoice-sync', commitSha: SHA });
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
