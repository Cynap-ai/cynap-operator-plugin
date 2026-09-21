---
name: platform-invariants
description: Read before authoring anything for a Cynap org — the compiles-but-breaks constraints that every automation, handler, flow, and schema change must satisfy regardless of mode.
---

# platform-invariants — Compiles-But-Breaks Constraints

You are authoring config/code for exactly ONE customer org's directory. This
skill is the shared digest every other authoring skill (`author-a-flow`,
`author-a-code-execution`, `author-a-deterministic-automation`,
`author-a-schema-change`) assumes you have read first. It is self-contained
and authoritative enough to act on — treat the rules below as the rules, and
when in doubt, ask rather than guessing.

## Platform-owned vs operator-declared settings

> "Files you author in the workspace declare business intent. They do not own
> platform decisions."

This governs every file you author. Concretely:

- A config field is either an **Intent** (you request a value, the platform
  resolves the effective one) or a **Forbidden customer decision** (you
  cannot declare it at all — e.g. `execution.max_concurrent`, how many
  `code_execution` runs your org may have at once).
- If a field is not covered by the rules here and it would affect platform
  resources, tool grants, concurrency, scheduling, provider routing,
  credentials, or isolation, it is not yours to set — flag it as platform
  work.
- Enforcement is **layered**, never single-point: (1) the schema check rejects
  unsafe config at commit time, (2) a check after activation re-validates the
  deployed config before applying side effects, (3) the platform
  validates/clamps/strips/rejects at load time. A file you author that
  clears the first check but would be silently clamped at runtime is not
  "done" — check what the effective value becomes, not just what parses.

## Where business data belongs — the org's data model, not platform plumbing

Before adding ANY new field or table, ask:

> *"Would the customer's ops lead query this in their portal dashboard?"*
> — yes → the org's own data model: an **entity field** or an
> **observation**; no (platform plumbing the customer never sees) → keep
> it out of the org's data model.

**Common trap:** a `message_id` or timestamp from a business communication
(e.g. a DM sent to verify an invoice) is NOT automatically platform plumbing
just because it looks like "communication state." If it anchors a real
business event the customer's ops lead would ask about ("who responded
fastest to a verification request?"), it is a field on the entity itself
(e.g. an invoice's outbound-message id and sent-at timestamp — the canonical
example), never left out of the data model. Only pieces the customer
genuinely never sees — webhook→identity pairing, agent session IDs,
automation run ledgers — are platform plumbing. You are authoring
customer-org config; platform plumbing is not yours to author at all — but
this test should shape whether you put a field on an entity/schema vs.
leaving it out of scope entirely.

| Where | What belongs | What does NOT belong |
|---|---|---|
| **The org's data model** (the org database) | Business knowledge + lifecycle events: entities, observations, context_documents, entity_schemas, pipeline stages, enrichment. Business-level communication events as entity fields. | Platform plumbing, auth sessions, run-runtime instance state, webhook identity pairing |
| **Platform-owned internals** (NOT something you author into) | Platform operational state: users, orgs, billing, integration creds, run-runtime instances, webhook→identity resolution, automation run metadata | Business knowledge or business lifecycle events, even ones with a `message_id` |

## Do not add customer-specific shapes or code to platform types

- **Platform types stay shape-agnostic.** Platform types (`UserIdentity`,
  `CynapContext`, pairing rows, integration definitions, automation metadata)
  stay shape-agnostic across every org. You will never add an org-specific
  named field to one of these — that is platform work, out of scope for this
  authoring surface entirely. If an authoring task seems to require it (e.g.
  "the handler needs `ctx.identity.clinician_id`"), the correct answer is:
  pass it inside `input`, resolved upstream (see `author-a-code-execution`
  for the `channel_sender` pattern) — never propose a new field on a platform
  type.
- **Business logic lives in your workspace config.** Business logic,
  classification rules, pricing/commission math, template maps, state
  machines — anything describing how *one specific customer's business
  works* — belongs in the config you are authoring, never in platform code.
  You are already authoring inside the customer org directory, so this
  mostly just confirms you're in the right place; it also means don't propose
  backend changes as part of an authoring task.
- **A new platform capability is a separate deliverable.** If an authoring
  task genuinely seems to require a new platform primitive (not just customer
  config), that is a *different, cleanly-scoped* deliverable with its own
  generic-guarantee + own-tests requirements — flag it as a platform-work
  follow-up, do not fold it into your customer-config change.

## Adding platform tools is not authoring work

Adding a new MCP-level tool is platform work, not authoring work — flag it. A
**sub-tool** reachable through `knowledge_query_data` is a smaller platform
change, but still platform work: it needs its own allowlist entry and a
parity test on the platform side. Flag either as a platform follow-up rather
than attempting it from the org directory.

## AI calls use the customer AI boundary

If a flow, automation, operation, or Actor needs an AI call, read
`configure-customer-ai` before proposing config. Workspace files may narrow
model/task intent, but provider routing, credentials, funding, prices,
reservations, and debits remain platform-owned. Explain native versus BYOK
billing to the user before asking them to choose.

## Access control is the platform's job

All access facts — who the caller is, what their org allows, and the scope
they act in — are resolved by the platform, not by anything you write. If an
authoring task promises "user A can only see rows they own," the only
structural mechanism is the scope-token primitive (`subject_scope`) —
**prompt discipline is not access control** and must never be presented as
such in your authoring output. See `author-a-flow` for the `subject_scope`
config field.

## Quick pre-flight checklist before any authoring task

1. Which of the 3 modes does this task need? → `choose-the-right-mode`.
2. Does the field/table I'm about to touch pass the audience test above —
   would the customer's ops lead query it in their dashboard?
3. Is every config field I'm setting either an accepted **Intent**, or
   genuinely inert (ignored/rejected) if I set it?
4. Am I about to reference a platform type (`CynapContext`, `UserIdentity`)
   with an org-specific field name? If yes, stop — pass it in `input`
   instead.
5. Am I about to hardcode a physical table name? Stop — resolve it through
   the schema registry (`getSchemaRegistry()` / `resolveTableForType()`, see
   `author-a-schema-change`).
6. Does this task make an AI call? Read `configure-customer-ai`, explain its
   billing choices, and keep payer/provider authority out of customer config.
