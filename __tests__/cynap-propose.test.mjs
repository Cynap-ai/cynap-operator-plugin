// /cynap-propose: the proxy's /prepare-proof endpoint and the bin's read → prepare → propose flow.
// Pure `node --test`, no real network: fetchImpl is injected everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import {
  describeProposeRefusal, main, parseProposeArgs, refusalCode, runProposeFlow,
} from '../bin/cynap-propose.mjs';
import {
  CONTROL_HEADER, PREPARE_PROOF_PATH, classifyProofAnswer, createProxyServer, parsePrepareProofRequest,
} from '../bin/operator-proxy.mjs';

const NONCE = 'prepare-proof-nonce';
const SHA = 'c'.repeat(64);
const RECEIPT = '4b1d2c3e-0000-4000-8000-1234567890ab';
const REQUEST_ID = 'req_01HZZZ';
const BODY = { request_id: REQUEST_ID, expected_state_version: 3, commit_sha: SHA };
const MINT_URL = 'https://portal.example/api/auth/operator-token';
const MCP_URL = 'https://mcp.example/mcp/operator';

function post(port, body, headers = { [CONTROL_HEADER]: NONCE }) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: PREPARE_PROOF_PATH, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      }
    );
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}

const toolAnswer = (value) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }), { status: 200 });
const mintOk = (token) => new Response(JSON.stringify({ token, expires_in: 900 }), { status: 200 });
const mintRefused = (error = 'invalid_grant', status = 403) => new Response(JSON.stringify({ error }), { status });
const prepared = () => toolAnswer({ ok: true, commit_sha: SHA, proof: { receipt: RECEIPT, fingerprint: 'f'.repeat(64), expiresAt: '2026-10-11T12:00:00Z' } });

/** A proxy whose upstream is `mint(requestedScope)` for the portal and `tool(call)` for MCP. */
async function withProxy({ mint, tool = prepared }, fn) {
  const calls = [];
  const standing = { reads: 0 };
  const server = createProxyServer({
    mcpHost: 'https://mcp.example',
    mcpPath: '/mcp/operator',
    tokenManager: { getToken: async () => { standing.reads += 1; return 'standing-execute-preview-token'; } },
    orgSlug: 'acme',
    orgId: 'org_acme',
    mintHost: 'https://portal.example',
    getAuthHeaders: () => ({ Authorization: 'Bearer octk_cred' }),
    pluginVersion: '9.9.9',
    controlNonce: NONCE,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body, authorization: init.headers.Authorization });
      return url === MINT_URL ? mint(body.requestedScope) : tool(body);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(server.address().port, calls, standing);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('parsePrepareProofRequest accepts exactly the three fields and returns them unchanged', () => {
  assert.deepEqual(parsePrepareProofRequest(BODY), BODY);
  assert.deepEqual(parsePrepareProofRequest({ ...BODY, expected_state_version: 0 }), { ...BODY, expected_state_version: 0 });
});

test('parsePrepareProofRequest refuses a bad sha, version, request id or extra field', () => {
  const bad = [
    null, [], 'x',
    { ...BODY, commit_sha: 'c'.repeat(63) }, { ...BODY, commit_sha: 'z'.repeat(64) }, { ...BODY, commit_sha: undefined },
    { ...BODY, expected_state_version: -1 }, { ...BODY, expected_state_version: 1.5 }, { ...BODY, expected_state_version: '3' },
    { ...BODY, request_id: '' }, { ...BODY, request_id: '   ' }, { ...BODY, request_id: 7 },
    { ...BODY, changes: [] }, { ...BODY, requestedScope: 'workspace:file-activate' },
  ];
  for (const payload of bad) {
    assert.throws(() => parsePrepareProofRequest(payload), (error) => error.code === 'invalid_request', JSON.stringify(payload));
  }
});

test('/prepare-proof refuses a missing or wrong nonce and never mints', async () => {
  await withProxy({ mint: () => mintOk('proof-token') }, async (port, calls) => {
    for (const headers of [{}, { [CONTROL_HEADER]: 'wrong' }]) {
      const res = await post(port, BODY, headers);
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { error: 'invalid_local_control_nonce' });
    }
    assert.equal(calls.length, 0);
  });
});

test('/prepare-proof validates the body before minting', async () => {
  await withProxy({ mint: () => mintOk('proof-token') }, async (port, calls) => {
    for (const body of [{ ...BODY, commit_sha: 'abc' }, { ...BODY, expected_state_version: -2 }, { ...BODY, request_id: '' }, 'not json']) {
      const res = await post(port, body);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'invalid_request' });
    }
    assert.equal(calls.length, 0);
  });
});

test('/prepare-proof mints workspace:operate and spends the token on exactly one prepare call', async () => {
  await withProxy({ mint: () => mintOk('proof-token') }, async (port, calls, standing) => {
    const res = await post(port, BODY);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, commit_sha: SHA, receipt: RECEIPT });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, MINT_URL);
    assert.deepEqual(calls[0].body, { targetOrgId: 'org_acme', family: 'workspace', requestedScope: 'workspace:operate' });
    assert.equal(calls[0].authorization, 'Bearer octk_cred');
    assert.equal(calls[1].url, MCP_URL);
    assert.equal(calls[1].authorization, 'Bearer proof-token');
    assert.equal(calls[1].body.method, 'tools/call');
    assert.deepEqual(calls[1].body.params, { name: 'workspace_prepare_commit_proof', arguments: BODY });
    assert.equal(standing.reads, 0, 'the standing workspace token is never used');
    assert.doesNotMatch(JSON.stringify(res.body), /proof-token/);
  });
});

test('/prepare-proof mints a fresh token per request: nothing is cached between calls', async () => {
  let minted = 0;
  await withProxy({ mint: () => mintOk(`proof-token-${++minted}`) }, async (port, calls) => {
    await post(port, BODY);
    await post(port, BODY);
    const tools = calls.filter((call) => call.url === MCP_URL);
    assert.deepEqual(tools.map((call) => call.authorization), ['Bearer proof-token-1', 'Bearer proof-token-2']);
    assert.ok(tools.every((call) => call.body.params.name === 'workspace_prepare_commit_proof'));
  });
});

test('/prepare-proof falls back to workspace:commit once when workspace:operate answers invalid_grant', async () => {
  const mint = (scope) => (scope === 'workspace:operate' ? mintRefused() : mintOk('commit-token'));
  await withProxy({ mint }, async (port, calls) => {
    const res = await post(port, BODY);
    assert.deepEqual(res.body, { ok: true, commit_sha: SHA, receipt: RECEIPT });
    assert.deepEqual(calls.map((call) => call.body.requestedScope ?? call.body.params.name),
      ['workspace:operate', 'workspace:commit', 'workspace_prepare_commit_proof']);
    assert.equal(calls[2].authorization, 'Bearer commit-token');
  });
});

test('/prepare-proof stops when both profiles answer invalid_grant, with no tool call', async () => {
  await withProxy({ mint: () => mintRefused() }, async (port, calls) => {
    const res = await post(port, BODY);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'proof_credential_refused', failureCode: 'invalid_grant' });
    assert.deepEqual(calls.map((call) => call.body.requestedScope), ['workspace:operate', 'workspace:commit']);
  });
});

test('/prepare-proof does not fall back on any other mint failure', async () => {
  await withProxy({ mint: () => mintRefused('unauthorized', 401) }, async (port, calls) => {
    const res = await post(port, BODY);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'proof_credential_failed', failureCode: 'http_401' });
    assert.equal(calls.length, 1);
  });
});

test('/prepare-proof returns the server refusal with its code', async () => {
  const tool = () => toolAnswer({ ok: false, code: 'forbidden_actor', message: 'Request proof preparation requires\ncurrent member authority.' });
  await withProxy({ mint: () => mintOk('proof-token'), tool }, async (port) => {
    const res = await post(port, BODY);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: false, code: 'forbidden_actor', message: 'Request proof preparation requires current member authority.' });
  });
});

test('/prepare-proof names an upstream HTTP failure by status only', async () => {
  const tool = () => new Response('upstream said proof-token is bad', { status: 502 });
  await withProxy({ mint: () => mintOk('proof-token'), tool }, async (port) => {
    const res = await post(port, BODY);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'prepare_proof_failed', failureCode: 'http_502' });
  });
});

test('workspace_prepare_commit_proof never becomes a tool the proxy mints for on /mcp', async () => {
  await withProxy({ mint: () => mintOk('proof-token'), tool: () => toolAnswer({ ok: false, code: 'x' }) }, async (port, calls, standing) => {
    await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workspace_prepare_commit_proof', arguments: BODY } }));
    });
    assert.equal(calls.filter((call) => call.url === MINT_URL).length, 0, 'an MCP caller never triggers the proof mint');
    assert.equal(standing.reads, 1, 'the call is forwarded on the standing token, which the server refuses');
    assert.equal(calls[0].authorization, 'Bearer standing-execute-preview-token');
  });
});

test('classifyProofAnswer refuses a receipt for another commit and names a surface denial', () => {
  const text = (result) => JSON.stringify({ jsonrpc: '2.0', id: 1, result });
  const other = text({ content: [{ type: 'text', text: JSON.stringify({ ok: true, commit_sha: 'd'.repeat(64), proof: { receipt: RECEIPT } }) }] });
  assert.deepEqual(classifyProofAnswer(other, SHA), { ok: false, code: 'prepare_proof_unreadable' });
  const denied = text({ isError: true, content: [{ type: 'text', text: "Tool 'workspace_prepare_commit_proof' is not available on this connection." }] });
  assert.deepEqual(classifyProofAnswer(denied, SHA), { ok: false, code: 'tool_not_available' });
});

// --- the bin ---------------------------------------------------------------

test('parseProposeArgs reads the sha, the Request number and --json in any order', () => {
  assert.deepEqual(parseProposeArgs([SHA, '--request', '12']), { commitSha: SHA, number: 12, json: false });
  assert.deepEqual(parseProposeArgs(['--request', '12', SHA, '--json']), { commitSha: SHA, number: 12, json: true });
});

test('parseProposeArgs refuses a missing sha or number, unknown flags and duplicates', () => {
  const bad = [[], [SHA], ['--request', '12'], [SHA, '--request'], [SHA, '--request', '0'], [SHA, '--request', 'abc'],
    [SHA, '--request', '1', '--request', '2'], [SHA, '--request', '1', '--force'], ['abc', '--request', '1'], [SHA, SHA, '--request', '1']];
  for (const argv of bad) assert.throws(() => parseProposeArgs(argv), /Usage: cynap-propose\.mjs/, JSON.stringify(argv));
});

/** An /mcp fetch double answering each tool by name, recording every call. */
function mcpDouble(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { name, arguments: args } = JSON.parse(init.body).params;
    calls.push({ url, name, args });
    return { ok: true, json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify(answers[name]) }] } }) };
  };
  return { calls, fetchImpl };
}

const claimed = { request: { id: REQUEST_ID, number: 12, state: 'claimed', state_version: 7 } };

test('the bin refuses a Request that is not claimed without preparing a proof', async () => {
  const state = 'proposed';
  const { calls, fetchImpl } = mcpDouble({ request_get: { request: { ...claimed.request, state } } });
  const prepare = async () => { throw new Error('must not prepare'); };
  const result = await runProposeFlow({ slug: 'acme', commitSha: SHA, number: 12, fetchImpl, prepare });
  assert.deepEqual(result, { ok: false, code: 'request_not_claimed', state });
  assert.deepEqual(calls.map((call) => call.name), ['request_get']);
});

test('the bin reports an unknown Request number without preparing a proof', async () => {
  const { fetchImpl } = mcpDouble({ request_get: { request: null } });
  const result = await runProposeFlow({ slug: 'acme', commitSha: SHA, number: 99, fetchImpl,
    prepare: async () => { throw new Error('must not prepare'); } });
  assert.deepEqual(result, { ok: false, code: 'request_not_found' });
});

test('the bin passes the Request id, state_version and receipt through unchanged', async () => {
  const transition = { request: { id: REQUEST_ID, state: 'proposed', state_version: 8 } };
  const { calls, fetchImpl } = mcpDouble({ request_get: claimed, request_operator_transition: transition });
  const prepares = [];
  const prepare = async (args) => { prepares.push(args); return { ok: true, commit_sha: SHA, receipt: RECEIPT }; };
  const result = await runProposeFlow({ slug: 'acme', commitSha: SHA, number: 12, fetchImpl, prepare });
  assert.deepEqual(calls[0], { url: calls[0].url, name: 'request_get', args: { number: 12 } });
  assert.match(calls[0].url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(prepares.length, 1);
  assert.deepEqual({ ...prepares[0], fetchImpl: undefined },
    { slug: 'acme', requestId: REQUEST_ID, expectedStateVersion: 7, commitSha: SHA, fetchImpl: undefined });
  assert.deepEqual(calls[1].args,
    { id: REQUEST_ID, verb: 'propose', expected_state_version: 7, proposal_ref: SHA, proof_receipt: RECEIPT });
  assert.deepEqual(result, { ok: true, request_number: 12, request_id: REQUEST_ID, commit_sha: SHA, result: transition });
});

test('the bin stops at a proof refusal and never calls the transition', async () => {
  const { calls, fetchImpl } = mcpDouble({ request_get: claimed });
  const refusal = { ok: false, code: 'forbidden_actor', message: 'Request proof preparation requires current member authority.' };
  const result = await runProposeFlow({ slug: 'acme', commitSha: SHA, number: 12, fetchImpl, prepare: async () => refusal });
  assert.deepEqual(result, refusal);
  assert.deepEqual(calls.map((call) => call.name), ['request_get']);
  const text = describeProposeRefusal(result);
  assert.match(text, /forbidden_actor/);
  assert.match(text, /only the Owner/);
});

test('a server refusal of the transition is surfaced with its code and a next step', async () => {
  const refusal = { ok: false, code: 'REQUEST_PROPOSAL_INTENDED_OUTCOMES_REQUIRED', message: 'A build Request with a published Scope needs Intended outcomes.' };
  const { fetchImpl } = mcpDouble({ request_get: claimed, request_operator_transition: refusal });
  const result = await runProposeFlow({ slug: 'acme', commitSha: SHA, number: 12, fetchImpl,
    prepare: async () => ({ ok: true, commit_sha: SHA, receipt: RECEIPT }) });
  assert.deepEqual(result, refusal);
  const text = describeProposeRefusal(result);
  assert.match(text, /^cynap-propose: refused \(REQUEST_PROPOSAL_INTENDED_OUTCOMES_REQUIRED\)\n/);
  assert.match(text, /cynap-propose: A build Request with a published Scope needs Intended outcomes\./);
  assert.match(text, /Next step: .*intended_outcomes/);
});

test('refusalCode finds a REQUEST_* code inside a plain-text server refusal', () => {
  assert.equal(refusalCode({ ok: false, code: 'tool_error', message: 'REQUEST_PREAPPROVAL_PROOF_EXPIRED: Pre-approval proof receipt has expired' }),
    'REQUEST_PREAPPROVAL_PROOF_EXPIRED');
  assert.equal(refusalCode({ ok: false, code: 'forbidden_actor', message: 'REQUEST_X' }), 'forbidden_actor');
  assert.equal(refusalCode({ ok: false, code: 'something_else' }), 'something_else');
});

test('main prints one outcome line on success and exits non-zero on a refusal', async () => {
  const lines = [];
  const out = { write: (text) => lines.push(text) };
  const before = process.exitCode;
  try {
    await main([SHA, '--request', '12'], { out, run: async () => ({ ok: true, request_number: 12, request_id: REQUEST_ID, commit_sha: SHA, result: {} }) });
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(`^proposed: Request 12 now carries commit ${SHA}\\.`));
    assert.equal(process.exitCode, before);
    lines.length = 0;
    await main([SHA, '--request', '12'], { out, run: async () => ({ ok: false, code: 'request_not_claimed', state: 'open' }) });
    assert.match(lines.join(''), /request_not_claimed/);
    assert.match(lines.join(''), /The Request is open\./);
    assert.equal(process.exitCode, 1);
    lines.length = 0;
    await main([SHA, '--request', '12', '--json'], { out, run: async () => ({ ok: false, code: 'forbidden_actor' }) });
    assert.deepEqual(JSON.parse(lines.join('')), { ok: false, code: 'forbidden_actor' });
  } finally {
    process.exitCode = before;
  }
});
