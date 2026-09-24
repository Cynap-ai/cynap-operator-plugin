---
name: author-a-schema-change
description: Add or change an entity type in a customer org's schema.json — entity fields, dedicated tables, pipeline stages. Applies regardless of which automation mode a task otherwise routes to.
---

# author-a-schema-change — Entity Schema Authoring

You are adding or changing an **entity type** for one customer org — the
shape of the business knowledge the org's database holds. This is
orthogonal to the 3-mode router (`choose-the-right-mode`): any mode's
automations may read/write entities whose shape you define here. Read
`platform-invariants` before this skill if you haven't this session.

## Deliverable shape

```
context/schema.json
```

Author only additive changes through the operator workspace. Start from the
current accepted parent, then use `workspace_validate` to inspect the schema
plan and its proposed DDL. A schema change needs the org owner's approval:
`workspace_commit` records the plan, `/cynap-checks <commit-sha>` verifies the
pending bytes, and `/cynap-activate <commit-sha>` opens the consent page with
the exact delta and DDL before applying it. Wait for the activation's terminal
status; a submitted command alone does not prove the DB effect or live publish.

The admitted operator set is new entity types, nullable fields on dedicated
tables, required boolean fields whose existing rows read false, and metadata
annotations. Existing field type, requiredness, name, enum values, searchability,
uniqueness, dedicated table placement, and removals are outside that set.
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

Note the `priority` field below has **no top-level `description`** —
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
    { "name": "name", "field_type": "text", "required": true },
    {
      "name": "priority",
      "field_type": "enum",
      "required": false,
      "enum_values": ["low", "normal", "high"],
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

1. Choose `type` (a stable machine key — this becomes the entity type name
   everywhere) and `display_name` (human-facing).
2. Write `fields[]` with `field_type` from the closed enum; `enum` fields
   MUST carry `enum_values`.
3. Sanitize any free-text `description` at the authoring step: `;`→`,`,
   `--`→`—`, `/*`→`/ *`. Never leave these characters for the validator.
4. Scan every description for a BLOCKED keyword (DROP/ALTER/CREATE/
   TRUNCATE/DELETE FROM/INSERT INTO/UPDATE SET/TRIGGER/PROCEDURE/FUNCTION/
   EXEC/EXECUTE/GRANT/REVOKE) — rephrase if present.
5. If this entity needs a `dedicated_table`, inspect each planned physical
   change, including later additive fields.
6. If this entity has a pipeline (stage-based lifecycle), declare `stages`,
   `terminal_stages`, and `forward_only` together.
7. Validate and commit, run `/cynap-checks <commit-sha>`, then have the owner
   review the consent page through `/cynap-activate <commit-sha>`. Confirm the
   terminal activation and registry state.
8. In any other authoring skill that reads/writes this entity type, use
   `getSchemaRegistry()`/`resolveTableForType()`, never a hardcoded table
   name.

---
