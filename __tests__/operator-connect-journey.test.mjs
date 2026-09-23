import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOperatorConnect } from '../lib/operator-connect.mjs';
import { formatConnectMessage, parseConnectArgs } from '../bin/cynap-connect.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test('/cynap-connect delegates to the executable product seam, not agent-authored setup', () => {
  const command = readFileSync(join(TEST_DIR, '..', 'commands', 'cynap-connect.md'), 'utf8');
  assert.match(
    command,
    /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/cynap-connect\.mjs" \$ARGUMENTS/
  );
  assert.doesNotMatch(command, /generic Cynap app|app connector|mcp-token/i);
});

test('a lower-version same-org connector is launched only after its credential revocation is proven', async () => {
  const events = [];
  const plan = {
    slug: 'cynap', env: 'prod', authMode: 'interactive', action: 'reuse', port: 39123,
    workingDir: '/tmp/CynapOperator/cynap', mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json',
    proxyArgv: ['/plugin/bin/operator-proxy.mjs', '--port', '39123'],
    health: { ok: true, status: 'ready', org: 'cynap', env: 'prod', authMode: 'interactive', pluginVersion: '0.14.0' },
  };
  const result = await runOperatorConnect({
    slug: 'cynap', proxyPath: '/plugin/bin/operator-proxy.mjs', pluginVersion: '0.15.0',
    plan: async () => plan,
    disconnect: async () => { events.push('revoke'); return { status: 'disconnected', credentialIssued: true, credentialRevoked: true }; },
    launch: async () => { events.push('launch'); return { pid: 4242 }; },
    waitForHealth: async () => ({ ...plan.health, pluginVersion: '0.15.0', pid: 4242 }),
  });
  assert.deepEqual(events, ['revoke', 'launch']);
  assert.deepEqual(result.replaced, { from: '0.14.0', to: '0.15.0', credentialRevoked: true });
});

test('a failed revoke never launches a replacement connector', async () => {
  let launched = false;
  await assert.rejects(() => runOperatorConnect({
    slug: 'cynap', proxyPath: '/plugin/bin/operator-proxy.mjs', pluginVersion: '0.15.0',
    plan: async () => ({ slug: 'cynap', env: 'prod', authMode: 'interactive', action: 'reuse', port: 39123,
      workingDir: '/tmp/CynapOperator/cynap', mcpJsonPath: '/tmp/CynapOperator/cynap/.mcp.json', proxyArgv: ['/p'],
      health: { ok: true, status: 'ready', org: 'cynap', env: 'prod', authMode: 'interactive', pluginVersion: '0.14.0' } }),
    disconnect: async () => ({ status: 'disconnected', credentialIssued: true, credentialRevoked: false, credExpiresAt: 'later' }),
    launch: async () => { launched = true; },
  }), /Could not revoke/);
  assert.equal(launched, false);
});

test('the executable accepts one server-resolved org slug and production defaults', () => {
  assert.deepEqual(parseConnectArgs(['cynap']), { slug: 'cynap', env: 'prod' });
  assert.deepEqual(parseConnectArgs(['cynap', '--staging']), {
    slug: 'cynap',
    env: 'staging',
  });
  assert.throws(() => parseConnectArgs([], { cwd: '/tmp/elsewhere', operatorRoot: '/home/o/CynapOperator' }), /Usage/);
  // Inside a workspace the directory names the org, so the slug may be omitted.
  assert.deepEqual(
    parseConnectArgs([], { cwd: '/home/o/CynapOperator/cynap-e2e', operatorRoot: '/home/o/CynapOperator' }),
    { slug: 'cynap-e2e', env: 'prod' }
  );
  assert.deepEqual(
    parseConnectArgs(['--staging'], { cwd: '/home/o/CynapOperator/cynap-e2e', operatorRoot: '/home/o/CynapOperator' }),
    { slug: 'cynap-e2e', env: 'staging' }
  );
  // A subdirectory of a workspace is not a workspace root.
  assert.throws(
    () => parseConnectArgs([], { cwd: '/home/o/CynapOperator/cynap-e2e/context', operatorRoot: '/home/o/CynapOperator' }),
    /Usage/
  );
  assert.throws(() => parseConnectArgs(['cynap', '--device']), /Usage/);
});

test('connect copy is cwd-realpath aware and never advises a new session', () => {
  const result = { slug: 'cynap', workingDir: '/real/CynapOperator/cynap', health: {} };
  const realpath = (path) => path === '/symlink/cynap' ? '/real/CynapOperator/cynap' : path;
  const inside = formatConnectMessage(result, { cwd: '/symlink/cynap', realpath });
  const outside = formatConnectMessage(result, { cwd: '/elsewhere', realpath });
  // Spec D §8.2 leg 2 (2026-09-23, prod cynap-e2e): a same-session reconnect answered
  // a read tool with no /mcp, so the message no longer sends the operator there.
  assert.match(inside, /^Reconnected to cynap\. This session's operator tools use the new connection\./);
  assert.doesNotMatch(inside, /\/mcp/);
  assert.match(outside, /^Connected to cynap\. Open ~\/CynapOperator\/cynap\/ in Claude Code/);
  assert.doesNotMatch(`${inside}\n${outside}`, /new (Claude Code )?session/i);
});

test('/cynap-connect cynap launches the operator PKCE connector and returns a healthy workspace', async () => {
  const events = [];
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    pluginVersion: '0.9.0',
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
        pluginVersion: '0.9.0',
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
      pluginVersion: '0.9.0',
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
          pluginVersion: '0.9.0',
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
    pluginVersion: '0.9.0',
  };
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    pluginVersion: '0.9.0',
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
    pluginVersion: '0.9.0',
    pid: 4242,
  };
  const result = await runOperatorConnect({
    slug: 'cynap',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    pluginVersion: '0.9.0',
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
    { ok: true, status: 'ready', org: 'cynap', env: 'prod', pluginVersion: '0.9.0' },
    {
      ok: true,
      status: 'ready',
      org: 'cynap',
      env: 'prod',
      pluginVersion: '0.9.0',
      authMode: 'device',
    },
  ]) {
    await assert.rejects(
      () =>
        runOperatorConnect({
          slug: 'cynap',
          proxyPath: '/plugin/bin/operator-proxy.mjs',
          pluginVersion: '0.9.0',
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
      /PKCE proxy|plugin version/
    );
  }
});

test('a conflicting local proxy is refused instead of crossing org identity', async () => {
  await assert.rejects(
    () =>
      runOperatorConnect({
        slug: 'cynap',
        proxyPath: '/plugin/bin/operator-proxy.mjs',
        pluginVersion: '0.9.0',
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
