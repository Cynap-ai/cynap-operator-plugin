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

The command prints the attempt id and polls until its verdict. If another preview holds the
org's slot, this attempt reports `waiting` and its queue position. It waits through the server's
queue deadline, then through the promoted run's lease plus a 60-second verdict grace.
`preview_queue_full` means the org already has ten waiting attempts. Older clients receive
`preview_running`; update the plugin to use the queue.
If the wait ends before a verdict, use `/cynap-preview status <attempt-id>` to read that
attempt once. Do not start another attempt to check the original one's progress.
`preview_not_found` means the attempt is not in this org or its verdict has expired.
A gateway timeout, a 502 from the proxy or a 503 `operator_authz_unavailable` during the poll
says nothing about the attempt, so the poll keeps going through up to five of them in a row.
Previews run only at the accepted tip. A `superseded` result names its reason and prints the next
step. `key_changed` means the commit is no longer the tip, or its handler inputs changed before the
run started. Preview the automation at the tip instead (`/cynap-status` names it). A pass there also
proves an earlier pending commit whose handler and context are unchanged. If a later commit changed
that handler, `/cynap-discard` the commit after the one you need, preview and activate that one,
then push the rest again. On pass, re-read `workspace_status` and follow its activation
`next_action`. A pass reports counts and effect kinds only. A failure reports the
typed verdict code and its closed facts: `failureLocation` (the error class and
`handler.js` line where the candidate threw) and whether the baseline, the accepted
code on its own copy, failed too. A baseline that failed too means the failure may
not come from this commit. A baseline that succeeded but whose effects could not be
compared (`diff_unavailable`) did not fail: look at what this commit changed. A
`capture_tool_failed` verdict also lists `faults`: `tool_error:<tool>:<thrown|result_error>`,
plus `<rejection_code>:<tool>` (e.g. `batch_too_large:knowledge_store_batch`) when the tool
refused the request for a fixable reason, and says when the same tool failed on the baseline
too. No error text or payload is ever shown. Never print row
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
