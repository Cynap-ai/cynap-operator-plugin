---
name: author-a-schema-change
description: Add an entity or admitted additive fields and annotations in a customer org's schema.json. Applies regardless of automation mode.
---

# author-a-schema-change — Entity Schema Authoring

You are adding or changing an **entity type** for one customer org — the
shape of the business knowledge the org's database holds. This is
orthogonal to the 3-mode router (`choose-the-right-mode`): any mode's
automations may read/write entities whose shape you define here. Read
`platform-invariants` before this skill if you haven't this session.
Check the path and operation in `choose-the-right-mode`'s workspace capability
matrix before authoring.

## Deliverable shape

```
context/schema.json
```

**Step 1: pull the current accepted parent, edit, then run
`/cynap-push --dry-run -m "<message>"` before committing.** The dry run calls
`workspace_validate` and reports whether the schema change is admitted or
refused. Do not proceed on `schema_change_not_admitted`.

Author only admitted additive changes through the operator workspace. The dry
run reports admission only; the proposed DDL appears on the activation consent
page. A schema change is approved by the org owner at activation (push and checks run automatically):
`workspace_commit` records the plan, `/cynap-checks <commit-sha>` verifies the
pending bytes, and `/cynap-activate <commit-sha>` opens the consent page with
the exact delta and DDL before applying it. Wait for the activation's terminal
status; a submitted command alone does not prove the DB effect or live publish.

The admitted operator set is: new entity types with a new `typed_` dedicated
table and eligible fields; nullable non-enum, non-searchable, non-unique fields
on existing dedicated tables; required boolean fields whose existing rows
read false; entity descriptions and field description/semantic annotations;
new relationships joining two existing entities; and **adding**
`pipeline.dropout_stages` to an existing entity's pipeline that does not yet
declare it (a non-empty, duplicate-free list whose values are all in
`pipeline.stages`; registry annotation only, no DDL). New entities/fields
cannot use enum, searchable, unique, or reserved fields. Existing field type,
requiredness, name, enum values, searchability, uniqueness, dedicated table
placement, and removals are outside that set. Every other change to existing
entity shape, including `pipeline.stages`, `pipeline.terminal_stages`,
`pipeline.forward_only`, and removing or changing an already-declared
`pipeline.dropout_stages`, is **not** admitted. A newly created entity may
declare its initial pipeline, but later pipeline changes need the reviewed
git and owner migration route.
Treat a `schema_change_not_admitted` result as a git PR plus owner migration
decision; do not reshape the change to evade the refusal.

To reclaim a schema file from operator provenance for git, add a reviewed
`reclaims.json` entry in the customer's org workspace through a git PR. `provenance`
requires identical bytes; `content` requires the live ETag and an admissible
change or a ticket naming the destructive migration runbook. Reclaims are
git-only and cannot be submitted through `workspace_commit`.

The `entities[]` array, each entry an `EntitySchema`:

```typescript
export interface EntitySchema {
  id: string;
  type: string;
  display_name: string;
  description: string | null;
  fields: EntitySchemaField[];
  pipeline: PipelineConfig | null;
  created_at: string;
  updated_at: string;
  status: 'active' | 'pending' | 'archived' | 'rejected';
  schema_version: number;
  icon: string | null;
  color: string | null;
  system_prompt_additions: string | null;
  dedicated_table: string | null;
}

export interface EntitySchemaField {
  name: string;
  field_type: 'text' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'enum' | 'json';
  required: boolean;
  description?: string;
  enum_values?: string[];   // required in practice when field_type === 'enum'
  unique_index?: boolean;
}
```

## Gotchas

1. **SANITIZE AT AUTHORING TIME — never hand-edit `schema.json`
   for punctuation.** Before committing, rewrite any field
   `description` (or other free-text schema content) mechanically:
   `;` → `,`, `--` → `—`, `/*` → `/ *`. This is a mechanical, safe rewrite;
   do it at the authoring step, don't
   leave raw punctuation for the validator to reject.

   **Scope of this screening — read carefully:** these pattern checks apply
   ONLY to the top-level `EntitySchemaField.description` and `field.name`.
   They do **not** cover `semantic.description` — that is a separate,
   non-strict object with
   no `description` key at all, so an unrecognized `semantic.description`
   key is **silently stripped at parse time**, never validated or stored.
   Don't rely on the validator to catch punctuation or blocked keywords in
   `semantic.description` prose — it isn't screened at all.

2. **Blocked keywords hard-fail with NO safe rewrite.** Word-bounded and
   case-insensitive: DROP, ALTER, CREATE, TRUNCATE, DELETE FROM,
   INSERT INTO, UPDATE SET, TRIGGER, PROCEDURE, FUNCTION, EXEC, EXECUTE,
   GRANT, REVOKE. If a field description would naturally
   contain one of these words (e.g. "the trigger for a follow-up"), rephrase
   it — there is no mechanical fix, the validator rejects the whole entity.

3. **Verify the terminal effect and resulting registry.** The schema apply
   checks the touched physical objects, registry rows, relationships, and
   columns. A failed or pending activation is not a successful deploy.

4. **Adding a field to a dedicated table is conditional.** Only the admitted
   additive set can add a physical column. Inspect the plan and consent page;
   a column or registry mismatch refuses with `schema_state_diverged`.

5. **Use `getSchemaRegistry()` / `resolveTableForType()` — never hardcode
   `'entities'` as a table name** in any downstream authoring (handler,
   deterministic sync target, etc.) that reads/writes this entity type:

   ```typescript
   const registry = await getSchemaRegistry(client, orgSlug);
   const route = resolveTableForType(registry, entityType);
   const table = route?.dedicatedTable ?? 'entities';
   ```

   This applies to every other skill's deliverables too — if you're
   authoring a handler or deterministic sync that targets an entity type
   you just defined here, resolve the table through the registry, not a
   literal string.

## A minimal correct example

This is a **new** entity. Its initial pipeline is allowed; editing the pipeline
after creation is not. Note the `priority` field below has **no top-level `description`** —
the prose lives under `semantic.description` in the committed file. This
distinction matters (see gotcha 1 above): only the top-level
`EntitySchemaField.description` (and `name`) are screened;
`semantic.description` is a different, non-strict schema
with no `description` key at all — an
unrecognized key is silently stripped at parse time, never validated or
stored.

```json
{
  "type": "work_item",
  "display_name": "Work Item",
  "description": "A unit of work tracked through a lifecycle.",
  "dedicated_table": "typed_work_item",
  "pipeline": {
    "stages": ["New", "In Progress", "Blocked", "Done", "Cancelled"],
    "terminal_stages": ["Done", "Cancelled"],
    "forward_only": true,
    "stage_evaluation_rules": { "In Progress": "started_at", "Done": "completed_at", "Cancelled": "cancelled_at" }
  },
  "fields": [
    { "name": "title", "field_type": "text", "required": true },
    {
      "name": "priority",
      "field_type": "text",
      "required": false,
      "semantic": {
        "display_label": "Priority",
        "description": "How urgently this work item should be handled. low is background work with no deadline. normal is the default. high is work that blocks something else. When absent the platform treats the item as normal.",
        "category": "demand_mix",
        "visualization": "pie",
        "metric_type": "categorical"
      }
    }
  ]
}
```

## Authoring checklist

1. Run `/cynap-pull` before editing, then `/cynap-push --dry-run -m "<message>"`
   on the proposed edit. Resolve every admission finding before committing.
2. Choose `type` (a stable machine key — this becomes the entity type name
   everywhere) and `display_name` (human-facing).
3. Write `fields[]` with an admitted `field_type`; new enum fields are not
   operator-admitted.
4. Sanitize any free-text `description` at the authoring step: `;`→`,`,
   `--`→`—`, `/*`→`/ *`. Never leave these characters for the validator.
5. Scan every description for a BLOCKED keyword (DROP/ALTER/CREATE/
   TRUNCATE/DELETE FROM/INSERT INTO/UPDATE SET/TRIGGER/PROCEDURE/FUNCTION/
   EXEC/EXECUTE/GRANT/REVOKE) — rephrase if present.
6. If this entity needs a `dedicated_table`, inspect each planned physical
   change, including later additive fields.
7. Only for a **new** entity, declare its initial pipeline together. Never
   change an existing entity's pipeline through the operator route, except to
   add a missing `pipeline.dropout_stages` (values ⊆ `pipeline.stages`).
8. After a passing dry run, commit, run `/cynap-checks <commit-sha>`, then have the owner
   review the consent page through `/cynap-activate <commit-sha>`. Confirm the
   terminal activation and registry state.
9. In any other authoring skill that reads/writes this entity type, use
   `getSchemaRegistry()`/`resolveTableForType()`, never a hardcoded table
   name.

---
