#!/usr/bin/env node
// CYN-785 (CYN-768 P0) — testable mechanics behind /cynap-connect <org>.
//
// This module is PURE/functional wherever possible (no network, no process
// spawn) so it unit-tests deterministically. The `/cynap-connect` slash
// command (commands/cynap-connect.md) is the thin orchestration layer that
// calls into this module, materializes the working dir, writes the
// project-scoped .mcp.json, and launches the proxy process.
//
// Login is MODE-keyed (CYN-901), not env-keyed: the bundled proxy's default is
// PKCE-loopback (opens a browser, yields a CLI-scoped `octk_…` credential —
// see tooling/operator/operator-proxy.mjs pkceLoopbackLogin), `--device` is the
// RFC-8628 headless fallback, and `--e2e` is the staging-only cynap-e2e
// e2e-session cookie leg (headless test harness). resolveAuthMode() picks the
// mode: cynap-e2e on staging stays headless (`--e2e`, the pre-CYN-901
// behavior); everything else is interactive PKCE. The old CYNAP_OPERATOR_COOKIE
// manual-cookie stopgap is DELETED (the proxy no longer reads it).
//
// Server-side org enforcement (the authoritative boundary) is ALREADY SHIPPED:
// [internal reference omitted from public mirror] re-resolves org access
// against the caller's credential/session on every mint, and freezes the
// DB-returned orgId into the token. This module's org-pin is defense-in-depth
// only, mirroring the proxy's own --allow-org client-side refusal.

import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_TARGET_ORG_ID, HEALTH_PATH } from '../bin/operator-proxy.mjs';

// Base dir for operator working dirs. VISIBLE (not a dotfile) so a Desktop
// operator can open a Claude Code session in it via Finder / the folder-picker.
// MUST stay in lockstep with operator-proxy.mjs OPERATOR_WORKDIR_BASE (the two
// files can't share an import across the build-copy byte-parity boundary).
const OPERATOR_WORKDIR_BASE = 'CynapOperator';

/** The org the proxy's staging `--e2e` cookie leg authenticates for
 * (tooling/operator/operator-proxy.mjs DEFAULT_ORG_SLUG / DEFAULT_TARGET_ORG_ID).
 * CYNAP_E2E_ORG_ID is imported from the packaged proxy — NOT re-declared as an
 * independent literal — so a change to the proxy's default org id can never
 * silently diverge from this module's org-id map (the structural-blindness
 * class this repo's [internal reference omitted from public mirror] calls out: two disagreeing string literals with
 * no cross-parity assertion). */
export const CYNAP_E2E_SLUG = 'cynap-e2e';
export const CYNAP_E2E_ORG_ID = DEFAULT_TARGET_ORG_ID;

/** Known slug -> org id map, used ONLY for the headless e2e leg's client-side
 * --allow-org pin. The AUTHORITATIVE org resolution is server-side: the CYN-901
 * PKCE/device login returns the org id the credential was frozen to, and the
 * proxy pins itself to that (superseding this map).
 *
 * This map deliberately stays a single entry. An interactive/device connect to
 * ANY other org needs no entry here — it logs in first and adopts the org from
 * the credential — so adding customer orgs would be per-customer data in
 * platform tooling for no functional gain (ADR-0036: the platform is a generic
 * engine). Only the e2e cookie leg, which has no consent step to resolve an
 * org, still requires a mapping. */
const KNOWN_ORG_IDS = {
  [CYNAP_E2E_SLUG]: CYNAP_E2E_ORG_ID,
};

/**
 * Canonical slug normalization — trim only. EVERY slug consumer (resolveOrgId,
 * resolveAuthMode, resolveWorkingDir) routes through this so they can
 * never disagree on whether e.g. "cynap-e2e " is the e2e org (the trim-vs-raw
 * inconsistency class). Returns '' for a non-string/blank input.
 */
export function normalizeSlug(slug) {
  return typeof slug === 'string' ? slug.trim() : '';
}

/**
 * The accepted org-slug shape: lowercase alphanumerics in hyphen-separated
 * segments (cynap-e2e, acme-clinic-uk, brightleaf).
 *
 * This became load-bearing the moment planConnect stopped refusing every slug
 * outside KNOWN_ORG_IDS. Before that, an unknown slug could never reach
 * resolveWorkingDir; now any string can, and that path does
 * `join(homedir(), OPERATOR_WORKDIR_BASE, slug)` — so a slug of `../../tmp` would
 * materialize a working dir OUTSIDE ~/CynapOperator and write a .mcp.json
 * there. Validating the shape closes that traversal, and rejects the wider
 * class (path separators, NUL, absolute paths) rather than blocklisting `..`.
 */
export const ORG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ORG_SLUG_MAX_LENGTH = 100;

/** True when `slug` is a well-formed org slug safe to use as a path segment. */
export function isValidOrgSlug(slug) {
  const s = normalizeSlug(slug);
  return s.length > 0 && s.length <= ORG_SLUG_MAX_LENGTH && ORG_SLUG_RE.test(s);
}

/**
 * Resolves an org slug to its org id for v1. Returns null if the slug isn't
 * in the known map (general-org resolution needs a live portal API call,
 * which this offline module deliberately does not perform).
 */
export function resolveOrgId(slug) {
  const s = normalizeSlug(slug);
  if (s.length === 0) return null;
  return KNOWN_ORG_IDS[s] ?? null;
}

/**
 * CYN-901 — pick the proxy login mode for a (slug, env) pair:
 *   - cynap-e2e on staging → 'e2e' (the headless e2e-session cookie leg — keeps
 *     the agent-driven dogfood flow browser-free, matching pre-CYN-901 behavior).
 *   - everything else → 'interactive' (PKCE loopback; the proxy's default).
 *
 * `env` defaults to PROD: real operator work targets real customer orgs, which
 * live on prod, so the common case must not require a flag and staging is opted
 * into explicitly. A consequence worth knowing: omitting env for cynap-e2e now
 * yields 'interactive', because the cookie leg is staging-only by construction.
 * The staging-only constraint is also enforced by the proxy itself (`--e2e`
 * refuses `--prod`), so this helper can never widen the cookie leg.
 * Normalized so a trailing-space slug that resolveOrgId() accepts is treated
 * identically here.
 */
export function resolveAuthMode(slug, env = 'prod') {
  return normalizeSlug(slug) === CYNAP_E2E_SLUG && env === 'staging' ? 'e2e' : 'interactive';
}

/**
 * Picks a free ephemeral TCP port by binding to port 0 and reading back the
 * OS-assigned port, then releasing it immediately. Used so N concurrent
 * `/cynap-connect` working dirs each get their own proxy port instead of all
 * colliding on the fixed 8790 default (the spec: "two dirs = two proxies on
 * two ports").
 */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * The window stable per-org ports are drawn from. Deliberately BELOW the macOS
 * ephemeral range (49152-65535) so a slug-derived port can never collide with a
 * port the OS hands out to some unrelated process, and high enough to need no
 * privileges. 1000 slots is far more than the number of orgs one operator runs.
 */
export const STABLE_PORT_BASE = 39000;
export const STABLE_PORT_SLOTS = 1000;

/**
 * Deterministic loopback port for an org slug.
 *
 * Replaces the ephemeral `pickFreePort()` allocation for the connect path. A
 * fresh random port per connect was the source of two real failures: the
 * written `.mcp.json` and the actually-running proxy drift apart the moment
 * either side is restarted (leaving `.mcp.json` pointing at a dead port), and
 * every re-connect orphans the previous proxy on its old port (we found one
 * still listening two days later). With a slug-derived port, `.mcp.json` is a
 * pure function of the org, re-connecting is idempotent, and "is my proxy up?"
 * is answerable without reading any state file.
 *
 * `pickFreePort` is retained for callers that genuinely want an arbitrary free
 * port (tests, ad-hoc multi-instance runs) — it is no longer the connect path.
 */
export function stablePortForSlug(slug) {
  const s = normalizeSlug(slug);
  if (s.length === 0) {
    throw new Error('stablePortForSlug: slug is required');
  }
  const digest = createHash('sha256').update(s).digest();
  // 32-bit unsigned read keeps this stable across platforms/Node versions.
  return STABLE_PORT_BASE + (digest.readUInt32BE(0) % STABLE_PORT_SLOTS);
}

/**
 * Probes `GET http://127.0.0.1:<port>/health`. Resolves to the parsed health
 * body, or null when nothing healthy is listening (connection refused, non-200,
 * unparseable body, or timeout). Never throws and never rejects — a probe
 * failure IS the answer ("no proxy there"), not an error condition.
 *
 * `fetchImpl` is injectable so the reuse/launch decision unit-tests without a
 * live socket.
 */
export async function probeProxyHealth({ port, timeoutMs = 1500, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(port) || port <= 0) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}${HEALTH_PATH}`, { signal });
    if (!res || res.ok !== true) return null;
    const body = await res.json();
    return body &&
      (body.ok === true || body.status === 'authorizing' || body.status === 'disconnecting')
      ? body
      : null;
  } catch {
    return null;
  }
}

/**
 * Pure decision: given the health probe result for an org's stable port, should
 * the caller reuse the running proxy, launch a new one, or refuse?
 *
 * - no health           → 'launch'  (nothing there; start one)
 * - health, same org    → 'reuse'   (idempotent re-connect; do NOT spawn a twin)
 * - health, other org   → 'conflict' (another org squatting this port — refuse
 *                          loudly rather than silently proxying the wrong org,
 *                          which would be a cross-tenant footgun)
 */
export function decideProxyAction({ health, orgId, slug, env }) {
  if (!health) return { action: 'launch', reason: 'no healthy proxy on the stable port' };
  // The port is derived from the SLUG alone, so the same org's staging and prod
  // proxies collide on it. Reusing across environments would silently serve a
  // staging proxy to an operator who asked for prod — the precise "authoring
  // against the wrong reality" failure that motivated defaulting to prod. The
  // env is right there in /health; refuse rather than ignore the mismatch.
  if (health.env && env && health.env !== env) {
    return {
      action: 'conflict',
      reason: `port already serving the ${health.env} plane, not ${env}`,
    };
  }
  if (health.orgId && orgId && health.orgId !== orgId) {
    return {
      action: 'conflict',
      reason: `port already serving org ${health.orgId}, not ${orgId}`,
    };
  }
  // orgId is unknown before an interactive/device login (the credential carries
  // it). Fall back to the SLUG, which the proxy reports on /health and which is
  // what derived this port in the first place — so a mismatch here still means
  // another org is squatting the port, and must not be silently reused.
  if (!orgId && slug && health.org && health.org !== slug) {
    return {
      action: 'conflict',
      reason: `port already serving org "${health.org}", not "${slug}"`,
    };
  }
  if (health.status === 'authorizing') {
    return {
      action: 'wait',
      reason: `operator PKCE authorization already starting for ${health.org ?? slug}`,
    };
  }
  if (health.status === 'disconnecting') {
    return {
      action: 'conflict',
      reason: `operator connector already disconnecting for ${health.org ?? slug}; retry shortly`,
    };
  }
  return { action: 'reuse', reason: `healthy proxy already serving ${health.org ?? health.orgId ?? 'this org'}` };
}

/** Base directory under which every per-org working directory is
 * materialized: `~/CynapOperator/<slug>/`. Fixed (not cwd-relative) so
 * "one directory = one org" is a stable, self-contained location regardless
 * of where the operator happened to invoke `/cynap-connect` from, and so a
 * later rollback (spec §10) has a deterministic target to find/delete. */
export function resolveWorkingDir(slug) {
  const s = normalizeSlug(slug);
  if (s.length === 0) {
    throw new Error('resolveWorkingDir: slug is required');
  }
  return join(homedir(), OPERATOR_WORKDIR_BASE, s);
}

/**
 * Materializes the per-org working directory (creating it if absent) and
 * writes `mcpJson` to `<dir>/.mcp.json`. The ONLY side-effecting step in this
 * module — everything else is pure. Returns the dir and file paths written.
 */
export function materializeWorkingDir({ slug, mcpJson }) {
  const dir = resolveWorkingDir(slug);
  mkdirSync(dir, { recursive: true });
  const mcpJsonPath = join(dir, '.mcp.json');
  writeFileSync(mcpJsonPath, `${JSON.stringify(mcpJson, null, 2)}\n`);
  return { dir, mcpJsonPath };
}

/**
 * Records how to (re)start this working dir's proxy, so the SessionStart
 * self-heal hook can revive a dead one WITHOUT having to infer the org, env or
 * auth mode — inferring any of those would risk minting against the wrong
 * tenant, so the hook refuses to act unless this record exists.
 *
 * Carries no secret: an argv + a shell command line, exactly what `ps` would
 * already show for the running proxy.
 */
export function writeLaunchRecord({ dir, slug, orgId, env, authMode, port, proxyArgv, launchCommand }) {
  if (!dir) throw new Error('writeLaunchRecord: dir is required');
  const path = join(dir, 'proxy-launch.json');
  const record = { slug, orgId, env, authMode, port, proxyArgv, launchCommand };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return { launchRecordPath: path, record };
}

/**
 * Builds the project-scoped .mcp.json content for a per-org working dir.
 * Points at the loopback proxy on `port` — carries NO secret, NO token, NO
 * cookie. The proxy injects the Bearer server-side; this file never does.
 *
 * CYN-801: `headers.X-Cynap-CC-Session` carries `${CLAUDE_SESSION_ID}` — a
 * `.mcp.json` header IS `${VAR}`-expanded (see the top-of-file "Why the proxy,
 * not a templated Authorization header" note: expansion happens once, at
 * config-parse/connect time). Unlike a Bearer token this is fine for a session
 * id: it only needs to stay CONSTANT for one session's lifetime, and Claude
 * Code re-parses `.mcp.json` at each new session's connect, so a new session
 * gets its own correct id even though the file bytes never change. This is
 * NOT a secret — it is the marker key the proxy uses to gate the session-trail
 * upload (§2.2).
 */
export function buildProjectMcpJson({ port, serverName = 'cynap-operator' }) {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`buildProjectMcpJson: invalid port ${port}`);
  }
  return {
    mcpServers: {
      [serverName]: {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          'X-Cynap-CC-Session': '${CLAUDE_SESSION_ID}',
        },
      },
    },
  };
}

/**
 * Builds the argv for launching the org-pinned proxy process:
 *   node <proxyPath> --allow-org <orgId> --port <port> [--staging|--prod]
 *        [--e2e|--device] [--org-slug <slug>]
 * `--allow-org` sets BOTH allowedOrgId and targetOrgId on the proxy CLI (see
 * tooling/operator/operator-proxy.mjs parseArgs) — this is the client-side
 * pin; the server-side check in operator-token/route.ts is authoritative.
 * `authMode` (CYN-901) selects the login leg: 'e2e' / 'device' append the
 * matching flag; 'interactive' (PKCE loopback) is the proxy's default and
 * appends nothing. `--org-slug` (CYN-801) is the session-trail marker
 * directory key — passed explicitly whenever the caller supplies `slug`, so
 * the proxy's marker store never silently falls back to its DEFAULT_ORG_SLUG
 * default for a caller that meant a different (v1: still cynap-e2e-only) org.
 */
export function buildProxyArgv({ proxyPath, orgId, port, env = 'prod', slug, authMode }) {
  if (!proxyPath) throw new Error('buildProxyArgv: proxyPath is required');
  // orgId is REQUIRED for the e2e leg (no consent step can supply it) but
  // OPTIONAL otherwise: an interactive/device login returns the org inside the
  // credential and the proxy pins itself to that, so omitting --allow-org is
  // the correct shape for an org whose id only the server can state. The proxy
  // fails closed if that login yields no org and no explicit pin was given.
  if (!orgId && authMode === 'e2e') {
    throw new Error('buildProxyArgv: orgId is required for the e2e auth mode');
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`buildProxyArgv: invalid port ${port}`);
  }
  const envFlag = env === 'prod' ? '--prod' : '--staging';
  const argv = [proxyPath, ...(orgId ? ['--allow-org', orgId] : []), '--port', String(port), envFlag];
  if (authMode === 'e2e') {
    argv.push('--e2e');
  } else if (authMode === 'device') {
    argv.push('--device');
  }
  if (slug) {
    argv.push('--org-slug', slug);
  }
  return argv;
}

/**
 * Top-level plan builder: resolves everything /cynap-connect needs, INCLUDING
 * materializing the per-org working directory + writing its .mcp.json (the
 * one deliberate I/O step — see materializeWorkingDir). The slash command
 * body is responsible only for launching the proxy process + /reload-plugins.
 */
/**
 * The shell command that starts the proxy DETACHED from the calling session.
 *
 * This is the fix for the defect that made `/cynap-connect` feel broken: the
 * command used to prescribe a bare `node …`, so the proxy was a child of the
 * session that ran connect — and that is, by construction, NOT the session that
 * uses it (you have to `cd` to the working dir and start a new one). The proxy
 * therefore died at the handoff, leaving a valid-looking `.mcp.json` pointing at
 * a dead port. `nohup … &` + `disown` severs it from the caller's process group
 * so it survives; stdout/stderr land in the working dir's proxy.log (NOT a
 * scratch dir) so `/cynap-status` and the operator can actually find them.
 */
export function buildDetachedLaunchCommand({ proxyArgv, workingDir }) {
  if (!Array.isArray(proxyArgv) || proxyArgv.length === 0) {
    throw new Error('buildDetachedLaunchCommand: proxyArgv is required');
  }
  if (!workingDir) {
    throw new Error('buildDetachedLaunchCommand: workingDir is required');
  }
  const quoted = proxyArgv.map((a) => (/[^A-Za-z0-9_@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a));
  const log = join(workingDir, 'proxy.log');
  const pid = join(workingDir, 'proxy.pid');
  return `nohup node ${quoted.join(' ')} >> '${log}' 2>&1 & echo $! > '${pid}'; disown`;
}

export async function planConnect({
  slug: rawSlug,
  proxyPath,
  env = 'prod',
  authMode: requestedAuthMode,
  pickPort = pickFreePort,
  materialize = materializeWorkingDir,
  // Injectable for the same reason `materialize` is: this module keeps its I/O
  // behind swappable seams so planConnect unit-tests without touching a disk.
  writeLaunch = writeLaunchRecord,
  probeHealth = probeProxyHealth,
}) {
  // Normalize ONCE up front; every helper below (and the returned slug) uses
  // this value so nothing can disagree on the canonical slug.
  const slug = normalizeSlug(rawSlug);
  // Validate BEFORE anything touches the filesystem. The slug becomes a path
  // segment under ~/CynapOperator, and now that arbitrary slugs are accepted
  // (they used to be rejected unless present in KNOWN_ORG_IDS) an unvalidated
  // value like `../../tmp` would materialize a working dir outside that root.
  if (!isValidOrgSlug(slug)) {
    throw new Error(
      `planConnect: invalid org slug ${JSON.stringify(rawSlug)} — expected lowercase ` +
        `alphanumeric segments separated by hyphens (e.g. "acme-clinic-uk"). ` +
        `The slug is used as a filesystem path segment, so path separators and traversal are refused.`
    );
  }
  const authMode = requestedAuthMode ?? resolveAuthMode(slug, env);
  const orgId = resolveOrgId(slug);

  // The e2e cookie leg has no consent step that could tell us the org, so it
  // still needs the offline map. Every other mode (interactive PKCE / device)
  // logs in FIRST and receives the org id inside the issued credential — the
  // server resolves it from the operator's own grant and freezes it into the
  // token, and the proxy adopts it post-login. So an unknown slug is NOT an
  // error there: it is simply an org whose id only the server is entitled to
  // state. This is what lets /cynap-connect reach ANY org the operator holds a
  // grant on without shipping a per-customer org map in platform tooling
  // (ADR-0036: the platform stays a generic engine, no per-customer code).
  if (!orgId && authMode === 'e2e') {
    throw new Error(
      `planConnect: unknown org slug "${rawSlug}" for the headless e2e mode — that leg has no ` +
        `consent step to resolve an org, so it supports only "${CYNAP_E2E_SLUG}". Use the ` +
        `interactive (PKCE) or device mode for other orgs; the credential carries the org.`
    );
  }
  // Stable, slug-derived port — NOT an ephemeral one. See stablePortForSlug for
  // why: it makes .mcp.json a pure function of the org, so re-connecting is
  // idempotent and config can never drift from the running proxy.
  const port = stablePortForSlug(slug);
  const mcpJson = buildProjectMcpJson({ port });
  const { dir, mcpJsonPath } = materialize({ slug, mcpJson });
  const proxyArgv = buildProxyArgv({ proxyPath, orgId, port, env, slug, authMode });

  const launchCommand = buildDetachedLaunchCommand({ proxyArgv, workingDir: dir });

  // Decide BEFORE touching the launch record. Is one already up for this org?
  const health = await probeHealth({ port });
  const { action, reason } = decideProxyAction({ health, orgId, slug, env });

  // Record how to revive this proxy — but ONLY when we are actually about to
  // launch one. On `reuse` the existing record already describes the process
  // that is running, and overwriting it with THIS call's argv would corrupt it
  // (a caller passing a different proxyPath would leave the self-heal hook
  // pointing at a binary that never launched the live proxy). On `conflict` we
  // are refusing outright, so writing anything would be a lie.
  const launchRecordPath =
    action === 'launch'
      ? writeLaunch({ dir, slug, orgId, env, authMode, port, proxyArgv, launchCommand }).launchRecordPath
      : join(dir, 'proxy-launch.json');

  return {
    launchRecordPath,
    slug,
    orgId,
    port,
    env,
    authMode,
    mcpJson,
    workingDir: dir,
    mcpJsonPath,
    proxyArgv,
    // What the slash command should actually DO: 'reuse' (skip the launch),
    // 'wait' (another managed PKCE launch owns this slug), 'launch' (start it),
    // or 'conflict' (refuse + tell the operator).
    action,
    actionReason: reason,
    health,
    launchCommand,
  };
}
