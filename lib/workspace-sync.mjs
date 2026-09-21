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
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// MCP loopback call (same shape as cynap-checks-runner.mjs's mcpCall).
// ---------------------------------------------------------------------------

let rpcId = 0;

export async function mcpCall(proxyUrl, name, args, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(proxyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error(`MCP ${name} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`MCP ${name} error: ${JSON.stringify(body.error)}`);
  const result = body.result ?? {};
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find?.((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : result;
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

export function resolveOrgSlug({ cwd = process.cwd() } = {}) {
  const slug = cwd.split(sep).filter(Boolean).pop();
  if (!slug) throw new Error('cannot infer the connected org from the current directory — run /cynap-connect first.');
  return slug;
}

// ---------------------------------------------------------------------------
// Local filesystem safety (spec §7.1, F20).
// ---------------------------------------------------------------------------

export const RESERVED_DIR = '.cynap';
export const STATE_REL_PATH = `${RESERVED_DIR}/state.json`;

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

export function deleteFileIfExists(absPath) {
  if (existsSync(absPath)) unlinkSync(absPath);
}

/** Recursively lists every file under `dir`, excluding `.cynap/`, as POSIX-relative paths.
 * Throws WorkspaceSyncError the moment it finds a symlink anywhere in the tree (spec §7.1: "a
 * local symlink inside the tree makes the push refuse"). */
export function listLocalFiles(dir) {
  const absDir = resolve(dir);
  const out = [];
  const walk = (current, relParts) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      if (relParts.length === 0 && entry === RESERVED_DIR) continue;
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

export function assertConnectedOrg(state, org) {
  if (state.org !== org) {
    throw new WorkspaceSyncError(
      `${STATE_REL_PATH} was created for org "${state.org}", but the connected org is "${org}" — this directory belongs to a different org.`
    );
  }
}
