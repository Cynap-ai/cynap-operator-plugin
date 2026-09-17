---
name: author-a-code-execution
description: Author a mode:code_execution automation — a single-file TypeScript handler (entrypoint:worker) or a headless agent session (entrypoint:opencode), the cheapest way to add selective LLM calls plus deterministic logic and Turso writes, or a browser/filesystem agent task. Use after choose-the-right-mode routes here.
---

# author-a-code-execution — Code-Execution-Mode Authoring

You are authoring a **`mode:code_execution` automation** for one customer
org — the live, single code-bearing mode on this platform (CLAUDE.md
§Architecture: `mode:handler` and `mode:agent` are **REMOVED** — migrate to
`mode:code_execution`). It runs in a per-run AWS Lambda MicroVM (Firecracker), not
a Daytona sandbox. If you haven't confirmed this is the right mode, go read
`choose-the-right-mode` first. Read `platform-invariants` before this skill
if you haven't this session.

## Two entrypoints, one mode

`execution.entrypoint` picks the runtime shape (`unified-automation-types.ts`
`CodeExecutionSchema`, default `'worker'`; validated
`customer-config-validator.ts` `validateCodeExecutionExecution`):

- **`worker`** (default) — runs your single-file `handler.ts`, selective
  `ctx.tools.llm.complete()` calls, no chat loop. `mode:handler` is RETIRED — migrate to
  `mode:code_execution` for this deliverable shape. Use for classification/extraction plus
  deterministic TypeScript logic and Turso writes.
- **`opencode`** — a headless agent chat session on the OpenCode microVM
  image. Add `capabilities: ['browser']` to get the glibc OpenCode +
  Chromium image (≥4GB tier, `resolveImageFamily`) for browser automation.
  `mode:agent` is RETIRED — migrate to `mode:code_execution`
  for browser/filesystem/multi-turn workloads. **Prefer `worker` for classification/extraction** —
  only reach for `opencode` when the task genuinely needs browser,
  filesystem, or a long-running multi-turn agent workflow.

Both entrypoints share the same `allowed_tools`/`http_allowlist` contract
below. This skill focuses on the `worker` entrypoint (the common case); for
`opencode`, the config shape is the same minus `handler.ts` — the sandbox
drives an LLM chat turn directly.

## Deliverable shape (worker entrypoint) — exactly TWO files

```
automations/handlers/{handler-id}/config.json
automations/handlers/{handler-id}/handler.ts
```

(Nested `handlers/<id>/config.json` layout takes precedence over the flat
`automations/<id>.json` layout — a stale flat file silently shadows a new
nested bundle.)

`config.json`:

```json
{
  "id": "{handler-id}",
  "name": "Human Name",
  "version": "1.0",
  "enabled": true,
  "triggers": [ { "type": "manual" | "schedule" | "mcp" | "webhook", "...": "..." } ],
  "execution": {
    "mode": "code_execution",
    "entrypoint": "worker",
    "max_runtime_ms": 120000,
    "allowed_tools": []
  },
  "params": {},
  "metadata": { "description": "...", "tags": [], "created_at": "...", "created_by": "..." },
  "portal_visible": false
}
```

**No top-level `tools: []`.** `mode:code_execution` REJECTS it at parse time
(`AutomationSchema.superRefine` in `unified-automation-types.ts`): "`tools[]`
is ignored for mode:code_execution - declare callable ctx.tools in
execution.allowed_tools instead." `mode:handler` is retired — migrate to `mode:code_execution`
and move the old top-level `tools[]` declarations to `execution.allowed_tools`.

`handler.ts`:

```typescript
import type { CynapContext } from '@cynap/sdk';

export default async function handler(ctx: CynapContext): Promise<Record<string, unknown>> {
  // ... your logic ...
  return { ok: true };
}
```

## Gotchas (verified against `unified-automation-types.ts`, `customer-config-validator.ts`, `handler-executor.ts`, `handler-storage.ts`, `entity-schemas.ts`/`knowledge-handlers.ts`)

1. **NO `ctx.identity`.** the operator safety rules
   `CynapContext` shape is `{ input, tools, step, meta: {id, name, orgSlug,
   orgId, runId, triggeredBy, triggeredAt}, log }`. There is no `identity`
   field — workers run with an org-scoped service token, never a
   user-scoped one. `tools` (`CynapTools`, the tool-surface source of
   truth: the operator tool contract) has **five** members —
   `{ http, knowledge, llm, automation, channel }` — not just the three
   most examples touch. `automation` is cross-automation dispatch (trigger
   another automation in this org); `channel` is a communication-channel
   send (Roam, Telegram, WhatsApp, Slack, email) — used by prod ACME
   handlers (`invoice-approval`, `pharmacist-payout`,
   `acme-stale-verification-scan`). Both are declared in
   `execution.allowed_tools` exactly like `http`/`knowledge`/`llm` — e.g.
   an active channel send is `"channel.send"`, cross-automation dispatch is
   `"automation.trigger"`. If you need to know which
   channel sender triggered a run, it arrives as
   **`ctx.input.channel_sender`** — server-injected, not user-forgeable
   (`mcp-server.ts`'s `assertValidAutomationTriggerRequest` rejects any
   attempt to supply `channel_sender` in trigger_data and merges the
   server-resolved value last). Real pattern
   (`automations/handlers/whatsapp-facilitator/handler.ts:84-92`):

   ```typescript
   const senderObj = asObj(input.channel_sender);
   const rawSenderId = senderObj ? getStr(senderObj, 'senderId') : null;
   if (!rawSenderId) {
     // fail closed — missing/empty sender is NEVER a wildcard authorization
     return { reply_text: 'Sorry, you are not authorized to use this service.', ok: false };
   }
   ```

2. **`knowledge.store` upserts by `name`+`type`, NOT by `id`.** To UPDATE an
   existing entity, use `ctx.tools.knowledge.executeSql('UPDATE <table> SET
   <field>=? WHERE id=?', [...])` with a `rowsAffected === 1` guard, or
   `advancedQuery` with a `*__in` filter. Calling
   `knowledge.store('entity', { id, ... })` for an update silently
   duplicates the row or throws `name must be a non-empty string` — the
   documented incident (`acme-stage-evaluator/handler.ts:345`):

   > "IMPORTANT: `knowledge.store('entity', {id, ...})` does NOT update by
   > id — it upserts by name+type. The handler doesn't pass `name`, so the
   > SELECT misses, the fallback INSERT fails on the `patients.name` NOT
   > NULL constraint, and the error is silently swallowed by the SDK
   > transport. Result before 2026-04-29: zero stage mutations + thousands
   > of false 'stage_change' observations."

   `executeSql` is **DML-only** — no `SELECT`; reads go through
   `advancedQuery`/`knowledge_query`.

3. **Single-file ONLY — no sibling imports.** The upload path
   (`handler-upload-bundle.ts`) is a pure `ts.transpileModule` transpile with
   **no module resolution**. A sibling relative import
   (`import { x } from './logic'`) throws "Cannot find module" at runtime
   or, worse, silently executes an older cached version
   (the operator safety rules. If your logic needs decomposition
   for testability, keep a sibling `.logic.ts` file as the **unit-tested
   source of truth** but **inline the same logic into `handler.ts`
   verbatim**, and add a test asserting the two stay byte/behavior-matched
   (see `acme-stage-evaluator`'s pattern of an inlined const + a sync-guard
   test).

4. **Batch cap is transport-dependent, platform-selected — not yours to
   choose.** `knowledge_store_batch` caps at **20 rows over API Gateway**,
   **200 over a Function URL**; the worker (`resolveMcpTarget` in
   `sandbox/handler-runtime/worker.ts`) picks the transport, not the
   handler author. Exceeding the active cap returns a `BATCH_TOO_LARGE`
   error naming the safe size — catch it and re-chunk defensively, but do
   not hardcode an assumed cap.

5. **`execution.allowed_tools` is REQUIRED** (empty `[]` is allowed — that's
   the secure default, not an omission). `execution.allowed_tools ===
   undefined` is a hard rejection at the trust boundary
   (`customer-config-validator.ts` `validateCodeExecutionExecution`).
   Declare every `ctx.tools.X.Y` method the handler calls; the runtime
   enforces a strict allowlist via the sealed-tools IPC layer
   (the operator safety rules. A handler calling
   `ctx.tools.knowledge.executeSql` without `"knowledge.executeSql"` in
   `allowed_tools` is denied at runtime, not at config-parse time — verify
   your allowlist matches your code by reading every `ctx.tools.` call site
   before finalizing `config.json`.

6. **`dispatch_mode` is fixed `'async'`** — every `code_execution` run is
   pre-created and dispatched async; there is no sync-dispatch path (a
   per-run microVM has no persistent VM to answer synchronously). Set
   `max_runtime_ms` realistically instead — it's clamped to `[1s, 2h]`
   (`MAX_RUNTIME_MS_FLOOR`..`MAX_RUNTIME_MS_CEILING`, default 60min), the
   same ceiling `worker.ts`'s `clampMaxRuntime()` enforces regardless of
   the microVM platform's 8h lifetime max. **The budget is a hard stop**
   (ADR-0080): at `max_runtime_ms` the worker starts no new tool call,
   cancels the handler, and records the run `timed_out` — or `unresolved`
   (paging an operator) when a reply was owed or the run had attempted a
   write. Set `execution.rerun_safe: true` only when re-running the
   automation from the start is safe after a partial run (idempotent,
   CAS-guarded writes); it lets a stopped run that wrote land `timed_out`.

## A minimal correct example (real, `cynap-e2e/e2e-lease-probe`)

`config.json`:
```json
{
  "id": "e2e-lease-probe",
  "name": "E2E Lease Probe",
  "version": "1.0",
  "enabled": true,
  "triggers": [{ "type": "manual", "description": "..." }],
  "execution": { "mode": "code_execution", "entrypoint": "worker", "max_runtime_ms": 120000, "allowed_tools": [] },
  "params": {},
  "metadata": { "description": "...", "tags": ["cynap-e2e", "test"], "created_at": "2026-05-22T00:00:00Z", "created_by": "claude-code" },
  "portal_visible": false
}
```

`handler.ts`:
```typescript
import type { CynapContext } from '@cynap/sdk';

export default async function handler(
  ctx: CynapContext
): Promise<{ ok: boolean; ranInSandbox: true; at: string }> {
  await ctx.log.info('e2e_lease_probe_start', { note: 'microVM lifecycle probe' });
  await ctx.log.info('e2e_lease_probe_done', {});
  return { ok: true, ranInSandbox: true, at: new Date().toISOString() };
}
```

For a real example WITH `allowed_tools` populated and a knowledge write,
see `automations/handlers/acme-stage-evaluator/config.json`
(`"allowed_tools": ["knowledge.advancedQuery", "knowledge.store",
"knowledge.executeSql"]`) and its `handler.ts` for the `executeSql`
UPDATE-by-id pattern. (That example predates the `mode:code_execution`
migration and still commits the now-RETIRED `mode` literal — port it by
replacing that literal with `"mode": "code_execution"` and dropping any
top-level `tools: []` before treating it as a template.)

## MockCynapContext — write the test before you write the handler

Handler logic is unit-testable via `MockCynapContext`. Frame every handler
authoring task test-first: write the expected `ctx.tools.*` calls and
assertions against a mock context before finalizing `handler.ts`, so the
first prod deploy is correct against the actual write path (the
`acme-stage-evaluator` incident above cost real data-integrity damage
precisely because the write path wasn't characterized by a test before
shipping).

## Authoring checklist

1. Confirm `code_execution` is right (`choose-the-right-mode`) — if this
   needs a full chat session for browser/filesystem/multi-turn work, use
   `entrypoint: 'opencode'` (add `capabilities: ['browser']` for browser);
   otherwise `entrypoint: 'worker'` with a `.ts` handler.
2. Draft `handler.ts` as a single file — inline everything, no imports
   beyond type-only SDK imports.
3. Do NOT declare a top-level `tools: []` — it's rejected for
   `mode:code_execution`.
4. List every `ctx.tools.X.Y` call site, then populate
   `execution.allowed_tools` to match exactly — including `channel.send`
   (active channel sends) and `automation.trigger` (cross-automation
   dispatch) if used, declared like any other tool.
5. If updating an existing entity, use `executeSql ... WHERE id=?` with a
   `rowsAffected===1` guard — never `knowledge.store` for updates.
6. If reading identity/sender context, use `ctx.input.channel_sender`, never
   invent a `ctx.identity` field.
7. Write a `MockCynapContext` unit test for the write path before
   finalizing.
8. Set `max_runtime_ms` realistically — `dispatch_mode` is fixed `async`.

---

**Spec references:** CYN-768 P2 §2.5 · CYN-1457 · the operator safety rules`CynapTools` — the five-member tool surface: http/knowledge/llm/automation/channel) · the platform validator (`CodeExecutionSchema`, `RETIRED_EXECUTION_MODES`) · the platform validator (`validateCodeExecutionExecution`) · `automations/handlers/acme-stage-evaluator/handler.ts:345` (knowledge.store upsert-by-name gotcha) · `automations/handlers/whatsapp-facilitator/handler.ts:82-92` (channel_sender pattern) · the platform runtime (batch cap transport selection) · the platform validator (BATCH_TOO_LARGE guard).
