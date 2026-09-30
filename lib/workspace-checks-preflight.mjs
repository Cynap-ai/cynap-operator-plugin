// Spec §7.3 step 2 — /cynap-push runs the SAME checks engine as /cynap-checks, but as a
// pre-commit local gate against this push's PLANNED bytes (there is no commit_sha yet, so this
// never calls `checks_verdict_report` — that attestation still happens via /cynap-checks after
// the commit lands). "No skip flag, because a commit that can't activate blocks the chain."

import { mapWithConcurrency } from './workspace-sync.mjs';

/** In-flight `workspace_get_file` reads — the same bound /cynap-pull uses. */
const READ_CONCURRENCY = 8;

function fileBytes(path, file) {
  if (typeof file?.content !== 'string' || (file.encoding !== 'utf8' && file.encoding !== 'base64')) {
    throw new Error(`workspace_get_file ${path}: reply has no {encoding, content}`);
  }
  return new Uint8Array(Buffer.from(file.content, file.encoding));
}

/**
 * The DEPLOYED (live) checks/** suite files — same HEAD-correctness rule as /cynap-checks
 * (spec §5.1 step 0): checks are git-PR-only, so a pending/tip draft gates nothing.
 * `call(name, args)` is the caller's already-proxy-bound MCP call — same shape as every other
 * `call` in cynap-push.mjs/cynap-pull.mjs, not the raw 3-arg `mcpCall(proxyUrl, name, args)`.
 */
export async function fetchLiveCheckFiles(call) {
  const tree = await call('workspace_tree', { commit: 'live' });
  if (tree?.ok === false) throw new Error(`workspace_tree(live) refused: ${tree.code}`);
  const entries = Array.isArray(tree?.entries) ? tree.entries : [];
  const paths = entries
    .map((e) => e?.path)
    .filter((p) => typeof p === 'string' && p.startsWith('checks/') && p.endsWith('.json'))
    .sort();
  const bytes = await mapWithConcurrency(paths, READ_CONCURRENCY, async (path) => {
    const file = await call('workspace_get_file', { path, commit: 'live' });
    if (file?.ok === false) throw new Error(`workspace_get_file(${path}) refused: ${file.code}`);
    return fileBytes(path, file);
  });
  const bytesByPath = new Map(paths.map((path, i) => [path, bytes[i]]));
  return bytesByPath;
}

/**
 * Runs the checks engine over this push's planned bytes. `resolvePlanned(path)` returns the
 * post-push bytes for a path THIS push touches (a create/update's new bytes, or `null` for a
 * delete), or `undefined` when this push doesn't touch that path — the current pending TIP is
 * read as the fallback, since this push layers on top of it. `evaluateChecks` /
 * `collectFingerprintPaths` come from the bundled cynap-checks-core.mjs (the same engine
 * /cynap-checks uses).
 */
export async function runChecksPreflight({ call, resolvePlanned, evaluateChecks, collectFingerprintPaths }) {
  const liveChecks = await fetchLiveCheckFiles(call);
  if (liveChecks.size === 0) return { ran: false };

  const headPaths = [...liveChecks.keys()];
  const suites = headPaths.map((path) => JSON.parse(Buffer.from(liveChecks.get(path)).toString('utf8')));

  const fPaths = collectFingerprintPaths(suites, headPaths);
  const snapshot = new Map();
  const toFetch = [];
  for (const path of fPaths) {
    if (liveChecks.has(path)) {
      snapshot.set(path, liveChecks.get(path));
      continue;
    }
    const planned = resolvePlanned(path);
    if (planned !== undefined) snapshot.set(path, planned);
    else toFetch.push(path);
  }
  const fetched = await mapWithConcurrency(toFetch, READ_CONCURRENCY, async (path) => {
    const file = await call('workspace_get_file', { path, commit: 'tip' });
    return file?.ok === false ? null : fileBytes(path, file);
  });
  toFetch.forEach((path, i) => snapshot.set(path, fetched[i]));
  const resolve = (path) => snapshot.get(path) ?? null;
  const run = evaluateChecks(suites, resolve);
  const firstFailure = run.suites.flatMap((s) => s.assertions).find((a) => !a.passed);
  return { ran: true, run, firstFailure };
}
