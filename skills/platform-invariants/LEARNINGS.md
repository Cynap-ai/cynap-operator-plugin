# LEARNINGS — platform-invariants (cross-org)

Cross-org procedural wisdom for the shared invariant digest. Read at task
start; append at task end. No customer-specific strings.

---

## What worked

- **Front-loading the I-17 trust-boundary framing before any mode-specific
  skill.** Authoring tasks that start from "what does the customer intend"
  vs. "what does the platform decide" produce fewer config fields that get
  silently clamped or rejected downstream.
- **The I-16a audience test as a single question.** "Would the ops lead
  query this in their portal dashboard?" resolves the Turso-vs-Supabase
  question faster than reasoning about data shape.

## What failed

- Treating a platform-type field addition (e.g. wanting `ctx.identity.X`)
  as a small customer-side ask instead of recognizing it as an I-13
  violation up front — this always turns into wasted authoring effort that
  has to be redirected to the `input`-payload pattern.

## Patterns

- Every other skill in this plugin cross-links here rather than
  re-explaining I-17/I-16a/I-13 — keep this file as the single source for
  the shared constraints so the mode-specific skills stay short and don't
  drift from each other.

## Open questions

(none yet)

---

**Last updated:** 2026-07-07 (initial template).
