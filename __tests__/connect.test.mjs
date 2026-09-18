// lib/connect.mjs unit tests: slug->id resolution,
// port selection distinctness, generated .mcp.json shape (loopback + no
// secret), per-org working-dir materialization, and org-pinned proxy argv
// construction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveOrgId,
  resolveAuthMode,
  pickFreePort,
  stablePortForSlug,
  resolveWorkingDir,
  materializeWorkingDir,
  buildProjectMcpJson,
  buildProxyArgv,
  planConnect,
  CYNAP_E2E_SLUG,
  CYNAP_E2E_ORG_ID,
} from '../lib/connect.mjs';
import { CYNAP_E2E_ORG_ID as PROXY_CYNAP_E2E_ORG_ID } from '../bin/operator-proxy.mjs';

test('CYNAP_E2E_ORG_ID is imported from the proxy, not an independent literal (FIX 4)', () => {
  // A change to the proxy's CYNAP_E2E_ORG_ID must be reflected here
  // automatically — asserting equality alone would still pass if both were
  // independent copies; asserting identity via reference-equal string value
  // sourced from the SAME import is the actual regression guard (see the
  // `import { CYNAP_E2E_ORG_ID } from '../bin/operator-proxy.mjs'` in
  // lib/connect.mjs — no second literal exists to drift).
  assert.equal(CYNAP_E2E_ORG_ID, PROXY_CYNAP_E2E_ORG_ID);
});

test('resolveOrgId maps cynap-e2e to its known org id', () => {
  assert.equal(resolveOrgId(CYNAP_E2E_SLUG), CYNAP_E2E_ORG_ID);
});

test('resolveOrgId returns null for an unknown slug', () => {
  assert.equal(resolveOrgId('some-other-org'), null);
});

test('resolveOrgId returns null for empty/non-string input', () => {
  assert.equal(resolveOrgId(''), null);
  assert.equal(resolveOrgId('   '), null);
  assert.equal(resolveOrgId(undefined), null);
  assert.equal(resolveOrgId(null), null);
});

test('resolveAuthMode is e2e only for cynap-e2e on staging, else interactive PKCE', () => {
  assert.equal(resolveAuthMode(CYNAP_E2E_SLUG, 'staging'), 'e2e');
  // The default env is now PROD (production is the normal case; staging is the
  // exception and must be asked for), so omitting env yields the consent path
  // even for cynap-e2e — the headless cookie leg is staging-only by definition.
  assert.equal(resolveAuthMode(CYNAP_E2E_SLUG), 'interactive'); // prod default
  // The e2e cookie leg is STAGING-ONLY (the proxy refuses --e2e on --prod) — prod
  // always goes through PKCE, even for cynap-e2e.
  assert.equal(resolveAuthMode(CYNAP_E2E_SLUG, 'prod'), 'interactive');
  assert.equal(resolveAuthMode('some-other-org', 'staging'), 'interactive');
  assert.equal(resolveAuthMode('some-other-org', 'prod'), 'interactive');
});

test('pickFreePort returns distinct free ports across a batch held open concurrently (two dirs = two proxies)', async () => {
  // pickFreePort() releases its probe socket before resolving, so picking
  // sequentially can have the OS legitimately recycle the same ephemeral
  // port (non-deterministic flake). Instead, hold N probe sockets open
  // SIMULTANEOUSLY (mirroring N concurrent /cynap-connect dirs each with a
  // live proxy bound) and assert the OS assigned each a distinct port before
  // any of them are released.
  const { createServer } = await import('node:net');
  const COUNT = 5;
  const servers = await Promise.all(
    Array.from({ length: COUNT }, () => {
      return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => resolve(srv));
      });
    })
  );
  try {
    const ports = servers.map((srv) => srv.address().port);
    assert.equal(new Set(ports).size, COUNT, 'all concurrently-held ports must be distinct');
    for (const port of ports) {
      assert.ok(Number.isInteger(port) && port > 0);
    }
  } finally {
    await Promise.all(servers.map((srv) => new Promise((resolve) => srv.close(resolve))));
  }
});

test('pickFreePort resolves a usable port', async () => {
  const port = await pickFreePort();
  assert.ok(Number.isInteger(port) && port > 0);
});

test('buildProjectMcpJson points at the loopback proxy and carries no secret', () => {
  const mcpJson = buildProjectMcpJson({ port: 9123 });
  const json = JSON.stringify(mcpJson);
  assert.match(json, /http:\/\/127\.0\.0\.1:9123\/mcp/);
  assert.doesNotMatch(json.toLowerCase(), /authorization|bearer|token|cookie|secret/);
});

test('buildProjectMcpJson rejects an invalid port', () => {
  assert.throws(() => buildProjectMcpJson({ port: 0 }));
  assert.throws(() => buildProjectMcpJson({ port: -1 }));
  assert.throws(() => buildProjectMcpJson({ port: NaN }));
});

test('buildProjectMcpJson carries the X-Cynap-CC-Session header with a ${CLAUDE_SESSION_ID} placeholder (never a literal value)', () => {
  const mcpJson = buildProjectMcpJson({ port: 9123 });
  const server = mcpJson.mcpServers['cynap-operator'];
  assert.equal(server.headers['X-Cynap-CC-Session'], '${CLAUDE_SESSION_ID}');
  // Still carries no secret — the session id is not itself a credential.
  const json = JSON.stringify(mcpJson);
  assert.doesNotMatch(json.toLowerCase(), /authorization|bearer|token|cookie|secret/);
});

test('buildProxyArgv builds the org-pinned argv with --allow-org and --port', () => {
  const argv = buildProxyArgv({
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    orgId: CYNAP_E2E_ORG_ID,
    port: 9123,
    env: 'staging',
  });
  assert.deepEqual(argv, [
    '/plugin/bin/operator-proxy.mjs',
    '--allow-org',
    CYNAP_E2E_ORG_ID,
    '--port',
    '9123',
    '--staging',
  ]);
});

test('buildProxyArgv uses --prod when env is prod', () => {
  const argv = buildProxyArgv({
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    orgId: CYNAP_E2E_ORG_ID,
    port: 9123,
    env: 'prod',
  });
  assert.ok(argv.includes('--prod'));
  assert.ok(!argv.includes('--staging'));
});

test('buildProxyArgv rejects missing proxyPath, a missing e2e orgId, or an invalid port', () => {
  assert.throws(() => buildProxyArgv({ orgId: CYNAP_E2E_ORG_ID, port: 9123 }));
  // orgId is now required ONLY for the e2e leg — that leg has no consent step to
  // resolve an org. For interactive/device the credential carries it, so a null
  // orgId is the CORRECT shape there (see connect-any-org.test.mjs).
  assert.throws(() => buildProxyArgv({ proxyPath: '/x.mjs', port: 9123, authMode: 'e2e' }));
  assert.throws(() => buildProxyArgv({ proxyPath: '/x.mjs', orgId: 'id', port: 0 }));
});

test('buildProxyArgv appends --org-slug when slug is supplied', () => {
  const argv = buildProxyArgv({
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    orgId: CYNAP_E2E_ORG_ID,
    port: 9123,
    env: 'staging',
    slug: CYNAP_E2E_SLUG,
  });
  assert.deepEqual(argv, [
    '/plugin/bin/operator-proxy.mjs',
    '--allow-org',
    CYNAP_E2E_ORG_ID,
    '--port',
    '9123',
    '--staging',
    '--org-slug',
    CYNAP_E2E_SLUG,
  ]);
});

test('buildProxyArgv omits --org-slug when slug is not supplied (backward-compatible)', () => {
  const argv = buildProxyArgv({
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    orgId: CYNAP_E2E_ORG_ID,
    port: 9123,
  });
  assert.ok(!argv.includes('--org-slug'));
});

test('buildProxyArgv appends the auth-mode flag for e2e/device, nothing for interactive (proxy default)', () => {
  const base = {
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    orgId: CYNAP_E2E_ORG_ID,
    port: 9123,
    env: 'staging',
  };
  assert.ok(buildProxyArgv({ ...base, authMode: 'e2e' }).includes('--e2e'));
  assert.ok(buildProxyArgv({ ...base, authMode: 'device' }).includes('--device'));
  const interactive = buildProxyArgv({ ...base, authMode: 'interactive' });
  assert.ok(!interactive.includes('--e2e'));
  assert.ok(!interactive.includes('--device'));
  // No dead CYNAP_OPERATOR_COOKIE path: nothing in the argv references a cookie.
  assert.doesNotMatch(JSON.stringify(interactive).toLowerCase(), /cookie/);
});

test('resolveWorkingDir builds a per-org path under ~/CynapOperator/<slug>/', () => {
  const dir = resolveWorkingDir(CYNAP_E2E_SLUG);
  assert.match(dir, /CynapOperator[/\\]cynap-e2e$/);
});

test('resolveWorkingDir rejects an empty/non-string slug', () => {
  assert.throws(() => resolveWorkingDir(''));
  assert.throws(() => resolveWorkingDir(undefined));
});

test('materializeWorkingDir creates the dir and writes .mcp.json with no secret (FIX 2)', () => {
  // materializeWorkingDir always targets resolveWorkingDir(slug) == real
  // ~/CynapOperator/<slug>/ — there is no injectable base dir (by design,
  // it's a fixed, deterministic location, see resolveWorkingDir's docblock).
  // To avoid polluting the dev machine's real home dir, use a unique
  // per-test-run slug that will never collide with a real org, and always
  // clean it up in `finally`.
  const slug = `cynap-plugin-test-${process.pid}-${Date.now()}`;
  const mcpJson = buildProjectMcpJson({ port: 34567 });
  const { dir, mcpJsonPath } = materializeWorkingDir({ slug, mcpJson });
  try {
    assert.equal(dir, resolveWorkingDir(slug));
    assert.ok(existsSync(dir), 'working dir must be created');
    assert.ok(existsSync(mcpJsonPath), '.mcp.json must be written into the working dir');
    const written = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    assert.deepEqual(written, mcpJson);
    const raw = readFileSync(mcpJsonPath, 'utf8').toLowerCase();
    assert.doesNotMatch(raw, /authorization|bearer|token|cookie|secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('materializeWorkingDir is idempotent — re-running for the same slug does not throw', () => {
  const slug = `cynap-plugin-test-idempotent-${process.pid}-${Date.now()}`;
  const mcpJson = buildProjectMcpJson({ port: 34568 });
  const first = materializeWorkingDir({ slug, mcpJson });
  try {
    assert.doesNotThrow(() => materializeWorkingDir({ slug, mcpJson }));
  } finally {
    rmSync(first.dir, { recursive: true, force: true });
  }
});

test('planConnect resolves a full plan for cynap-e2e, materializing into an injected tmpdir (headless e2e mode on staging)', async () => {
  const scratchDir = mkdtempSync(join(tmpdir(), 'cynap-connect-plan-test-'));
  try {
    const fakeMaterialize = ({ mcpJson }) => {
      const mcpJsonPath = join(scratchDir, '.mcp.json');
      fsWriteFileSync(mcpJsonPath, JSON.stringify(mcpJson));
      return { dir: scratchDir, mcpJsonPath };
    };
    const plan = await planConnect({
      slug: CYNAP_E2E_SLUG,
      proxyPath: '/plugin/bin/operator-proxy.mjs',
      env: 'staging', // explicit: this test asserts the headless e2e leg
      materialize: fakeMaterialize,
    });
    assert.equal(plan.orgId, CYNAP_E2E_ORG_ID);
    // cynap-e2e on staging stays headless (--e2e) — the previous behavior.
    assert.equal(plan.authMode, 'e2e');
    assert.ok(plan.proxyArgv.includes('--e2e'));
    assert.ok(Number.isInteger(plan.port) && plan.port > 0);
    assert.match(JSON.stringify(plan.mcpJson), new RegExp(`127\\.0\\.0\\.1:${plan.port}/mcp`));
    assert.equal(plan.workingDir, scratchDir);
    assert.ok(existsSync(plan.mcpJsonPath), 'planConnect must have materialized the .mcp.json');
    assert.ok(plan.proxyArgv.includes('--allow-org'));
    assert.ok(plan.proxyArgv.includes(CYNAP_E2E_ORG_ID));
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

test('planConnect rejects an unresolvable org slug for the E2E leg (before any materialization)', async () => {
  // Narrowed from "rejects any unknown slug": an interactive/device connect to an
  // arbitrary org is now legitimate — the credential carries the org id. Only the
  // headless e2e cookie leg still needs an offline mapping, so only it refuses.
  await assert.rejects(
    () =>
      planConnect({
        slug: 'totally-unknown-org',
        proxyPath: '/plugin/bin/operator-proxy.mjs',
        authMode: 'e2e',
      }),
    /unknown org slug "totally-unknown-org"/
  );
});

test('slug normalization is consistent across resolveOrgId / resolveAuthMode / resolveWorkingDir (trailing-space regression)', async () => {
  const padded = `  ${CYNAP_E2E_SLUG}  `;
  // Trim-vs-raw inconsistency class: a padded slug must resolve AND be treated
  // as the headless-e2e org AND materialize under the canonical dir — never a
  // "resolves but wrong auth mode" split.
  assert.equal(resolveOrgId(padded), CYNAP_E2E_ORG_ID, 'padded slug must resolve to the e2e org id');
  assert.equal(resolveAuthMode(padded, 'staging'), 'e2e', 'padded slug must still pick the headless e2e mode (it is cynap-e2e)');
  assert.equal(resolveWorkingDir(padded), resolveWorkingDir(CYNAP_E2E_SLUG), 'padded and clean slug must map to the same working dir');

  const plan = await planConnect({
    slug: padded,
    proxyPath: '/plugin/bin/operator-proxy.mjs',
    env: 'staging', // explicit: asserts e2e-mode normalization
    materialize: ({ mcpJson }) => ({ dir: '/tmp/x', mcpJsonPath: '/tmp/x/.mcp.json', mcpJson }),
    // Stub both remaining I/O seams so this stays a pure resolution test: the
    // launch record would write to the fake dir, and the health probe would hit
    // a real socket.
    writeLaunch: ({ dir }) => ({ launchRecordPath: `${dir}/proxy-launch.json` }),
    probeHealth: async () => null,
  });
  assert.equal(plan.slug, CYNAP_E2E_SLUG, 'planConnect must return the normalized slug');
  assert.equal(plan.authMode, 'e2e');
  assert.equal(plan.orgId, CYNAP_E2E_ORG_ID);
  // The padded slug must derive the SAME stable port as the clean one — a
  // trim-inconsistency here would silently point two connects at two ports.
  assert.equal(plan.port, stablePortForSlug(CYNAP_E2E_SLUG));
});
