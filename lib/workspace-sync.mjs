// Shared, zero-dep primitives for /cynap-pull and /cynap-push. Node
// built-ins only — these scripts run from a clean-machine HOME with no monorepo (spec §9.3
// bake), so nothing here may import a workspace package.

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// MCP loopback call — the SINGLE entry every operator command uses to reach
// the platform (/cynap-pull, /cynap-push, /cynap-checks all route through it).
//
// Credentials are the proxy's business, never a command's: the proxy holds the
// operator credential, and when one is missing, expired or rejected it reopens
// browser consent itself and retries the upstream call. This function's job is
// the other half of that contract — making sure the operator can always tell
// WHICH wall they hit. The four answers a loopback call can give that are not
// about the org's data get a sentence here instead of an HTTP number:
//
//   connection refused  -> no proxy is running for this org at all
//   503 authorizing     -> a consent is open in the browser right now
//   503 login_timed_out -> the proxy's startup sign-in timed out; /cynap-connect restarts it
//   401 consent_required-> consent timed out, was declined, or is unavailable
//
// A hung command with no explanation is the failure this replaces.
// ---------------------------------------------------------------------------

let rpcId = 0;

/** Node's fetch reports a refused/unreachable loopback as a TypeError whose
 * cause carries the syscall code. Recognizing it is what lets us say "the
 * proxy isn't running" instead of re-printing "fetch failed". */
const PROXY_UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH']);

export function isProxyUnreachableError(error) {
  const code = error?.cause?.code ?? error?.code;
  return typeof code === 'string' && PROXY_UNREACHABLE_CODES.has(code);
}

/** The operator-facing sentence for a loopback failure that is about the
 * CONNECTION or the CREDENTIAL rather than about the request. Returns null
 * when the failure is an ordinary one the caller should report its own way.
 *
 * `body` is the parsed JSON the proxy answered with, when there was one — the
 * proxy puts its own `message` there for a consent failure, and passing it
 * through verbatim is deliberate: the proxy knows whether consent timed out,
 * was declined, or was never possible, and this layer must not re-guess. */
export function describeLoopbackFailure({ status, body, error, proxyUrl } = {}) {
  if (error && isProxyUnreachableError(error)) {
    return (
      `no operator proxy is listening on ${proxyUrl ?? 'the loopback port'} — ` +
      'this working directory is not connected. Run /cynap-connect to open a workspace.'
    );
  }
  if (status === 503 && body?.error === 'operator_authorization_pending') {
    return 'the operator proxy is still waiting for browser consent — finish the sign-in page, then re-run this command.';
  }
  if (status === 503 && body?.error === 'operator_login_timed_out') {
    return body.message ?? 'the operator proxy sign-in timed out — run /cynap-connect to restart it.';
  }
  if (status === 401 && body?.error === 'operator_consent_required') {
    return body.message ?? 'operator browser consent did not complete.';
  }
  return null;
}

export async function mcpCall(proxyUrl, name, args, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    });
  } catch (error) {
    const described = describeLoopbackFailure({ error, proxyUrl });
    if (described) throw new WorkspaceSyncError(described, { reason: 'proxy_unreachable' });
    throw error;
  }
  if (!response.ok) {
    // Read the error body DEFENSIVELY. Only the three loopback-specific
    // statuses below care what is in it, and a response shape with no usable
    // `.text()` must still produce the ordinary `HTTP <status>` error rather
    // than a TypeError that buries the status entirely.
    let body = null;
    try {
      const raw = typeof response.text === 'function' ? await response.text() : '';
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // unreadable or non-JSON error body — an opaque upstream failure
    }
    const described = describeLoopbackFailure({ status: response.status, body, proxyUrl });
    if (described) {
      throw new WorkspaceSyncError(described, {
        reason:
          response.status === 401
            ? 'consent_required'
            : body?.error === 'operator_login_timed_out'
              ? 'login_timed_out'
              : 'authorizing',
        outcome: body?.outcome,
      });
    }
    if (response.status === 403 && !body?.jsonrpc) {
      throw new WorkspaceSyncError(`the platform's edge firewall rejected this request body (HTTP 403). This is a platform fault, not your files — report it with the time ${new Date().toISOString()}.`, { reason: 'edge_firewall', status: 403 });
    }
    if ([502, 503, 504].includes(response.status)) {
      throw new WorkspaceSyncError(`the gateway timed out (HTTP ${response.status}); the server may still have completed the call. Check /cynap-status before retrying.`, { reason: 'gateway_timeout', status: response.status });
    }
    const pathSuffix = args && typeof args.path === 'string' ? `(${args.path})` : '';
    throw new WorkspaceSyncError(`MCP ${name}${pathSuffix} HTTP ${response.status}`, { status: response.status });
  }
  let body;
  if (response.headers?.get?.('content-type')?.includes('text/event-stream')) {
    const events = (await response.text()).split('\n').filter((line) => line.startsWith('data:'));
    for (const event of events.reverse()) {
      try { body = JSON.parse(event.slice(5).trim()); break; } catch { /* keep looking */ }
    }
    if (!body) throw new WorkspaceSyncError(`MCP ${name} returned an empty event stream`);
  } else {
    body = await response.json();
  }
  if (body.error) throw new Error(`MCP ${name} error: ${JSON.stringify(body.error)}`);
  const result = body.result ?? {};
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find?.((c) => c.type === 'text')?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch (error) {
    // A tool the server refuses before it runs answers `isError` with PLAIN text,
    // not a JSON refusal (mcp-server.ts's surface denial). Return it in the same
    // `{ ok: false, code }` shape a tool's own refusal takes, so callers branch on
    // one shape instead of crashing on a SyntaxError.
    if (!result.isError) throw error;
    return toolDenial(text);
  }
}

/** Code for the MCP server's surface denial: the credential cannot resolve the tool. */
export const TOOL_NOT_AVAILABLE_CODE = 'tool_not_available';

/** The literal prefix of that denial, as the MCP server throws it. */
export const TOOL_NOT_AVAILABLE_PATTERN = /^Tool '[^']+' is not available on this connection/;

function toolDenial(text) {
  const code = TOOL_NOT_AVAILABLE_PATTERN.test(text) ? TOOL_NOT_AVAILABLE_CODE : 'tool_error';
  return { ok: false, code, message: text };
}

/** Bounded-concurrency map — never more than `limit` in-flight calls to `fn`. */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Org / proxy resolution — mirrors cynap-activate.mjs's `basename(process.cwd())` convention:
// the operator's shell cwd is the /cynap-connect working directory (~/CynapOperator/<slug>/),
// and every /cynap-* command infers the org from it.
// ---------------------------------------------------------------------------

export function resolveWorkspace({ cwd = process.cwd(), dir } = {}) {
  const start = resolve(dir ?? cwd);
  for (let current = start; ; current = dirname(current)) {
    const statePath = join(current, STATE_REL_PATH);
    if (existsSync(statePath)) {
      const state = readState(current);
      return { org: state.org, root: current, statePath };
    }
    if (current === dirname(current)) break;
    if (dirname(current).split(sep).filter(Boolean).pop() === 'CynapOperator') {
      return { org: current.split(sep).filter(Boolean).pop(), root: current, statePath: null };
    }
  }
  const slug = resolve(cwd).split(sep).filter(Boolean).pop();
  if (!slug) throw new Error('cannot infer the connected org from the current directory — run /cynap-connect first.');
  return { org: slug, root: null, statePath: null };
}

/** The org this session is CONNECTED to: the nearest `CynapOperator/<slug>` ancestor of `cwd`,
 * else the basename of `cwd`. It never comes from a workspace's own state file, so `--dir`
 * cannot redirect a command to another org. */
export function resolveOrgSlug({ cwd = process.cwd() } = {}) {
  const segments = resolve(cwd).split(sep).filter(Boolean);
  const base = segments.lastIndexOf('CynapOperator');
  const slug = base >= 0 && base < segments.length - 1 ? segments[base + 1] : segments.pop();
  if (!slug) throw new Error('cannot infer the connected org from the current directory — run /cynap-connect first.');
  return slug;
}

export function resolveWorkspaceDir({ cwd = process.cwd(), dir, org = resolveOrgSlug({ cwd }) } = {}) {
  if (dir) return resolve(cwd, dir);
  const workspace = resolveWorkspace({ cwd });
  if (workspace.statePath) return workspace.root;
  return join(resolve(cwd), `cynap-${org}`);
}

// ---------------------------------------------------------------------------
// Local filesystem safety (spec §7.1, F20).
// ---------------------------------------------------------------------------

export const RESERVED_DIR = '.cynap';
export const STATE_REL_PATH = `${RESERVED_DIR}/state.json`;

/** Root files the plugin owns (the package.json whose `imports` maps `#cynap/testing`). Like
 * `.cynap/`, they are never synced: the tree walk skips them, a pull never writes them, and the
 * plane refuses them at commit. */
export const PLUGIN_OWNED_ROOT_FILES = new Set(['package.json']);

export class WorkspaceSyncError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'WorkspaceSyncError';
    Object.assign(this, extra);
  }
}

/** Normalizes and safety-checks a REMOTE (server-reported) path. Throws WorkspaceSyncError on
 * `..`, an absolute path, a NUL byte, an empty path, or anything landing under the reserved
 * `.cynap/` directory. */
export function assertSafeRemotePath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new WorkspaceSyncError(`remote path is empty or not a string: ${JSON.stringify(path)}`);
  }
  if (path.includes('\u0000')) {
    throw new WorkspaceSyncError(`remote path contains a NUL byte: ${path}`);
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new WorkspaceSyncError(`remote path is absolute: ${path}`);
  }
  const segments = normalized.split('/');
  if (segments.includes('..') || segments.includes('.')) {
    throw new WorkspaceSyncError(`remote path is not normalized: ${path}`);
  }
  if (segments[0] === RESERVED_DIR) {
    throw new WorkspaceSyncError(`remote path lands under the reserved ${RESERVED_DIR}/ directory: ${path}`);
  }
  return normalized;
}

/** The same fold spec §7.1 requires: NFC-normalize, then lowercase — case collisions must
 * refuse identically on every filesystem, not just a case-insensitive one. */
export function collisionKey(path) {
  return path.normalize('NFC').toLocaleLowerCase('en-US');
}

/** Returns the list of `{a, b}` path pairs that collide once case-folded. */
export function findCaseCollisions(paths) {
  const seen = new Map();
  const collisions = [];
  for (const path of paths) {
    const key = collisionKey(path);
    const previous = seen.get(key);
    if (previous !== undefined && previous !== path) {
      collisions.push({ a: previous, b: path });
      continue;
    }
    seen.set(key, path);
  }
  return collisions;
}

/** Resolves a safe remote path to an absolute path under `dir`, and re-verifies the resolved
 * path is still contained (defense in depth on top of assertSafeRemotePath). */
export function resolveContainedPath(dir, remotePath) {
  const safe = assertSafeRemotePath(remotePath);
  const absDir = resolve(dir);
  const abs = resolve(absDir, safe);
  const rel = relative(absDir, abs);
  if (rel === '' || rel.startsWith('..') || resolve(absDir, rel) !== abs) {
    throw new WorkspaceSyncError(`remote path escapes the target directory: ${remotePath}`);
  }
  return abs;
}

/** True if any path component from `dir` down to (and including) `absPath` is a symlink.
 * Walks only components that exist — a not-yet-created leaf (a pull create, a push create) is
 * fine; an existing ancestor standing in for a symlinked directory is not. */
export function hasSymlinkOnPath(dir, absPath) {
  const absDir = resolve(dir);
  const rel = relative(absDir, absPath);
  if (rel === '' || rel.startsWith('..')) return true; // outside dir — treat as unsafe
  const parts = rel.split(sep);
  let current = absDir;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current); // lstat, not existsSync: a dangling symlink must still count
    } catch (error) {
      if (error?.code === 'ENOENT') break; // nothing below a missing component can exist yet
      throw error;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Atomic write: temp file in the SAME directory, then rename (spec §7.1). */
export function writeFileAtomic(absPath, buf) {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${randomUUID()}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, absPath);
}

/**
 * Moves a local file out of the working tree into `<dir>/.cynap/discarded/<stamp>/<relPath>`
 * instead of unlinking it, so bytes the remote no longer holds stay recoverable. Returns the
 * backup path, or null when there was no file.
 */
export function moveToDiscarded(dir, relPath, absPath, stamp) {
  if (!existsSync(absPath)) return null;
  const backup = join(resolve(dir), RESERVED_DIR, 'discarded', stamp, ...relPath.split('/'));
  mkdirSync(dirname(backup), { recursive: true });
  renameSync(absPath, backup);
  return backup;
}

/** Recursively lists every file under `dir`, excluding `.cynap/` and the plugin-owned root files,
 * as POSIX-relative paths.
 * Throws WorkspaceSyncError the moment it finds a symlink anywhere in the tree (spec §7.1: "a
 * local symlink inside the tree makes the push refuse"). */
export function listLocalFiles(dir) {
  const absDir = resolve(dir);
  const out = [];
  const walk = (current, relParts) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      if (relParts.length === 0 && (entry === RESERVED_DIR || PLUGIN_OWNED_ROOT_FILES.has(entry))) continue;
      const abs = join(current, entry);
      const relPath = [...relParts, entry].join('/');
      const stat = lstatSync(abs);
      if (stat.isSymbolicLink()) {
        throw new WorkspaceSyncError(`local path is a symlink — push refuses: ${relPath}`, { path: relPath });
      }
      if (stat.isDirectory()) {
        walk(abs, [...relParts, entry]);
      } else if (stat.isFile()) {
        out.push(relPath);
      }
    }
  };
  walk(absDir, []);
  return out.sort();
}

// ---------------------------------------------------------------------------
// `.cynap/state.json` — {org, base, files: {path: sha256}}.
// ---------------------------------------------------------------------------

/** `.cynap/` is skipped by the tree walk, so it gets its own check: a symlinked `.cynap` would
 *  redirect every state read and write outside the working directory. */
export function assertReservedDirNotSymlink(dir) {
  let stat;
  try {
    stat = lstatSync(join(dir, RESERVED_DIR));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new WorkspaceSyncError(`${RESERVED_DIR} must be a real directory, not a symlink or file`, { path: RESERVED_DIR });
  }
}

export function readState(dir) {
  assertReservedDirNotSymlink(dir);
  const path = join(dir, STATE_REL_PATH);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.org !== 'string' ||
    (parsed.base !== null && typeof parsed.base !== 'string') ||
    typeof parsed.files !== 'object' ||
    parsed.files === null
  ) {
    throw new WorkspaceSyncError(`${STATE_REL_PATH} is malformed — expected {org, base, files}`);
  }
  return { org: parsed.org, base: parsed.base, files: parsed.files };
}

/** Atomic write: state.json goes last, the same way as every other file (spec §7.1). */
export function writeStateAtomic(dir, state) {
  assertReservedDirNotSymlink(dir);
  writeFileAtomic(join(dir, STATE_REL_PATH), Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8'));
}

export function assertConnectedOrg(state, org, dir = '.') {
  if (state.org !== org) {
    throw new WorkspaceSyncError(
      `workspace mismatch: ${join(resolve(dir), STATE_REL_PATH)} says org "${state.org}", but the connected org is "${org}" — this directory belongs to a different org; run from the workspace root or pass --dir.`
    );
  }
}
