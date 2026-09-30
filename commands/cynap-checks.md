---
description: Run this org's checks/ suite locally against your LOCAL pending changes and report the verdict.
argument-hint: "<commit-sha>"
---

# /cynap-checks

Runs the org's `checks/` suite — the per-org config-as-code invariants —
**locally, against your LOCAL working-dir pending bytes**, and reports the
terminal verdict (bound to the committed content) so the platform can gate activation on it.

This is the fast, preventive half of the org-checks gate: your local run produces an
**attestation** the backend trusts and binds to the exact committed content (the commit hash
⋈ a resultant-content fingerprint). The backend recomputes that fingerprint server-side and
refuses activation on a mismatch — so a stale or dishonest attestation can never gate untested
content. (The detective half — the platform-CI backstop — lands in W2.)

## When to run it

Right after `workspace_commit` returns a `commit_sha`, and before you run
`/cynap-activate <commit_sha>` (the owner step-up that mints the one-purpose
activation credential and calls `workspace_activate_commit` for you). Pass the commit
sha you just committed.

## What it does (entirely operator-local — spec §5)

The command runs the deterministic runner (no LLM in the load-bearing path — the fingerprint
and pass/fail are computed by trusted code, not inferred):

```
node ${CLAUDE_PLUGIN_ROOT}/bin/cynap-checks-runner.mjs --commit-sha <commit-sha>
```

The runner, from your current org working directory:

1. **Loads your pending suites.** Reads the `checks/**` suites from your LOCAL working directory —
   the same pending suites the activation gate evaluates. A change to an existing
   suite must be committed alone; activation refuses it otherwise (`gate_change_not_alone`).
2. **Snapshots once.** Reads each asserted-over file's **LOCAL pending bytes** (the changes you
   just authored — NOT the workspace read tools, which serve the stale deployed HEAD) into a
   single snapshot.
3. **Interprets** the closed vocabulary (`file_exists`, `json_path_equals`, `json_path_matches`,
   `json_array_length`, `json_path_absent`/`present`, `schema_field_present`; every op except
   `file_exists` accepts an optional `allow_absent: true`, which passes when the file is missing) against that
   snapshot — every assertion is a pure predicate, no code execution.
4. **Computes** the resultant-content fingerprint over the same snapshot and **reports** the
   terminal verdict via `checks_verdict_report`.

## Strict handler typecheck

Before the checks, the runner typechecks every handler source (`automations/*.ts` and
`automations/handlers/*/handler.ts`) with strict `tsc`, against the `@cynap/sdk` declarations
this plugin ships and Node's own types. The platform's own handler check is best-effort, so this
is where a type error is caught before it ships. Each error prints as
`path:line:column TSxxxx message`, and a failure exits 3.

Run it on its own before `/cynap-push` — no commit sha needed:

```
node ${CLAUDE_PLUGIN_ROOT}/bin/cynap-checks-runner.mjs --typecheck-only
```

The pinned compiler is installed once into `~/.cache/cynap-operator/typecheck/` with `npm`. When
that is not possible (no `npm`, offline), the typecheck reports **NOT RUN** with the reason — it
never reports a pass it did not earn. Point `CYNAP_TYPECHECK_TOOLCHAIN` at a directory whose
`node_modules` already holds `typescript`, `@types/node` and `zod` to skip the install.

## Usage

```
/cynap-checks <commit-sha>
```

## Reading the result

- **pass** — every assertion held against your pending bytes; a fresh pass verdict is now
  persisted for `commit_sha`. You may proceed to `/cynap-activate <commit_sha>`.
- **fail** — at least one invariant is violated by your pending change; the runner prints the
  first failing assertion. Fix the config and re-commit + re-run — do NOT activate.

An org with **no** `checks/` tree passes vacuously — there is nothing to run, and activation is
unaffected.
