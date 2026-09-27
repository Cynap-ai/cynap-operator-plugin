// An unanswered startup sign-in used to exit the proxy, leaving nothing on the
// stable port and no explanation. Now the control plane stays up and reports
// `login_timed_out`, operator calls get a sentence instead of a hang, and the
// next /cynap-connect retires that proxy and starts the sign-in again.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSENT_OUTCOMES,
  ConsentError,
  HEALTH_PATH,
  LOGIN_TIMED_OUT_STATUS,
  acquireStartupCredential,
  createLifecycleServer,
  isLoginTimeout,
} from '../bin/operator-proxy.mjs';
import { decideProxyAction, probeProxyHealth } from '../lib/connect.mjs';
import { runOperatorConnect, waitForOperatorHealth } from '../lib/operator-connect.mjs';
import { describeLoopbackFailure } from '../lib/workspace-sync.mjs';

const TIMED_OUT_HEALTH = {
  ok: false,
  status: 'login_timed_out',
  org: 'acme',
  orgId: null,
  env: 'prod',
  authMode: 'interactive',
  pluginVersion: '0.19.4',
  pid: 4242,
};

function recorder() {
  const lines = [];
  return { write: (s) => lines.push(s), text: () => lines.join('') };
}

test('isLoginTimeout recognizes every "nobody answered consent" shape and nothing else', () => {
  assert.equal(isLoginTimeout(new Error('operator login timed out')), true);
  assert.equal(isLoginTimeout(new Error('device authorization timed out')), true);
  assert.equal(isLoginTimeout(new ConsentError(CONSENT_OUTCOMES.TIMEOUT, 'timed out')), true);
  assert.equal(isLoginTimeout(new ConsentError(CONSENT_OUTCOMES.REFUSED, 'declined')), false);
  assert.equal(isLoginTimeout(new Error('operator-cli token exchange failed: 500')), false);
});

test('a startup consent that times out keeps the proxy up and says how to restart it', async () => {
  const out = recorder();
  const outcome = await acquireStartupCredential({
    receiveHandoff: async () => null,
    adopt: () => { throw new Error('no handoff offered'); },
    consent: async () => { throw new Error('operator login timed out'); },
    out,
  });
  assert.equal(outcome, LOGIN_TIMED_OUT_STATUS);
  assert.match(out.text(), /operator login failed: operator login timed out/);
  assert.match(out.text(), /control plane stays up with status login_timed_out; run \/cynap-connect/);
});

test('any other startup login failure still propagates (and is logged first)', async () => {
  const out = recorder();
  await assert.rejects(
    acquireStartupCredential({
      receiveHandoff: async () => null,
      adopt: () => {},
      consent: async () => { throw new Error('operator-cli token exchange failed: 500'); },
      out,
    }),
    /token exchange failed/
  );
  assert.match(out.text(), /operator login failed: operator-cli token exchange failed: 500/);
});

test('a timed-out proxy reports login_timed_out on /health and answers MCP calls with a sentence', async (t) => {
  const server = createLifecycleServer({
    getHealth: () => TIMED_OUT_HEALTH,
    onDisconnect: async () => ({ stopped: true, credentialIssued: false, credentialRevoked: true }),
    getReadyServer: () => null,
    controlNonce: 'local-nonce',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await (await fetch(`${base}${HEALTH_PATH}`)).json();
  assert.equal(health.status, 'login_timed_out');

  const response = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'operator_login_timed_out');
  assert.match(body.message, /Run \/cynap-connect to restart the sign-in/);
  assert.match(describeLoopbackFailure({ status: 503, body }), /Run \/cynap-connect/);
});

test('/cynap-connect sees the timed-out proxy and plans to relaunch it, never to reuse or wait on it', async () => {
  const probed = await probeProxyHealth({
    port: 39468,
    fetchImpl: async () => ({ ok: true, json: async () => TIMED_OUT_HEALTH }),
  });
  assert.deepEqual(probed, TIMED_OUT_HEALTH, 'the probe must not read a timed-out proxy as "nothing listening"');
  const decision = decideProxyAction({ health: probed, orgId: null, slug: 'acme', env: 'prod' });
  assert.equal(decision.action, 'relaunch');
});

function relaunchPlan() {
  return {
    slug: 'acme', env: 'prod', authMode: 'interactive', action: 'relaunch', port: 39468,
    workingDir: '/tmp/CynapOperator/acme', mcpJsonPath: '/tmp/CynapOperator/acme/.mcp.json',
    proxyArgv: ['/plugin/bin/operator-proxy-launcher.mjs', '--port', '39468', '--prod', '--org-slug', 'acme'],
    health: TIMED_OUT_HEALTH,
  };
}

test('a relaunch retires the timed-out proxy, then starts a fresh sign-in', async () => {
  const events = [];
  const result = await runOperatorConnect({
    slug: 'acme', proxyPath: '/plugin/bin/operator-proxy-launcher.mjs', pluginVersion: '0.19.4',
    plan: async () => relaunchPlan(),
    disconnect: async () => { events.push('retire'); return { status: 'disconnected', credentialIssued: false, credentialRevoked: true }; },
    launch: async () => { events.push('launch'); return { pid: 77 }; },
    waitForHealth: async ({ expectedPid }) => ({ ok: true, status: 'ready', org: 'acme', env: 'prod', pid: expectedPid }),
  });
  assert.deepEqual(events, ['retire', 'launch']);
  assert.equal(result.status, 'connected');
  assert.equal(result.reused, false);
});

test('a relaunch whose retire cannot prove revocation launches nothing', async () => {
  let launched = false;
  await assert.rejects(
    runOperatorConnect({
      slug: 'acme', proxyPath: '/plugin/bin/operator-proxy-launcher.mjs', pluginVersion: '0.19.4',
      plan: async () => relaunchPlan(),
      disconnect: async () => ({ status: 'disconnected', credentialIssued: true, credentialRevoked: false }),
      launch: async () => { launched = true; },
    }),
    /Could not revoke/
  );
  assert.equal(launched, false);
});

test('waiting on a fresh launch stops at once when its sign-in times out, instead of polling to the deadline', async () => {
  let sleeps = 0;
  await assert.rejects(
    waitForOperatorHealth({
      plan: { slug: 'acme', env: 'prod', port: 39468, workingDir: '/tmp/CynapOperator/acme' },
      probe: async () => TIMED_OUT_HEALTH,
      sleep: async () => { sleeps += 1; },
    }),
    /browser sign-in timed out/
  );
  assert.equal(sleeps, 0);
});
