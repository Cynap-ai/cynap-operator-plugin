# LEARNINGS — author-a-schema-change (cross-org)

Cross-org procedural wisdom for entity-schema authoring. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Sanitize-at-authoring-time framing** ("do the punctuation rewrite
  yourself, don't wait for the validator") saves a round-trip versus
  discovering the rejection after a deploy attempt.
- **Naming the silent-skip gap explicitly** (gotcha 3) rather than implying
  the fail-closed pre-check makes the whole sync safe. The pre-check only
  covers the BLOCKED_PATTERNS class; other per-entity failures still get
  swallowed into a counter. Authors who assume "no error = all entities
  registered" have been burned by this before.

## What failed

- Adding a new field to an entity that already had a `dedicated_table`,
  assuming the live table would pick it up automatically on next sync. The
  `CREATE TABLE IF NOT EXISTS` is a no-op once the table exists; the column
  only appears via a separate ALTER path that is not fully hardened. Always
  verify the column actually landed after a schema change to an
  already-dedicated entity, don't treat it as "just a JSON edit."

## Patterns

- `dedicated_table` is a one-way door in practice: declare the full field
  set at entity-creation time rather than planning incremental field
  additions. If a field genuinely needs to be added later, treat it as
  requiring explicit verification of the ALTER path, not routine work.
- Pipeline-bearing entities (stages/terminal_stages/forward_only) are a
  distinct sub-pattern from plain entities — when an authoring task
  mentions "stage," "pipeline," or a lifecycle noun, check whether the
  entity should declare a `pipeline` block rather than modeling stage as a
  plain enum field.

## Open questions

- Should this skill document the `unique_index` field's interaction with
  `dedicated_table` DDL (does it become a real SQL UNIQUE constraint, or is
  it advisory)? Current: not verified against `dedicated-tables.ts` in
  enough depth to state confidently as of 2026-07-07 — flag for follow-up
  investigation rather than guess.

---

**Last updated:** 2026-07-07 (initial template).
