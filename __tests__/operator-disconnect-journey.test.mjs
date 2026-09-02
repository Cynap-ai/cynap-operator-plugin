import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOperatorDisconnect } from '../lib/operator-disconnect.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test('/cynap-disconnect delegates to the managed lifecycle seam', () => {
  const command = readFileSync(join(TEST_DIR, '..', 'commands', 'cynap-disconnect.md'), 'utf8');
  assert.match(
    command,
    /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/cynap-disconnect\.mjs" \$ARGUMENTS/
  );
});

test('disconnect verifies tenant identity before signalling the proxy', async () => {
  const requests = [];
  const result = await runOperatorDisconnect({
    slug: 'cynap',
    inspect: async () => ({
      ok: true,
      status: 'ready',
      org: 'cynap',
      env: 'prod',
      pid: 4242,
    }),
    requestDisconnect: async (input) => {
      requests.push(input);
      return { stopped: true, credentialIssued: true, credentialRevoked: true };
    },
    waitUntilDown: async () => true,
  });

  assert.deepEqual(requests, [{ slug: 'cynap' }]);
  assert.deepEqual(result, {
    status: 'disconnected',
    slug: 'cynap',
    credentialIssued: true,
    credentialRevoked: true,
  });
});

test('disconnect refuses a mismatched tenant and is idempotent when already down', async () => {
  await assert.rejects(
    () =>
      runOperatorDisconnect({
        slug: 'cynap',
        inspect: async () => ({ ok: true, org: 'other-org', env: 'prod', pid: 4242 }),
      }),
    /identity mismatch/
  );

  const result = await runOperatorDisconnect({
    slug: 'cynap',
    inspect: async () => null,
    hasStartupReceipt: () => false,
    requestDisconnect: () => assert.fail('must not request disconnect'),
  });
  assert.deepEqual(result, { status: 'already_disconnected', slug: 'cynap' });
});

test('disconnect waits for an authorizing proxy and never equates a startup receipt with down', async () => {
  let probes = 0;
  const result = await runOperatorDisconnect({
    slug: 'cynap',
    inspect: async () => {
      probes += 1;
      return probes === 1
        ? null
        : { ok: false, status: 'authorizing', org: 'cynap', env: 'prod', pid: 4242 };
    },
    hasStartupReceipt: () => true,
    waitForLifecycle: async ({ inspect }) => inspect('cynap'),
    requestDisconnect: async () => ({
      stopped: true,
      credentialIssued: false,
      credentialRevoked: true,
    }),
    waitUntilDown: async () => true,
  });

  assert.equal(result.status, 'disconnected');
  assert.equal(result.credentialIssued, false);
  assert.equal(result.credentialRevoked, true);
});

test('disconnect preserves an unconfirmed revocation outcome', async () => {
  const result = await runOperatorDisconnect({
    slug: 'cynap',
    inspect: async () => ({ ok: true, status: 'ready', org: 'cynap', env: 'prod', pid: 4242 }),
    requestDisconnect: async () => ({
      stopped: true,
      credentialIssued: true,
      credentialRevoked: false,
    }),
    waitUntilDown: async () => true,
  });
  assert.equal(result.credentialRevoked, false);
});
