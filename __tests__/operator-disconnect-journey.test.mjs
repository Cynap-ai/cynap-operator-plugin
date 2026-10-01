import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { requestProxyDisconnect, runOperatorDisconnect } from '../lib/operator-disconnect.mjs';
import { parseDisconnectArgs, resolveDisconnectSlug } from '../bin/cynap-disconnect.mjs';
import { writeStateAtomic } from '../lib/workspace-sync.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

test('bare disconnect resolves the current workspace state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyn-disconnect-'));
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: null, files: {} });
    assert.deepEqual(parseDisconnectArgs([]), { slug: null });
    assert.equal(await resolveDisconnectSlug({ cwd: dir }), 'cynap-e2e');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
      return {
        stopped: true,
        credentialIssued: true,
        credentialRevoked: true,
        revocationWitness: { logoutOk: true, mintStatus: 401 },
      };
    },
    waitUntilDown: async () => true,
  });

  assert.deepEqual(requests, [{ slug: 'cynap' }]);
  // The proxy's revocation witness (a refused mint) reaches the caller intact: the
  // release journey's leg 3 reads it from here.
  assert.deepEqual(result, {
    status: 'disconnected',
    slug: 'cynap',
    credentialIssued: true,
    credentialRevoked: true,
    revocationWitness: { logoutOk: true, mintStatus: 401 },
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

test('a missing local control nonce names its file and tells the operator how to restore it', async () => {
  await assert.rejects(
    () => requestProxyDisconnect({ slug: 'cynap', controlPath: '/tmp/cynap/.operator-control' }),
    /\/tmp\/cynap\/\.operator-control.*restore the control file/i
  );
});
