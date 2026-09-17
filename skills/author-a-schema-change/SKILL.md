---
name: author-a-schema-change
description: Add or change an entity type in a customer org's schema.json — entity fields, dedicated tables, pipeline stages. Applies regardless of which automation mode a task otherwise routes to.
---

# author-a-schema-change — Entity Schema Authoring

You are adding or changing an **entity type** for one customer org — the
shape of the business knowledge the org's Turso database holds. This is
orthogonal to the 3-mode router (`choose-the-right-mode`): any mode's
automations may read/write entities whose shape you define here. Read
`platform-invariants` before this skill if you haven't this session.

## Deliverable shape

```
context/schema.json
```

The `entities[]` array, each entry an `EntitySchema`
(the platform validator):

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

## Gotchas (verified against `entity-schemas.ts`, `schema-bootstrap.ts`, `dedicated-tables.ts`)

1. **SANITIZE AT THE SEED/OVERLAY BOUNDARY — never hand-edit `schema.json`
   for punctuation.** `entity-schemas.ts` `SANITIZABLE_PATTERNS`
   (lines 26-30):

   ```typescript
   const SANITIZABLE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
     [/;/g, ','],
     [/--/g, '—'],
     [/\/\*/g, '/ *'],
   ];
   ```

   `;` → `,`, `--` → `—`, `/*` → `/ *`. Apply this rewrite to any field
   `description` (or other free-text schema content) BEFORE committing —
   this is a mechanical, safe rewrite; do it at the authoring step, don't
   leave raw punctuation for the validator to reject.

   **Scope of this screening — read carefully:** BLOCKED/SANITIZABLE
   pattern checks (`validateSchemaContent`, `entity-schemas.ts:194`) apply
   ONLY to the top-level `EntitySchemaField.description` and `field.name`.
   They do **not** cover `semantic.description` — `SemanticAnnotationSchema`
   (`schema-bootstrap.ts:20-38`) is a separate, non-strict Zod object with
   no `description` key at all, so an unrecognized `semantic.description`
   key is **silently stripped at parse time**, never validated or stored.
   Don't rely on this validator to catch punctuation or blocked keywords in
   `semantic.description` prose — it isn't screened at all.

2. **BLOCKED keywords hard-fail with NO safe rewrite** (`entity-schemas.ts`
   `BLOCKED_KEYWORD_PATTERNS`, lines 32-35):

   ```typescript
   const BLOCKED_KEYWORD_PATTERNS = [
     /\b(DROP|ALTER|CREATE|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+SET)\b/i,
     /\b(TRIGGER|PROCEDURE|FUNCTION|EXEC|EXECUTE|GRANT|REVOKE)\b/i,
   ];
   ```

   Word-bounded, case-insensitive. If a field description would naturally
   contain one of these words (e.g. "the trigger for a follow-up"), rephrase
   it — there is no mechanical fix, the validator rejects the whole entity.

3. **The S3 sync validates fail-closed BEFORE registering any entity, but
   individual per-entity registration failures are still swallowed into a
   `skipped_entities` counter with only a log line — not surfaced as a hard
   error to you.** `bootstrapSchemasFromS3` (`schema-bootstrap.ts:382+`)
   runs `validateAllEntitiesFailClosed` (the same BLOCKED_PATTERNS check
   preview uses) over every entity up front and throws on a blocked-pattern
   violation — but a *different* per-entity registration error (e.g. a
   malformed field) still lands in a per-entity `try/catch` that increments
   `skipped_entities++` and logs `ERROR` structuredLog, without failing the
   whole bootstrap or being visible to you as the author. **Consequence:**
   a stale registry or a missing table for one entity can persist silently
   — after any schema change, verify the entity actually registered (e.g.
   via a schema query), don't assume "no error surfaced to me" means
   "every entity in the file registered."

4. **`dedicated_table` triggers auto-DDL on CREATE, not on a later ALTER —
   there is no v1 schema-evolution tooling.** `dedicated-tables.ts`:
   `CREATE TABLE IF NOT EXISTS` (line 153) is a no-op if the table already
   exists — so adding a NEW field to an entity that already has a
   `dedicated_table` does NOT retroactively ALTER the live table; the
   `ensureDedicatedTable...` path in `schema-bootstrap.ts` only ALTER-adds
   missing columns on a subsequent bootstrap run, and comments in the code
   explicitly flag this as an evolving, not-fully-hardened path ("had to
   ALTER-add columns" / "FTS triggers reference a column the no-op CREATE
   TABLE did not add"). **Declare the FULL schema upfront** for any entity
   you intend to give a `dedicated_table` — treat later field additions to
   an already-dedicated-table entity as needing careful verification, not a
   trivial JSON edit.

5. **Use `getSchemaRegistry()` / `resolveTableForType()` — never hardcode
   `'entities'` as a table name** in any downstream authoring (handler,
   deterministic sync target, etc.) that reads/writes this entity type:

   ```typescript
   const registry = await getSchemaRegistry(client, orgSlug);
   const route = resolveTableForType(registry, entityType);
   const table = route?.dedicatedTable ?? 'entities';
   ```

   (the operator safety rules`schema-registry.ts:145-150`.)
   This applies to every other skill's deliverables too — if you're
   authoring a handler or deterministic sync that targets an entity type
   you just defined here, resolve the table through the registry, not a
   literal string.

## A minimal correct example (real, `brightleaf/context/schema.json`)

Note the `service_model` field below has **no top-level `description`** —
the prose lives under `semantic.description` in the committed file. This
distinction matters (see gotcha 1 above): only the top-level
`EntitySchemaField.description` (and `name`) are BLOCKED/SANITIZABLE
screened; `semantic.description` is a different, non-strict schema
(`SemanticAnnotationSchema`) with no `description` key at all — an
unrecognized key is silently stripped at parse time, never validated or
stored.

```json
{
  "type": "event",
  "display_name": "Event",
  "description": "A catered job for a wedding, corporate event, or private party.",
  "dedicated_table": "typed_event",
  "pipeline": {
    "stages": ["Inquiry", "Quoted", "Booked", "Executed", "Closed", "Lost"],
    "terminal_stages": ["Closed", "Lost"],
    "forward_only": true,
    "stage_evaluation_rules": { "Quoted": "quoted_at", "Booked": "booked_at", "Executed": "executed_at", "Closed": "closed_at" }
  },
  "fields": [
    { "name": "name", "field_type": "text", "required": true },
    {
      "name": "service_model",
      "field_type": "enum",
      "required": false,
      "enum_values": ["cocktail_bar", "alcohol_bar", "workshop"],
      "semantic": {
        "display_label": "Service Model",
        "description": "Which of the three service lines this event runs. cocktail_bar is the batch-and-pour mobile bar. alcohol_bar is a field wedding where the owner brings his own spirits and a supplier delivers perishables to the venue on the day. workshop is a hands-on cocktail class. When absent the planner treats the event as cocktail_bar for backward compatibility.",
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
5. If this entity needs a `dedicated_table`, declare the FULL field set now
   — don't plan to "add fields later" without re-verifying the ALTER path.
6. If this entity has a pipeline (stage-based lifecycle), declare `stages`,
   `terminal_stages`, and `forward_only` together.
7. After deploy, verify the entity actually registered (don't assume
   silence means success — see gotcha 3).
8. In any other authoring skill that reads/writes this entity type, use
   `getSchemaRegistry()`/`resolveTableForType()`, never a hardcoded table
   name.

---

**Spec references:** CYN-768 P2 §2.5 · the platform validator (BLOCKED_PATTERNS/SANITIZABLE_PATTERNS) · the platform validator (EntitySchema/EntitySchemaField shape) · the platform validator (bootstrapSchemasFromS3 fail-closed pre-check + per-entity skip behavior) · the platform validator (CREATE TABLE IF NOT EXISTS no-op-on-exists) · the operator safety rulesthe workspace instructions.
