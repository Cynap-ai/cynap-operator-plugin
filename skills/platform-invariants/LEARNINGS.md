# LEARNINGS — platform-invariants (cross-org)

Cross-org procedural wisdom for the shared invariant digest. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Front-loading the platform-owned-vs-operator-declared framing before any
  mode-specific skill.** Authoring tasks that start from "what does the
  customer intend" vs. "what does the platform decide" produce fewer config
  fields that get silently clamped or rejected downstream.
- **The audience test as a single question.** "Would the ops lead query this
  in their portal dashboard?" resolves where a field belongs faster than
  reasoning about data shape.
- **Treating a platform-type field addition (e.g. wanting `ctx.identity.X`)
  as platform work, not a small customer-side ask.** Recognizing this up
  front avoids authoring effort that has to be redirected to the
  `input`-payload pattern.

## Patterns

- Every other skill in this plugin cross-links here rather than
  re-explaining the shared constraints — keep this file as the single source
  for them so the mode-specific skills stay short and don't drift from each
  other.

---

**Last updated:** 2026-07-07 (initial template).
