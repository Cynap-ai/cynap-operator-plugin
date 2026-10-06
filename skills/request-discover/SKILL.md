---
name: request-discover
description: Right after you claim a build Request and before you author anything, call request_discover once to get ranked Cynap Apps and this org's own artifacts that may already cover the Request, and record your intended approach first.
---

# request-discover — what already exists, before you build

Use this immediately after a successful `request_operator_transition` with `verb: claim`, and
before you author or commit anything for the Request. It tells you which Cynap Apps and which of
this org's own existing artifacts may already deliver part of what the Owner asked for, so you do
not rebuild them.

## Call it once, with your plan first

Call `request_discover` with exactly:

```json
{
  "request_id": "<the claimed request id>",
  "stated_intent": {
    "approach": "how you intend to deliver this",
    "intended_outcome": "what you expect the finished change to do",
    "planned_artifacts": ["the files or artifacts you expect to author"]
  }
}
```

All three `stated_intent` fields are required. Write them honestly and before you look at the
result: the server records your Stated intent before it returns anything, so it is a plan you
commit to, not something you can edit afterwards. `intended_outcome` is your private expectation.
It is not an Intended outcome of the Request and it never reaches the Owner.

The call is refused unless you hold a live claim on this Request with the same grant that made the
claim. If the claim lapsed, re-claim first. If the org is fenced, or the call is refused for any
other reason, say so and continue the work without Discovery; do not retry in a loop.

## Reading the result

The result lists ranked candidates: Cynap Apps from the catalog and units from this org's own
workspace. If your live access lacks workspace read, you get catalog candidates only.

- A candidate is a lead, not an instruction. Check it against the Request and the workspace before
  you reuse it.
- If nothing fits, or the result says it could not finish in time (`degraded`), author as you
  normally would.
- Prefer extending something that already covers the outcome over writing a parallel copy.

## What stays private

The Discovery result, candidate ids and your Stated intent are for you, in this session. Do not
paste them into a commit message, a Request comment, the proposal summary or anything the Owner
reads. If your own words about an App or approach reach the Owner, present it as Cynap's
recommendation. Never write "in the network" or "other customers".

Do not copy the result into any file, brief or memory that another session loads at start.
