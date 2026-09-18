# LEARNINGS — choose-the-right-mode (cross-org)

Cross-org procedural wisdom. Read at task start; append at task end. No
customer-specific strings.

---

## What worked

- **Cost-ordering as the first thing an operator sees.** Presenting
  `code_execution` > `flow` > `deterministic` by cost before the decision
  rules nudges toward the cheaper mode when a task is genuinely ambiguous
  between two of them. (Historical: this used to be a 4-row table —
  `agent` > `handler` > `flow` > `deterministic` — before `agent` and
  `handler` retired; both collapsed into `code_execution`.)
- **Naming the trap explicitly** (conversational bot → sandbox-driven
  headless mode) rather than only describing the correct answer. Operators
  pattern-match "AI mode" to whichever entrypoint sounds most agentic;
  calling out the mistake by name short-circuits it faster than a
  positive-only description.

## What failed

- Early informal guidance that just listed the modes without an ordered
  decision tree left ambiguous cases (e.g. "an automation that classifies
  incoming data") unresolved between the code-bearing mode and `flow`. The
  fix was making rule 1 (conversational?) the first gate — everything else
  follows from whether a human is on the other end of a real-time reply.
- The skill body drifted out of sync with the schema for weeks:
  it kept routing to `agent`/`handler`, both of which validation
  had already rejected. A skill that authors a
  guaranteed-to-fail config is worse than no skill — it costs the
  operator a round-trip through a validation error instead of getting it
  right the first time. Whenever a platform mode is retired, this skill
  needs updating in the SAME change, not on a later pass.

## Patterns

- Route decisions in order of narrowest-applicability-first
  (conversational → no-LLM-closed-vocabulary → everything else) rather
  than a flat lookup table — this avoids a task matching two rows
  simultaneously.

## Open questions

- None outstanding as of 2026-08-11 — `mode:code_execution` is
  now the live customer-authorable mode covering everything the retired
  `agent`/`handler` modes used to (the prior "should this become a 5th
  option" question resolved itself: it became THE code-bearing mode, not
  an addition to a 4-mode set).

---

**Last updated:** 2026-08-11 (routing rewritten around the live
3-mode vocabulary after `agent`/`handler` retirement).
