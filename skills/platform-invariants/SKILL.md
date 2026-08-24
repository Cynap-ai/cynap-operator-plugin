---
name: platform-invariants
description: Read before authoring anything for a Cynap org — the compiles-but-breaks constraints that every automation, handler, flow, and schema change must satisfy regardless of mode.
---

# platform-invariants — Compiles-But-Breaks Constraints

You are authoring config/code for exactly ONE customer org's directory. This
skill is the shared digest every other authoring skill (`author-a-flow`,
`author-a-code-execution`, `author-a-deterministic-automation`,
`author-a-schema-change`) assumes you have read first. It does not replace
the canonical files — it is a pointer-dense summary so you don't have to
re-derive these constraints from scratch every session. When in doubt, open
the canonical file and quote it verbatim; do not paraphrase from memory.

**Canonical sources (read these, don't just trust this digest):**
- [internal reference omitted from public mirror] §I-1 through §I-17 + §8 (spec-review compliance check)
- [internal reference omitted from public mirror] §Data Boundaries (Non-Obvious) + §Tool Allowlists

## I-17 — Customer Configuration Trust Boundary (the load-bearing one)

> "Customer-owned files under [internal reference omitted from public mirror] declare business
> intent. They do not own platform decisions." — [internal reference omitted from public mirror] §I-17

This governs every file you author. Concretely:

- A customer config field is either an **Intent** (the customer requests a
  value, platform clamps/resolves the effective one) or a **Forbidden
  customer decision** (the customer cannot declare it at all — e.g.
  `execution.max_concurrent`, per-org `code_execution` concurrency).
- The full field-by-field classification table lives in
  [internal reference omitted from public mirror] §I-17 — check it before inventing a new
  config field. If your field isn't in that table and it would affect
  platform resources, tool grants, concurrency, scheduling, provider
  routing, credentials, or isolation, **it needs a table row and a platform
  spec**, not an ad-hoc addition to a customer config schema.
- Enforcement is **layered**, never single-point: (1) CI schema gate rejects
  unsafe config before merge, (2) post-deploy sync gate re-validates
  S3-backed config before applying side effects, (3) runtime defense
  validates/clamps/strips/rejects at load time. A file you author that
  clears CI but would be silently clamped at runtime is not "done" — check
  what the effective value becomes, not just what parses.

## I-16a — Data-store boundary is audience-axis, not shape-axis

Before adding ANY new field or table, ask:

> *"Would the customer's ops lead query this in their portal dashboard?"*
> — yes → **Turso** (entity field or observation); no (Cynap internals the
> customer never sees) → **Supabase**.

**Common trap:** a `message_id` or timestamp from a business communication
(e.g. a DM sent to verify an invoice) is NOT automatically platform
plumbing just because it looks like "communication state." If it anchors a
real business event the customer's ops lead would ask about ("who responded
fastest to a verification request?"), it is a Turso entity field
(`clinician_invoice.verification_outbound_message_id`,
`verification_sent_at`, `verification_reply_raw` — the canonical example),
never a new Supabase table. Only pieces the customer genuinely never sees —
webhook→identity pairing, sandbox session IDs, automation run ledgers —
belong in Supabase. You are authoring customer-org config; you will not be
creating Supabase tables in this authoring surface at all — but this test
should shape whether you put a field on a Turso entity/schema vs. leaving it
out of scope entirely.

| Store | What belongs | What does NOT belong |
|---|---|---|
| **Turso** (per-customer SQLite) | Business knowledge + lifecycle events: entities, observations, context_documents, entity_schemas, pipeline stages, enrichment. Business-level communication events as entity fields. | Cynap platform plumbing, auth sessions, sandbox instance state, webhook identity pairing |
| **Supabase** (PostgreSQL, platform-owned — NOT something you author into) | Cynap platform operational state: users, orgs, billing, integration creds, sandbox instances, webhook→identity resolution, automation run metadata | Business knowledge or business lifecycle events, even ones with a `message_id` |

## I-13 / I-14 / I-15 — No customer-specific shapes or code on platform types

- **I-13:** Platform types (`UserIdentity`, `CynapContext`, pairing rows,
  integration definitions, automation metadata) stay shape-agnostic across
  every org. You will never add an org-specific named field to one of these
  — that is backend platform work, out of scope for this authoring surface
  entirely. If an authoring task seems to require it (e.g. "the handler
  needs `ctx.identity.clinician_id`"), the correct answer is: pass it inside
  `input`, resolved upstream (see `author-a-code-execution` for the
  `channel_sender` pattern) — never propose a new field on a platform type.
- **I-14:** Business logic, classification rules, pricing/commission math,
  template maps, state machines — anything describing how *one specific
  customer's business works* — belongs under
  [internal reference omitted from public mirror], never in [internal reference omitted from public mirror]. You are already
  authoring inside the customer org directory, so this mostly just confirms
  you're in the right place; it also means don't propose backend changes as
  part of an authoring task.
- **I-15:** If an authoring task genuinely seems to require a new platform
  primitive (not just customer config), that is a *different, cleanly-scoped
  deliverable* with its own generic-guarantee + own-tests requirements — flag
  it as a platform-work follow-up, do not fold it into your customer-config
  change.

## Tool allowlist rules (only relevant if a task touches MCP-level tools)

You are not expected to add new MCP-level tools in ordinary org-authoring
work — that is backend platform work. If a task ever asks you to, per
[internal reference omitted from public mirror] §Tool Allowlists, a new MCP-level tool must be added to ALL 8
allowlists (`tool-registry.ts`, `authorization.ts`, `mcp-schemas.ts`,
`mcp-server.ts`, `semantic-model.ts`, `mcp.ts` FAST_PATH_TOOLS, portal
`query-schema.ts`, the acme `no-new-exports.test.js` snapshot) plus the
parity test in [internal reference omitted from public mirror]. A
**sub-tool** dispatched through `knowledge_query_data` needs only 2:
`knowledge-handlers.ts` `QUERY_DATA_ALLOWLIST` + the portal
`TOOL_ALLOWLIST`. Flag this as backend platform work rather than attempting
it from the org directory.

## I-12 — Access control is resolved by one layer, never re-derived

All access facts (caller-kind × org-capability × scope) are computed by the
capability-resolution layer ([internal reference omitted from public mirror]). If an
authoring task promises "user A can only see rows they own," the only
structural mechanism is the scope-token primitive (`subject_scope`) —
**agent-prompt discipline is not platform enforcement** and must never be
presented as such in your authoring output. See `author-a-flow` for the
`subject_scope` config field.

## Quick pre-flight checklist before any authoring task

1. Which of the 3 modes does this task need? → `choose-the-right-mode`.
2. Does the field/table I'm about to touch pass the I-16a audience test?
3. Is every config field I'm setting either accepted **Intent** in the
   §I-17 table, or genuinely inert (ignored/rejected) if I set it?
4. Am I about to reference a platform type (`CynapContext`, `UserIdentity`)
   with an org-specific field name? If yes, stop — pass it in `input`
   instead.
5. Am I about to hardcode `'entities'` as a table name? Stop — use
   `getSchemaRegistry()` / `resolveTableForType()` (see
   `author-a-schema-change`).

---

**Spec references:** CYN-768 P2 §2.5 · [internal reference omitted from public mirror] §I-1–§I-17, §8 · [internal reference omitted from public mirror] §Data Boundaries (Non-Obvious), §Tool Allowlists.
