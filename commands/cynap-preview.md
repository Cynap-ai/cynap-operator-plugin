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
