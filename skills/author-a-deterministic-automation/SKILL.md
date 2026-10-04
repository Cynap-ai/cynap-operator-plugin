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

Exactly nine step kinds:

- `{ tool, input?, output?, continue_on_error? }` — invoke a declared
  `tools[]` entry
- `{ integration_action: { integration_id: 'cynap_simulated', action_id } }`
  — a platform-simulated integration action
- `{ condition, then: Step[], else?: Step[] }` — branch
- `{ set, value }` — assign a variable
- `{ parallel: Step[], onFailure?: 'fail_fast'|'continue'|'collect_errors' }`
- `{ sync: SyncSpec }` — integration → org database incremental upsert
- `{ land: LandSpec }` — raw webhook events → `source_events` Bronze table
- `{ set_stage: { entity_type, stage_field, entity_id, expected_from, to } }`
  — move ONE declared stage field of ONE record (CAS + stage history)
- `{ set_fields: { entity_type, entity_id, require?, fields: { <field>: { to, read } } } }`
  — update 1–32 declared fields of ONE record (per-changed-field CAS)
- `{ create_record: { entity_type, entity_id, name, fields } }` — insert ONE record
  under a caller-minted UUID id (idempotent)
- `{ fail: { code } }` — end the run as a failure with a stable code

The kinds are `tool` / `integration_action` / `condition` / `set` / `parallel` / `sync` / `land` / `set_stage` / `set_fields` / `create_record` / `fail`.
No other step kind parses. `tool`/`integration_action`/`set`/`condition`/
`parallel` are control flow and calls; `sync`/`land`/`set_stage`/`set_fields`/`create_record` are the ONLY
sanctioned deterministic writes to the org database; `fail` writes nothing.

### `set_fields` and `create_record`

- `entity_type`, every `fields` key and every `require` key are **literals**
  (no `{{`, no `$`). Values and `entity_id` are a JSON scalar or exactly one
  `"{{$trigger.x}}"` template. `set_fields` has 1–32 fields, `create_record`
  0–32; `require` has up to 8 keys (a scalar or 1–16 literals each).
- `set_fields` refuses system columns, stage fields (use `set_stage`), `json`
  fields, spend-authority and money-magnitude columns and undeclared fields. `read` is
  REQUIRED per field (JSON `null` = "must currently be empty"); only fields
  whose `to` differs from `read` are written and CAS-guarded.
- `set_fields` outcomes: `updated` → `rowsAffected: 1`; `unchanged`,
  `cas_miss`, `precondition_failed`, `not_found` → `rowsAffected: 0`, step
  succeeds. A refusal fails `set_fields_rejected:<CODE>`; an absent trigger
  key fails `set_fields_input_missing`.
- `create_record` takes a Surface-minted UUID `entity_id` (keep it across
  retries). It must list every required non-boolean field, may set a tracked
  stage field only to a literal on its declared list, and never lists the
  `stage` column. `created` → 1; a retry of the same create is
  `already_created` → 0; a duplicate id/name or unique field fails
  `create_record_rejected:<CODE>` (`ID_CONFLICT`, `NAME_EXISTS`, …).
- Together with `set_stage`: at most **one** entity-write step on any path,
  never inside `parallel`. The run result carries flat `rowsAffected` and
  `entityWriteOutcome`.

### `set_stage` and `fail`

- `entity_type` and `stage_field` are **literals** (no `{{`, no `$`), and the
  field must be the entity's pipeline `stage` or a declared
  `tracked_stage_fields` entry in `context/schema.json`.
- `entity_id`, `expected_from` and `to` may be `$`-rooted templates
  (`"{{$trigger.record_id}}"`). A template without `$` resolves to null.
- `expected_from` is **required**. If it resolves to an absent key, the step
  fails `stage_move_input_missing`; an explicit JSON `null` means "the record
  must currently have no stage".
- Outcome: moved → `rowsAffected: 1`; a CAS conflict or an unchanged stage →
  `rowsAffected: 0` and the step still succeeds. Any other rejection fails the
  run with `stage_move_rejected:<CODE>` (`NOT_FOUND`, `OFF_LIST`,
  `FORWARD_ONLY`, `UNDECLARED_FIELD`, …).
- At most **one** entity-write step (`set_stage`, `set_fields`, `create_record`)
  may run on any path. It may sit inside `condition` branches, never inside
  `parallel`.
- `fail.code` matches `^[a-z][a-z0-9_]{2,63}$`. Use it as the `else` of a
  refusal `condition` — without it, a false condition with no `else` ends
  the run as a success that wrote nothing.

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
   config time — they are no longer part of the tool schema:

   > "tools[N] '{name}' uses retired impl type '{type}', which the
   > deterministic runtime no longer executes (use 'llm', 'http', or
   > 'automation')."

2. **Raw HTTP writes to the org database are retired.** An `http` tool
   whose `url` targets a database write endpoint is rejected;
   deterministic mode may write the org database only via the closed
   `sync`, `land`, `set_stage`, `set_fields` and `create_record` steps.

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
2. Use only the eleven step kinds; never invent a step shape.
3. If writing to the org database, use `sync` (incremental, watermarked),
   `land` (raw Bronze capture), `set_stage` (one stage move), `set_fields` (edit fields)
   or `create_record` (insert one record) — never an
   `http` tool at a database endpoint.
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
