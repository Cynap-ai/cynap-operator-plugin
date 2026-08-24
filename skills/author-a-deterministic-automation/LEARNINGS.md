# LEARNINGS — author-a-deterministic-automation (cross-org)

Cross-org procedural wisdom for deterministic-mode authoring. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Quoting the field-path refusal message verbatim.** "no templates ('{{')
  or expressions ('$')" is the exact wording an author will see at
  config-time — showing it up front prevents an author from trying `{{var}}`
  syntax by habit from other templating systems and hitting the rejection
  blind.
- **Calling out `key_template` constant-collapse as a data-loss bug, not a
  style nit.** A typo'd constant template silently merging every record
  onto one entity is a permanent, irreversible failure mode; framing it
  that strongly changes how carefully an author reviews the field before
  shipping.

## What failed

- Early drafts of deterministic automations tried to route "compute a
  derived value" through a `set` step with a JSON-logic expression that
  looked like it should reach across records — `set`/`condition` operate on
  the automation's own step-local variables only, not a data-mapping DSL.
  Anything that needs real per-record transformation belongs in the closed
  `coerce`/`derive` vocabulary of a `sync` step's `field_map`, not invented
  ad hoc in `set`.

## Patterns

- The six-step vocabulary is intentionally closed — resist any urge to
  propose a 7th step kind (e.g. "just let me run raw JS") as part of an
  authoring task. That's an invariant change ([internal reference omitted from public mirror]
  §9), not something an authoring session can add ad hoc.
- `sync` and `land` look similar (both land external data into Turso) but
  serve different layers: `sync` does per-record incremental upsert into a
  typed target table; `land` does cheap raw Bronze capture for later batch
  normalization. Don't reach for `sync` when the real need is "just capture
  this webhook payload cheaply" — that's `land`.

## Open questions

- Should this skill grow a worked `land` example once one exists with a
  populated `events_path`/`payload_path` against a real webhook shape?
  Current: no committed `land`-step automation example exists in the repo
  as of 2026-07-07 to ground one.

---

**Last updated:** 2026-07-07 (initial template).
