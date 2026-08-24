---
name: choose-the-right-mode
description: Route an authoring task to the correct one of Cynap's 3 live automation modes (code_execution/flow/deterministic) before writing anything — the wrong mode fails config validation or wastes runtime budget.
---

# choose-the-right-mode — The 3-Mode Router

You are about to author a new automation, bot, or scheduled job for a
customer org. **Pick the mode before writing any config or code.** Read
`platform-invariants` first if you haven't this session.

## ⛔ `mode:agent` and `mode:handler` are RETIRED — they no longer validate

[internal reference omitted from public mirror]'s
`RETIRED_EXECUTION_MODES` map rejects both loudly at the config trust
boundary (`agent`: CYN-1045 — agent-runner and the Daytona agent dispatch
arm are deleted; `handler`: CYN-729 — the Daytona handler dispatch arm and
`HandlerExecutionSchema` are deleted). If you find either mode name in an
old doc, ticket, or config, it is stale — do not author it, and do not
"restore" it. Everything both modes used to cover is now `code_execution`
(single-file handler contract, TypeScript, selective LLM calls, browser/
filesystem/multi-turn agent sessions) — see `author-a-code-execution`.

## The 3 live modes, cost-ordered (cheapest last, most expensive first)

Per ADR [internal reference omitted from public mirror] and
[internal reference omitted from public mirror] §Architecture "Automation System — 3 authorable modes":

| Mode | Runtime | LLM | Runtime→COGS | Deliverable shape |
|---|---|---|---|---|
| **code_execution** | Per-run AWS Lambda MicroVM (Firecracker) | Selective (`ctx.tools.llm.complete()`) or a full headless OpenCode session (`entrypoint: 'opencode'`), depending on the task | Per-run microVM time — the most expensive of the 3, still cheaper than the old Daytona sandbox model it replaced | `automations/handlers/{id}/config.json` + single-file `handler.ts` |
| **flow** | Lambda | BYOK, per-message | ~free (no sandbox) | `communication/flows/{id}/flow.json` (+ optional `bots.json`) |
| **deterministic** | Lambda | No agentic loop — a fixed step sequence may include a bounded `llm` tool call | **Cheapest** — Lambda only, no sandbox, no AI credits (beyond an optional bounded `llm` step) | single `automations/{automation-id}.json` with `execution.steps[]` |

## Decision rules (apply in this order)

1. **Is this a conversational bot** (WhatsApp/Slack/Roam DM, replies to a
   human in real time)? → **`flow`**. This is the only path for new
   conversational bots — see `author-a-flow`.

2. **Is there no agentic LLM loop driving control flow** — a scheduled
   sync, reconciler, or ETL job driven by a small, closed step vocabulary
   (`tool`/`set`/`condition`/`parallel`/`sync`/`land`), where any LLM
   involvement is at most a single declared `llm` tool call inside a fixed
   step sequence (a bounded transform/classification call, never a chat
   loop that decides what to do next)? → **`deterministic`**. This is the
   cheapest mode and the correct default for "pull data from an integration
   on a schedule and write it to Turso," including one that classifies a
   field via a bounded LLM call along the way. It is **not** a general
   workflow engine and **not** a home for platform infra jobs (reapers,
   drift-check, cleanup stay hardcoded backend Lambdas — modeling those as
   customer config would invert the trust boundary). See
   `author-a-deterministic-automation`.

3. **Otherwise — everything else**: classification/extraction plus
   deterministic TypeScript logic (parsing, validation, a fixed decision
   tree, direct Turso writes), OR a task that genuinely needs browser
   automation, filesystem access, or a long-running multi-turn agent
   workflow → **`code_execution`**. Both live on the same runtime now; pick
   `entrypoint: 'worker'` (a `.ts` handler you write, selective
   `ctx.tools.llm.complete()` calls) for the classification/extraction/
   Turso-write case, or `entrypoint: 'opencode'` (a headless agent chat
   session, add `capabilities: ['browser']` if it needs a browser) for the
   agentic-workflow case. **Prefer `entrypoint: 'worker'` with
   `ctx.tools.llm.complete(prompt, { model })`** and a cheap fast model
   (Gemini Flash class) over a full OpenCode session wherever the task is
   really classification/extraction — it's cheaper, unit-testable via
   `MockCynapContext`, and decoupled from sandbox provisioning. See
   `author-a-code-execution`.

## The trap to avoid

The single most common mis-route: authoring a conversational bot as
`code_execution` with `entrypoint: 'opencode'` because that's the "AI mode"
that sounds right. It is not — conversational bots are **Flows & Bots
(Flow-Runner)**, full stop. The headless-agent entrypoint is reserved for
browser/filesystem/multi-turn DATA tasks, not customer-facing chat.

The second most common mis-route: assuming `deterministic` mode can't call
an LLM at all, then reaching for `code_execution` when `deterministic` would
have been cheaper and correct. It CAN — a `tool` step whose declared
`impl.type` is `'llm'` runs through `executeLlmTool` exactly like
`http`/`automation` (`deterministic-runner.ts:76-77`;
`customer-config-validator.ts`'s deterministic arm sanctions `'llm' | 'http'
| 'automation'` as the tool-impl set — the retired `'transform'` type's own
rejection message says "Use 'llm' tool with a transformation prompt
instead"). The real distinction `deterministic` enforces is **no agentic
loop** — no chat session deciding what to do next, no reasoning driving
control flow — not "no LLM whatsoever." A fixed sequence of steps where one
step happens to be a bounded `llm` call for a transform/classification is
still `deterministic`; an open-ended chat session that decides its own next
action is `code_execution` (`entrypoint: 'opencode'`) or `flow`. See
`author-a-deterministic-automation` for the exact vocabulary.

## Links

- Conversational bot → `author-a-flow`
- TypeScript handler with selective LLM / Turso writes, or a headless
  browser/filesystem agent session → `author-a-code-execution`
- No-LLM scheduled sync/reconciler/ETL → `author-a-deterministic-automation`
- Schema/entity changes (any mode) → `author-a-schema-change`
- Shared cross-mode constraints → `platform-invariants`

---

**Spec references:** CYN-768 P2 §2.5 · CYN-1457 · [internal reference omitted from public mirror] §Architecture "Automation System — 3 authorable modes" · [internal reference omitted from public mirror] · [internal reference omitted from public mirror] (`RETIRED_EXECUTION_MODES`, `ExecutionSchema`).
