import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOperatorConnect } from '../lib/operator-connect.mjs';
import { parseConnectArgs } from '../bin/cynap-connect.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test('/cynap-connect delegates to the executable product seam, not agent-authored setup', () => {
  const command = readFileSync(join(TEST_DIR, '..', 'commands', 'cynap-connect.md'), 'utf8');
  assert.match(
    command,
    /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/cynap-connect\.mjs" \$ARGUMENTS/
  );
  assert.doesNotMatch(command, /generic Cynap app|app connector|mcp-token/i);
});

test('the executable accepts one server-resolved org slug and production defaults', () => {
  assert.deepEqual(parseConnectArgs(['cynap']), { slug: 'cynap', env: 'prod' });
  assert.deepEqual(parseConnectArgs(['cynap', '--staging']), {
    slug: 'cynap',
    env: 'staging',
  });
  assert.throws(() => parseConnectArgs([]), /Usage/);
  assert.throws(() => parseConnectArgs(['cynap', '--device']), /Usage/);
});

test('/cynap-connect cynap launches the operator PKCE connector and returns a healthy workspace', async () => {
  const events = [];
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    plan: async (input) => {
      events.push(['plan', input]);
      return {
        slug: 'cynap',
        env: 'prod',
        authMode: 'interactive',
        action: 'launch',
        actionReason: 'no healthy proxy',
        port: 39123,
        workingDir: '/tmp/CynapOperator/cynap',
        mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
        proxyArgv: [
          '/plugin/bin/operator-proxy.mjs',
          '--port',
          '39123',
          '--prod',
          '--org-slug',
          'cynap',
        ],
      };
    },
    launch: async (plan) => {
      events.push(['launch', plan.authMode, plan.proxyArgv]);
      return { pid: 4242 };
    },
    waitForHealth: async (input) => {
      events.push(['health', input]);
      return {
        ok: true,
        org: 'cynap',
        orgId: 'org-cynap',
        env: 'prod',
        version: '0.9.0',
        authMode: 'interactive',
        status: 'ready',
        pid: 4242,
        credExpiresAt: '2026-09-04T10:00:00.000Z',
      };
    },
  });

  assert.equal(events[0][0], 'plan');
  assert.deepEqual(events[0][1], {
    slug: 'cynap',
    env: 'prod',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
  });
  assert.deepEqual(events[1], [
    'launch',
    'interactive',
    [
      '/plugin/bin/operator-proxy.mjs',
      '--port',
      '39123',
      '--prod',
      '--org-slug',
      'cynap',
    ],
  ]);
  assert.equal(events[2][0], 'health');
  assert.deepEqual(result, {
    status: 'connected',
    reused: false,
    slug: 'cynap',
    env: 'prod',
    personaRoute: 'operator_pkce',
    workingDir: '/tmp/CynapOperator/cynap',
    mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
    health: {
      ok: true,
      org: 'cynap',
      orgId: 'org-cynap',
      env: 'prod',
      version: '0.9.0',
      authMode: 'interactive',
      status: 'ready',
      pid: 4242,
      credExpiresAt: '2026-09-04T10:00:00.000Z',
    },
  });
});

test('the managed connector refuses every non-PKCE production plan', async () => {
  for (const authMode of ['device', 'e2e']) {
    await assert.rejects(
      () =>
        runOperatorConnect({
          slug: 'cynap',
          proxyPath: '/plugin/bin/operator-proxy.mjs',
          plan: async () => ({
            slug: 'cynap',
            env: 'prod',
            authMode,
            action: 'launch',
            port: 39123,
            workingDir: '/tmp/CynapOperator/cynap',
            mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
            proxyArgv: [],
          }),
          launch: async () => {
            throw new Error('must not launch');
          },
        }),
      /operator PKCE route/
    );
  }
});

test('a healthy PKCE proxy at the supported version is reused without launching another process', async () => {
  let launched = false;
  const health = {
    ok: true,
    status: 'ready',
    org: 'cynap',
    orgId: 'org-cynap',
    env: 'prod',
    authMode: 'interactive',
    version: '0.9.0',
  };
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    plan: async () => ({
      slug: 'cynap',
      env: 'prod',
      authMode: 'interactive',
      action: 'reuse',
      port: 39123,
      workingDir: '/tmp/CynapOperator/cynap',
      mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
      health,
    }),
    launch: async () => {
      launched = true;
    },
  });

  assert.equal(launched, false);
  assert.equal(result.status, 'connected');
  assert.equal(result.reused, true);
  assert.deepEqual(result.health, health);
});

test('an authorizing PKCE proxy is awaited instead of launching a second credential flow', async () => {
  let launched = false;
  const ready = {
    ok: true,
    status: 'ready',
    org: 'cynap',
    env: 'prod',
    authMode: 'interactive',
    version: '0.9.0',
    pid: 4242,
  };
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    plan: async () => ({
      slug: 'cynap',
      env: 'prod',
      authMode: 'interactive',
      action: 'wait',
      port: 39123,
      workingDir: '/tmp/CynapOperator/cynap',
      mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
      health: { ...ready, ok: false, status: 'authorizing' },
    }),
    launch: async () => {
      launched = true;
    },
    waitForHealth: async () => ready,
  });

  assert.equal(launched, false);
  assert.equal(result.reused, true);
  assert.deepEqual(result.health, ready);
});

test('reuse refuses missing or non-PKCE provenance instead of claiming operator PKCE', async () => {
  for (const health of [
    { ok: true, status: 'ready', org: 'cynap', env: 'prod', version: '0.9.0' },
    {
      ok: true,
      status: 'ready',
      org: 'cynap',
      env: 'prod',
      version: '0.9.0',
      authMode: 'device',
    },
    {
      ok: true,
      status: 'ready',
      org: 'cynap',
      env: 'prod',
      version: '0.8.0',
      authMode: 'interactive',
    },
  ]) {
    await assert.rejects(
      () =>
        runOperatorConnect({
          slug: 'cynap',
          proxyPath: '/plugin/bin/operator-proxy.mjs',
          plan: async () => ({
            slug: 'cynap',
            env: 'prod',
            authMode: 'interactive',
            action: 'reuse',
            workingDir: '/tmp/CynapOperator/cynap',
            mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
            health,
          }),
        }),
      /PKCE proxy|supported proxy version/
    );
  }
});

test('a conflicting local proxy is refused instead of crossing org identity', async () => {
  await assert.rejects(
    () =>
      runOperatorConnect({
        slug: 'cynap',
        proxyPath: '/plugin/bin/operator-proxy.mjs',
        plan: async () => ({
          slug: 'cynap',
          env: 'prod',
          authMode: 'interactive',
          action: 'conflict',
          actionReason: 'port belongs to other-org',
          port: 39123,
          workingDir: '/tmp/CynapOperator/cynap',
          mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
        }),
      }),
    /other-org/
  );
});
