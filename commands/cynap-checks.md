---
description: Run this org's checks/ suite locally against your LOCAL pending changes and report the verdict.
argument-hint: "<commit-sha>"
---

# /cynap-checks

Runs the org's `checks/` suite — the per-org config-as-code invariants (CYN-1094 /
ADR-0059) — **locally, against your LOCAL working-dir pending bytes**, and reports the
terminal verdict (bound to the committed content) so the platform can gate activation on it.

This is the fast, preventive half of the org-checks gate: your local run produces an
**attestation** the backend trusts and binds to the exact committed content (the commit hash
⋈ a resultant-content fingerprint). The backend recomputes that fingerprint server-side and
refuses activation on a mismatch — so a stale or dishonest attestation can never gate untested
content. (The detective half — the platform-CI backstop — lands in W2.)

## When to run it

Right after `workspace_commit` returns a `commit_sha`, and before you elevate to
`workspace_activate_commit`. Pass the commit sha you just committed.

## What it does (entirely operator-local — spec §5)

The command runs the deterministic runner (no LLM in the load-bearing path — the fingerprint
and pass/fail are computed by trusted code, not inferred):

```
node ${CLAUDE_PLUGIN_ROOT}/bin/cynap-checks-runner.mjs --commit-sha <commit-sha>
```

The runner, from your current org working directory:

1. **Loads the gate from HEAD.** Reads the deployed `checks/**` suites through the operator
   proxy (HEAD-correct — checks are git-PR-only, so a local *draft* checks file gates nothing).
   If your local `checks/` differs from the deployed HEAD, it **refuses** — merge the checks
   change via git first; a draft gates nothing until merged.
2. **Snapshots once.** Reads each asserted-over file's **LOCAL pending bytes** (the changes you
   just authored — NOT the workspace read tools, which serve the stale deployed HEAD) and the
   HEAD bytes for the suite files, into a single snapshot.
3. **Interprets** the closed vocabulary (`file_exists`, `json_path_equals`, `json_path_matches`,
   `json_array_length`, `json_path_absent`/`present`, `schema_field_present`) against that
   snapshot — every assertion is a pure predicate, no code execution.
4. **Computes** the resultant-content fingerprint over the same snapshot and **reports** the
   terminal verdict via `checks_verdict_report`.

## Usage

```
/cynap-checks <commit-sha>
```

## Reading the result

- **pass** — every assertion held against your pending bytes; a fresh pass verdict is now
  persisted for `commit_sha`. You may proceed to `workspace_activate_commit`.
- **fail** — at least one invariant is violated by your pending change; the runner prints the
  first failing assertion. Fix the config and re-commit + re-run — do NOT activate.
- **refused (local checks drift)** — your `checks/` differs from the deployed HEAD. Merge the
  checks change through the git-PR entrance first (a second human reviews any change to the gate
  itself), then re-run.

An org with **no** `checks/` tree passes vacuously — there is nothing to run, and activation is
unaffected.
