// Connecting to ANY org the operator holds a grant on — not just cynap-e2e.
//
// The offline plugin used to hard-refuse every slug outside KNOWN_ORG_IDS, which
// made a real-customer connect impossible. It never needed to: an interactive
// (PKCE) or device login returns the org id INSIDE the issued credential — the
// server resolves it from the operator's own grant and freezes it into the token
// — and the proxy adopts that post-login. So the client only needs the org id
// for the headless e2e cookie leg, which has no consent step.
//
// The alternative (adding customer org ids to KNOWN_ORG_IDS) would put
// per-customer data in platform tooling for no functional gain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planConnect,
  buildProxyArgv,
  decideProxyAction,
  resolveAuthMode,
  CYNAP_E2E_SLUG,
} from '../lib/connect.mjs';

const stubs = {
  materialize: ({ mcpJson }) => ({ dir: '/tmp/x', mcpJsonPath: '/tmp/x/.mcp.json', mcpJson }),
  writeLaunch: ({ dir }) => ({ launchRecordPath: `${dir}/proxy-launch.json` }),
  probeHealth: async () => null,
};

// ---------------------------------------------------------------------------
// planConnect — any org, credential-resolved
// ---------------------------------------------------------------------------

test('planConnect accepts an org outside KNOWN_ORG_IDS in interactive mode', async () => {
  const plan = await planConnect({
    slug: 'acme-clinic-uk',
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    env: 'prod',
    ...stubs,
  });
  assert.equal(plan.slug, 'acme-clinic-uk');
  assert.equal(plan.authMode, 'interactive', 'a non-e2e org must take the PKCE consent path');
  assert.equal(plan.orgId, null, 'org id is unknown client-side — the credential carries it');
});

test('planConnect STILL refuses an unknown slug for the headless e2e leg', async () => {
  // That leg has no consent step, so there is nothing to resolve the org from —
  // guessing would be worse than refusing.
  await assert.rejects(
    planConnect({
      slug: 'acme-clinic-uk',
      proxyPath: '/plugin/bin/operator-proxy.mjs',
      authMode: 'e2e',
      ...stubs,
    }),
    /headless e2e mode/
  );
});

test('cynap-e2e on staging is unchanged — still headless with a known org id', async () => {
  const plan = await planConnect({
    slug: CYNAP_E2E_SLUG,
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    env: 'staging',
    ...stubs,
  });
  assert.equal(plan.authMode, 'e2e');
  assert.ok(plan.orgId, 'the e2e leg still resolves its org id offline');
});

test('prod always takes the consent path — the cookie leg can never widen to prod', () => {
  assert.equal(resolveAuthMode(CYNAP_E2E_SLUG, 'prod'), 'interactive');
  assert.equal(resolveAuthMode('acme-clinic-uk', 'prod'), 'interactive');
});

test('each org gets its own stable port (no cross-org collision on the loopback)', async () => {
  const a = await planConnect({ slug: 'acme-clinic-uk', proxyPath: '/p', env: 'prod', ...stubs });
  const b = await planConnect({ slug: CYNAP_E2E_SLUG, proxyPath: '/p', env: 'staging', ...stubs });
  assert.notEqual(a.port, b.port);
});

// ---------------------------------------------------------------------------
// buildProxyArgv — --allow-org becomes optional
// ---------------------------------------------------------------------------

test('argv omits --allow-org when the org will come from the credential', () => {
  const argv = buildProxyArgv({
    proxyPath: '/p/operator-proxy.mjs',
    orgId: null,
    port: 39846,
    env: 'prod',
    slug: 'acme-clinic-uk',
    authMode: 'interactive',
  });
  assert.ok(!argv.includes('--allow-org'), 'must not pin an org the client cannot know');
  assert.ok(argv.includes('--prod'), 'prod env must reach the proxy');
  assert.deepEqual(argv.slice(-2), ['--org-slug', 'acme-clinic-uk']);
});

test('argv still REQUIRES an org id for the e2e leg', () => {
  assert.throws(
    () => buildProxyArgv({ proxyPath: '/p', orgId: null, port: 39846, authMode: 'e2e' }),
    /orgId is required for the e2e auth mode/
  );
});

test('argv still pins --allow-org when the org IS known', () => {
  const argv = buildProxyArgv({
    proxyPath: '/p',
    orgId: 'org-123',
    port: 39468,
    env: 'staging',
    slug: CYNAP_E2E_SLUG,
    authMode: 'e2e',
  });
  assert.ok(argv.includes('--allow-org'));
  assert.ok(argv.includes('org-123'));
});

// ---------------------------------------------------------------------------
// reuse/conflict with an unknown org id — fall back to the slug
// ---------------------------------------------------------------------------

test('a healthy proxy for the SAME slug is reused even when orgId is unknown', () => {
  const d = decideProxyAction({ health: { ok: true, org: 'acme-clinic-uk' }, orgId: null, slug: 'acme-clinic-uk' });
  assert.equal(d.action, 'reuse');
});

test('a proxy serving a DIFFERENT slug still conflicts when orgId is unknown', () => {
  // Without the slug fallback this would silently "reuse" another tenant's proxy
  // simply because the client could not name its own org id yet.
  const d = decideProxyAction({ health: { ok: true, org: 'cynap-e2e' }, orgId: null, slug: 'acme-clinic-uk' });
  assert.equal(d.action, 'conflict');
  assert.match(d.reason, /cynap-e2e/);
});

// ---------------------------------------------------------------------------
// Review findings (cubic, PR #2148) — each of these was a real defect that this
// PR introduced by widening connect beyond cynap-e2e.
// ---------------------------------------------------------------------------

test('a prod connect REFUSES to reuse the same org\'s staging proxy on the shared port', async () => {
  const { decideProxyAction } = await import('../lib/connect.mjs');
  // The port is derived from the slug alone, so staging and prod collide on it.
  // Reusing across planes would hand an operator who asked for prod a staging
  // proxy — silently authoring against the wrong reality.
  const d = decideProxyAction({
    health: { ok: true, org: 'cynap-e2e', orgId: 'cynap-e2e-test-org-00000000', env: 'staging' },
    orgId: 'cynap-e2e-test-org-00000000',
    slug: 'cynap-e2e',
    env: 'prod',
  });
  assert.equal(d.action, 'conflict');
  assert.match(d.reason, /staging/);
});

test('same org AND same env still reuses', async () => {
  const { decideProxyAction } = await import('../lib/connect.mjs');
  const d = decideProxyAction({
    health: { ok: true, org: 'acme-clinic-uk', env: 'prod' },
    orgId: null,
    slug: 'acme-clinic-uk',
    env: 'prod',
  });
  assert.equal(d.action, 'reuse');
});

test('planConnect refuses a path-traversal slug BEFORE touching the filesystem', async () => {
  // Widening beyond KNOWN_ORG_IDS made the slug reachable as a path segment
  // under ~/CynapOperator; `../../tmp` would materialize outside that root.
  let materialized = false;
  await assert.rejects(
    planConnect({
      slug: '../../tmp',
      proxyPath: '/p',
      materialize: () => {
        materialized = true;
        return { dir: '/tmp/x', mcpJsonPath: '/tmp/x/.mcp.json' };
      },
      writeLaunch: () => ({ launchRecordPath: '/tmp/x' }),
      probeHealth: async () => null,
    }),
    /invalid org slug/
  );
  assert.equal(materialized, false, 'must reject before any filesystem write');
});

test('slug validation rejects separators/absolute paths but accepts real org slugs', async () => {
  const { isValidOrgSlug } = await import('../lib/connect.mjs');
  for (const bad of ['../../tmp', 'a/b', '/etc/passwd', 'a\\b', '..', '.', 'UPPER', 'has space', '']) {
    assert.equal(isValidOrgSlug(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
  for (const good of ['cynap-e2e', 'acme-clinic-uk', 'brightleaf', 'cynap-zero']) {
    assert.equal(isValidOrgSlug(good), true, `${good} must be accepted`);
  }
});
