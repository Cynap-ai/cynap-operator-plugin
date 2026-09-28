---
description: Request owner step-up and activate an accepted Cynap workspace commit.
argument-hint: "<commit-sha>"
---

# /cynap-activate

Use this only when `workspace_commit` or `workspace_status` returns
`next_action.kind: step_up_and_activate`. Run it once with that commit digest.
`next_action.kind: reconciling` means the platform is finishing a stalled activation: do not
re-activate, discard or re-push that commit. Check `workspace_status` again later.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" $ARGUMENTS
```

The local proxy opens the owner PKCE approval page, then uses the resulting
single-use purpose credential for exactly one `workspace_activate_commit` call.
Do not use device approval or call `workspace_activate_commit` directly.
