---
description: Commit the local working directory's changes against the connected org's chain.
argument-hint: "-m <message> [--intent <edit|repair|revert|provision|migration|drift_repair>] [--rebuild <surfaceId>] [--dry-run] [--dir <path>]"
---

# /cynap-push

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-push.mjs" $ARGUMENTS
```

A push is a draft: it commits to the org's accepted chain and deploys nothing. Run it without asking
in chat; the owner approves at `/cynap-activate`. See the lifecycle rule in `platform-invariants`.

Plans creates/updates/deletes against `.cynap/state.json`, then:

1. **Refuses locally** if the plan touches a `generated`/`unknown` path or a
   git-only kind (such as `reclaims.json`) — naming each path's entrance.
   Checks, handler source, and surfaces are operator-routable. Nothing further
   runs on a refused path.
2. **Runs the accepted live `checks/` suite**, if it has one, with the same engine as
   `/cynap-checks`, against the resultant planned content. A check file replaced by this
   push is evaluated from its planned bytes; unchanged check files come from live.
   Refuses on failure. If a content change would break an unchanged live check, ship
   the check update first, then pull and ship the content change. **There is no skip flag** — a commit
   that can't activate blocks the chain for everyone behind it.
3. **Validates** with `workspace_validate` and refuses on findings. Every refusal, dry run or
   real, prints each error (`[code] path:line: message`), the server's message, and the
   `validation run:` id.
4. **Commits** with `workspace_commit` (`expected_head_sha` = the last pull's sha, a required
   `-m`). `parent_mismatch` means the tip moved — run `/cynap-pull` first. `chain_full` names
   the commit to activate or discard before pushing again. A byte-identical retry reports as a
   replay, not a new commit.
5. **Updates state** atomically, then prints the chain position.

## Surfaces (`surfaces/<id>/**`)

A push that touches a surface is built by the platform before it is committed: at most **one**
surface directory per push. A refusal prints the code, the builder's findings (file:line and the
rule that fired) and a one-line fix. Nothing is committed on a refusal.

| Code | Meaning |
|---|---|
| `surface_lint_failed` | The source uses a construct surfaces may not use (raw `postMessage`, `parent`/`top`/`opener`, `eval`, an ext-apps import), or does not compile. |
| `surface_import_rejected` | An import outside the Surface SDK, `react`, `react-dom` and the surface's own files. |
| `surface_manifest_invalid` | The directory, `routes.json` or `tools.json` is invalid. |
| `surface_tool_not_callable` | A called tool is undeclared in `tools.json`, or is not app-visible. |
| `surface_csp_not_empty` | A `_meta.ui.csp` domain list is not empty. |
| `surface_too_large` | The built bundle is over its size cap. |
| `surface_too_many` | The push touches more than one surface. Split it. |
| `surface_build_failed` | The build failed, or the builder was unavailable. |
| `surface_receipt_invalid` | The platform could not verify the build. Report the request id. |
| `surface_build_busy` | Another build for this org is running. **Retryable.** |
| `surface_build_timeout` | The build did not fit in the request. Retry once; if it repeats, stop and report the request and findings. |

**`--rebuild <surfaceId>`** commits no file changes and rebuilds that surface against the current
platform builder — how a new Surface SDK minor reaches an approved surface (there are no silent
platform rebuilds). The rebuild is a draft like any push; the Owner approves it at activation.

**Runtime changes need `/cynap-activate <commit_sha>` separately.** A commit
containing only commit-only files auto-activates.

`--dry-run` stops after step 3 (validate) — nothing is committed.

## Usage

```
/cynap-push -m "<message>" [--intent edit] [--rebuild <surfaceId>] [--dry-run] [--dir <path>]
```

Requires a prior `/cynap-pull` into the same directory — there is no `.cynap/state.json`
without one.

Pull immediately before editing: an old local base can silently diverge from the
accepted tip. Pull and push may take minutes without interim output. Run a
long command in the background with stdout/stderr redirected to an output
file, then read that file and its exit status when it finishes. Keep the
shell invocation rooted at `${CLAUDE_PLUGIN_ROOT}`, never a copied versioned
plugin-cache path. In a pulled tree, `checks/` holds suites, `operator/skills/`
holds org authoring instructions, `operator/scripts/` holds read-only scripts,
and test files/`__tests__/` run through `/cynap-test`.

An existing check edit or deletion cannot ride with a runtime change
(`gate_change_not_alone`). A new check may accompany a change. A changed
managed path with no assertion naming it is refused up front, during push
validation, with `checks_uncovered_path`, and again at activation; add coverage
in a check before pushing.
