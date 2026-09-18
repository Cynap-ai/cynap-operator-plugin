# LEARNINGS — summarize-your-change (cross-org)

Cross-org procedural wisdom for composing `change_overview`. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Framing it as "you already know this, just write it down" rather than
  "generate a summary."** The operator (Claude Code / Codex) just authored
  the change and holds the intent first-hand — the skill's job is to
  prompt the operator to externalize what it already knows, not to derive
  anything new, and the platform never re-derives an overview from the diff.
- **Naming the closed `mode` vocabulary explicitly** (`code_execution`/
  `flow`/`deterministic`/`schema`/`mixed`) rather than leaving it open-ended —
  an open-ended mode field produced inconsistent labels across orgs before
  this was pinned to `choose-the-right-mode`'s existing vocabulary.
- **Stating the omit-is-fine escape hatch up front.** Making `change_overview`
  clearly optional (not a mandatory ritual) keeps the skill from turning a
  quick scripted/automated commit into a forced essay-writing exercise.

## Patterns

- Never imply the overview is mandatory before `workspace_commit` will
  succeed — the field is OPTIONAL and its absence never blocks the commit;
  saying otherwise trains operators to pad every commit with a low-effort
  placeholder overview just to satisfy a perceived requirement.
- Compose `change_overview` in the SAME tool call as `workspace_commit` —
  never as a separate follow-up call. There is no async step to "catch up"
  later; if the overview isn't on the commit call, the owner never sees
  one for that commit.
- Treat the PHI/row-value warning as load-bearing, not boilerplate: an
  operator drafting `why` from a bug report that itself quotes a customer
  name is the most likely real-world leak vector, not a hypothetical.

---

**Last updated:** 2026-07-07 (initial template).
