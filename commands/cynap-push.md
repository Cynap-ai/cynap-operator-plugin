---
description: Commit the local working directory's changes against the connected org's chain.
argument-hint: "-m <message> [--intent <edit|repair|revert|provision|migration|drift_repair>] [--dry-run] [--dir <path>]"
---

# /cynap-push

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-push.mjs" $ARGUMENTS
```

Plans creates/updates/deletes against `.cynap/state.json`, then:

1. **Refuses locally** if the plan touches a `generated`/`unknown` path or a kind with its own
   entrance (`checks/**`, handler source, and the rest of §4.3's list) — naming each path's
   entrance. Nothing further runs.
2. **Runs the org's `checks/` suite**, if it has one, with the same engine as `/cynap-checks`,
   against this push's planned bytes. Refuses on failure. **There is no skip flag** — a commit
   that can't activate blocks the chain for everyone behind it.
3. **Validates** with `workspace_validate` and refuses on findings.
4. **Commits** with `workspace_commit` (`expected_head_sha` = the last pull's sha, a required
   `-m`). `parent_mismatch` means the tip moved — run `/cynap-pull` first. `chain_full` names
   the commit to activate or discard before pushing again. A byte-identical retry reports as a
   replay, not a new commit.
5. **Updates state** atomically, then prints the chain position.

**`/cynap-push` never activates.** Use `/cynap-activate <commit_sha>` separately.

`--dry-run` stops after step 3 (validate) — nothing is committed.

## Usage

```
/cynap-push -m "<message>" [--intent edit] [--dry-run] [--dir <path>]
```

Requires a prior `/cynap-pull` into the same directory — there is no `.cynap/state.json`
without one.
