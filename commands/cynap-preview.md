---
description: Preview a code_execution handler at a committed workspace SHA on data copies.
argument-hint: "<automation-id> <commit-sha> | status <attempt-id>"
---

# /cynap-preview

Run a handler preview for this exact automation and commit. The plugin's pinned org identity
supplies `orgSlug`; the command sends `{orgSlug, automationId, commitSha}` to the backend.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-preview.mjs" $ARGUMENTS
```

The command prints `preview_running` with the attempt id while the backend runs, then polls
status for a bounded time. A preview that outlives that wait is still running: the command
prints `/cynap-preview status <attempt-id>`, and running it later reads that attempt's state
and verdict once (`GET /preview/status/{previewId}`, the same `workspace:execute-preview`
read). Do not start a second preview to find out: an org runs one preview at a time, so it is
refused `preview_running`, and the refusal names the running attempt, its automation and
when it started.
`preview_not_found` means the attempt is not in this org or its verdict has expired. On pass, re-read `workspace_status` and follow its activation
`next_action`. A pass reports counts and effect kinds only. A failure reports the
typed verdict code and its closed facts: `failureLocation` (the error class and
`handler.js` line where the candidate threw) and whether the baseline, the accepted
code on its own copy, failed too. A baseline that failed too means the failure may
not come from this commit. No error text or payload is ever shown. Never print row
data from a preview copy.

Browser handlers (`capabilities: ["browser"]`) preview like any other handler: the vendor session never enters the preview VM, page loads use it server-side, and every write is captured. Activation needs a pass. After a pass, run `/cynap-activate <commit-sha>`; any captured write is listed on the owner approval page.

`handler_unproven` on activation calls for `/cynap-preview <automation-id>
<commit-sha>` on the exact committed handler bundle. `preview_unavailable`
means preview admission is closed; the commit itself can be valid, but it
blocks the strictly ordered chain. Stop and report the commit SHA and refusal
instead of retrying. If the chain is frozen, a platform admin must unfreeze
it; there is no operator unfreeze route. A `baseline_required` next action
uses `/cynap-activate <commit-sha> --reconcile`, only after checking the live
provenance gap.

An existing check edit bundled with a runtime change fails
`gate_change_not_alone`. A managed path without a pending exact-path
assertion fails `checks_uncovered_path` at activation. Ship the check change
first, or add coverage before committing the runtime change.
