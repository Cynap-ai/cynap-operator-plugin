---
name: author-a-flow
description: Author a conversational bot (WhatsApp/Slack/Roam DM) as a Flow-Runner config — the canonical path for all new conversational automations. Use after choose-the-right-mode routes here.
---

# author-a-flow — Flow-Runner Authoring

You are authoring a **conversational bot** for one customer org. This is a
BYOK-LLM config on the platform runtime — no sandbox, ~free COGS. If you haven't
confirmed this is the right mode, go read `choose-the-right-mode` first.

Read `platform-invariants` before this skill if you haven't this session.

## Deliverable shape

```
communication/flows/{flow-id}/flow.json
communication/flows/{flow-id}/bots.json   (optional — channel binding)
```

You are authoring the config only — never the runner code.

## The schema (quote verbatim, do not paraphrase)

`flowConfigSchema`, the shape the platform validates:

```typescript
export const flowConfigSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(FLOW_ID, 'flow_id must match ^[a-z0-9_-]+$ (no path separators or ..)'),
  lane: z.enum(['config', 'code']).default('config'),
  model: modelRef,               // { provider, model, baseURL: url|null }
  instructions: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).max(64).default([]),
  allowed_automations: z.array(z.string().min(1)).max(16).optional(),
  dispatch: z.enum(['sync', 'async']).default('sync'),
  async_ack_text: z.string().min(1).max(2000).optional(),
  context_preload: z.array(ContextPathSchema).max(8).default([]),
  context_allowlist: z.array(ContextPathSchema).max(8).default([]),
  subagents: z.array(subagent).max(16).default([]),
  subject_scope: z.object({ kind: z.string().min(1) }).strict().optional(),
  memory: z.object({
    provider: z.string().default('default'),
    scopes: z.array(z.string()).default(['user', 'org']),
  }).strict().default({ provider: 'default', scopes: ['user', 'org'] }),
  budget: z.object({ max_usd, max_rounds, rate_per_min }).strict(),
  escalation: z.object({ enabled: z.boolean().default(false), max_usd }).strict().default(...),
}).strict();
```

`.strict()` means **no extra fields** — a typo'd field name is a hard
schema-parse rejection, not a silently-ignored key.

## Gotchas (load-time rules)

1. **`allowed_automations[]` is REQUIRED if `tools` includes
   `automation_run_sync` or `trigger_automation`**. Absent or empty pin lets
   ANY org automation run — this is a hard load-time rejection, not a warning:

   > "flow '{id}' declares automation-invoking tool(s) […] but does not pin
   > `allowed_automations[]`. An empty pin permits running ANY automation in
   > the org — declare the exact automation_id(s) this flow may run."

2. **`dispatch:"async"` REQUIRES a non-empty `async_ack_text`**. Async
   correctness must not depend on
   the LLM acking in prose — the platform sends `async_ack_text`
   deterministically via the channel adapter at dispatch time. Omitting it
   with `dispatch:"async"` is a load-time config error:

   > "flow '{id}' sets dispatch:'async' but declares no async_ack_text.
   > Async dispatch acks deterministically via the channel adapter (not LLM
   > prose) — declare async_ack_text."

3. **`model.baseURL` is SSRF-guarded** by the platform: must parse as a valid URL,
   protocol must be strictly `https:`, hostname must not be
   `metadata.google.internal` or any private/link-local/CGNAT/IPv6-ULA
   range, and the hostname must appear in the
   platform-managed `allowedHosts` list. A `baseURL` pointing at
   `169.254.169.254` or an unlisted host is rejected at load time — this
   applies to `model.baseURL` AND every `subagents[*].model.baseURL`.

4. **A declared tool must be permitted, not just approved** — the platform
   computes `declared ∩ grant`, and a tool you declare that IS in the approved
   grant but has no platform permission entry gets a **loud rejection**
   naming the dropped tool, not a silent drop.
   If you hit this, the fix is a platform-side permission entry — flag it
   as platform work, don't remove the tool to work around it unless the
   tool genuinely isn't needed.

5. **`escalation.enabled: true` is rejected** — escalation is phased and not
   yet implemented. Leave it `false`.

6. **Budget fields are clamped, not rejected** — `max_usd`/`max_rounds`/
   `rate_per_min` are each capped (`Math.min()`) against a platform ceiling.
   Setting a high budget is a request, not a decision — the platform owns
   the ceiling, and the
   effective value silently narrows. Don't assume your declared budget is
   what actually applies — it's an upper request, not a guarantee.

## A minimal correct example

`communication/flows/example-flow/flow.json`:

```json
{
  "schema_version": 1,
  "id": "example-flow",
  "lane": "config",
  "model": {
    "provider": "openrouter",
    "model": "openai/gpt-5.4",
    "baseURL": "https://openrouter.ai/api/v1"
  },
  "instructions": "You are the example-org async-delivery agent. For ANY user message, immediately call the automation_run_sync tool exactly once with automation_id 'example-automation'. Do NOT write a prose reply yourself — the platform sends a deterministic acknowledgement, and the real reply is delivered when the dispatched handler run terminalizes. Call the tool once and stop.",
  "capabilities": [],
  "tools": ["automation_run_sync"],
  "allowed_automations": ["example-automation"],
  "context_preload": [],
  "context_allowlist": [],
  "subagents": [],
  "dispatch": "async",
  "async_ack_text": "Got it — processing now, I'll reply when it's done. (example-org async example)",
  "memory": { "provider": "default", "scopes": ["user", "org"] },
  "budget": { "max_usd": 0.05, "max_rounds": 2, "rate_per_min": 6 },
  "escalation": { "enabled": false, "max_usd": 0.5 }
}
```

Note how gotchas 1 and 2 are both satisfied together: `tools` includes
`automation_run_sync` → `allowed_automations` is non-empty; `dispatch` is
`async` → `async_ack_text` is set.

A simpler sync, no-automation-tool example is
`communication/flows/default/flow.json` — no
`allowed_automations` needed because `tools` contains no automation-invoking
tool, and `dispatch` defaults to `sync` so `async_ack_text` is unnecessary.

## Authoring checklist

1. Confirm this is genuinely conversational (real-time reply to a human) —
   otherwise go back to `choose-the-right-mode`.
2. Write `instructions` as a directive system prompt, not a vague
   description — the model reads this literally.
3. Declare only the `tools[]` this bot actually needs (least privilege).
4. If any tool is automation-invoking (`automation_run_sync`,
   `trigger_automation`), pin `allowed_automations[]` to the exact
   automation id(s).
5. Decide `dispatch: sync` (default, relayed inline) vs `async` (true async
   Event invoke) — if async, write `async_ack_text`.
6. Set a realistic `budget` — remember it's clamped to a platform ceiling
   regardless of what you write.
7. If this bot needs row-level data isolation ("user only sees their own
   rows"), that requires the `subject_scope` field resolved from a
   platform-verified identity source — never rely on prompt
   discipline alone to promise row isolation.

---
