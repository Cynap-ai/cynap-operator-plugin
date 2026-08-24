# LEARNINGS — summarize-your-change (cross-org)

Cross-org procedural wisdom for composing `change_overview`. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Framing it as "you already know this, just write it down" rather than
  "generate a summary."** The operator (Claude Code / Codex) just authored
  the change and holds the intent first-hand — the skill's job is to
  prompt the operator to externalize what it already knows, not to derive
  anything new. This is the whole point of ADR 0034: no re-derivation.
- **Naming the closed `mode` vocabulary explicitly** (`code_execution`/
  `flow`/`deterministic`/`schema`/`mixed`; historically `agent`/`handler`
  before CYN-1045/CYN-729 retired them) rather than leaving it open-ended —
  an open-ended mode field produced inconsistent labels across orgs before
  this was pinned to `choose-the-right-mode`'s existing vocabulary.
- **Stating the omit-is-fine escape hatch up front.** Making `change_overview`
  clearly optional (not a mandatory ritual) keeps the skill from turning a
  quick scripted/automated commit into a forced essay-writing exercise.

## What failed

- An early draft of this skill implied the overview was mandatory before
  `workspace_commit` would succeed — that's wrong (ADR 0034 / the tool
  contract: the field is OPTIONAL, absence never blocks the commit) and
  would have trained operators to pad every commit with a low-effort
  placeholder overview just to satisfy a perceived requirement.

## Patterns

- Compose `change_overview` in the SAME tool call as `workspace_commit` —
  never as a separate follow-up call. There is no async step to "catch up"
  later; if the overview isn't on the commit call, the owner never sees
  one for that commit.
- Treat the PHI/row-value warning as load-bearing, not boilerplate: an
  operator drafting `why` from a bug report that itself quotes a customer
  name is the most likely real-world leak vector, not a hypothetical.

## Open questions

- Should the skill eventually cite REAL scrub-rejection examples once a
  cynap-e2e bake produces one (a genuinely rejected overview from a real
  session), rather than only the synthetic examples in the sibling skill
  doc? Current: no real-traffic example exists yet as of 2026-07-07.

---

**Last updated:** 2026-07-07 (initial template).
