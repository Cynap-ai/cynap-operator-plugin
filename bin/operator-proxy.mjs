#!/usr/bin/env node
// CYN-713 — operator-plane client mint-proxy.
//
// A local stdio-adjacent (actually: loopback HTTP) MCP proxy that lets an
// operator run a long session from a directory ISOLATED from this monorepo
// against the live operator MCP endpoint, whose token has a hard 900s TTL
// and NO refresh path (see [internal reference omitted from public mirror]
// gaps #3 no-refresh + #4 session-cookie mint).
//
// The proxy:
//   1. Holds ONE better-auth session cookie (minted via the headless
//      /api/auth/e2e-session route — cynap-e2e ONLY).
//   2. Mints an operator token via POST /api/auth/operator-token whenever the
//      cached token is missing or within 60s of `exp` (expires_in is 900).
//   3. Runs a tiny local HTTP MCP server (default http://127.0.0.1:8790/mcp)
//      that forwards every request to the upstream operator MCP endpoint,
//      injecting `Authorization: Bearer <fresh-token>`.
//   4. CYN-801: records which MCP endpoints an operator SESSION touched (via the
//      `X-Cynap-CC-Session` header the plugin injects) into a per-session marker
//      file — org + session id + endpoint list ONLY, NEVER the token/cookie — and
//      serves a local `POST /session-end` control endpoint that a SessionEnd hook
//      signals to mint a FRESH operator token (session-capture scope) and upload
//      the session's transcript to the backend session-trail endpoint.
//
// Zero external dependencies — Node built-ins only, per
// tooling/sandbox/run-params-json.mjs convention. Single file, build-copied
// byte-for-byte into the plugin package (scripts/build-copy-proxy.mjs) — so
// the CYN-801 marker/session-end logic below is INLINED here rather than
// split into a sibling module the copy mechanism doesn't know about.
//
// Safety: refuses any targetOrgId other than the cynap-e2e TEXT org id unless
// --allow-org <id> is passed explicitly. Cookie/token are held in memory only
// — never written to disk. The session marker (CYN-801) is the ONE exception to
// "never written to disk", and it is deliberately narrow: org + session id +
// endpoint list, never a token/cookie/credential.

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The TEXT organization.id for cynap-e2e (NOT the slug). The only compliant
 * default target — see [internal reference omitted from public mirror]
 * §Risks & rules: "Real-org exposure is one wrong ID away." */
export const DEFAULT_TARGET_ORG_ID = 'cynap-e2e-test-org-00000000';
export const DEFAULT_ORG_SLUG = 'cynap-e2e';

/** expires_in from POST /api/auth/operator-token ([internal reference omitted from public mirror]). */
export const OPERATOR_TTL_SECONDS = 15 * 60;

/** CYN-901: the fixed PUBLIC operator-CLI client id + the CLI-credential wire prefix.
 * MUST match [internal reference omitted from public mirror] */
export const OPERATOR_CLI_CLIENT_ID = 'cynap-operator-cli';
export const CLI_CREDENTIAL_PREFIX = 'octk_';

/** Re-mint this many seconds before `exp` so a request never races expiry. */
export const REMINT_SKEW_SECONDS = 60;

// ---------------------------------------------------------------------------
// CYN-766 — cold-start 504 translation + guarded single retry.
//
// The operator's first (and every post-idle) MCP call can hit a cold
// `cynap-mcp-handler` and time out at API Gateway's ~29-31s cap, surfacing as
// a bare HTTP 504. To a first-time operator that reads as "the endpoint is
// broken." The cold-init root cause (deferring the Turso open at handler
// init, CYN-769) is a separate follow-up — this is the client-side
// mitigation: translate the 504 into a clear message, and retry it exactly
// once, but ONLY for read-only/idempotent tool calls. A 504 does NOT prove
// the upstream work never ran (RFC 9110 §15.6.5), so a write/side-effecting
// call is NEVER auto-retried — it is translated without retrying.
// ---------------------------------------------------------------------------

/** The read-only operator tools (docs/operator/operator-plane-contract.md §4)
 * — safe to retry blind on a 504 because they cannot have caused a mutation.
 * Mirrors WORKSPACE_READ_TOOLS ∪ OPS_READ_TOOLS (12 members: 7 + 5) from
 * [internal reference omitted from public mirror] (kept as a literal set here —
 * this tool is intentionally zero-dep and cannot import backend TS).
 * CYN-1411 W3 U-12: `run_evidence_get` was missing — OPS_READ_TOOLS has been 5
 * members (not 4) since CYN-1078, and this list drifted from it. Harmless before W3
 * (no scope ever held both families at once, so the drift only meant one operator
 * evidence read wasn't blind-retried on a cold 504); W3's workspace:operate profile
 * makes both families reachable from the SAME session, so the omission is now live. */
export const IDEMPOTENT_TOOL_NAMES = new Set([
  'workspace_status',
  'workspace_tree',
  'workspace_get_file',
  'workspace_diff',
  'workspace_log',
  'workspace_receipts',
  'workspace_drift',
  'journal_describe',
  'journal_query',
  'runs_query',
  'journal_count',
  'run_evidence_get',
]);

/** API Gateway's integration timeout is ~29-31s; treat any 504 as the cold-start signal. */
export const GATEWAY_TIMEOUT_STATUS = 504;
/** Never retry (or begin a retry wait) if the token is within this many seconds of expiry —
 * a retry that outlives the 900s operator token is wasted (it will 401, not 504). */
export const RETRY_TOKEN_EXPIRY_GUARD_SECONDS = 10;
/** Backoff SCHEDULE between idempotent retries — retryDelayMs(attempt) indexes
 * into this (clamping to the last entry past its length, defensively). This is
 * only the SLEEP between attempts; MAX_IDEMPOTENT_RETRY_ELAPSED_MS below is
 * what actually stops the loop. */
export const IDEMPOTENT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 6000, 8000, 10000];
export const RETRY_JITTER_MS = 250;
/** CYN-1080 (review): the idempotent-retry loop is bounded by CUMULATIVE
 * ELAPSED WALL-TIME since the first attempt, not a fixed attempt count. Each
 * cold attempt is ITSELF ~29s — API Gateway's own integration timeout (the
 * CYN-766 premise) — before it even comes back as a 504, so an N-attempt
 * budget is wrong on wall-time: an 8-attempt ladder's true worst case is
 * ~8x29s of attempts + sleeps ~= 260s, far past any client's own request
 * timeout, and ~4min of hammering a genuinely-down backend for no benefit (a
 * retry that lands after the CLIENT already gave up doesn't rescue that
 * request — only warmBackendAsync's fire-and-forget tools/list, fired from
 * the local `initialize` answer, actually fixes a cold backend). 40s is
 * chosen to sit safely under a typical 60s client per-request timeout, WITH
 * the knowledge that the elapsed check only runs BETWEEN attempts (never
 * mid-flight) — one more ~29s attempt may already be in progress when it
 * fires. In practice this yields ~1 useful retry on a real cold start
 * (attempt 0 ~29s, still cold; attempt 1 fires, ~58s total elapsed once IT
 * resolves, budget exhausted, no attempt 2) instead of an unbounded attempt
 * count. Still gated on isIdempotentRequest() + the token-expiry guard below
 * — this bounds HOW LONG an idempotent read keeps retrying, never WHETHER a
 * write (tools/call) is retried (it never is). */
export const MAX_IDEMPOTENT_RETRY_ELAPSED_MS = 40_000;

export const COLD_START_MESSAGE =
  'cold start — retrying (this is not a failure)';
export const COLD_START_MESSAGE_NO_RETRY =
  'cold start — this call is not known-idempotent, so it was not auto-retried; please retry manually';

/**
 * Attempts to parse a JSON-RPC MCP `tools/call` body and return the tool name,
 * or `null` if the body isn't a recognizable tools/call envelope (batch
 * requests, non-JSON bodies, other JSON-RPC methods, etc). A `null` name is
 * treated as NOT known-idempotent — fail closed, never guess a write is safe.
 */
export function extractToolName(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    if (Array.isArray(parsed)) return null; // batch request — ambiguous, don't guess
    if (parsed && parsed.method === 'tools/call' && parsed.params && typeof parsed.params.name === 'string') {
      return parsed.params.name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * MCP lifecycle/discovery methods that are inherently side-effect-free, so a
 * cold-start 504 on one is safe to auto-retry.
 *
 * `initialize` stays in this set for correctness (a handshake genuinely is not
 * a mutation) and because isIdempotentRequest() is still exercised directly
 * against it — but as of CYN-1080 the proxy no longer actually forwards
 * `initialize` upstream at all: createProxyServer() answers it locally (see
 * below) before this classification is ever consulted for it. The set's
 * practical job now is the other four methods; `tools/list` is the one most
 * likely to hit an idle backend in practice (the first REAL forwarded call of
 * a session, right after the local initialize answer triggers the async warm).
 */
export const IDEMPOTENT_METHODS = new Set([
  'initialize',
  'tools/list',
  'resources/list',
  'resources/read',
  'prompts/list',
]);

/** The JSON-RPC method of a single (non-batch) request body, or null. */
export function extractMethod(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    if (Array.isArray(parsed)) return null; // batch — ambiguous, don't guess
    return parsed && typeof parsed.method === 'string' ? parsed.method : null;
  } catch {
    return null;
  }
}

/**
 * True for a body that decodes to either a single tools/call naming a tool in
 * IDEMPOTENT_TOOL_NAMES, or a single side-effect-free lifecycle/discovery
 * method in IDEMPOTENT_METHODS.
 */
export function isIdempotentRequest(rawBody) {
  const name = extractToolName(rawBody);
  if (name !== null) return IDEMPOTENT_TOOL_NAMES.has(name);
  const method = extractMethod(rawBody);
  return method !== null && IDEMPOTENT_METHODS.has(method);
}

/**
 * Pure decision: should the proxy retry this 504?
 * @param {object} opts
 * @param {boolean} opts.idempotent - result of isIdempotentRequest(body)
 * @param {number} opts.elapsedMs - wall-clock ms elapsed since the FIRST attempt for
 *   this request (CYN-1080 review — replaces a fixed attempt-count cap; see
 *   MAX_IDEMPOTENT_RETRY_ELAPSED_MS)
 * @param {number} opts.tokenExpSeconds - the token manager's cached exp (seconds since epoch), or null if unknown
 * @param {number} opts.nowSeconds - current time (seconds since epoch)
 */
export function shouldRetryOn504({ idempotent, elapsedMs, tokenExpSeconds, nowSeconds }) {
  if (!idempotent) return false;
  if (elapsedMs >= MAX_IDEMPOTENT_RETRY_ELAPSED_MS) return false;
  if (typeof tokenExpSeconds === 'number' && nowSeconds >= tokenExpSeconds - RETRY_TOKEN_EXPIRY_GUARD_SECONDS) {
    return false;
  }
  return true;
}

/** Backoff + jitter delay (ms) before the (0-indexed) `attempt`-th retry —
 * attempt=0 is the FIRST retry, using IDEMPOTENT_RETRY_DELAYS_MS[0]. Clamps to
 * the last entry if ever called past the array's length (defensive — the
 * elapsed-time cap in shouldRetryOn504 is what actually stops attempts now,
 * so an attempt index can in principle run past this schedule's length).
 * Deterministic given an injected rng. */
export function retryDelayMs(attempt = 0, rng = Math.random) {
  const base = IDEMPOTENT_RETRY_DELAYS_MS[Math.min(attempt, IDEMPOTENT_RETRY_DELAYS_MS.length - 1)];
  return base + Math.floor(rng() * RETRY_JITTER_MS);
}

/**
 * In-memory counters for the three CYN-766 signals. Exposed as a factory so
 * tests get an isolated instance; the CLI entrypoint creates one process-wide
 * instance and logs deltas via structured stderr lines (no metric sink in
 * this zero-dep client).
 */
export function createColdStartCounters() {
  const counts = {
    operator_cold_504_translated: 0,
    operator_cold_504_retry_succeeded: 0,
    operator_cold_504_retry_failed: 0,
  };
  return {
    increment(name) {
      counts[name] += 1;
      process.stderr.write(`[operator-proxy] counter ${name}=${counts[name]}\n`);
    },
    snapshot: () => ({ ...counts }),
  };
}

export const HOSTS = {
  staging: {
    mintHost: 'https://staging.cynap.ai',
    mcpHost: 'https://staging.mcp.cynap.ai',
  },
  prod: {
    mintHost: 'https://cynap.ai',
    mcpHost: 'https://api.cynap.ai',
  },
};

const DEFAULT_PORT = 8790;
/** The path the local .mcp.json points at. The proxy forwards every request
 * regardless of the incoming path, so this is display-only. */
const LOCAL_MCP_PATH = '/mcp';
/** The upstream operator MCP surface. Token-keyed enforcement means an ES256
 * operator token is honored on any /mcp path, but /mcp/operator is the
 * documented operator surface (and what the .well-known PRM advertises), so
 * the proxy always forwards there. */
const UPSTREAM_MCP_PATH = '/mcp/operator';

/** CYN-801: the header the plugin injects on every proxied MCP request, carrying
 * $CLAUDE_SESSION_ID (the only thing the proxy needs to key the marker — it never
 * sees the session id any other way, since it forwards raw MCP JSON-RPC bodies). */
export const SESSION_HEADER = 'x-cynap-cc-session';

/** The local control endpoint a SessionEnd hook POSTs to, signalling "this session
 * ended — if its marker shows it touched the operator MCP, upload its transcript." */
export const SESSION_END_PATH = '/session-end';

/** Liveness/identity probe path (GET). Carries no secret — see the handler. */
export const HEALTH_PATH = '/health';

/** Managed local shutdown path. The proxy performs its own credential revocation and
 * returns the outcome before exiting; callers never signal a health-supplied PID. */
export const DISCONNECT_PATH = '/disconnect';
export const CONTROL_HEADER = 'x-cynap-operator-control';
export const CONTROL_FILE = '.operator-control';

/** Reported by /health so a caller can tell a stale proxy build from a current one. */
export const PROXY_VERSION = '0.9.0';

/** CYN-1080: the MCP protocolVersion the locally-answered `initialize` falls
 * back to when the client's request omits `params.protocolVersion`. Mirrors
 * the backend's own pinned version (MCP_PROTOCOL_VERSION,
 * [internal reference omitted from public mirror]) so a client that trusts our answer stays
 * aligned with what the real upstream actually speaks. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// MUST match connect.mjs OPERATOR_WORKDIR_BASE (kept in lockstep; see there).
const OPERATOR_WORKDIR_BASE = 'CynapOperator';

/** Process start time, reported by /health so `/cynap-status` can show uptime. */
const PROCESS_STARTED_AT = new Date().toISOString();

/** CYN-1080: the operator credential's absolute expiry (ISO string from the
 * login response), retained so /health and /cynap-status can warn BEFORE it
 * silently expires mid-session — previously logged once at login (see main()'s
 * login branch) then dropped. Never itself a secret (just a timestamp), so
 * exposing it on /health does not weaken the "no token/cookie" contract there.
 * Module-level: exactly one login happens per running proxy process. Stays
 * null for the --e2e cookie leg, which has no absolute credential TTL. */
let credentialExpiresAt = null;

/** Test/CLI seam for the above — main()'s login branch calls this once after a
 * successful PKCE/device login; tests call it directly to exercise /health
 * without running the full login flow. */
export function setCredentialExpiresAt(expiresAt) {
  credentialExpiresAt = typeof expiresAt === 'string' ? expiresAt : null;
}

/** Hours remaining until an ISO expiry timestamp, floored at 0 (never negative
 * — an already-expired credential reads as "0h left"), or null when
 * `expiresAt` is absent/unparseable. Pure function; `nowMs` is milliseconds
 * since epoch. */
export function hoursUntil(expiresAt, nowMs) {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.floor((target - nowMs) / (1000 * 60 * 60)));
}

/** The backend endpoint the proxy uploads the transcript to (mcp-handler; CYN-801). */
const SESSION_TRAIL_UPSTREAM_PATH = '/api/operator/session-trail';

// ---------------------------------------------------------------------------
// CYN-801 — session marker. Pure I/O helpers (fs is real, but no network / no
// process spawn), so they unit-test deterministically against a scratch HOME.
// The marker is the proxy's "touched the operator MCP" gate + endpoint list —
// per spec §2.2 it carries ONLY org + session id + endpoint list, NEVER the
// token/cookie (preserves the "no secrets to disk" property). The proxy is the
// ONLY writer; the SessionEnd hook only ever reads it indirectly, through
// POST /session-end below — it never touches the marker file itself.
// ---------------------------------------------------------------------------

/** Mirrors the backend's session-id validation (session-trail-key.ts) so a
 * marker file name can never itself be a traversal vector. */
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId);
}

/** `~/CynapOperator/<slug>/session-markers/<sessionId>.json` — same base dir
 * connect.mjs already uses for the per-org working directory. `baseDir` is
 * injectable for tests (defaults to the real home dir). */
export function markerPath(slug, sessionId, baseDir = join(homedir(), OPERATOR_WORKDIR_BASE)) {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`markerPath: invalid session id "${sessionId}"`);
  }
  return join(baseDir, slug, 'session-markers', `${sessionId}.json`);
}

/**
 * Record that the session touched the operator MCP via THIS proxied request, and
 * (when the body decodes to a `tools/call`) append the tool name to the session's
 * endpoint list. Creates the marker if absent. Idempotent (a repeated endpoint
 * name is de-duped). Returns the updated marker, or null when the session id
 * fails validation (fail-closed — never write an unvalidated path).
 * `now`/`baseDir` are injectable for tests.
 *
 * qodo #4 fix: `touched` is set on EVERY call regardless of `endpoint` — a
 * session that only ever sent non-`tools/call` requests (`resources/read`,
 * `resources/list`, `initialize`, `prompts/*`) still genuinely "touched the
 * operator MCP" per the spec's marker gate, even though `endpoint` (the tool-name
 * list, kept separately for the upload metadata) stays empty for it. The
 * PREVIOUS behavior gated `/session-end` on `endpoints.length > 0`, which
 * silently dropped exactly this class of session.
 */
export function recordTouchedEndpoint({
  slug,
  sessionId,
  orgId,
  endpoint,
  now = () => Date.now(),
  baseDir,
}) {
  if (!isValidSessionId(sessionId)) return null;
  const path = markerPath(slug, sessionId, baseDir);
  mkdirSync(join(path, '..'), { recursive: true });

  let marker = {
    org: slug,
    orgId: orgId ?? null,
    sessionId,
    touched: false,
    endpoints: [],
    updatedAt: null,
  };
  if (existsSync(path)) {
    try {
      const existing = JSON.parse(readFileSync(path, 'utf8'));
      marker = { ...marker, ...existing };
    } catch {
      // corrupt marker — rebuild fresh rather than throw (best-effort side channel)
    }
  }
  // The "touched the operator MCP" gate — set unconditionally for ANY proxied
  // operator-MCP request, independent of whether it decoded to a named tool call.
  marker.touched = true;
  if (endpoint && !marker.endpoints.includes(endpoint)) {
    marker.endpoints = [...marker.endpoints, endpoint];
  }
  marker.org = slug;
  marker.orgId = orgId ?? marker.orgId ?? null;
  marker.sessionId = sessionId;
  marker.updatedAt = new Date(now()).toISOString();

  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

/** Reads the marker for a session, or null if absent / unparseable / invalid id. */
export function readMarker(slug, sessionId, baseDir) {
  if (!isValidSessionId(sessionId)) return null;
  const path = markerPath(slug, sessionId, baseDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Best-effort marker cleanup after a successful upload — a failed unlink never
 * throws (a stale marker is harmless: at worst a future /session-end re-reads
 * stale endpoints for an id that will never recur). */
export function deleteMarker(slug, sessionId, baseDir) {
  if (!isValidSessionId(sessionId)) return;
  try {
    unlinkSync(markerPath(slug, sessionId, baseDir));
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Token manager — pure decision logic, no I/O side effects beyond the
// injected fetchImpl/now. Kept separate from the HTTP server so it can be
// unit-tested deterministically (see __tests__/remint-clock.test.mjs).
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.mintHost - e.g. https://staging.cynap.ai
 * @param {string} opts.targetOrgId - the org id to mint for
 * @param {string} [opts.allowedOrgId] - if set, the only org id this manager will mint for
 * @param {() => Record<string, string>} opts.getAuthHeaders - CYN-901: returns the mint
 *   auth header(s): `{ Authorization: 'Bearer octk_…' }` for a CLI-scoped credential
 *   (PKCE/device login) OR `{ Cookie: '…' }` for the staging e2e-session leg.
 * @param {'workspace'|'session'} [opts.family] - CYN-801: the operator-token scope
 *   family to mint (default 'workspace', backward-compatible). 'session' mints
 *   workspace:session-capture for the /session-end transcript upload.
 * @param {'workspace:file-activate'|'workspace:commit'|'workspace:operate'} [opts.requestedScope] -
 *   CYN-1411 W3: forwarded verbatim to POST /api/auth/operator-token's `requestedScope`
 *   body field. 'workspace:operate' is the cross-family minting PROFILE — the operator
 *   plugin's --profile operate flag sets this so a single session can both read a run
 *   (ops-journal evidence) and activate a config-kind commit (the structural gap this
 *   wave closes: "a session that can change a file cannot read a single run").
 * @param {typeof fetch} [opts.fetchImpl] - injectable fetch for tests
 * @param {() => number} [opts.now] - injectable clock (seconds since epoch), for tests
 */
export function createTokenManager({
  mintHost,
  targetOrgId,
  allowedOrgId = DEFAULT_TARGET_ORG_ID,
  getAuthHeaders,
  family = 'workspace',
  requestedScope,
  fetchImpl = fetch,
  now = () => Math.floor(Date.now() / 1000),
}) {
  if (targetOrgId !== allowedOrgId) {
    throw new Error(
      `Refusing targetOrgId "${targetOrgId}" — only "${allowedOrgId}" is permitted. ` +
        `Pass --allow-org ${targetOrgId} explicitly to override (own-org preview runs dataMode:'real' against real data).`
    );
  }

  /** @type {{ token: string, exp: number } | null} */
  let cached = null;
  /** @type {Promise<unknown> | null} — in-flight mint shared by concurrent callers. */
  let mintInFlight = null;

  function needsRemint() {
    if (!cached) return true;
    return now() > cached.exp - REMINT_SKEW_SECONDS;
  }

  async function mint() {
    const authHeaders = getAuthHeaders();
    if (!authHeaders || Object.keys(authHeaders).length === 0) {
      throw new Error('No operator credential available — log in before minting.');
    }
    const res = await fetchImpl(`${mintHost}/api/auth/operator-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...stagingProtectionBypassHeaders(),
      },
      body: JSON.stringify(
        requestedScope ? { targetOrgId, family, requestedScope } : { targetOrgId, family }
      ),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`operator-token mint failed: ${res.status} ${body}`.trim());
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('operator-token mint returned no token');
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : OPERATOR_TTL_SECONDS;
    cached = { token: data.token, exp: now() + expiresIn };
    return cached;
  }

  /** Returns a fresh (or cached-if-still-fresh) token, re-minting as needed.
   * Concurrent callers near expiry share ONE in-flight mint so we never fire
   * duplicate POSTs to /api/auth/operator-token. */
  async function getToken() {
    if (needsRemint()) {
      if (!mintInFlight) {
        mintInFlight = mint().finally(() => {
          mintInFlight = null;
        });
      }
      await mintInFlight;
    }
    return cached.token;
  }

  return { getToken, needsRemint, _peekCache: () => cached };
}

// ---------------------------------------------------------------------------
// Vercel Deployment-Protection (SSO) bypass — staging.cynap.ai only.
// ---------------------------------------------------------------------------

/**
 * CYN-768: the staging portal (`staging.cynap.ai`) sits behind Vercel Deployment
 * Protection (SSO), so BOTH portal calls this proxy makes — the `e2e-session` cookie
 * leg and the `operator-token` mint — get a 401 "Protected deployment" at the SSO wall
 * unless the request carries a "Protection Bypass for Automation" secret. When one is
 * present in the environment we send it as the `x-vercel-protection-bypass` header on every
 * mint-host call. We deliberately do NOT send `x-vercel-set-bypass-cookie: true`: that asks
 * Vercel to persist the bypass via a `_vercel_jwt` cookie, which it does with a 307 redirect
 * — and a cookie-jar-less client (Node's `fetch`/undici) re-sends the header on the redirect,
 * re-triggers the set-cookie 307, and loops until "redirect count exceeded". The header alone
 * clears the SSO wall on each call (a direct 200), so the cookie handshake is both redundant
 * and breaking. This is scoped to the two portal fetches ONLY — the operator JWT the proxy
 * injects is verified by the backend via JWKS (no portal round-trip), so the MCP path never
 * needs this.
 *
 * No-op when unset: prod never needs it (the `e2e-session` route is HARD-OFF on prod), and
 * an un-protected preview/staging accepts the calls without a bypass. Read from (in order):
 * `CYNAP_STAGING_PROTECTION_BYPASS`, then Vercel's canonical `VERCEL_AUTOMATION_BYPASS_SECRET`,
 * then the repo's documented `VERCEL_BYPASS_TOKEN` name. When none is in the environment,
 * `hydrateBypassSecretFromKeychain` (called once at startup) may have populated
 * `CYNAP_STAGING_PROTECTION_BYPASS` from the macOS Keychain — this helper stays pure/env-only.
 */
export function stagingProtectionBypassHeaders(env = process.env) {
  const secret =
    env.CYNAP_STAGING_PROTECTION_BYPASS ||
    env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    env.VERCEL_BYPASS_TOKEN ||
    '';
  if (!secret) return {};
  return {
    'x-vercel-protection-bypass': secret,
  };
}

// macOS Keychain fallback for the staging Protection-Bypass secret.
export const KEYCHAIN_SERVICE = 'cynap-operator';
export const KEYCHAIN_ACCOUNT = 'staging-protection-bypass';

/**
 * Read the staging bypass secret from the macOS login Keychain. Returns '' on any
 * failure (not darwin, item absent, access denied, timeout) — never throws, so a
 * missing item is indistinguishable from "no Keychain" and simply falls through.
 */
export function readBypassFromKeychain({ execImpl = execFileSync, platform = process.platform } = {}) {
  if (platform !== 'darwin') return '';
  try {
    const out = execImpl(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    );
    return String(out).trim();
  } catch {
    return '';
  }
}

/**
 * Populate `CYNAP_STAGING_PROTECTION_BYPASS` from the macOS Keychain when no bypass
 * secret is present in the environment. This solves the "a GUI-launched Claude Desktop
 * does not inherit shell env" problem: store the secret once —
 *   security add-generic-password -s cynap-operator -a staging-protection-bypass \
 *     -w '<secret>' -T /usr/bin/security -U
 * (`-T /usr/bin/security` pre-authorizes the `security` CLI this proxy shells out to, so the
 * read never triggers a Keychain access prompt) — and `/cynap-connect`'s spawned proxy
 * resolves it regardless of how Desktop was launched,
 * with no plaintext secret in a dotfile or the global launchd env. Environment always wins.
 * Returns the resolved source for logging: 'env' | 'keychain' | 'none'.
 */
export function hydrateBypassSecretFromKeychain(env = process.env, reader = readBypassFromKeychain) {
  if (
    env.CYNAP_STAGING_PROTECTION_BYPASS ||
    env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    env.VERCEL_BYPASS_TOKEN
  ) {
    return 'env';
  }
  const secret = reader();
  if (secret) {
    env.CYNAP_STAGING_PROTECTION_BYPASS = secret;
    return 'keychain';
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// Cookie acquisition — headless staging login via the e2e-session route.
// ---------------------------------------------------------------------------

/**
 * POSTs { org_slug: 'cynap-e2e' } to /api/auth/e2e-session and returns a raw
 * Cookie header string reconstructed from the Set-Cookie response headers.
 * See [internal reference omitted from public mirror],117-144 — the route
 * is auto-on on preview/staging, HARD-OFF on prod.
 */
export async function acquireStagingCookie({
  mintHost,
  orgSlug = DEFAULT_ORG_SLUG,
  fetchImpl = fetch,
}) {
  const res = await fetchImpl(`${mintHost}/api/auth/e2e-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...stagingProtectionBypassHeaders() },
    body: JSON.stringify({ org_slug: orgSlug }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`e2e-session mint failed: ${res.status} ${body}`.trim());
  }
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies.length === 0) {
    const raw = res.headers.get('set-cookie');
    if (raw) setCookies.push(raw);
  }
  if (setCookies.length === 0) {
    throw new Error('e2e-session response carried no Set-Cookie header');
  }
  // Reduce each Set-Cookie to its "name=value" pair for the outbound Cookie header.
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

// ---------------------------------------------------------------------------
// CYN-901 — operator-CLI credential login. Both legs yield an `octk_…` CLI-SCOPED
// credential (usable ONLY at the operator-token mint route, absolute ≤48h, revocable),
// which the proxy injects as `Authorization: Bearer`. This REPLACES the whole-account
// session cookie (and deletes the CYNAP_OPERATOR_COOKIE `--prod` stopgap):
//   * PKCE loopback (PRIMARY, RFC 8252) — opens a browser, receives the code on 127.0.0.1.
//   * device code   (fallback, RFC 8628) — prints a user_code, polls for approval.
// ---------------------------------------------------------------------------

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a PKCE code_verifier (43 chars, unreserved) + its S256 challenge (RFC 7636). */
export function generatePkcePair(rand = randomBytes) {
  const verifier = base64url(rand(32));
  const challenge = base64url(createHash('sha256').update(verifier, 'ascii').digest());
  return { verifier, challenge };
}

/** Best-effort open the OS default browser; always prints the URL to copy/paste. */
function openBrowser(url, out = process.stderr) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore — the URL is printed regardless
  }
  out.write(`[operator-proxy] If your browser did not open, visit:\n  ${url}\n`);
}

/** Start an ephemeral 127.0.0.1 loopback listener (OS-assigned port). Resolves with the
 * single-use code on `GET /callback?code&state` (state-verified), rejects on error/timeout. */
function startLoopbackListener(expectedState) {
  return new Promise((resolveListener) => {
    let resolveCode;
    let rejectCode;
    const codePromise = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:3rem">' +
          '<h2>Cynap Operator CLI</h2><p>You can close this window and return to your terminal.</p></body>'
      );
      const err = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (state !== expectedState) {
        rejectCode(new Error('loopback state mismatch (possible CSRF) — login aborted'));
      } else if (err) {
        rejectCode(new Error(`authorization denied: ${err}`));
      } else if (!code) {
        rejectCode(new Error('no code in loopback callback'));
      } else {
        resolveCode(code);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const waitForCode = (timeoutMs) =>
        Promise.race([
          codePromise,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('operator login timed out')), timeoutMs)
          ),
        ]);
      resolveListener({ server, port, waitForCode });
    });
  });
}

/**
 * PKCE-loopback login (PRIMARY). Opens the browser to the operator-cli authorize page,
 * receives the single-use code on the exact 127.0.0.1 redirect, and exchanges it (+ the
 * PKCE verifier) for a CLI credential. Returns { credential, orgId, expiresAt }.
 */
export async function pkceLoopbackLogin({
  mintHost,
  orgSlug,
  clientId = OPERATOR_CLI_CLIENT_ID,
  fetchImpl = fetch,
  open = openBrowser,
  out = process.stderr,
  timeoutMs = 5 * 60 * 1000,
}) {
  const { verifier, challenge } = generatePkcePair();
  const state = base64url(randomBytes(16));
  const { server, port, waitForCode } = await startLoopbackListener(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL(`${mintHost}/operator-cli/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('org', orgSlug);

  out.write('[operator-proxy] Opening browser for operator login (PKCE loopback)…\n');
  open(authUrl.toString(), out);

  let code;
  try {
    code = await waitForCode(timeoutMs);
  } finally {
    server.close();
  }

  const res = await fetchImpl(`${mintHost}/api/auth/operator-cli/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...stagingProtectionBypassHeaders() },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`operator-cli token exchange failed: ${res.status} ${body}`.trim());
  }
  const data = await res.json();
  if (!data.credential) throw new Error('operator-cli token exchange returned no credential');
  return { credential: data.credential, orgId: data.org_id, expiresAt: data.expires_at };
}

/**
 * Device-code login (RFC 8628 fallback, headless). Prints the user_code + verification URL,
 * then polls until the operator approves in a browser. Returns { credential, orgId, expiresAt }.
 */
export async function deviceCodeLogin({
  mintHost,
  orgSlug,
  clientId = OPERATOR_CLI_CLIENT_ID,
  fetchImpl = fetch,
  out = process.stderr,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  const startRes = await fetchImpl(`${mintHost}/api/auth/operator-cli/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...stagingProtectionBypassHeaders() },
    body: JSON.stringify({ client_id: clientId, org: orgSlug }),
  });
  if (!startRes.ok) {
    const body = await startRes.text().catch(() => '');
    throw new Error(`device-code start failed: ${startRes.status} ${body}`.trim());
  }
  const start = await startRes.json();
  out.write(
    `\n[operator-proxy] To authorize this device, open:\n  ${start.verification_uri_complete}\n` +
      `[operator-proxy] and confirm the code:  ${start.user_code}\n\n`
  );
  const deadline = now() + (start.expires_in ?? 900) * 1000;
  let interval = (start.interval ?? 5) * 1000;
  while (now() < deadline) {
    await sleep(interval);
    const pollRes = await fetchImpl(`${mintHost}/api/auth/operator-cli/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...stagingProtectionBypassHeaders() },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: start.device_code,
        client_id: clientId,
      }),
    });
    const data = await pollRes.json().catch(() => ({}));
    if (pollRes.ok && data.credential) {
      return { credential: data.credential, orgId: data.org_id, expiresAt: data.expires_at };
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (data.error === 'access_denied') throw new Error('device authorization denied by the operator');
    if (data.error === 'expired_token') throw new Error('device code expired before approval');
    throw new Error(`device-code poll failed: ${data.error ?? pollRes.status}`);
  }
  throw new Error('device authorization timed out');
}

/** Hard bound on the revoke-on-exit call — the shutdown path swallows repeat
 * SIGINT/SIGTERM (the `exiting` guard), so an unbounded fetch against an unreachable
 * portal would leave the process unkillable except by SIGKILL. */
export const REVOKE_ON_EXIT_TIMEOUT_MS = 5000;

/** Revoke-on-exit: best-effort revoke the CLI credential server-side (proxy shutdown).
 * Time-bounded so a hung portal can never wedge the exit — on timeout the credential
 * still self-expires within its absolute ≤48h TTL. */
export async function revokeCliCredential({ mintHost, credential, fetchImpl = fetch }) {
  if (!credential) return true;
  try {
    const response = await fetchImpl(`${mintHost}/api/auth/operator-cli/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential}`,
        ...stagingProtectionBypassHeaders(),
      },
      body: JSON.stringify({ credential }),
      signal: AbortSignal.timeout(REVOKE_ON_EXIT_TIMEOUT_MS),
    });
    return response.ok === true;
  } catch {
    // best-effort — a lingering credential still self-expires within its absolute ≤48h TTL
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTTP proxy server
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Writes a 200 JSON-RPC 2.0 result envelope. Used by the CYN-1080 local
 * `initialize` answer below — the ONE response this proxy synthesizes itself
 * rather than forwarding upstream. */
function sendJsonRpcResult(res, id, result) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

// ---------------------------------------------------------------------------
// CYN-801 — session-trail transcript upload (the proxy-driven POST). The
// operator token is 900s/no-refresh, so the SessionEnd hook (which fires AFTER
// the token that ran the session has long expired) cannot upload directly — the
// still-running proxy mints a FRESH session-capture token on demand and POSTs.
// ---------------------------------------------------------------------------

/**
 * Reads the Claude Code transcript file (`<projectsDir>/<slug>/<sessionId>.jsonl`),
 * gzips it, and POSTs it (base64-encoded — no API-GW binary media-type config
 * exists, see the backend handler's module doc) to the session-trail endpoint,
 * using a FRESHLY-minted session-capture token from `sessionTokenManager`.
 * `readTranscript`/`fetchImpl`/`now` are injectable for tests.
 */
export async function uploadSessionTrail({
  mcpHost,
  sessionId,
  runtime = 'claude-code',
  endpoints,
  commitShas = [],
  startedAt,
  sessionTokenManager,
  readTranscript,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  const raw = await readTranscript();
  const gzipped = gzipSync(Buffer.from(raw, 'utf8'));
  const token = await sessionTokenManager.getToken();
  // CYN-992: POST /api/operator/session-trail is served by the mcp-handler
  // Lambda (routed via /api/{proxy+} → McpHandler; handlers/mcp.ts), which
  // JWKS-verifies the operator bearer token. It is NOT a portal route — the
  // portal (mintHost) has no such route and its middleware rejects any /api/*
  // lacking a better-auth cookie, and behind Vercel SSO the request never even
  // reaches the app. So the upload targets mcpHost (the same host as the MCP
  // forward): no cookie, no Vercel bypass. The token is still MINTED at the
  // portal (mintHost) by the session-family token manager; only this POST moves.
  const res = await fetchImpl(`${mcpHost}${SESSION_TRAIL_UPSTREAM_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_id: sessionId,
      runtime,
      endpoints,
      commit_shas: commitShas,
      started_at: startedAt,
      ended_at: now(),
      transcript_gzip_b64: gzipped.toString('base64'),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`session-trail upload failed: ${res.status} ${text}`.trim());
  }
  return res.json();
}

/**
 * @param {object} opts
 * @param {string} opts.mcpHost
 * @param {string} opts.mcpPath
 * @param {{ getToken: () => Promise<string>, _peekCache?: () => { token: string, exp: number } | null }} opts.tokenManager
 * @param {string} [opts.orgSlug] - CYN-801: the org slug this proxy is pinned to,
 *   used as the marker directory key.
 * @param {string} [opts.orgId] - CYN-801: recorded into the marker for display only.
 * @param {string} [opts.mintHost] - CYN-801: required for /session-end to mint +
 *   upload; optional here only so existing tests that don't exercise
 *   /session-end can omit it.
 * @param {ReturnType<typeof createTokenManager>} [opts.sessionTokenManager] -
 *   CYN-801: a token manager pre-configured with family:'session'. Built lazily
 *   from mintHost/getCookie if omitted and /session-end is actually invoked.
 * @param {() => Record<string, string>} [opts.getAuthHeaders] - CYN-801/CYN-901: needed
 *   only to lazily build sessionTokenManager when it isn't passed explicitly.
 * @param {(sessionId: string) => Promise<string>} [opts.readTranscriptFor] -
 *   CYN-801: resolves a session id to its raw transcript text. Injectable for tests.
 * @param {string} [opts.baseDir] - CYN-801: marker base dir override, for tests.
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {ReturnType<typeof createColdStartCounters>} [opts.counters]
 * @param {() => number} [opts.now] - injectable clock (seconds since epoch), for tests
 * @param {(ms: number) => Promise<void>} [opts.sleep] - injectable delay, for tests
 * @param {() => number} [opts.rng] - injectable rng for jitter, for tests
 */
/**
 * Bind the stable local port before browser authorization starts. This single listener
 * is the cross-process startup lease: concurrent connectors observe `authorizing` and
 * wait, while SessionStart sees a live control plane and does not launch a twin.
 * Once ready, non-control requests are delegated to the full proxy server.
 */
export function createLifecycleServer({
  getHealth,
  onDisconnect,
  getReadyServer,
  controlNonce,
  exitAfterResponse = () => {},
}) {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === HEALTH_PATH) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(getHealth()));
      return;
    }

    if (req.method === 'POST' && req.url === DISCONNECT_PATH) {
      if (!controlNonce || req.headers[CONTROL_HEADER] !== controlNonce) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'invalid_local_control_nonce' }));
        return;
      }
      try {
        const outcome = await onDisconnect();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(outcome), () => exitAfterResponse(outcome));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(
          JSON.stringify({
            stopped: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
      return;
    }

    const readyServer = getReadyServer();
    if (readyServer) {
      readyServer.emit('request', req, res);
      return;
    }

    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
    res.end(JSON.stringify({ error: 'operator_authorization_pending' }));
  });
}

/** Publish the local control nonce only after this process owns the stable port. */
export async function listenWithControlAuthority({
  server,
  port,
  controlPath,
  controlNonce,
  host = '127.0.0.1',
  writeControl = writeFileSync,
}) {
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      try {
        writeControl(controlPath, `${controlNonce}\n`, { mode: 0o600 });
        resolve();
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

export function createProxyServer({
  mcpHost,
  mcpPath,
  tokenManager,
  orgSlug,
  orgId,
  authMode,
  mintHost,
  sessionTokenManager,
  getAuthHeaders,
  readTranscriptFor,
  baseDir,
  fetchImpl = fetch,
  counters = createColdStartCounters(),
  now = () => Math.floor(Date.now() / 1000),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  rng = Math.random,
}) {
  // CYN-1080: at most ONE in-flight "wake the backend" request at a time for
  // this proxy instance — an operator's editor can fire several `initialize`s
  // in quick succession (a client retry, a second tool window); they should
  // share one warm, not pile up N redundant cold-start pokes.
  let warmInFlight = false;

  /** Fire-and-forget: nudge the upstream operator MCP with a minimal
   * `tools/list` so a cold `cynap-mcp-handler` starts coming up WHILE the
   * client is still parsing the (already-sent) local `initialize` response,
   * rather than waiting for the client's first real forwarded call to pay the
   * full cold-start latency. Never throws to its caller and never blocks the
   * request that triggered it — a failure here just means the next real
   * forwarded request pays its own cold start via the retry loop below. */
  function warmBackendAsync() {
    if (warmInFlight) return;
    warmInFlight = true;
    (async () => {
      const token = await tokenManager.getToken();
      const warmRes = await fetchImpl(`${mcpHost}${mcpPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'cynap-operator-warm', method: 'tools/list', params: {} }),
      });
      try {
        await warmRes.body?.cancel();
      } catch {
        // best-effort drain — a failed cancel is harmless, never worth surfacing
      }
    })()
      .catch((err) => {
        process.stderr.write(
          `[operator-proxy] backend warm failed (non-fatal — the next real request pays its own cold start): ${err instanceof Error ? err.message : err}\n`
        );
      })
      .finally(() => {
        warmInFlight = false;
      });
  }

  return createServer(async (req, res) => {
    // Liveness/identity probe. `/cynap-connect` uses it to decide reuse-vs-launch
    // (so re-connecting an already-running org is idempotent instead of spawning
    // a second proxy), the SessionStart self-heal hook uses it to decide whether
    // to relaunch, and `/cynap-status` renders it. Deliberately carries NO token,
    // NO cookie and NO secret — only the pinned identity + liveness facts, so it
    // is safe for any local caller that can already reach the loopback port.
    if (req.method === 'GET' && req.url === HEALTH_PATH) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          org: orgSlug ?? null,
          orgId: orgId ?? null,
          env: mcpHost && mcpHost.includes('staging') ? 'staging' : 'prod',
          version: PROXY_VERSION,
          authMode: authMode ?? null,
          status: 'ready',
          pid: process.pid,
          startedAt: PROCESS_STARTED_AT,
          // CYN-1080: the credential's absolute expiry — a timestamp, never a
          // secret, so this stays within the "no token/cookie on /health"
          // contract above. null until a login has completed (or always, for
          // the --e2e cookie leg, which has no absolute TTL to report).
          credExpiresAt: credentialExpiresAt,
          credExpiresInHours: hoursUntil(credentialExpiresAt, now() * 1000),
        })
      );
      return;
    }

    // CYN-801: the local control endpoint a SessionEnd hook signals. Handled
    // BEFORE the generic MCP-forward path below (distinct route, distinct method
    // semantics — not itself forwarded upstream).
    if (req.method === 'POST' && req.url === SESSION_END_PATH) {
      await handleSessionEnd(req, res, {
        orgSlug,
        orgId,
        mintHost,
        mcpHost,
        sessionTokenManager,
        getAuthHeaders,
        readTranscriptFor,
        baseDir,
        fetchImpl,
      });
      return;
    }

    try {
      const body = await readBody(req);
      const idempotent = isIdempotentRequest(body);
      const upstreamUrl = `${mcpHost}${mcpPath}`;

      // CYN-801: record the touched endpoint (if the plugin sent the session
      // header) BEFORE the upstream call — a marker write must never depend on
      // the call succeeding, since the point of the marker is to gate whether an
      // upload happens at all, independent of any one call's outcome. This also
      // covers the CYN-1080 locally-answered `initialize` just below: it never
      // reaches the upstream, but it still genuinely touched the operator MCP.
      const sessionId = req.headers[SESSION_HEADER];
      if (orgSlug && typeof sessionId === 'string' && isValidSessionId(sessionId)) {
        try {
          recordTouchedEndpoint({
            slug: orgSlug,
            sessionId,
            orgId,
            endpoint: extractToolName(body) ?? undefined,
            baseDir,
          });
        } catch (err) {
          // Marker write is a best-effort side channel — never let it block or
          // fail the actual MCP forward.
          process.stderr.write(
            `[operator-proxy] marker write failed (non-fatal): ${err instanceof Error ? err.message : err}\n`
          );
        }
      }

      // CYN-1080: answer the MCP `initialize` handshake LOCALLY — never
      // forward it upstream, never let a cold backend surface as a 5xx at the
      // handshake. Claude Code retries a failing `initialize` a handful of
      // times, then marks the whole MCP server FAILED for the rest of the
      // session (zero tools, no re-poll) — the exact failure mode this closes.
      // A local 200 lands in low-single-digit ms, independent of backend
      // state. The real backend is still woken, just decoupled from the
      // handshake: fire-and-forget below.
      if (extractMethod(body) === 'initialize') {
        warmBackendAsync();
        let id = null;
        let protocolVersion = DEFAULT_PROTOCOL_VERSION;
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          id = parsed.id ?? null;
          if (typeof parsed.params?.protocolVersion === 'string') {
            protocolVersion = parsed.params.protocolVersion;
          }
        } catch {
          // extractMethod() above only returns 'initialize' for a body that
          // parsed cleanly, so this branch is unreachable in practice — kept
          // as a defensive fallback (id stays null, protocolVersion default).
        }
        sendJsonRpcResult(res, id, {
          protocolVersion,
          serverInfo: { name: 'cynap-operator', version: PROXY_VERSION },
          // CYN-1080 (review): mirror the REAL backend's full capability set
          // ([internal reference omitted from public mirror] registers a prompt via
          // registerPrompts + a resources/list handler, alongside tools). An
          // MCP client caches whatever this handshake advertises and never
          // re-polls it — declaring only `tools` would permanently disable
          // prompts/list + resources/list for the entire session, a silent
          // regression vs. origin/main (which forwarded initialize and got
          // all three from the real backend). A later forwarded
          // resources/list or prompts/list just goes upstream like any other
          // idempotent call — this only fixes what the handshake ADVERTISES.
          capabilities: { tools: {}, prompts: {}, resources: {} },
        });
        return;
      }

      async function attemptOnce() {
        const token = await tokenManager.getToken();
        return fetchImpl(upstreamUrl, {
          method: req.method,
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/json',
            Accept: req.headers['accept'] || 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
        });
      }

      // CYN-1080 (review): the retry-window clock starts BEFORE the very
      // first attempt — that attempt's own ~29s cost counts toward the
      // elapsed budget just as much as any retry's does (see
      // MAX_IDEMPOTENT_RETRY_ELAPSED_MS).
      const retryWindowStartSeconds = now();
      let upstreamRes = await attemptOnce();
      let attempt = 0;
      while (upstreamRes.status === GATEWAY_TIMEOUT_STATUS) {
        counters.increment('operator_cold_504_translated');
        const tokenExpSeconds =
          typeof tokenManager._peekCache === 'function' ? tokenManager._peekCache()?.exp : undefined;
        const nowSeconds = now();
        const elapsedMs = (nowSeconds - retryWindowStartSeconds) * 1000;
        const canRetry = shouldRetryOn504({
          idempotent,
          elapsedMs,
          tokenExpSeconds,
          nowSeconds,
        });
        process.stderr.write(
          `[operator-proxy] ${canRetry ? COLD_START_MESSAGE : COLD_START_MESSAGE_NO_RETRY}\n`
        );
        if (!canRetry) break;
        // Drain/cancel the discarded 504 response body so its stream + underlying
        // socket isn't held open across the retry (connection-reuse / resource hygiene).
        try {
          await upstreamRes.body?.cancel();
        } catch {
          // best-effort — a failed cancel must never block the retry
        }
        await sleep(retryDelayMs(attempt, rng));
        attempt += 1;
        upstreamRes = await attemptOnce();
        if (upstreamRes.status !== GATEWAY_TIMEOUT_STATUS) {
          counters.increment('operator_cold_504_retry_succeeded');
        } else if ((now() - retryWindowStartSeconds) * 1000 >= MAX_IDEMPOTENT_RETRY_ELAPSED_MS) {
          counters.increment('operator_cold_504_retry_failed');
        }
      }

      // Forward status + the headers MCP StreamableHTTP/SSE clients rely on,
      // then STREAM the body — never buffer, because text/event-stream is a
      // long-lived stream and arrayBuffer() would defeat it (and balloon memory).
      const outHeaders = {};
      for (const h of ['content-type', 'cache-control', 'www-authenticate', 'mcp-session-id']) {
        const v = upstreamRes.headers.get(h);
        if (v) outHeaders[h] = v;
      }
      if (!outHeaders['content-type']) outHeaders['content-type'] = 'application/json';
      res.writeHead(upstreamRes.status, outHeaders);
      if (upstreamRes.body) {
        Readable.fromWeb(upstreamRes.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'proxy_error', message: err instanceof Error ? err.message : String(err) }));
    }
  });
}

/**
 * CYN-801 — POST /session-end handler. Reads the marker for the given session;
 * if it shows the session touched the operator MCP, mints a fresh session-
 * capture token and uploads the transcript. GATED on the marker: a session that
 * never touched the operator MCP produces no upload (the marker IS the "touched
 * the MCP" gate, per spec §2.1/§7). Always responds 200 (best-effort, fire-and-
 * forget from the hook's perspective) — errors are logged to stderr, never
 * thrown back at the caller, so a slow/failed upload can never make the
 * SessionEnd hook (which already runs async/fail-open) hang or error louder.
 */
async function handleSessionEnd(req, res, ctx) {
  const respond = (statusCode, body) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      return respond(400, { error: 'invalid_body' });
    }

    const sessionId = payload.session_id;
    if (!isValidSessionId(sessionId)) {
      return respond(400, { error: 'invalid_session_id' });
    }
    if (!ctx.orgSlug) {
      return respond(200, { status: 'skipped', reason: 'no_org_pinned' });
    }

    const marker = readMarker(ctx.orgSlug, sessionId, ctx.baseDir);
    // qodo #4: the gate is "the proxy saw ANY operator MCP request for this
    // session" (marker.touched), NOT "a tools/call happened" (marker.endpoints
    // non-empty). A session that only ever sent resources/read, resources/list,
    // initialize, or prompts/* requests still genuinely touched the operator MCP
    // and must still upload — endpoints stays available separately as the
    // tool-name list for the upload metadata, empty or not.
    if (!marker || marker.touched !== true) {
      // The gate: never uploaded for a session that never touched the operator MCP.
      return respond(200, { status: 'skipped', reason: 'no_marker' });
    }

    if (!ctx.mintHost || !ctx.readTranscriptFor) {
      process.stderr.write('[operator-proxy] /session-end: missing mintHost/readTranscriptFor — cannot upload.\n');
      return respond(200, { status: 'skipped', reason: 'proxy_not_configured' });
    }

    const sessionTokenManager =
      ctx.sessionTokenManager ??
      (ctx.getAuthHeaders
        ? createTokenManager({
            mintHost: ctx.mintHost,
            targetOrgId: ctx.orgId ?? ctx.orgSlug,
            allowedOrgId: ctx.orgId ?? ctx.orgSlug,
            getAuthHeaders: ctx.getAuthHeaders,
            family: 'session',
            fetchImpl: ctx.fetchImpl,
          })
        : null);
    if (!sessionTokenManager) {
      process.stderr.write('[operator-proxy] /session-end: no session token manager available.\n');
      return respond(200, { status: 'skipped', reason: 'no_token_manager' });
    }

    await uploadSessionTrail({
      mcpHost: ctx.mcpHost,
      sessionId,
      endpoints: Array.isArray(marker.endpoints) ? marker.endpoints : [],
      commitShas: Array.isArray(payload.commit_shas) ? payload.commit_shas : [],
      startedAt: typeof payload.started_at === 'string' ? payload.started_at : marker.updatedAt,
      sessionTokenManager,
      readTranscript: () => ctx.readTranscriptFor(sessionId),
      fetchImpl: ctx.fetchImpl,
    });

    deleteMarker(ctx.orgSlug, sessionId, ctx.baseDir);
    respond(200, { status: 'uploaded' });
  } catch (err) {
    process.stderr.write(
      `[operator-proxy] /session-end upload failed (non-fatal): ${err instanceof Error ? err.message : err}\n`
    );
    respond(200, { status: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    env: 'prod',
    port: DEFAULT_PORT,
    targetOrgId: DEFAULT_TARGET_ORG_ID,
    allowedOrgId: DEFAULT_TARGET_ORG_ID,
    /** True once --allow-org is supplied. False means targetOrgId is still the
     * built-in default, which the post-login guard refuses to serve under. */
    orgPinnedExplicitly: false,
    // CYN-801: the marker directory key. v1 only ever pins one org per proxy
    // instance (the DEFAULT_ORG_SLUG default matches the DEFAULT_TARGET_ORG_ID
    // default) — --org-slug lets --allow-org callers supply the matching slug.
    orgSlug: DEFAULT_ORG_SLUG,
    // CYN-901: how to acquire the operator credential. Keyed on MODE, not env, so G2
    // bakes identically on staging + prod. interactive → PKCE loopback (default);
    // device → RFC 8628; e2e → the staging e2e-session cookie leg (cynap-e2e only).
    authMode: 'interactive',
    // CYN-1411 W3: absent by default (unchanged single-scope execute-preview mint).
    requestedScope: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--prod') {
      opts.env = 'prod';
    } else if (arg === '--staging') {
      opts.env = 'staging';
    } else if (arg === '--device') {
      opts.authMode = 'device';
    } else if (arg === '--interactive') {
      opts.authMode = 'interactive';
    } else if (arg === '--e2e') {
      opts.authMode = 'e2e';
    } else if (arg === '--port') {
      opts.port = Number(argv[++i]);
    } else if (arg === '--allow-org') {
      const orgId = argv[++i];
      opts.allowedOrgId = orgId;
      opts.targetOrgId = orgId;
      // Distinguishes "operator pinned this org" from "still on the built-in
      // default" — the post-login cross-tenant guard keys off this.
      opts.orgPinnedExplicitly = true;
    } else if (arg === '--org-slug') {
      opts.orgSlug = argv[++i];
    } else if (arg === '--profile') {
      // CYN-1411 W3: the only accepted value today is 'operate' (the cross-family
      // minting profile — {workspace:file-activate, workspace:read-ops}, handler_upload
      // and subject_erase/suggestion_propose carved out). Any other value is a hard
      // refusal at the client, mirroring the portal route's own closed set.
      const profile = argv[++i];
      if (profile !== 'operate') {
        process.stderr.write(`Unknown --profile value: ${profile} (only 'operate' is accepted)\n`);
        process.exit(1);
      }
      opts.requestedScope = 'workspace:operate';
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function usage() {
  return [
    'Usage: operator-proxy.mjs [--staging|--prod] [--device|--e2e] [--org-slug <slug>] [--port <n>] [--profile operate]',
    '',
    'Starts a local HTTP MCP proxy at http://127.0.0.1:<port>/mcp that forwards',
    'to the operator MCP endpoint, injecting a freshly-minted Bearer token.',
    '',
    'Login (CYN-901) — the credential is CLI-scoped (mints operator tokens ONLY, absolute',
    '≤48h, revoked on exit), NEVER a whole-account session:',
    '  (default)  PKCE loopback — opens a browser; receives the code on 127.0.0.1.',
    '  --device   RFC 8628 device code — prints a user_code; poll for browser approval.',
    '  --e2e      staging e2e-session cookie — cynap-e2e + --staging ONLY (headless test).',
    'Login is keyed on MODE, not environment, so --prod needs NO local secret.',
    '',
    '--org-slug <slug> is the org to connect to (default cynap-e2e); the server resolves it',
    'from your active grants and freezes the credential to it.',
    '',
    'Default environment is staging (zero prod mutation). --prod couples BOTH',
    'the mint host and the MCP forward host — staging tokens 401 on prod',
    '(different JWKS), so the two never drift independently.',
    '',
    'CYN-801: also serves POST /session-end, signalled by a SessionEnd hook to',
    'upload the ending session\'s transcript (if it touched the operator MCP).',
    '',
    '--profile operate (CYN-1411 W3): mint the cross-family workspace:operate profile',
    'instead of the default workspace:execute-preview — a session that can both READ a',
    'run (journal_describe/journal_query/runs_query/journal_count/run_evidence_get) and',
    'ACTIVATE a config-kind commit (workspace_activate_commit), never handler_upload or',
    'the GDPR erase/propose tools. Requires org-owner membership.',
  ].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const { mintHost, mcpHost } = HOSTS[opts.env];
  process.stderr.write(`[operator-proxy] env=${opts.env} mintHost=${mintHost} mcpHost=${mcpHost}\n`);
  process.stderr.write(`[operator-proxy] targetOrgId=${opts.targetOrgId}\n`);

  // Resolve the staging SSO bypass secret: env wins, else the macOS Keychain (so a
  // GUI-launched Claude Desktop that inherits no shell env still finds it).
  const bypassSource = hydrateBypassSecretFromKeychain();
  if (opts.env === 'staging') {
    if (bypassSource === 'none') {
      process.stderr.write(
        '[operator-proxy] WARNING: no staging Protection-Bypass secret in env or Keychain — ' +
          'staging.cynap.ai SSO will 401. Set CYNAP_STAGING_PROTECTION_BYPASS, or store it once:\n' +
          "[operator-proxy]   security add-generic-password -s cynap-operator -a staging-protection-bypass -w '<secret>' -T /usr/bin/security -U\n"
      );
    } else {
      process.stderr.write(`[operator-proxy] staging bypass secret source: ${bypassSource}\n`);
    }
  }

  // CYN-901: acquire the operator credential (mode-keyed, NOT env-keyed — so G2 bakes on
  // staging first and behaves identically on prod). `getAuthHeaders` is the single seam the
  // token managers use for the mint call: `{ Authorization: 'Bearer octk_…' }` for a
  // CLI-scoped credential, `{ Cookie: … }` for the staging e2e-session leg.
  let getAuthHeaders;
  let revokeOnExit = null;
  let readyProxyServer = null;
  let lifecycleStatus = 'authorizing';
  let shutdownPromise = null;
  const controlNonce = randomBytes(32).toString('base64url');
  const controlPath = join(process.cwd(), CONTROL_FILE);

  const disconnect = () => {
    if (!shutdownPromise) {
      lifecycleStatus = 'disconnecting';
      shutdownPromise = (async () => {
        const credentialIssued = typeof revokeOnExit === 'function';
        const credentialRevoked = credentialIssued ? await revokeOnExit() : true;
        return { stopped: true, credentialIssued, credentialRevoked };
      })();
    }
    return shutdownPromise;
  };

  const closeAndExit = (outcome) => {
    const exitCode = outcome.credentialRevoked ? 0 : 1;
    try {
      unlinkSync(controlPath);
    } catch {
      // The nonce is not a credential and is overwritten on next launch; cleanup is best-effort.
    }
    lifecycleServer.close(() => process.exit(exitCode));
    setTimeout(() => process.exit(exitCode), 1000).unref();
  };

  const lifecycleServer = createLifecycleServer({
    getHealth: () => ({
      ok: lifecycleStatus === 'ready',
      status: lifecycleStatus,
      org: opts.orgSlug ?? null,
      orgId: lifecycleStatus === 'ready' ? (opts.targetOrgId ?? null) : null,
      env: opts.env,
      version: PROXY_VERSION,
      authMode: opts.authMode,
      pid: process.pid,
      startedAt: PROCESS_STARTED_AT,
      credExpiresAt: credentialExpiresAt,
      credExpiresInHours: hoursUntil(credentialExpiresAt, Date.now()),
    }),
    onDisconnect: disconnect,
    getReadyServer: () => readyProxyServer,
    controlNonce,
    exitAfterResponse: closeAndExit,
  });

  await listenWithControlAuthority({
    server: lifecycleServer,
    port: opts.port,
    controlPath,
    controlNonce,
  });
  process.stderr.write(
    `[operator-proxy] control plane listening on http://127.0.0.1:${opts.port} ` +
      `(status: authorizing, auth: ${opts.authMode}).\n`
  );

  const shutdownFromSignal = (signal) => {
    process.stderr.write(`[operator-proxy] ${signal} — disconnecting managed proxy…\n`);
    disconnect().then(closeAndExit, () => closeAndExit({ credentialRevoked: false }));
  };
  process.on('SIGINT', () => shutdownFromSignal('SIGINT'));
  process.on('SIGTERM', () => shutdownFromSignal('SIGTERM'));

  if (opts.authMode === 'e2e') {
    // The staging e2e-session cookie survives ONLY as the headless-e2e path — cynap-e2e +
    // staging, never a prod/real-org fallback (spec §2.G2). The CYNAP_OPERATOR_COOKIE
    // `--prod` stopgap is DELETED — prod uses PKCE (default) or --device.
    if (opts.env !== 'staging') {
      process.stderr.write(
        '[operator-proxy] --e2e is a STAGING-ONLY headless leg (cynap-e2e). For --prod use ' +
          'PKCE loopback (default) or --device. Refusing.\n'
      );
      process.exit(1);
    }
    const cookie = await acquireStagingCookie({ mintHost, orgSlug: opts.orgSlug });
    getAuthHeaders = () => ({ Cookie: cookie });
    process.stderr.write('[operator-proxy] staging e2e-session cookie acquired.\n');
  } else {
    const login = opts.authMode === 'device' ? deviceCodeLogin : pkceLoopbackLogin;
    let result;
    try {
      result = await login({ mintHost, orgSlug: opts.orgSlug });
    } catch (err) {
      process.stderr.write(
        `[operator-proxy] operator login failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }
    const credential = result.credential;
    getAuthHeaders = () => ({ Authorization: `Bearer ${credential}` });
    revokeOnExit = () => revokeCliCredential({ mintHost, credential });
    // The credential is frozen to a server-resolved org — pin the proxy to it (the mint
    // route enforces this too), superseding the --org-slug default as source of truth.
    if (result.orgId) {
      opts.targetOrgId = result.orgId;
      opts.allowedOrgId = result.orgId;
    } else if (!opts.orgPinnedExplicitly) {
      // Fail closed. Without an explicit --allow-org, targetOrgId is still the
      // built-in DEFAULT_TARGET_ORG_ID (cynap-e2e). Serving under that default
      // after logging in for some OTHER org would silently point the operator at
      // the wrong tenant — the exact failure this proxy's org-pin exists to
      // prevent. A credential that carries no org is not something to paper over.
      process.stderr.write(
        '[operator-proxy] operator login returned no org for the credential and no --allow-org was given — ' +
          'refusing to serve under the built-in default org (cross-tenant guard).\n'
      );
      // Revoke the credential we just obtained BEFORE bailing. This exit runs
      // long before the revoke-on-exit handler is installed further down, so
      // without this an issued octk_ credential would stay live for its full TTL
      // after we refused to start — a fail-closed guard that leaks the very
      // credential it declined to use. Best-effort: a revoke failure must not
      // mask the refusal itself.
      await revokeCliCredential({ mintHost, credential }).catch(() => {});
      process.exit(1);
    }
    process.stderr.write(
      `[operator-proxy] operator credential acquired for org ${opts.targetOrgId} (expires ${result.expiresAt}).\n`
    );
    // CYN-1080: retain the expiry (previously logged once here, then dropped)
    // so /health and /cynap-status can warn before it silently expires
    // mid-session.
    setCredentialExpiresAt(result.expiresAt);
  }

  const tokenManager = createTokenManager({
    mintHost,
    targetOrgId: opts.targetOrgId,
    allowedOrgId: opts.allowedOrgId,
    getAuthHeaders,
    requestedScope: opts.requestedScope,
  });

  // Prime the cache with one mint so the first MCP call doesn't pay the
  // latency, and so a bad credential/grant fails loudly at startup.
  try {
    await tokenManager.getToken();
  } catch (error) {
    await disconnect();
    throw error;
  }
  process.stderr.write('[operator-proxy] initial token minted successfully.\n');

  // CYN-801: resolves a Claude Code session id to its transcript file. Sessions
  // live at ~/.claude/projects/<escaped-cwd-slug>/<sessionId>.jsonl, but the
  // proxy has no reliable way to know which project slug a given session
  // belongs to (it never sees $CLAUDE_PROJECT_DIR) — so it globs every project
  // dir for a matching <sessionId>.jsonl rather than guessing the slug.
  const readTranscriptFor = async (sessionId) => {
    const { readFile, readdir } = await import('node:fs/promises');
    const projectsDir = join(homedir(), '.claude', 'projects');
    const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(projectsDir, entry.name, `${sessionId}.jsonl`);
      if (existsSync(candidate)) {
        return readFile(candidate, 'utf8');
      }
    }
    throw new Error(`transcript not found for session ${sessionId}`);
  };

  readyProxyServer = createProxyServer({
    mcpHost,
    mcpPath: UPSTREAM_MCP_PATH,
    tokenManager,
    orgSlug: opts.orgSlug,
    orgId: opts.targetOrgId,
    authMode: opts.authMode,
    mintHost,
    getAuthHeaders,
    readTranscriptFor,
  });
  lifecycleStatus = 'ready';
  process.stderr.write(
    `[operator-proxy] ready on http://127.0.0.1:${opts.port}${LOCAL_MCP_PATH} ` +
      `→ ${mcpHost}${UPSTREAM_MCP_PATH} (session-end: http://127.0.0.1:${opts.port}${SESSION_END_PATH})\n`
  );
}

// Only run when invoked directly (not when imported for tests). Compare via
// pathToFileURL so a relative argv[1] (e.g. `node tooling/operator/operator-proxy.mjs`)
// still matches import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[operator-proxy] fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
