import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  failureCode, failureReason, MAX_TRANSIENT_STATUS_READS, parsePreviewArgs, previewSummary, readPreviewStatus, runPreview, stillRunningHint,
  SUPERSEDED_HINTS,
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
  assert.equal((await forward({ status: 'fail', baselineOutcome: 'diff_unavailable' })).body.baselineOutcome, 'diff_unavailable');
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
    `cynap-preview: the poll budget ran out before the verdict was ready (the preview has not hung; its verdict can wait on the baseline run). Resume with /cynap-preview status ${ATTEMPT}`);
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
      + `Wait for its verdict with /cynap-preview status ${running}, then preview again. Update the plugin to queue another preview.`);
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

test('both proxy copies preserve validated queue and lease horizons separately from verdict expiry', async () => {
  const { forwardPreviewRequest: canonicalForward } = await import('../../operator/operator-proxy.mjs');
  const answer = { previewId: ATTEMPT, status: 'waiting', position: 2,
    queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms: 120_000,
    lease_expires_at: '2026-10-31T12:20:00Z', remaining_lease_ms: 600_000,
    expiresAt: '2026-11-14T12:00:00Z', privateNote: 'patient Jo' };
  for (const forward of [forwardPreviewRequest, canonicalForward]) {
    const call = (body) => forward({ method: 'GET', previewId: ATTEMPT, orgSlug: 'cynap-e2e',
      mcpHost: 'https://staging.mcp.cynap.ai', pluginVersion: '0.19.196',
      tokenManager: { getToken: async () => 't' }, fetchImpl: async () => ({ status: 200, json: async () => body }) });
    const valid = await call(answer);
    assert.deepEqual(valid.body, { previewId: ATTEMPT, status: 'waiting', position: 2,
      queue_expires_at: answer.queue_expires_at, remaining_queue_ms: 120_000,
      lease_expires_at: answer.lease_expires_at, remaining_lease_ms: 600_000,
      expiresAt: answer.expiresAt });
    const invalid = await call({ ...answer, position: 0, queue_expires_at: 'private', remaining_queue_ms: -1,
      lease_expires_at: 'yesterday', remaining_lease_ms: Infinity, expiresAt: 'private' });
    assert.deepEqual(invalid.body, { previewId: ATTEMPT, status: 'waiting' });
  }
});

test('preview summary discloses position and server horizons while waiting', () => {
  assert.deepEqual(previewSummary({ previewId: ATTEMPT, status: 'waiting', position: 3,
    queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms: 90_000,
    secret: 'patient Jo' }), { status: 'waiting', attemptId: ATTEMPT, effectKinds: [],
    position: 3, queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms: 90_000 });
});

test('waiting preview survives the old 36 polls, prints position, then waits through promoted lease', async () => {
  let reads = 0;
  const positions = [];
  const waits = [];
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, nonceOverride: 'n',
    onPosition: (position) => positions.push(position),
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url) => {
      if (!String(url).includes('/status/')) return { ok: true, status: 202, json: async () => ({ previewId: ATTEMPT, status: 'waiting' }) };
      reads += 1;
      const body = reads <= 40 ? { status: 'waiting', position: reads <= 20 ? 2 : 1,
        queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms: 600_000 }
        : reads <= 44 ? { status: 'pending', lease_expires_at: '2026-10-31T12:20:00Z', remaining_lease_ms: 600_000 }
          : { status: 'pass', effectKinds: [] };
      return { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, ...body }) };
    },
  });
  assert.equal(result.status, 'pass');
  assert.equal(reads, 45);
  assert.deepEqual([...new Set(positions)], [2, 1]);
  assert.ok(waits.every((ms) => ms <= 10_000));
});

test('the queue deadline stops waiting without using verdict expiry', async () => {
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, nonceOverride: 'n',
    wait: async () => {},
    fetchImpl: async (url) => ({ ok: true, status: String(url).includes('/status/') ? 200 : 202,
      json: async () => ({ previewId: ATTEMPT, status: 'waiting', position: 1,
        queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms: 0,
        expiresAt: '2026-11-14T12:00:00Z' }) }) });
  assert.equal(result.status, 'waiting');
  assert.equal(result.remaining_queue_ms, 0);
});

test('a promoted attempt gets the server lease plus 60 seconds of verdict grace', async () => {
  const waits = [];
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, nonceOverride: 'n',
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url) => ({ ok: true, status: String(url).includes('/status/') ? 200 : 202,
      json: async () => ({ previewId: ATTEMPT, status: 'pending',
        lease_expires_at: '2026-10-31T12:20:00Z', remaining_lease_ms: 0,
        expiresAt: '2026-11-14T12:00:00Z' }) }) });
  assert.equal(result.status, 'pending');
  assert.ok(waits.reduce((total, ms) => total + ms, 0) >= 60_000);
  assert.ok(waits.length < 36);
});

test('lease grace begins after the first zero-remaining server response', async () => {
  const waits = [];
  let zeroResponseSeen = false;
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, nonceOverride: 'n',
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url) => ({ ok: true, status: String(url).includes('/status/') ? 200 : 202,
      json: async () => {
        if (String(url).includes('/status/')) zeroResponseSeen = true;
        return { previewId: ATTEMPT, status: 'pending', lease_expires_at: '2026-10-31T12:20:00Z',
          remaining_lease_ms: 0 };
      } }) });
  assert.equal(zeroResponseSeen, true);
  assert.equal(result.status, 'pending');
  assert.ok(waits.slice(1).reduce((total, ms) => total + ms, 0) >= 60_000,
    'the first wait was before the server reported zero and cannot count as grace');
});

test('waiting refuses missing or malformed server queue duration without a legacy poll fallback', async () => {
  for (const remaining_queue_ms of [undefined, -1, '120000', Number.MAX_SAFE_INTEGER + 1]) {
    let statusReads = 0;
    await assert.rejects(runPreview({ slug: 's', automationId: 'a', commitSha: SHA, nonceOverride: 'n',
      maxPolls: 2, wait: async () => {},
      fetchImpl: async (url) => {
        if (String(url).includes('/status/')) statusReads += 1;
        return { ok: true, status: 202, json: async () => ({ previewId: ATTEMPT, status: 'waiting', position: 1,
          queue_expires_at: '2026-10-31T12:00:00Z', remaining_queue_ms, secret: 'patient Jo' }) };
      } }), (error) => error.code === 'preview_status_invalid' && !String(error.message).includes('patient Jo'));
    assert.equal(statusReads, 1, 'malformed waiting horizon must stop on the first status read');
  }
});

// The CLI once printed `pass` for an attempt still `pending` (one later failed) because it read the
// chain's next_action as a verdict; `blocked_by_chain` answers before handler proof is even checked.
// The attempt this run started is the only verdict it may report.
const workspaceStatus = (nextAction) => ({ ok: true, json: async () => ({ result: { structuredContent: {
  pending: [{ commit_sha: SHA, next_action: nextAction }] } } }) });

for (const nextAction of [
  { kind: 'blocked_by_chain', next_commit_sha: 'b'.repeat(64), position: 2 },
  { kind: 'step_up_and_activate', command: `/cynap-activate ${SHA}` },
]) {
  test(`a pending attempt never reports pass, whatever the chain says (${nextAction.kind})`, async () => {
    let chainReads = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes('/mcp')) { chainReads += 1; return workspaceStatus(nextAction); }
      return { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) };
    };
    const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl, wait: async () => {}, maxPolls: 6, nonceOverride: 'n' });
    assert.equal(result.status, 'preview_running');
    assert.equal(result.attemptId, ATTEMPT);
    assert.equal(chainReads, 0, 'the chain is not a verdict source');
  });
}

test('a verdict landing during the last wait is not missed', async () => {
  let reads = 0;
  const fetchImpl = async () => {
    reads += 1;
    return { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: reads >= 3 ? 'fail' : 'pending', failureCode: 'copy_create_failed' }) };
  };
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl, wait: async () => {}, maxPolls: 2, nonceOverride: 'n' });
  assert.equal(result.status, 'fail', 'the final read before giving up caught the verdict');
});

// the closed warning set survives the summary; anything else is dropped.
test('previewSummary keeps preview_wrote_nothing and drops unknown warnings', () => {
  const summary = previewSummary({ previewId: 'p-1', status: 'pass', effectKinds: [], warnings: ['preview_wrote_nothing', 'made_up'] });
  assert.deepEqual(summary.warnings, ['preview_wrote_nothing']);
  assert.equal(previewSummary({ previewId: 'p-1', status: 'pass', effectKinds: [] }).warnings, undefined);
});

// A gateway timeout and an authorization outage must not end a wait whose preview then passes.
test('a running poll rides out gateway timeouts and an authorization outage, then reports the verdict', async () => {
  const replies = [
    { ok: false, status: 504, json: async () => { throw new SyntaxError('not json'); } },
    { ok: false, status: 503, json: async () => ({ error: 'operator_authz_unavailable', retryAfterMs: 2000 }) },
    { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) },
    { ok: false, status: 502, json: async () => ({ error: 'fetch failed' }) },
    { ok: true, status: 200, json: async () => ({ previewId: ATTEMPT, status: 'pass', effectKinds: [] }) },
  ];
  const fetchImpl = async (url) => (String(url).includes('/status/')
    ? replies.shift()
    : { ok: true, status: 202, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) });
  const result = await runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl, wait: async () => {}, nonceOverride: 'n' });
  assert.equal(result.status, 'pass');
  assert.equal(replies.length, 0);
});

test('a streak of transient reads still ends the poll, and a 403 ends it at once', async () => {
  let reads = 0;
  const failing = (status) => async (url) => {
    if (!String(url).includes('/status/')) return { ok: true, status: 202, json: async () => ({ previewId: ATTEMPT, status: 'pending' }) };
    reads += 1;
    return { ok: false, status, json: async () => ({}) };
  };
  await assert.rejects(runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl: failing(504), wait: async () => {}, nonceOverride: 'n' }),
    (error) => error.code === 'status_http_504');
  assert.equal(reads, MAX_TRANSIENT_STATUS_READS);
  reads = 0;
  await assert.rejects(runPreview({ slug: 's', automationId: 'a', commitSha: SHA, fetchImpl: failing(403), wait: async () => {}, nonceOverride: 'n' }),
    (error) => error.code === 'status_http_403');
  assert.equal(reads, 1);
});

test('a superseded attempt carries its closed reason through the proxy and the summary, and each reason has a next step', async () => {
  const forward = (answer) => forwardPreviewRequest({
    method: 'GET', previewId: ATTEMPT, orgSlug: 'cynap-e2e', mcpHost: 'https://staging.mcp.cynap.ai',
    tokenManager: { getToken: async () => 't' }, fetchImpl: async () => ({ status: 200, json: async () => answer }),
  });
  const ok = await forward({ previewId: ATTEMPT, status: 'superseded', supersedeReason: 'key_changed' });
  assert.equal(ok.body.supersedeReason, 'key_changed');
  assert.ok(!('supersedeReason' in (await forward({ previewId: ATTEMPT, status: 'superseded', supersedeReason: 'private text' })).body));
  assert.deepEqual(previewSummary(ok.body), { status: 'superseded', attemptId: ATTEMPT, supersedeReason: 'key_changed', effectKinds: [] });
  assert.deepEqual(Object.keys(SUPERSEDED_HINTS).sort(), ['commit_discarded', 'key_changed', 'queue_expired', 'replaced_by_newer']);
  assert.match(SUPERSEDED_HINTS.key_changed, /accepted tip/);
});
