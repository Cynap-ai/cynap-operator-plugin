---
name: author-a-deterministic-automation
description: Author a fixed-step scheduled sync, reconciler, or ETL automation with no agentic loop. Use after choose-the-right-mode routes here.
---

# author-a-deterministic-automation — Deterministic-Mode Authoring

You are authoring a **fixed-step, non-agentic** automation for one customer
org — scheduled syncs, reconcilers, ETL, optionally with a bounded `llm`
tool step. This is the **cheapest runtime** mode; it
is **not** a general workflow engine and **not** a home for platform infra
jobs (reapers/drift-check/cleanup belong to the platform, not to your org's
config). If you haven't confirmed this is the right mode, go read
`choose-the-right-mode` first. Read `platform-invariants` before this skill
if you haven't this session.

If the step graph includes an `llm` tool, read `configure-customer-ai` and
explain native versus BYOK billing first. The AI call is billed under the
org's funding record even though the surrounding runtime is deterministic.

## Deliverable shape — ONE file

```
automations/{automation-id}.json
```

```json
{
  "id": "{automation-id}",
  "name": "Human Name",
  "version": "1.0",
  "enabled": true,
  "triggers": [ { "type": "schedule" | "manual" | "mcp", "cron": "cron(...)" } ],
  "tools": [ { "name": "...", "description": "...", "impl": { "type": "http" | "llm" | "automation", "...": "..." } } ],
  "execution": {
    "mode": "deterministic",
    "steps": [ /* the closed step vocabulary below */ ]
  },
  "metadata": { "..." }
}
```

## The step vocabulary — CLOSED, interpreted by trusted platform code

Exactly six step kinds:

- `{ tool, input?, output?, continue_on_error? }` — invoke a declared
  `tools[]` entry
- `{ set, value }` — assign a variable
- `{ condition, then: Step[], else?: Step[] }` — branch
- `{ parallel: Step[], onFailure?: 'fail_fast'|'continue'|'collect_errors' }`
- `{ sync: SyncSpec }` — integration → org database incremental upsert
- `{ land: LandSpec }` — raw webhook events → `source_events` Bronze table

No other step kind parses. `tool`/`set`/`condition`/`parallel` are generic
control flow; `sync`/`land` are the ONLY sanctioned deterministic writes to
the org database.

### `sync` step field-path rule — no templates, no expressions

A non-plain field path is rejected at parse time with:

> "sync field paths must be plain field names — no templates ('{{') or expressions ('$')"

**Every field path in `sync`/`land` is a plain field name — NEVER a
template (`{{…}}`) or expression (`$var`).** Rejection at parse time
**IS** the safety check: deterministic config carries data (field names +
closed enums), never operator code. If your task seems to need a computed
expression on a field path, deterministic mode is the wrong tool — that's
`code_execution` or `flow`.

`sync` also carries:
- `external_key.key_template` MUST contain a `{field}` placeholder — a
  constant template (e.g. a typo'd `'WU'` instead of `'WU{id}'`) collapses
  every record onto ONE entity in the org database, a permanent
  irreversible data-loss bug. Rejected at parse time.
- `watermark.business_date_field` — the incremental floor must be the SAME
  field the provider's `?from=` filter narrows on, or the floor and the
  filter silently drift (documented as a config-correctness invariant, not
  engine-enforceable — verify this by hand).
- `coerce` values are a **closed enum**:
  `string|int|bool|iso_date|date|pounds_to_pence` — no arbitrary
  transformation code.

## Gotchas (all verified against the live platform)

1. **Retired tool-impl types `transform`/`code` are hard-rejected** at
   config time — the deterministic runner explicitly refuses to execute
   them:

   > "tools[N] '{name}' uses retired impl type '{type}', which the
   > deterministic runtime no longer executes (use 'llm', 'http', or
   > 'automation')."

2. **Raw HTTP writes to the org database are retired.** An `http` tool
   whose `url` targets a database write endpoint is rejected;
   deterministic mode may write the org database only via the closed
   `sync` and `land` steps.

3. **Every `step.tool` reference must resolve to a declared `tools[]`
   entry** — tool-reference integrity is checked at config time, not
   discovered at run time. A step referencing an
   undeclared tool name is a hard config-time rejection.

4. **WriteUpp `sync.nested` is rejected** — per-parent nested fetch
   (invoice → its line items) is not supported yet. A `sync` step with
   `provider: 'writeupp'` and a `nested` field
   fails at parse time, not at runtime crash time.

5. **`mode:deterministic` has NO execute-preview.** `workspace_validate`'s
   static checks are the ONLY pre-deploy proof available for a
   deterministic candidate — there's no dry-run execution to sanity-check
   against. Treat a clean `workspace_validate` as necessary, not
   sufficient; review the step tree carefully by hand.

## A minimal correct example

```json
{
  "id": "example-deterministic",
  "name": "Example Deterministic Test",
  "version": "3.0",
  "enabled": true,
  "portal_visible": false,
  "description": "Deterministic automation covering set, condition, and parallel steps — no external deps",
  "triggers": [{ "type": "manual" }, { "type": "mcp" }],
  "tools": [],
  "execution": {
    "mode": "deterministic",
    "steps": [
      { "set": "$greeting", "value": "hello from example-deterministic" },
      { "set": "$counter", "value": 42 },
      {
        "condition": { ">=": [{ "var": "$counter" }, 10] },
        "then": [{ "set": "$status", "value": "counter is large" }],
        "else": [{ "set": "$status", "value": "counter is small" }]
      },
      {
        "parallel": [
          { "set": "$parallel_a", "value": "branch-a" },
          { "set": "$parallel_b", "value": "branch-b" }
        ]
      },
      { "set": "$result", "value": "all steps completed" }
    ]
  },
  "metadata": { "tags": ["example", "deterministic", "test"], "created_at": "2026-03-31T00:00:00Z", "created_by": "example-setup" }
}
```

**Note: no live `sync`-step example exists yet** (verified
2026-07-07) — the `sync` step is schema-defined but not yet used
in any org's committed config. For a real **`land`**-step example (note:
`land`, not `sync` — a different, simpler schema with no
`external_key`/`field_map`/`watermark`), read
`automations/superchat-contact-ingest.json`:
its `execution.steps[0]` is `{ "land": { "source": "superchat.contacts",
"event_id_path": "_webhook_event_id", "event_type_path": "event" } }`.

## Authoring checklist

1. Confirm there is no agentic loop (`choose-the-right-mode`). A bounded
   classification/extraction `llm` tool may remain deterministic, but it must
   follow `configure-customer-ai`.
2. Use only the six step kinds; never invent a step shape.
3. If writing to the org database, use `sync` (incremental, watermarked) or
   `land` (raw Bronze capture) — never an `http` tool at a database
   endpoint.
4. Every field path in a `sync`/`land` step is a bare name — no `{{`, no
   `$`.
5. Verify `external_key.key_template` contains a real `{field}`
   placeholder, not a constant string.
6. Verify `watermark.business_date_field` matches the provider's own
   `?from=` filter field.
7. Cross-check every `step.tool` reference against a declared `tools[]`
   entry.
8. Remember: `workspace_validate` static checks are the only pre-deploy
   signal — there is no execute-preview for this mode.
