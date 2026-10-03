---
description: Request owner step-up and activate an accepted Cynap workspace commit.
argument-hint: "<commit-sha> [--reconcile]"
---

# /cynap-activate

Use this when `workspace_commit` or `workspace_status` returns
`next_action.kind: step_up_and_activate` or `handler_preview_required`. Run it once
with that commit digest.
`next_action.kind: reconciling` means the platform is finishing a stalled activation: do not
re-activate, discard or re-push that commit. Check `workspace_status` again later.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" $ARGUMENTS
```

Run this when the work is ready; do not ask in chat first. The owner's browser step-up is the approval, so
run it and tell the human the step-up is waiting. See the lifecycle rule in `platform-invariants`.

The local proxy opens the owner PKCE approval page, then uses the resulting
single-use purpose credential for exactly one `workspace_activate_commit` call.
Do not use device approval or call `workspace_activate_commit` directly.

The command reads `workspace_status` first. On `handler_preview_required`, it starts each
preview with `{orgSlug, automationId, commitSha}`, prints `preview_running` and the attempt
id, and polls status with bounded backoff. After a pass it re-reads `workspace_status`;
only `step_up_and_activate` opens the owner approval. On fail it stops with only the verdict
code, fixed operator text, and effect kinds with counts. Never show preview row data.

`handler_unproven` means this exact handler bundle lacks a passing proof: run
`/cynap-preview <automation-id> <commit-sha>`, then re-read status. A
`preview_unavailable` refusal means preview admission is not open. The commit
can be valid, but the strictly ordered chain cannot advance behind it until
preview is available or an authorized chain remedy is applied. Stop and report
the commit SHA; do not repeatedly activate it. A frozen chain
(`workspace_writes_frozen`) needs a platform admin today; the operator has no
unfreeze command.

`gate_change_not_alone` means an existing check was edited or deleted in the
same commit as a runtime change. Ship the check change separately.
`checks_uncovered_path` means a changed managed path has no exact-path check
assertion in the pending suite; add coverage and make a new commit. For a deleted
path, the covering assertion needs `"allow_absent": true`.

## `--reconcile` (rare, opt-in)

Add `--reconcile` only when `next_action.kind` is `baseline_required` because the live files
carry no provenance stamp. It adopts those live files and overwrites them with the commit's
content. It still requires the owner step-up and the single-use purpose credential, exactly as
without the flag. Never use it for any other `next_action`.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" <commit-sha> --reconcile
```
