// Client-side pre-check for spec §4.3 / §7.3 step 1: /cynap-push refuses locally when the
// plan includes a `generated`/`unknown` path or a `kind_not_activatable` kind, naming each
// path's entrance. `classifyPath`/`isGeneratedPath` come from the bundled checks core
// (cynap-checks-core.mjs, built from the SDK's single KIND_REGISTRY declaration).
// DEFERRED_ACTIVATION_KINDS, OWN_ENTRANCE_KINDS and COMMIT_ONLY_KINDS are not in the SDK (they are server-only),
// so this is a literal mirror, pinned by a private parity test — the same accepted pattern as operator-proxy.mjs's IDEMPOTENT_TOOL_NAMES
// (see its own module doc). This is a UX convenience, never the trust boundary: the server
// (workspace_commit step 6, spec §4.3) is the real gate and refuses the same paths with the
// same `kind_not_activatable` code regardless of what this local pre-check catches.

/** Kinds with their OWN activation entrance — never activatable through the config-kind
 * approve=deploy tool (activatable-kinds.ts `OWN_ENTRANCE_KINDS`). */
export const OWN_ENTRANCE_KINDS = new Set(['handler-source', 'surface-source']);

/** Kinds whose operator activation is deferred to git-PR wiring
 * (activatable-kinds.ts `DEFERRED_ACTIVATION_KINDS`). */
export const DEFERRED_ACTIVATION_KINDS = new Set([
  'org-manifest',
  'solution-manifest',
  'handler-manifest',
  'automation-script',
  'portal-config',
  'runtime-config',
  'checks',
]);

/** Kinds committed through workspace_commit but never consumed by a runtime reader
 * (activatable-kinds.ts `COMMIT_ONLY_KINDS`) — /cynap-push never refuses them locally. */
export const COMMIT_ONLY_KINDS = new Set(['operator-note']);

/** `entrance` per spec §4.3's `kind_not_activatable {paths: [{path, kind, entrance}]}`. */
export function entranceForKind(kind) {
  if (OWN_ENTRANCE_KINDS.has(kind)) return 'handler_upload';
  if (DEFERRED_ACTIVATION_KINDS.has(kind)) return 'git';
  return null;
}

/** Classifies a planned path and returns the local refusal reason, or null if it's fine to
 * commit. `classifyPath` is the bundled `@cynap/sdk` classifier (generated/unknown/<kind>). */
export function classifyForPush(path, classifyPath) {
  const kind = classifyPath(path);
  if (kind === 'generated' || kind === 'unknown') return { path, kind, entrance: null };
  const entrance = entranceForKind(kind);
  if (entrance) return { path, kind, entrance };
  return null;
}
