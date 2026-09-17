import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOperatorConnect } from '../lib/operator-connect.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function lowerVersionPlan() {
  return {
    slug: 'acme', env: 'prod', authMode: 'interactive', action: 'reuse', port: 39123,
    workingDir: '/tmp/CynapOperator/acme', mcpJsonPath: '/tmp/CynapOperator/acme/.mcp.json',
    proxyArgv: ['/plugin/bin/operator-proxy-launcher.mjs', '--port', '39123', '--prod', '--org-slug', 'acme'],
    health: { ok: true, status: 'ready', org: 'acme', env: 'prod', authMode: 'interactive', pluginVersion: '0.14.0' },
  };
}

test('a lower same-org proxy is launched over only after its credential revoke is proven', async () => {
  const events = [];
  const result = await runOperatorConnect({
    slug: 'acme', proxyPath: '/plugin/bin/operator-proxy-launcher.mjs', pluginVersion: '0.15.0',
    plan: async () => lowerVersionPlan(),
    disconnect: async () => { events.push('retire'); return { status: 'disconnected', credentialIssued: true, credentialRevoked: true }; },
    launch: async () => { events.push('launch'); return { pid: 55 }; },
    waitForHealth: async () => ({ ok: true, status: 'ready', org: 'acme', env: 'prod', pluginVersion: '0.15.0', pid: 55 }),
  });
  assert.deepEqual(events, ['retire', 'launch']);
  assert.deepEqual(result.replaced, { from: '0.14.0', to: '0.15.0', credentialRevoked: true });
});

test('a failed revoke never launches a replacement', async () => {
  let launched = false;
  await assert.rejects(() => runOperatorConnect({
    slug: 'acme', proxyPath: '/plugin/bin/operator-proxy-launcher.mjs', pluginVersion: '0.15.0',
    plan: async () => lowerVersionPlan(),
    disconnect: async () => ({ status: 'disconnected', credentialIssued: true, credentialRevoked: false, credExpiresAt: 'later' }),
    launch: async () => { launched = true; },
  }), /Could not revoke/);
  assert.equal(launched, false);
});

test('the retire path has no PID or signal fallback after a managed retirement failure', () => {
  const source = readFileSync(join(ROOT, 'lib', 'operator-disconnect.mjs'), 'utf8');
  assert.doesNotMatch(source, /SIGTERM|SIGKILL/);
});
