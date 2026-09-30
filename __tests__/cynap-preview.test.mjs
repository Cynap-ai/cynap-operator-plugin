import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePreviewArgs, previewSummary } from '../bin/cynap-preview.mjs';
import { forwardPreviewRequest } from '../bin/operator-proxy.mjs';

const SHA = 'a'.repeat(64);

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
    status: 'fail', attemptId: 'id', failureCode: 'copy_create_failed', operatorText: 'The handler was not run.',
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
