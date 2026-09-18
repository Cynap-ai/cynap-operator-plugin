# LEARNINGS — author-a-code-execution (cross-org)

Cross-org procedural wisdom for `mode:code_execution` (`entrypoint:worker`)
authoring — the mode `mode:handler` migrated into. Read at task start;
append at task end. No customer-specific strings.

---

## What worked

- **Leading with the `knowledge.store` upsert-by-name gotcha as a quoted
  incident, not an abstract warning.** The concrete "zero stage mutations +
  thousands of false observations" framing makes the failure mode
  memorable in a way "store() upserts by name" alone does not.
- **Test-first framing (MockCynapContext before handler.ts).** Handlers
  that shipped without a characterization test of the write path have been
  the single biggest source of silent-data-corruption incidents across
  orgs; leading authoring with "write the test first" catches this before
  first deploy rather than after.

## What failed

- Handlers written with an assumed fixed batch cap (e.g. always chunking at
  10) that then either under-utilized the Function-URL 200 cap or hit
  `BATCH_TOO_LARGE` on the API Gateway 20 cap depending on which transport
  the platform happened to select. The fix is to catch `BATCH_TOO_LARGE`
  and re-chunk to the size named in the error, not to hardcode either
  number.
- Handlers that assumed `ctx.identity` existed because it "feels like" it
  should, given other frameworks' context objects — always a compile-time
  type error once the SDK types are checked, but costly if authored against
  stale memory of the shape.

## Patterns

- The `acme-stage-evaluator` handler is the canonical worked example for
  BOTH the knowledge-write gotcha AND the single-file-with-inlined-logic
  pattern (a sibling `.logic.ts` as unit-tested source of truth, inlined
  verbatim into `handler.ts`, sync-guarded by a test). Point authoring
  tasks at it when the task needs more than the minimal lease-probe
  example.
- `execution.allowed_tools` drift (handler calls a tool not in the
  allowlist) fails at RUNTIME, not at config-parse time — always grep the
  finished `handler.ts` for every `ctx.tools.` call site as the last step
  before finalizing `config.json`.

## Open questions

- (Resolved 2026-08-11) `dispatch_mode` is fixed `'async'` for
  `mode:code_execution` — there's no longer a sync-vs-async choice to
  document a worked example for; `max_runtime_ms` (clamped `[1s, 2h]`) is
  the only runtime-budget knob now.
- Should this skill include a worked `entrypoint: 'opencode'` +
  `capabilities: ['browser']` example once a committed one exists with a
  real browser-automation task? Current: `author-a-code-execution` focuses
  on `entrypoint: 'worker'`; the headless-agent entrypoint is only
  described at a high level as of 2026-08-11.

---

**Last updated:** 2026-08-11 (migrated from `mode:handler` to
`mode:code_execution`; dispatch_mode question resolved).
