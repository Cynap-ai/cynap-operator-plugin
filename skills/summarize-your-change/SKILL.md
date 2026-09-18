---
name: summarize-your-change
description: Compose the change_overview argument for workspace_commit — the structured AI-overview the owner sees on their review pane. Use this immediately before every workspace_commit call, after you finish authoring a change.
---

# summarize-your-change — Compose `change_overview` Before You Commit

You are Claude Code (or Codex) acting as the operator. You authored this
change and know its intent first-hand; write the summary yourself. The
platform does **not** re-derive "what changed / why" from your diff — it
only validates, scrubs, and stores what you write. Pass the structured
overview as an argument to `workspace_commit`.

Read `platform-invariants` first if you haven't this session. This skill
assumes you have already finished authoring the change (via
`author-a-code-execution` / `author-a-flow` / `author-a-deterministic-automation` /
`author-a-schema-change`) and are about to call `workspace_commit`.

## What to do

Immediately before calling `workspace_commit`, compose a `change_overview`
object and pass it as an additional argument alongside `changes` / `message`
/ `intent` / `expected_head_sha`:

```json
{
  "changes": { "...": "..." },
  "message": "fix: refresh the invoice-sync stale-token check",
  "intent": "repair",
  "expected_head_sha": "<sha>",
  "change_overview": {
    "what_changed": "Updated the invoice-sync handler's WriteUpp token check.",
    "why": "The prior check accepted an expired token and failed silently.",
    "fix_summary": "Added a re-auth call before the token is used.",
    "touched_automations": ["invoice-sync"],
    "mode": "code_execution"
  }
}
```

## The five fields

- **`what_changed`** (required, 1-500 chars) — one or two sentences
  describing what you changed, in your own words. Not a diff dump — a
  human-readable summary the owner reads in seconds.
- **`why`** (0-500 chars) — the rationale, inferred from the task you were
  given or the bug you were fixing. If genuinely unclear, write `"not
  stated"` rather than guessing specifics you don't know.
- **`fix_summary`** (0-500 chars) — what the fix/change actually does,
  mechanically. If this isn't a fix (e.g. a new feature), write `"n/a"`.
- **`touched_automations`** (array of strings, up to 50) — the automation
  ids or names you edited (e.g. the `{handler-id}` from
  `automations/handlers/{handler-id}/`). Empty array for a schema-only or
  context-only change that touches no automation.
- **`mode`** (required, up to 50 characters — a free string on the wire
  schema, but authored from a closed vocabulary by convention) — the
  authoring mode this change falls under: one of `code_execution`, `flow`,
  `deterministic`, `schema`, or `mixed` (if the change spans more than one).
  Use `choose-the-right-mode`'s vocabulary — don't invent a new label.

## The hard rule: NO PHI, NO row values, NO entity instances

**Every field is free text you write — never quote or paraphrase actual
customer data into it.** Do not put a patient/customer name, an invoice
amount, a phone number, an address, or any other row-level VALUE into
`what_changed`/`why`/`fix_summary`. Describe the STRUCTURE of the change
("the invoice-verification handler", "the patient schema"), never an
INSTANCE of it ("patient John Doe's invoice #4021").

The backend independently scrubs the overview for a leaked
`*_id`/`*_ref`/`subject*`-shaped token (e.g. `patient_id`, `invoice_ref`)
before it's stored, and will silently drop the WHOLE overview if one slips
through — the commit itself still succeeds either way, but a scrubbed
overview means the owner sees "not yet available" instead of your summary.
Write clean the first time rather than relying on the scrub as a safety
net.

## When to send `request_id`

`request_id` is a **separate, optional** argument on the same
`workspace_commit` call. Send it **only** while you are implementing a Request
you have **already claimed** — it binds this commit to that Request, so the
owner's audit trail records which Request, claim, credential and grant
authorized the change.

- **Omit it** for an ordinary commit that is not against a claimed Request.
- It is **not an idempotency key.** It never dedupes, never replays, and never
  makes a repeat commit a no-op. Do not generate one, and do not reuse one
  from an earlier commit to "retry" this one.
- Your live grant must carry **both** `workspace:commit` and
  `workspace:request-claim`, and must hold that Request's claim. If it does
  not, the commit is refused with `REQUEST_AUTHORITY_UNAVAILABLE`.

A Request-bound commit with an overview looks like this:

```json
{
  "changes": { "...": "..." },
  "message": "fix: refresh the invoice-sync stale-token check",
  "intent": "repair",
  "expected_head_sha": "<sha>",
  "request_id": "<the-request-you-claimed>",
  "change_overview": {
    "what_changed": "Updated the invoice-sync handler's WriteUpp token check.",
    "why": "The prior check accepted an expired token and failed silently.",
    "fix_summary": "Added a re-auth call before the token is used.",
    "touched_automations": ["invoice-sync"],
    "mode": "code_execution"
  }
}
```

## What happens if you omit `change_overview`

Nothing breaks. `change_overview` is **optional** — the commit succeeds
identically whether or not you supply one. If you omit it (or the backend
rejects a malformed one), the owner's review pane simply shows "Change
summary not yet available." instead of your overview. There is no retry,
no async step, and no separate call to make later — if you want the owner
to see a summary, supply `change_overview` on the SAME `workspace_commit`
call.

## Checklist

1. Finish authoring the change (config/handler/flow/schema file(s)).
2. Compose `change_overview` — five fields, no PHI/row values, `mode` from
   the closed vocabulary.
3. Pass it as an argument on the SAME `workspace_commit` call — never a
   separate tool call, never after the fact.
4. If you genuinely can't summarize honestly (e.g. an automated/scripted
   commit with no real authoring intent), it's fine to omit the field
   entirely rather than write a vague/generic placeholder.
