---
name: scope-to-workflow
description: Map each operator scope to the workflows it unlocks and the tools each workflow uses. Use when a tool call is refused for scope, or before planning work, to see what your seat can do.
---

# scope-to-workflow — What Each Scope Unlocks

Your seat holds one or more scopes. A higher scope in the same family includes
the lower ones. A tool outside your scopes is not visible to you, so a missing
tool means a missing scope, not a broken platform. Ask the Owner for the scope
instead of working around it.

| Scope | Workflow | Tools |
|---|---|---|
| `workspace:read` | Read the org's workspace: state, files, history and drift | `workspace_status`, `workspace_tree`, `workspace_get_file`, `workspace_get_commit`, `workspace_diff`, `workspace_log`, `workspace_receipts`, `workspace_drift` |
| `workspace:execute-preview` | Validate a change, commit it, report check verdicts, discard a commit | `workspace_validate`, `workspace_commit`, `checks_verdict_report`, `workspace_discard_commit` |
| `workspace:file-activate` | Activate an accepted commit | `workspace_prepare_commit_proof`, `workspace_activate_commit`, `handler_upload` |
| `workspace:file-activate` | Rehearse a lifecycle and start a manual run | `cynap_simulated_lifecycle`, `automation_run_trigger` |
| `workspace:commit` | Commit only: validate and commit, with no reads | `workspace_validate`, `workspace_commit` |
| `workspace:read-ops` | Diagnose runs (see `debug-a-run`) | `runs_query`, `journal_describe`, `journal_query`, `journal_count`, `run_evidence_get`, `customer_ai_readiness_get` |
| `workspace:read-ops` | Read release evidence, one run's attempted writes, recent runs, org health and saved-query aggregates | `release_evidence_get`, `automation_run_writes`, `automation_runs_list`, `workspace_health`, `operator_saved_query_run` |
| `workspace:propose` | Propose a suggestion, escalate to Cynap, reconcile or start a run | `suggestion_propose`, `escalation_raise`, `automation_run_reconcile`, `automation_run_trigger` |

Scope families:

- File family: `workspace:read`, then `workspace:execute-preview`, then
  `workspace:file-activate`. Each includes the one before it.
- Operations family: `workspace:read-ops`, then `workspace:propose`. The
  second includes the first.
- `workspace:commit` stands alone. It does not include any read tool.

The usual operating seat holds `workspace:file-activate` together with
`workspace:read-ops`.
