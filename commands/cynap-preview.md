---
description: Preview a code_execution handler at a committed workspace SHA on data copies.
argument-hint: "<automation-id> <commit-sha>"
---

# /cynap-preview

Run a handler preview for this exact automation and commit. The plugin's pinned org identity
supplies `orgSlug`; the command sends `{orgSlug, automationId, commitSha}` to the backend.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-preview.mjs" $ARGUMENTS
```

The command prints `preview_running` with the attempt id while the backend runs, then polls
status for a bounded time. On pass, re-read `workspace_status` and follow its activation
`next_action`. A pass reports counts and effect kinds only. A failure reports the
typed verdict code and fixed operator text. Never print row data from a preview copy.

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
