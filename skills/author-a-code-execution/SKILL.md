---
name: author-a-code-execution
description: Author a mode:code_execution automation — a single-file TypeScript handler (entrypoint:worker), the cheapest way to add selective LLM calls plus deterministic logic and writes to the org database, a scripted browser job (worker + capabilities:["browser"] + session_providers). Use after choose-the-right-mode routes here.
---

# author-a-code-execution — Code-Execution-Mode Authoring

Check `choose-the-right-mode`'s workspace capability matrix for each path
and operation. Customer-read descriptions, Markdown, and SQL comments must
not expose internal ticket or document identifiers, invariant codes, vendor
datastore/runtime names, raw internal table names, or platform-only package
names. Keep these details in private engineering records, not customer copy.

## Publish a handler change

Only `code_execution` handlers have a preview. Flow and deterministic modes have no preview.
A worker handler with `capabilities: ["browser"]` previews like any other: it runs on data copies, the vendor session never enters the VM, and every write is captured and listed for owner approval at activation. Activation needs a passing `/cynap-preview`. Probation still applies after activation.
A preview requires a committed fixture input file for the selected trigger;
add that file before running `/cynap-preview <automation-id> <commit-sha>`.

Handler code must not use raw network APIs such as `fetch` or `node:https`. Call
`ctx.tools.http` with a declared destination so preview can capture the effect.

Commit the handler source and its matching config through `workspace_commit`. Run the checks and obtain a passing handler preview for that exact bundle. The organization owner then reviews the server-read commit and handler diff in the approval page; approval freezes the commit, bundle hash and live generation. The owner activates that approved commit through `workspace_activate_commit`. Do not use `handler_upload` or paste source into an approval form.

If activation returns `handler_unproven`, run `/cynap-preview <automation-id> <commit-sha>` and obtain a passing preview for the exact bundle. If it returns `preview_unavailable`, preview admission is closed and this commit blocks the ordered chain; stop and report it instead of retrying activation. `bundle_hash_mismatch` means the checked bundle differs from the approved one. `handler_base_moved` means the live generation advanced; make a new commit against the new base and request a fresh approval. `handler_effect_absent` means recovery fenced an effect that never committed; inspect the receipt and retry through the new commit path. A bad handler is repaired forward with a new commit, approval and activation. Do not roll back an older pointer over a newer generation.

You are authoring a **`mode:code_execution` automation** for one customer
org — it is the only code-bearing mode on this platform. It runs in
a per-run isolated runtime. If you haven't confirmed this is the right mode,
go read `choose-the-right-mode` first. Read `platform-invariants` before
this skill if you haven't this session. If the handler uses `ctx.tools.llm`,
also read `configure-customer-ai` and explain
native versus BYOK billing before choosing a model.

## One entrypoint

`execution.entrypoint` is `'worker'` (the default, and the only accepted
value): it runs your single-file `handler.ts`, with selective
`ctx.tools.llm.complete()` calls and no chat loop. Use it for
classification/extraction plus deterministic TypeScript logic and writes to
the org database. A headless agent chat session (`entrypoint:'opencode'`) no
longer exists; a config that names it is rejected at validation.

## Browser work

`execution.capabilities: ["browser"]` is valid on a `worker`. It is
intent: the platform picks the Chromium-capable image at the ≥4GB tier. The
only capability value the platform accepts today is `"browser"`.

| Route | `execution` | What drives the browser | Use when |
|---|---|---|---|
| **worker + browser** | `"entrypoint": "worker"`, `"capabilities": ["browser"]`, plus `handler.ts` | Your handler, deterministically: it runs the agent-browser CLI (`ab`, on PATH) itself. No LLM in the loop. | The pages and steps are known in advance — a nightly scrape, a sync that walks a list, a form an invoice writer fills. This is the production pattern for scripted browser jobs. |

A logged-in browser job adds a **stored session**:

```json
"execution": {
  "mode": "code_execution",
  "entrypoint": "worker",
  "capabilities": ["browser"],
  "session_providers": ["<provider>"],
  "http_allowlist": ["*.<provider-host>"],
  "allowed_tools": ["knowledge.storeBatch"],
  "max_runtime_ms": 900000
}
```

- `session_providers` injects the org's stored session for each named
  provider as `ctx.input.secrets.<provider>_session` — a JSON string
  `{cookies, userAgent}`. Your handler applies it (set the cookies and user
  agent on agent-browser before the first navigation).
- Injection is non-fatal: a missing or invalid session leaves the secret
  unset. The handler must fail closed when it is absent — return a failure,
  never scrape logged-out pages and report success.
- Egress is still gated by `http_allowlist`: list the provider's hosts.
- `session_providers` also works WITHOUT the browser capability, for a worker
  that calls the provider over `ctx.tools.http` with the session's cookies.
- Browser runs are switched on per environment by the platform. A config the
  platform accepts is not proof that browser runs are enabled where it runs —
  check the run's log before calling a new browser job done.

Before you tell anyone a browser job would be the org's first, read the
org's existing configs' `execution.capabilities` and
`execution.session_providers` (the operator context lists them in its
capability index). `mode` and `entrypoint` alone cannot show a browser job.

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

**No top-level `tools: []`.** `mode:code_execution` REJECTS it at parse time:
"`tools[]`
is ignored for mode:code_execution - declare callable ctx.tools in
execution.allowed_tools instead." Declare every callable in `execution.allowed_tools`.

`handler.ts`:

```typescript
import type { CynapContext } from '@cynap/sdk';

export default async function handler(ctx: CynapContext): Promise<Record<string, unknown>> {
  // ... your logic ...
  return { ok: true };
}
```

## Gotchas (all verified against the live platform)

1. **NO `ctx.identity`.** The `CynapContext` shape is `{ input, tools, step,
   meta: {id, name, orgSlug, orgId, runId, triggeredBy, triggeredAt}, log }`.
   There is no `identity` field — workers run with an org-scoped service
   token, never a user-scoped one. `tools` (`CynapTools`) has **five**
   members — `{ http, knowledge, llm, automation, channel }` — not just the
   three most examples touch. `automation` is cross-automation dispatch (trigger
   another automation in this org); `channel` is a communication-channel
   send (Roam, Telegram, WhatsApp, Slack, email) — used by prod ACME
   handlers (`invoice-approval`, `pharmacist-payout`,
   `acme-stale-verification-scan`). Both are declared in
   `execution.allowed_tools` exactly like `http`/`knowledge`/`llm` — e.g.
   an active channel send is `"channel.send"`, cross-automation dispatch is
   `"automation.trigger"`. If you need to know which
   channel sender triggered a run, it arrives as
   **`ctx.input.channel_sender`** — server-injected, not user-forgeable
   (the platform rejects any attempt to supply `channel_sender` in
   trigger_data and merges the server-resolved value last). Real pattern
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

3. **Single-file ONLY — no sibling imports.** The upload path is a plain
   single-file transpile with **no module resolution**. A sibling relative
   import (`import { x } from './logic'`) throws "Cannot find module" at
   runtime or, worse, silently executes an older cached version. If your
   logic needs decomposition for testability, keep a sibling `.logic.ts`
   file as the **unit-tested source of truth** but **inline the same logic
   into `handler.ts` verbatim**, and add a test asserting the two stay
   byte/behavior-matched (see `acme-stage-evaluator`'s pattern of an
   inlined const + a sync-guard test).

4. **Do not hardcode a batch size.** The platform picks the transport and
   sets the cap (about 20, up to 200). Call `knowledge_store_batch`; if it
   returns `BATCH_TOO_LARGE`, re-chunk to the size named in the error.

5. **`execution.allowed_tools` is REQUIRED** (empty `[]` is allowed — that's
   the secure default, not an omission). `execution.allowed_tools ===
   undefined` is a hard rejection by the platform's safety checks.
   Declare every `ctx.tools.X.Y` method the handler calls; the runtime
   enforces a strict allowlist. A handler calling
   `ctx.tools.knowledge.executeSql` without `"knowledge.executeSql"` in
   `allowed_tools` is denied at runtime, not at config-parse time — verify
   your allowlist matches your code by reading every `ctx.tools.` call site
   before finalizing `config.json`.

6. **`dispatch_mode` is fixed `'async'`** — every run is dispatched
   asynchronously; there is no synchronous path. Set `max_runtime_ms`
   realistically; the platform clamps it between 1s and 2h (default
   60 min). At the limit the run stops: no new tool call starts, and the
   run is recorded `timed_out` (or `unresolved` if a reply was owed or a
   write was attempted). Set `execution.rerun_safe: true` only if
   re-running from the start is safe.

## A minimal correct example

`config.json`:
```json
{
  "id": "example-probe",
  "name": "Example Probe",
  "version": "1.0",
  "enabled": true,
  "triggers": [{ "type": "manual", "description": "..." }],
  "execution": { "mode": "code_execution", "entrypoint": "worker", "max_runtime_ms": 120000, "allowed_tools": [] },
  "params": {},
  "metadata": { "description": "...", "tags": ["example", "test"], "created_at": "2026-05-22T00:00:00Z", "created_by": "claude-code" },
  "portal_visible": false
}
```

`handler.ts`:
```typescript
import type { CynapContext } from '@cynap/sdk';

export default async function handler(
  ctx: CynapContext
): Promise<{ ok: boolean; ranInSandbox: true; at: string }> {
  await ctx.log.info('example_probe_start', { note: 'runtime lifecycle probe' });
  await ctx.log.info('example_probe_done', {});
  return { ok: true, ranInSandbox: true, at: new Date().toISOString() };
}
```

For a real example WITH `allowed_tools` populated and a knowledge write,
see `automations/handlers/acme-stage-evaluator/config.json`
(`"allowed_tools": ["knowledge.advancedQuery", "knowledge.store",
"knowledge.executeSql"]`) and its `handler.ts` for the `executeSql`
UPDATE-by-id pattern. (Check that its `mode` is `"code_execution"` and it has no
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

1. Confirm `code_execution` is right (`choose-the-right-mode`). A scripted
   browser job is `entrypoint: 'worker'` + `capabilities: ['browser']` (+
   `session_providers` when it logs in); everything else is
   `entrypoint: 'worker'` with a `.ts` handler.
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

## Declare a freshness expectation

A scheduled automation that can write should declare how much it must get done, so a schedule that
runs green while applying nothing is caught. Add a block to the config, with a window you actually
mean (a window shorter than the schedule interval draws a warning):

```json
"freshness": { "min_effects": 1, "window": "36h" }
```

`min_effects` is 1–10,000 and `window` is `<n>h` or `<n>d` (1 hour to 90 days). `kinds` is optional:
a non-empty set drawn from `write`, `message`, `automation_trigger`, `artifact_write` and
`outbound_request`; omitted, it counts every kind except `artifact_write`. Freshness measures
activity, not truth: a no-op write still counts. To catch "the data went stale", author an
Operations Condition (`operations/conditions/*.yaml` with `analytics_read` and `stale_after_seconds`)
as well. A plan-only automation that never applies effects declares no `freshness`.
