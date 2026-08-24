# LEARNINGS — author-a-flow (cross-org)

Cross-org procedural wisdom for Flow-Runner authoring. Read at task start;
append at task end. No customer-specific strings — per-org vocabulary
belongs in that org's own context files, not here.

---

## What worked

- **Pairing the two hard resolve-time gates in one worked example**
  (`async-bake/flow.json`) rather than describing them separately —
  operators copy the working shape instead of assembling the two
  constraints from prose.
- **Quoting the exact resolver error strings.** When a flow fails to
  resolve, the operator sees this literal message — showing it in the skill
  means the operator recognizes the failure immediately instead of treating
  it as an opaque backend error.

## What failed

- Declaring `automation_run_sync` in `tools[]` "just in case" without
  actually wiring `allowed_automations[]` — always fails resolve. The
  fix-forward pattern is: only declare a tool the flow's `instructions`
  actually direct the model to call.
- Assuming a high `budget.max_usd` request would apply as written — it's
  silently clamped to the platform ceiling. Don't author budgets as if
  they're the effective value.

## Patterns

- `dispatch:"async"` flows exist specifically for automations that may run
  long (a dispatched handler run that terminalizes later) — pair it with an
  `async_ack_text` that sets the right expectation ("I'll reply when it's
  done"), not a generic "working on it."
- `.strict()` on the top-level schema means a copy-pasted extra field from
  another org's flow.json (e.g. a stray custom key) is a hard parse
  rejection — diff carefully when adapting an existing flow as a template.

## Open questions

- Should this skill grow a `bots.json` worked example once more orgs adopt
  the channel-binding file? Current: no committed `bots.json` example exists
  in the repo yet as of 2026-07-07 to ground one.

---

**Last updated:** 2026-07-07 (initial template).
