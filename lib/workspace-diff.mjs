// Pure diff logic for /cynap-pull (three-way merge) and /cynap-push (plan building). No I/O —
// every function takes plain path→sha256hex maps (or a Set of paths) and returns a decision.

/**
 * Spec §7.2 step 2/3 — three-way compare of base (`state.files`), local (hash on disk) and
 * remote (the pinned tip tree): a remote-only change is taken, a local-only change is kept,
 * and a change to different bytes on both sides is a conflict.
 *
 * `base`, `local`, `remote` are `Map<path, sha256hex>` — a missing key means the path doesn't
 * exist there. `takeRemoteOverrides` is a `Set<path>` of `--take-remote` paths that resolve a
 * conflict in the remote's favor.
 */
export function threeWayDiff({ base, local, remote, takeRemoteOverrides = new Set() }) {
  const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const takeRemote = [];
  const keepLocal = [];
  const conflicts = [];
  const unchanged = [];

  for (const path of paths) {
    const baseSha = base.get(path);
    const localSha = local.get(path);
    const remoteSha = remote.get(path);
    const remoteChanged = remoteSha !== baseSha;
    const localChanged = localSha !== baseSha;

    if (!remoteChanged && !localChanged) {
      unchanged.push(path);
    } else if (remoteChanged && !localChanged) {
      takeRemote.push(path);
    } else if (!remoteChanged && localChanged) {
      keepLocal.push(path);
    } else if (remoteSha === localSha) {
      // Both sides moved to the identical bytes — converged, not a conflict.
      unchanged.push(path);
    } else if (takeRemoteOverrides.has(path)) {
      takeRemote.push(path);
    } else {
      conflicts.push({ path, localSha: localSha ?? null, remoteSha: remoteSha ?? null });
    }
  }

  return { takeRemote: takeRemote.sort(), keepLocal: keepLocal.sort(), conflicts: conflicts.sort((a, b) => a.path.localeCompare(b.path)), unchanged: unchanged.sort() };
}

/**
 * Spec §7.3 step 1 — plan create/update/delete against `state.files` (the base). `base` and
 * `local` are `Map<path, sha256hex>`. Returns `{creates, updates, deletes}` path lists; the
 * caller reads actual bytes and encodes them (spec §5.4) when building the wire changeset.
 */
export function buildPushPlan({ base, local }) {
  const creates = [];
  const updates = [];
  const deletes = [];
  const paths = new Set([...base.keys(), ...local.keys()]);
  for (const path of paths) {
    const baseSha = base.get(path);
    const localSha = local.get(path);
    if (localSha === undefined) {
      deletes.push(path);
    } else if (baseSha === undefined) {
      creates.push(path);
    } else if (baseSha !== localSha) {
      updates.push(path);
    }
  }
  return { creates: creates.sort(), updates: updates.sort(), deletes: deletes.sort() };
}
