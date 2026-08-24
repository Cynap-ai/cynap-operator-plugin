// Supervised-daemon connect UX: stable per-org port, health-probe reuse, and
// the detached launch command.
//
// These three together fix the failure that made /cynap-connect feel broken:
// the proxy was launched as a CHILD of the connecting session (bare `node …`),
// but the connection is consumed by a DIFFERENT session — so the proxy died at
// the handoff and left a valid-looking .mcp.json pointing at a dead port. Each
// test below pins one leg of that fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stablePortForSlug,
  STABLE_PORT_BASE,
  STABLE_PORT_SLOTS,
  probeProxyHealth,
  decideProxyAction,
  buildDetachedLaunchCommand,
} from '../lib/connect.mjs';

// ---------------------------------------------------------------------------
// stable port
// ---------------------------------------------------------------------------

test('stablePortForSlug is deterministic — the same slug always maps to the same port', () => {
  const a = stablePortForSlug('cynap-e2e');
  const b = stablePortForSlug('cynap-e2e');
  assert.equal(a, b, 'a slug-derived port must not vary between calls');
});

test('stablePortForSlug stays inside the reserved window (below the OS ephemeral range)', () => {
  for (const slug of ['cynap-e2e', 'acme-clinic-uk', 'brightleaf', 'a', 'z'.repeat(60)]) {
    const port = stablePortForSlug(slug);
    assert.ok(
      port >= STABLE_PORT_BASE && port < STABLE_PORT_BASE + STABLE_PORT_SLOTS,
      `${slug} → ${port} outside [${STABLE_PORT_BASE}, ${STABLE_PORT_BASE + STABLE_PORT_SLOTS})`
    );
    // Must stay clear of macOS's 49152+ ephemeral range, or the OS could hand
    // this port to an unrelated process and the org would silently fail to bind.
    assert.ok(port < 49152, `${slug} → ${port} collides with the OS ephemeral range`);
  }
});

test('stablePortForSlug separates different orgs (no accidental shared port)', () => {
  assert.notEqual(stablePortForSlug('cynap-e2e'), stablePortForSlug('acme-clinic-uk'));
});

test('stablePortForSlug normalizes exactly like the rest of the module (trim only, NOT case)', () => {
  // normalizeSlug trims and nothing else. Deliberately not case-folding here:
  // KNOWN_ORG_IDS is keyed lowercase, so resolveOrgId('Cynap-E2E') returns null
  // and planConnect throws "unknown org slug" long before a port is derived.
  // Case-folding only here would make this function disagree with resolveOrgId.
  assert.equal(stablePortForSlug('  cynap-e2e  '), stablePortForSlug('cynap-e2e'));
});

test('stablePortForSlug refuses an empty slug rather than returning a shared default port', () => {
  assert.throws(() => stablePortForSlug('   '), /slug is required/);
});

// ---------------------------------------------------------------------------
// health probe — a failed probe IS the answer, never an exception
// ---------------------------------------------------------------------------

test('probeProxyHealth returns the body when a healthy proxy answers', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, org: 'cynap-e2e' }) });
  const health = await probeProxyHealth({ port: 39001, fetchImpl });
  assert.equal(health.org, 'cynap-e2e');
});

test('probeProxyHealth returns null (never throws) when the port is dead', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(await probeProxyHealth({ port: 39001, fetchImpl }), null);
});

test('probeProxyHealth returns null on a non-200 or a non-ok body', async () => {
  const notOk = async () => ({ ok: false, json: async () => ({ ok: true }) });
  assert.equal(await probeProxyHealth({ port: 39001, fetchImpl: notOk }), null);
  const bodyNotOk = async () => ({ ok: true, json: async () => ({ ok: false }) });
  assert.equal(await probeProxyHealth({ port: 39001, fetchImpl: bodyNotOk }), null);
});

// ---------------------------------------------------------------------------
// reuse / launch / conflict
// ---------------------------------------------------------------------------

test('no healthy proxy → launch', () => {
  assert.equal(decideProxyAction({ health: null, orgId: 'org-1' }).action, 'launch');
});

test('healthy proxy for the SAME org → reuse (re-connect must not spawn a twin)', () => {
  const d = decideProxyAction({ health: { ok: true, orgId: 'org-1' }, orgId: 'org-1' });
  assert.equal(d.action, 'reuse');
});

test('healthy proxy for a DIFFERENT org → conflict, never silent cross-tenant proxying', () => {
  const d = decideProxyAction({ health: { ok: true, orgId: 'other-org' }, orgId: 'org-1' });
  assert.equal(d.action, 'conflict');
  assert.match(d.reason, /other-org/);
});

// ---------------------------------------------------------------------------
// detached launch — the actual root-cause fix
// ---------------------------------------------------------------------------

test('launch command detaches the proxy so it outlives the connecting session', () => {
  const cmd = buildDetachedLaunchCommand({
    proxyArgv: ['/p/operator-proxy.mjs', '--allow-org', 'org-1', '--port', '39001'],
    workingDir: '/tmp/wd',
  });
  // nohup + background + disown are all load-bearing: without them the proxy is
  // a child of the session that ran /cynap-connect, which is never the session
  // that uses the connection.
  assert.match(cmd, /^nohup node /, 'must start detached via nohup');
  assert.match(cmd, /&/, 'must background the process');
  assert.match(cmd, /disown/, "must disown so the caller's exit doesn't reap it");
});

test('launch command logs into the WORKING DIR, not a scratch dir', () => {
  const cmd = buildDetachedLaunchCommand({
    proxyArgv: ['/p/operator-proxy.mjs', '--allow-org', 'org-1'],
    workingDir: '/tmp/wd',
  });
  assert.match(cmd, /'\/tmp\/wd\/proxy\.log'/, 'log belongs next to .mcp.json where /cynap-status looks');
  assert.match(cmd, /'\/tmp\/wd\/proxy\.pid'/, 'pid file belongs in the working dir');
});

test('launch command shell-quotes arguments containing spaces', () => {
  const cmd = buildDetachedLaunchCommand({
    proxyArgv: ['/path with space/operator-proxy.mjs', '--org-slug', 'cynap-e2e'],
    workingDir: '/tmp/wd',
  });
  assert.match(cmd, /'\/path with space\/operator-proxy\.mjs'/);
});

test('buildDetachedLaunchCommand refuses incomplete input rather than emitting a broken command', () => {
  assert.throws(() => buildDetachedLaunchCommand({ proxyArgv: [], workingDir: '/tmp/wd' }), /proxyArgv/);
  assert.throws(() => buildDetachedLaunchCommand({ proxyArgv: ['x'] }), /workingDir/);
});

// ---------------------------------------------------------------------------
// launch-record integrity (caught by a live run, not by review)
// ---------------------------------------------------------------------------

test('planConnect does NOT rewrite the launch record when reusing a running proxy', async () => {
  const { planConnect } = await import('../lib/connect.mjs');
  let wrote = false;
  await planConnect({
    slug: 'cynap-e2e',
    proxyPath: '/some/other/path/operator-proxy.mjs',
    materialize: ({ mcpJson }) => ({ dir: '/tmp/x', mcpJsonPath: '/tmp/x/.mcp.json', mcpJson }),
    writeLaunch: () => {
      wrote = true;
      return { launchRecordPath: '/tmp/x/proxy-launch.json' };
    },
    // A healthy proxy for the same org is already up ⇒ action must be 'reuse'.
    probeHealth: async () => ({ ok: true, orgId: 'cynap-e2e-test-org-00000000' }),
  });
  // Overwriting here would point the SessionStart self-heal hook at a binary
  // that never launched the live proxy — exactly what a stray reuse-call did
  // during the live smoke test.
  assert.equal(wrote, false, 'reuse must leave the existing launch record untouched');
});

test('planConnect DOES write the launch record when it is actually launching', async () => {
  const { planConnect } = await import('../lib/connect.mjs');
  let wrote = false;
  const plan = await planConnect({
    slug: 'cynap-e2e',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    materialize: ({ mcpJson }) => ({ dir: '/tmp/x', mcpJsonPath: '/tmp/x/.mcp.json', mcpJson }),
    writeLaunch: () => {
      wrote = true;
      return { launchRecordPath: '/tmp/x/proxy-launch.json' };
    },
    probeHealth: async () => null, // nothing listening
  });
  assert.equal(plan.action, 'launch');
  assert.equal(wrote, true, 'a real launch must record how to revive itself');
});
