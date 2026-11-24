// /cynap-activate on an Org the backend put on the Changes-page entrance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseActivateArgs, readActivationAction, runActivationFlow, runGrantActivation, waitForGrantActivation,
} from '../bin/cynap-activate.mjs';
import { requestAutomaticGrant } from '../bin/operator-proxy.mjs';

const SHA = 'c'.repeat(64);
const URL = 'https://cynap.ai/cynap-e2e/changes';
const statusFetch = (statuses) => {
  const queue = [...statuses];
  return async () => {
    const status = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify(status) }] } }) };
  };
};

test('parseActivateArgs accepts --auto once', () => {
  assert.equal(parseActivateArgs([SHA, '--auto']).auto, true);
  assert.throws(() => parseActivateArgs([SHA, '--auto', '--auto']), /Usage/);
});

test('readActivationAction follows the backend entrance field', async () => {
  const fetchImpl = statusFetch([{ ok: true, org_slug: 'cynap-e2e', activation_entrance: 'grant', changes_url: URL,
    pending: [{ commit_sha: SHA, next_action: { kind: 'step_up_and_activate' } }] }]);
  assert.deepEqual(await readActivationAction({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl }),
    { orgSlug: 'cynap-e2e', nextAction: { kind: 'step_up_and_activate' }, entrance: 'grant', changesUrl: URL });
});

test('a grant Org never reaches the legacy step-up', async () => {
  let legacy = 0;
  const calls = [];
  const result = await runActivationFlow({ slug: 'cynap-e2e', commitSha: SHA, auto: true,
    statusReader: async () => ({ orgSlug: 'cynap-e2e', nextAction: { kind: 'step_up_and_activate' }, entrance: 'grant', changesUrl: URL }),
    activateFn: async () => { legacy += 1; return {}; },
    grantFn: async (args) => { calls.push(args); return { ok: true, state: 'activated' }; } });
  assert.equal(legacy, 0);
  assert.deepEqual(result, { ok: true, state: 'activated' });
  assert.equal(calls[0].auto, true);
  assert.equal(calls[0].changesUrl, URL);
});

test('--auto is refused on a legacy-entrance Org', async () => {
  await assert.rejects(runActivationFlow({ slug: 'acme', commitSha: SHA, auto: true,
    statusReader: async () => ({ orgSlug: 'acme', nextAction: { kind: 'step_up_and_activate' }, entrance: 'legacy', changesUrl: null }),
    activateFn: async () => assert.fail('legacy activation must not start') }), /--auto applies only/);
});

test('link-and-wait prints the Changes link, then follows the chain', async () => {
  const links = [];
  const result = await runGrantActivation({ slug: 'cynap-e2e', commitSha: SHA, changesUrl: URL, onLink: (u) => links.push(u),
    acceptFn: async () => assert.fail('no automatic acceptance without --auto'),
    waitFn: async () => ({ ok: true, state: 'activated', commit_sha: SHA, ready: 'ready' }) });
  assert.deepEqual(links, [URL]);
  assert.equal(result.state, 'activated');
});

test('--auto stops on a portal refusal and keeps the Changes link', async () => {
  const result = await runGrantActivation({ slug: 'cynap-e2e', commitSha: SHA, auto: true, changesUrl: URL,
    acceptFn: async () => ({ ok: false, code: 'automatic_grant_refused', reason: 'not_owner' }),
    waitFn: async () => assert.fail('must not wait after a refusal') });
  assert.deepEqual(result, { ok: false, code: 'automatic_grant_refused', reason: 'not_owner', changes_url: URL });
});

test('waitForGrantActivation waits while the commit is only pending, then settles once it moves', async () => {
  const pending = { ok: true, pending: [{ commit_sha: SHA, state: 'ready' }] };
  const running = { ok: true, head_state: { activating: SHA }, pending: [{ commit_sha: SHA, state: 'activating' }] };
  let waits = 0;
  const result = await waitForGrantActivation({ slug: 'cynap-e2e', commitSha: SHA, fetchImpl: statusFetch([pending, pending, running]),
    wait: async () => { waits += 1; }, settle: async () => ({ ok: true, state: 'activated' }) });
  assert.equal(waits, 2);
  assert.deepEqual(result, { ok: true, state: 'activated' });
});

test('waitForGrantActivation reports a bounded wait without guessing an outcome', async () => {
  const result = await waitForGrantActivation({ slug: 'cynap-e2e', commitSha: SHA, waitMs: 10, intervalMs: 5,
    fetchImpl: statusFetch([{ ok: true, pending: [{ commit_sha: SHA, state: 'ready' }] }]), wait: async () => {},
    settle: async () => assert.fail('nothing moved') });
  assert.deepEqual(result, { ok: false, code: 'grant_approval_pending', commit_sha: SHA });
});

test('requestAutomaticGrant posts the sha with a fresh acceptance id and relays the portal answer', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ activation_grant_id: 'g-1' }), { status: 200 }); };
  const result = await requestAutomaticGrant({ mintHost: 'https://cynap.ai', throughSha: SHA, pluginVersion: '1.0.0',
    getAuthHeaders: () => ({ Authorization: 'Bearer cli' }), fetchImpl, acceptanceRequestId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(seen.url, 'https://cynap.ai/api/auth/operator-cli/activation-grant');
  assert.deepEqual(JSON.parse(seen.init.body), { through_sha: SHA, acceptance_request_id: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(result, { status: 200, body: { activation_grant_id: 'g-1' } });
});

test('requestAutomaticGrant needs a credential and a full sha', async () => {
  await assert.rejects(requestAutomaticGrant({ mintHost: 'x', throughSha: 'abc', getAuthHeaders: () => ({}) }), /64-character/);
  await assert.rejects(requestAutomaticGrant({ mintHost: 'x', throughSha: SHA, getAuthHeaders: () => ({}) }), /cynap-connect/);
});
