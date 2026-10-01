// Spec §7.3 step 2 — /cynap-push runs the SAME checks engine as /cynap-checks, but as a
// pre-commit local gate against this push's PLANNED bytes (there is no commit_sha yet, so this
// never calls `checks_verdict_report` — that attestation still happens via /cynap-checks after
// the commit lands). "No skip flag, because a commit that can't activate blocks the chain."

import { PLUGIN_OWNED_ROOT_FILES, mapWithConcurrency } from './workspace-sync.mjs';

/** In-flight `workspace_get_file` reads — the same bound /cynap-pull uses. */
const READ_CONCURRENCY = 8;

const CHECKS_PREFIX = 'checks/';

function fileBytes(path, file) {
  if (typeof file?.content !== 'string' || (file.encoding !== 'utf8' && file.encoding !== 'base64')) {
    throw new Error(`workspace_get_file ${path}: reply has no {encoding, content}`);
  }
  return new Uint8Array(Buffer.from(file.content, file.encoding));
}

/**
 * The DEPLOYED (live) checks/** suite files — same HEAD-correctness rule as /cynap-checks
 * (spec §5.1 step 0): a pending/tip draft gates nothing.
 * `call(name, args)` is the caller's already-proxy-bound MCP call — same shape as every other
 * `call` in cynap-push.mjs/cynap-pull.mjs, not the raw 3-arg `mcpCall(proxyUrl, name, args)`.
 *
 * One hashed listing names every live suite and its sha256. `resolveLocal(path, sha256)` returns
 * the working directory's bytes when it already holds that exact content, so a suite is read over
 * the wire only when the local copy differs from the deployed one.
 */
export async function fetchLiveCheckFiles(call, resolveLocal = () => undefined) {
  const tree = await call('workspace_tree', { commit: 'live', prefix: CHECKS_PREFIX, include_hashes: true });
  if (tree?.ok === false) throw new Error(`workspace_tree(live) refused: ${tree.code}`);
  const entries = (Array.isArray(tree?.entries) ? tree.entries : [])
    .filter((e) => typeof e?.path === 'string' && e.path.startsWith(CHECKS_PREFIX) && e.path.endsWith('.json'))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bytes = await mapWithConcurrency(entries, READ_CONCURRENCY, async ({ path, sha256 }) => {
    const local = typeof sha256 === 'string' ? resolveLocal(path, sha256) : undefined;
    if (local !== undefined) return local;
    const file = await call('workspace_get_file', { path, commit: 'live' });
    if (file?.ok === false) throw new Error(`workspace_get_file(${path}) refused: ${file.code}`);
    return fileBytes(path, file);
  });
  return {
    bytesByPath: new Map(entries.map((entry, i) => [entry.path, bytes[i]])),
    acceptedTip: typeof tree?.accepted_tip === 'string' ? tree.accepted_tip : null,
  };
}

/**
 * Runs the checks engine over this push's planned bytes. `resolvePlanned(path)` returns the
 * post-push bytes for a path THIS push touches (a create/update's new bytes, or `null` for a
 * delete), or `undefined` when this push doesn't touch that path — the current pending TIP is
 * read as the fallback, since this push layers on top of it. `evaluateChecks` /
 * `collectFingerprintPaths` come from the bundled cynap-checks-core.mjs (the same engine
 * /cynap-checks uses).
 *
 * `base` is the last pull: `{ sha, files: Map<path, sha256> }`. While the accepted tip is still
 * that pull, an untouched path's tip bytes ARE the local file, and a path the pull did not list
 * does not exist at the tip — neither needs a read. A stale pull reads the tip over the wire.
 */
export async function runChecksPreflight({
  call,
  resolvePlanned = () => undefined,
  plannedPaths = [],
  evaluateChecks,
  collectFingerprintPaths,
  resolveLocal = () => undefined,
  base = null,
}) {
  const { bytesByPath: liveChecks, acceptedTip } = await fetchLiveCheckFiles(call, resolveLocal);
  const checksByPath = new Map(liveChecks);
  for (const path of plannedPaths) {
    if (!path.startsWith(CHECKS_PREFIX) || !path.endsWith('.json')) continue;
    const planned = resolvePlanned(path);
    if (planned === undefined) continue;
    if (planned === null) checksByPath.delete(path);
    else checksByPath.set(path, planned);
  }
  for (const path of liveChecks.keys()) {
    const planned = resolvePlanned(path);
    if (planned === undefined) continue;
    if (planned === null) checksByPath.delete(path);
    else checksByPath.set(path, planned);
  }
  if (checksByPath.size === 0) return { ran: false };

  const headPaths = [...checksByPath.keys()];
  const suiteSources = new Map(headPaths.map((path) => [path, liveChecks.has(path) && resolvePlanned(path) === undefined ? 'live' : 'planned']));
  const suites = headPaths.map((path) => JSON.parse(Buffer.from(checksByPath.get(path)).toString('utf8')));

  const tipIsBase = base !== null && acceptedTip !== null && base.sha === acceptedTip;
  const fPaths = collectFingerprintPaths(suites, headPaths);
  const snapshot = new Map();
  const toFetch = [];
  for (const path of fPaths) {
    const planned = resolvePlanned(path);
    if (planned !== undefined) {
      snapshot.set(path, planned);
      continue;
    }
    if (liveChecks.has(path)) {
      snapshot.set(path, liveChecks.get(path));
      continue;
    }
    if (tipIsBase && !PLUGIN_OWNED_ROOT_FILES.has(path)) {
      const sha256 = base.files.get(path);
      if (sha256 === undefined) {
        snapshot.set(path, null);
        continue;
      }
      const local = resolveLocal(path, sha256);
      if (local !== undefined) {
        snapshot.set(path, local);
        continue;
      }
    }
    toFetch.push(path);
  }
  const fetched = await mapWithConcurrency(toFetch, READ_CONCURRENCY, async (path) => {
    const file = await call('workspace_get_file', { path, commit: 'tip' });
    return file?.ok === false ? null : fileBytes(path, file);
  });
  toFetch.forEach((path, i) => snapshot.set(path, fetched[i]));
  const resolve = (path) => snapshot.get(path) ?? null;
  const run = evaluateChecks(suites, resolve);
  let firstFailure;
  for (let i = 0; i < run.suites.length && !firstFailure; i += 1) {
    const assertion = run.suites[i].assertions.find((a) => !a.passed);
    if (assertion) {
      const source = suiteSources.get(headPaths[i]);
      firstFailure = {
        ...assertion,
        check: run.suites[i].id,
        source,
        ...(source === 'live' ? { guidance: 'this check is already accepted; change it in its own push first' } : {}),
      };
    }
  }
  return { ran: true, run, firstFailure };
}
