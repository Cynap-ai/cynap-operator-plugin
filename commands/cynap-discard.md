---
description: Discard a pending accepted commit and every commit after it on the org's chain.
argument-hint: "<commit-sha> --reason <text> [--dry-run] [--json]"
---

# /cynap-discard

Use this when a pending commit can never activate, most often because `/cynap-activate` refused it.
A refused commit blocks every commit behind it (`blocked_by_chain`), so pushing a fix on top does
not help. Discarding is the only way out: there is no revert.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-discard.mjs" $ARGUMENTS
```

Discarding removes the named commit **and every commit after it** from the pending chain. It
never touches the live commit, and nothing it removes was ever deployed. It cannot be undone, so
check the range first with `--dry-run`.

## What it does

1. Reads `workspace_status` and finds the commit in the pending chain. If it is not pending
   (it is live, already discarded, or unknown), the command stops and says so. Nothing is sent.
2. Lists the range it would remove, oldest first. With `--dry-run` it stops here.
3. Calls `workspace_discard_commit` once with the commit and your `--reason`, then prints what
   was removed and the new accepted tip.

After a discard, run `/cynap-pull` before editing so your local base is the accepted tip again.
To keep any change from a discarded commit, push it again as a new commit.

## Who may discard

You may discard a range only if you authored every commit in it, or you hold the Owner seat. A
commit bound to a Request can be discarded only by the Owner.

## Refusals

| Code | Meaning | Next step |
|---|---|---|
| `commit_not_pending` | the commit is not on the pending chain | Run `/cynap-status` to see the pending chain. |
| `commit_activating` | a commit in the range is activating now | Wait, check `/cynap-status`, then retry if it is still pending. |
| `commit_orphaned` | the commit was already discarded | Run `/cynap-status`, then `/cynap-pull`. |
| `forbidden_actor` | you did not author every commit in the range | Ask the Owner, or discard from a later commit that is all yours. |
| `workspace_writes_frozen` | the org's workspace writes are frozen | Nothing can be discarded until the freeze is lifted. |

**Never retry blindly.** If no reply came back (`outcome_unknown`), the discard may have landed.
Run `/cynap-status` first: a second discard of a discarded commit answers `commit_orphaned`.

## Usage

```
/cynap-discard <commit-sha> --reason <text> [--dry-run] [--json]
```
