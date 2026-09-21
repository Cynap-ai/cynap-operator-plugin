---
name: choose-the-right-mode
description: Route an authoring task to the correct one of Cynap's 3 live automation modes (code_execution/flow/deterministic) before writing anything — the wrong mode fails config validation or wastes runtime budget.
---

# choose-the-right-mode — The 3-Mode Router

You are about to author a new automation, bot, or scheduled job for a
customer org. **Pick the mode before writing any config or code.** Read
`platform-invariants` first if you haven't this session. If any route below
makes an AI call, also read `configure-customer-ai`; funding and provider
availability are independent of execution mode.

## Retired modes

`mode:agent` and `mode:handler` are retired — migrate to mode:code_execution.

## The 3 live modes

| Mode | Runtime | AI shape | Billing implication | Deliverable shape |
|---|---|---|---|---|
| **code_execution** | Per-run isolated runtime | Selective (`ctx.tools.llm.complete()`) or a full headless agent session (`entrypoint: 'opencode'`) | Runtime is charged separately; each AI call follows the org's native/BYOK funding record. | `automations/handlers/{id}/config.json` + single-file `handler.ts` |
| **flow** | Platform runtime | One or more model round-trips in a conversation | Each round-trip is customer AI consumption; native/BYOK rules apply and ordinary runtime charges still apply. | `communication/flows/{id}/flow.json` (+ optional `bots.json`) |
| **deterministic** | Platform runtime | No agentic loop; a fixed sequence may include a bounded `llm` tool call | Runtime stays cheap, but an `llm` step still incurs customer AI consumption under the org's funding mode. | single `automations/{automation-id}.json` with `execution.steps[]` |

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
   on a schedule and write it to the org database," including one that
   classifies a field via a bounded LLM call along the way. It is **not** a
   general workflow engine and **not** a home for platform infra jobs
   (reapers, drift-check, cleanup stay hardcoded platform jobs — those are
   the platform's decisions, not customer config). See
   `author-a-deterministic-automation`.

3. **Otherwise — everything else**: classification/extraction plus
   deterministic TypeScript logic (parsing, validation, a fixed decision
   tree, direct org-database writes), OR a task that genuinely needs browser
   automation, filesystem access, or a long-running multi-turn agent
   workflow → **`code_execution`**. Both live on the same runtime now; pick
   `entrypoint: 'worker'` (a `.ts` handler you write, selective
   `ctx.tools.llm.complete()` calls) for the classification/extraction/
   org-database-write case, or `entrypoint: 'opencode'` (a headless agent chat
   session, add `capabilities: ['browser']` if it needs a browser) for the
   agentic-workflow case. **Prefer `entrypoint: 'worker'` with
   `ctx.tools.llm.complete(prompt, { model })`** and a cheap fast model
   (Gemini Flash class) over a full headless agent session wherever the task is
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
`impl.type` is `'llm'` is supported and validated like `http`/`automation`.
The real distinction `deterministic` enforces is **no agentic
loop** — no chat session deciding what to do next, no reasoning driving
control flow — not "no LLM whatsoever." A fixed sequence of steps where one
step happens to be a bounded `llm` call for a transform/classification is
still `deterministic`; an open-ended chat session that decides its own next
action is `code_execution` (`entrypoint: 'opencode'`) or `flow`. See
`author-a-deterministic-automation` for the exact vocabulary.

## Links

- Conversational bot → `author-a-flow`
- TypeScript handler with selective LLM / org-database writes, or a headless
  browser/filesystem agent session → `author-a-code-execution`
- Fixed-step scheduled sync/reconciler/ETL → `author-a-deterministic-automation`
- Schema/entity changes (any mode) → `author-a-schema-change`
- Shared cross-mode constraints → `platform-invariants`
- Any AI call or model selection → `configure-customer-ai`

---
