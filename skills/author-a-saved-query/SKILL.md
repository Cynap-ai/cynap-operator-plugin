---
name: author-a-saved-query
description: Author an aggregate saved query (analytics/saved-queries/*.sql) that an operator seat can read with operator_saved_query_run. Use when you need a count, total or breakdown of the org's data from an operator session.
---

# author-a-saved-query — An Aggregate an Operator Can Read

A saved query is org SQL under `analytics/saved-queries/<name>.sql`. An
operator reads its result with `operator_saved_query_run`, and that read
returns only an **aggregate**. Read `platform-invariants` first if you have
not this session.

## The read rule

The full rule is in the org context document — the read-first resource whose
address the session-start banner prints (the proxy's `/health` `contextUri`).
Read part "Platform modes", line "Saved-query reads"; it is the one current
statement. In short:

- **Aggregate only.** Counts, sums, averages, rates — never one row per
  person, invoice or appointment.
- **At most 50 rows.** One row more refuses the whole run; nothing is
  truncated.
- **Numbers, booleans and NULL**, plus **admitted enum keys**: a column you
  declare in the front-matter `group_keys` may return the current values of
  a schema field declared `enum`, but only when your seat and the org are
  admitted to real rows. On every other seat or org the read stays
  numbers-only, so a grouped query refuses there with
  `saved_query_not_aggregate_safe`. Only fields already declared `enum` in
  `context/schema.json` can be group keys; a `text` field cannot, even if its
  values look like categories.

A question about individual records (which family, which invoice) is not an
operator read. Put it in an automation, or show it to the owner on a surface.

## Where the data shape lives

- `context/schema.json` — entity types, fields, and which fields are `enum`
  (with their `enum_values`).
- Existing `analytics/saved-queries/*.sql` files — the table and column names
  the org's queries already use. Copy their joins and filters.

## The file

```sql
-- ---
-- name: patients_by_status
-- description: Patients per status
-- entity_types: [patient]
-- returns: distribution
-- group_keys:
--   - column: status
--     field: patient.status
-- ---
SELECT status, COUNT(*) AS patients
FROM <the patient table named in existing queries>
WHERE (:date_from IS NULL OR date(created_at) >= date(:date_from))
GROUP BY status
```

- `name` is snake_case and matches the file name.
- `group_keys` is optional. Each entry names one result `column` and the
  schema `field` (`entity_type.field_name`) whose values it carries. Leave it
  out for a numbers-only query.
- Binds: only `:date_from`, `:date_to` and `:clinician`.
- `--` comment lines are visible to the org: write plain language, and never
  internal ticket ids or platform names in them — the commit refuses them.
- One `SELECT` or `WITH` statement, reading the org's own data only.

## The checks/ assertion

Every changed path must be covered by the org's `checks/` suite, or the
commit refuses with `checks_uncovered_path`. Add (or extend) an assertion that
names `analytics/saved-queries/<name>.sql` in the same change.

## The order

1. **Author** the `.sql` file and its `checks/` assertion.
2. **Dry-run** the commit: `/cynap-push -m "<message>" --dry-run` runs
   `workspace_validate` and commits nothing. This catches the static rules:
   front matter, `group_keys` against the schema, the SQL contract, checks
   coverage and vocabulary.
3. **Commit** (`/cynap-push`).
4. **Run the checks** at the commit: `/cynap-checks <sha>`.
5. **Activate** (`/cynap-activate`) — the owner approves.
6. **First run**: `operator_saved_query_run` with the query `name`.

Result-shape rules — the row cap, the cell types, enum membership — are
checked **only when the query runs**. Commit never executes your SQL, so the
earliest you learn that a query returns text or too many rows is the first
run after activation. Aggregate before you commit.

## When a run refuses

| Code | Meaning | Fix |
|---|---|---|
| `saved_query_not_aggregate_safe` | A cell is text that is not an admitted enum key | Aggregate it, or declare an enum group key (where admitted) |
| `saved_query_too_many_rows` | More than 50 rows | Group more coarsely or filter |
| `saved_query_schema_drift` | A group-key field is no longer the enum it was validated against | Re-commit the query against the current schema |
