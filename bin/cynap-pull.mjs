#!/usr/bin/env node
// /cynap-pull — spec §7.2. Three-way sync of the connected org's ACCEPTED TIP into a local
// working directory. Zero external dependencies (Node built-ins + sibling lib modules only) —
// this runs from a clean HOME with no monorepo (spec §9.3 bake).

import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import {
  assertConnectedOrg,
  assertSafeRemotePath,
  deleteFileIfExists,
  findCaseCollisions,
  hasSymlinkOnPath,
  listLocalFiles,
  mapWithConcurrency,
  mcpCall,
  readState,
  resolveContainedPath,
  resolveOrgSlug,
  sha256Hex,
  writeFileAtomic,
  writeStateAtomic,
} from '../lib/workspace-sync.mjs';
import { threeWayDiff } from '../lib/workspace-diff.mjs';

export function parsePullArgs(argv) {
  const args = { dir: null, takeRemote: [], proxyUrl: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dir') args.dir = argv[++i];
    else if (flag === '--take-remote') args.takeRemote.push(argv[++i]);
    else if (flag === '--proxy-url') args.proxyUrl = argv[++i];
    else throw new Error(`cynap-pull: unrecognized argument "${flag}"`);
  }
  return args;
}

function readLocalFileMap(dir) {
  const map = new Map();
  for (const path of listLocalFiles(dir)) {
    map.set(path, sha256Hex(readFileSync(join(dir, path))));
  }
  return map;
}

export async function pull({ cwd = process.cwd(), argv = [], fetchImpl = fetch } = {}) {
  const args = parsePullArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const proxyUrl = args.proxyUrl ?? `http://127.0.0.1:${stablePortForSlug(org)}/mcp`;
  const dir = args.dir ? resolvePath(cwd, args.dir) : resolvePath(cwd, `cynap-${org}`);
  mkdirSync(dir, { recursive: true });

  const existing = readState(dir);
  const state = existing ?? { org, base: null, files: {} };
  assertConnectedOrg(state, org);

  const call = (name, callArgs) => mcpCall(proxyUrl, name, callArgs, { fetchImpl });

  const tree = await call('workspace_tree', { commit: 'tip', include_hashes: true });
  if (tree?.ok === false) throw new Error(`workspace_tree refused: ${tree.code} — ${tree.message ?? ''}`);
  const commitSha = tree.commit_sha;
  const entries = Array.isArray(tree.entries) ? tree.entries : [];
  const fileEntries = entries.filter((e) => e.type === 'file');

  // Reserved-path + case-collision refusals cover the WHOLE pull before any write (spec §7.1).
  for (const entry of fileEntries) assertSafeRemotePath(entry.path);
  const collisions = findCaseCollisions(fileEntries.map((e) => e.path));
  if (collisions.length > 0) {
    return {
      ok: false,
      reason: 'case_collision',
      collisions,
      message: `remote paths collide once case-folded — refusing on every filesystem: ${collisions.map((c) => `${c.a} / ${c.b}`).join(', ')}`,
    };
  }
  if (fileEntries.some((e) => e.sha256 === undefined)) {
    throw new Error('workspace_tree({include_hashes: true}) returned an entry with no sha256 — cannot three-way diff.');
  }

  const remote = new Map(fileEntries.map((e) => [e.path, e.sha256]));
  const base = new Map(Object.entries(state.files));
  const local = readLocalFileMap(dir);
  const takeRemoteOverrides = new Set(args.takeRemote);

  const diff = threeWayDiff({ base, local, remote, takeRemoteOverrides });

  if (diff.conflicts.length > 0) {
    return {
      ok: false,
      reason: 'conflicts',
      conflicts: diff.conflicts,
      message: diff.conflicts.map((c) => `${c.path}: local ${c.localSha ?? '(deleted)'}, remote ${c.remoteSha ?? '(deleted)'}`).join('\n'),
    };
  }

  // All-or-nothing: nothing is written until every conflict is resolved.
  const written = [];
  const deleted = [];
  const toFetch = diff.takeRemote.filter((path) => remote.has(path));
  const toDelete = diff.takeRemote.filter((path) => !remote.has(path));

  // Fetch and verify EVERY file before writing any, so a refused fetch, a hash mismatch or a
  // symlink leaves the tree exactly as it was (all-or-nothing, spec §7.2 step 3).
  const fetched = await mapWithConcurrency(toFetch, 8, async (path) => {
    const file = await call('workspace_get_file', { path, commit: commitSha });
    if (file?.ok === false) throw new Error(`workspace_get_file(${path}) refused: ${file.code}`);
    if (typeof file?.content !== 'string' || (file.encoding !== 'utf8' && file.encoding !== 'base64')) {
      throw new Error(`workspace_get_file(${path}): reply has no {encoding, content}`);
    }
    const bytes = Buffer.from(file.content, file.encoding);
    if (sha256Hex(bytes) !== remote.get(path)) {
      throw new Error(`workspace_get_file(${path}): bytes do not match the tree's sha256 at ${commitSha}`);
    }
    return { path, abs: resolveContainedPath(dir, path), bytes };
  });
  const deletions = toDelete.map((path) => ({ path, abs: resolveContainedPath(dir, path) }));
  for (const { path, abs } of [...fetched, ...deletions]) {
    if (hasSymlinkOnPath(dir, abs)) throw new Error(`refusing to write through a symlink: ${path}`);
  }

  for (const { path, abs, bytes } of fetched) {
    writeFileAtomic(abs, bytes);
    written.push(path);
  }
  for (const { path, abs } of deletions) {
    deleteFileIfExists(abs);
    deleted.push(path);
  }

  const nextFiles = Object.fromEntries(remote);
  writeStateAtomic(dir, { org, base: commitSha, files: nextFiles });

  return { ok: true, dir, base: commitSha, written: written.sort(), deleted: deleted.sort(), keptLocal: diff.keepLocal };
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await pull({ argv });
  } catch (error) {
    // A path-safety violation (assertSafeRemotePath, a symlink) THROWS rather than returning a
    // structured {ok:false} — there is nothing list-shaped to report, unlike conflicts or a
    // case collision. Same stderr+exit1 shape either way.
    process.stderr.write(`cynap-pull: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    process.stderr.write(`cynap-pull: ${result.message}\n`);
    if (result.reason === 'conflicts') {
      process.stderr.write('Resolve with --take-remote <path> (repeatable), or edit locally and re-run.\n');
    }
    process.exitCode = 1;
    return result;
  }
  process.stdout.write(
    `${JSON.stringify({ dir: result.dir, base: result.base, written: result.written, deleted: result.deleted }, null, 2)}\n`
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
