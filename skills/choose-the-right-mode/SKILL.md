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

## The 3 live modes

| Mode | Runtime | AI shape | Billing implication | Deliverable shape |
|---|---|---|---|---|
| **code_execution** | Per-run isolated runtime | Selective (`ctx.tools.llm.complete()`) | Runtime is charged separately; each AI call follows the org's native/BYOK funding record. | `automations/handlers/{id}/config.json` + single-file `handler.ts` |
| **flow** | Platform runtime | One or more model round-trips in a conversation | Each round-trip is customer AI consumption; native/BYOK rules apply and ordinary runtime charges still apply. | `communication/flows/{id}/flow.json` (+ optional `bots.json`) |
| **deterministic** | Platform runtime | No agentic loop; a fixed sequence may include a bounded `llm` tool call | Runtime stays cheap, but an `llm` step still incurs customer AI consumption under the org's funding mode. | single `automations/{automation-id}.json` with `execution.steps[]` |

## Decision rules (apply in this order)

1. **Is this a conversational bot** (WhatsApp/Slack/Roam DM, replies to a
   human in real time)? → **`flow`**. This is the only path for new
   conversational bots — see `author-a-flow`.

2. **Is there no agentic LLM loop driving control flow** — a scheduled
   sync, reconciler, or ETL job driven by a small, closed step vocabulary
   (`tool` / `integration_action` / `condition` / `set` / `parallel` / `sync` / `land` / `set_stage` / `set_fields` / `create_record` / `fail`), where any LLM
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
   workflow → **`code_execution`** with `entrypoint: 'worker'` (a `.ts`
   handler you write, selective `ctx.tools.llm.complete()` calls) for the
   classification/extraction/org-database-write case. **A scripted browser job — known pages, known
   steps — is `entrypoint: 'worker'` + `capabilities: ['browser']`**, with
   `session_providers` when it needs the org's stored login: the handler
   drives the browser itself and no LLM is in the loop. **Prefer
   `ctx.tools.llm.complete(prompt, { model })`** with a cheap fast model
   (Gemini Flash class) wherever the task is really
   classification/extraction — it's cheaper, unit-testable via
   `MockCynapContext`, and decoupled from sandbox provisioning. See
   `author-a-code-execution`.

## The trap to avoid

The single most common mis-route: authoring a conversational bot as
`code_execution` because it sounds like the "AI mode". It is not —
conversational bots are **Flows & Bots (Flow-Runner)**, full stop.
`code_execution` is for DATA tasks, not customer-facing chat.

The second most common mis-route: assuming `deterministic` mode can't call
an LLM at all, then reaching for `code_execution` when `deterministic` would
have been cheaper and correct. It CAN — a `tool` step whose declared
`impl.type` is `'llm'` is supported and validated like `http`/`automation`.
The real distinction `deterministic` enforces is **no agentic
loop** — no chat session deciding what to do next, no reasoning driving
control flow — not "no LLM whatsoever." A fixed sequence of steps where one
step happens to be a bounded `llm` call for a transform/classification is
still `deterministic`; an open-ended chat session that decides its own next
action is a `flow`. See
`author-a-deterministic-automation` for the exact vocabulary.

## Workspace path capability matrix

Read this before editing a pulled org tree. Each row names the SDK path kind;
`create`, `update`, and `delete` are the planned operations from `/cynap-push`.

| Kind | Org path | Create | Update | Delete |
|---|---|---|---|---|
| `org-manifest` | `manifest.json` | human | human | human |
| `org-profile` | `profile.json` | activate | activate | activate |
| `org-agents` | `agents.json` | activate | activate | activate |
| `solution-manifest` | `solutions.json` | activate | activate | activate |
| `schema` | `context/schema.json` | activate¹ | activate¹ / reconcile⁵ | human |
| `context-doc` | `context/**/*.json`, `context/**/*.md` | activate | activate | activate |
| `automation` | `automations/*.json` | activate | activate | activate |
| `handler-config` | `automations/handlers/*/config.json` | activate | activate | activate |
| `handler-preview-input` | `automations/handlers/*/preview-input.json` | commit-only | commit-only | commit-only |
| `handler-source` | `automations/*.ts`, `automations/handlers/*/handler.ts` | preview | preview | activate² |
| `handler-manifest` | `automations/*.manifest.json` | human | human | human |
| `automation-script` | `automations/scripts/**/*` | human | human | human |
| `runtime-config` | `config/**/*.json` | human | human | human |
| `skill` | `skills/**/*.md` | activate | activate | activate |
| `agent` | `.opencode/agents/*.md` | activate | activate | activate |
| `communication-bots` | `communication/bots.json` | activate | activate | activate |
| `communication-flow` | `communication/flows/*/flow.json` | activate | activate | activate |
| `communication-sender-bindings` | `communication/sender-bindings.json` | activate | activate | activate |
| `portal-config` | `portal/config.json` | activate | activate | activate |
| `analytics-metric` | `analytics/metrics/**/*.yaml` | activate | activate | activate |
| `analytics-page` | `analytics/pages/*.yaml` | activate | activate | activate |
| `analytics-saved-query` | `analytics/saved-queries/*.sql` | activate | activate | activate |
| `operations-condition` | `operations/conditions/*.yaml` | activate | activate | activate |
| `checks` | `checks/**/*.json` | activate | activate³ | activate³ |
| `reclaims` | `reclaims.json` | human | human | human |
| `operator-skill` | `operator/skills/*/SKILL.md` | commit-only | commit-only | commit-only |
| `operator-script` | `operator/scripts/**` | commit-only | commit-only | commit-only |
| `operator-note` | `operator/**/*.md` | commit-only | commit-only | commit-only |
| `org-test` | test files and `__tests__/` | commit-only | commit-only | commit-only |
| `surface-source` | `surfaces/*/**` (allowed source types) | activate⁴ | activate⁴ | activate⁴ |
| `surface-bundle` | derived bundle; no authorable path | human | human | human |

`activate` = `/cynap-push` then `/cynap-activate <sha>` with owner consent.
`commit-only` = `/cynap-push`; a commit containing **only** commit-only kinds
auto-activates. `preview` = push, obtain a passing handler preview for that
exact commit, then activate. `human` = not operator-routable; stop, report the exact operation
you could not do, and continue the other draft work. Generated and unknown paths are refused.

¹ Only the additive schema set in `author-a-schema-change` is admitted. An
existing live file without a provenance baseline may require
`/cynap-activate <sha> --reconcile`; use it only on `baseline_required`.
² Source deletion has no handler build effect, but still needs activation.
³ Editing or deleting an existing check must be separate from runtime changes;
a newly created suite can accompany them. See `/cynap-checks`.
⁴ The surface build runs during push; owner approval still follows. See
`author-a-surface`.
⁵ `reconcile` means push then `/cynap-activate <sha> --reconcile` **only**
when the next action reports `baseline_required` for unstamped live files.

## Links

- Conversational bot → `author-a-flow`
- TypeScript handler with selective LLM / org-database writes, a scripted
  browser job (worker + browser capability), or a headless browser/filesystem
  agent session → `author-a-code-execution`
- Fixed-step scheduled sync/reconciler/ETL → `author-a-deterministic-automation`
- Schema/entity changes (any mode) → `author-a-schema-change`
- Surface UI and manifests → `author-a-surface`
- Shared cross-mode constraints → `platform-invariants`
- Any AI call or model selection → `configure-customer-ai`

---
