---
description: Start one run of an automation and wait for it to finish, optionally draining deferred rows.
argument-hint: "<automation-id> [--input <json> | --input-file <path>] [--wait] [--until-drained] [--max-iterations <n>] [--max-minutes <n>] [--org <slug>]"
---

# /cynap-run

Start a real run of one `manual` or `mcp`-triggered automation of the connected org, through `automation_run_trigger`:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-run.mjs" $ARGUMENTS
```

- No flags: dispatch the run and print its id.
- `--wait`: block until the run is terminal, polling `run_evidence_get`. Prints one JSON line (status, deferred count, the first error as the platform stated it) on stdout and per-iteration progress on stderr. Run it in the background so the harness is notified when it exits.
- `--until-drained` (implies `--wait`): while the run succeeds (or ends degraded) and its result reports deferred rows, trigger it again with the same input. The count is read from the result's `rows_deferred`, `deferred`, `rows_remaining` or `remaining` field (`--drain-key <field>` names another). An operator seat reads the result redacted, and only TOP-LEVEL numbers and booleans of the handler's return value survive, so the handler must return a top-level numeric `remaining` (or one of those keys). A count nested under `metrics` or `result` is not read, and the loop stops with exit 3 rather than guess. It stops at `--max-iterations` (default 20, max 100), at `--max-minutes` of wall time (default 60, max 360), when a run fails (a degraded run with no deferred count also stops it), or when two re-triggers in a row fail to shrink the count.

Exit codes: 0 finished or drained, 1 a run failed or a call was refused, 3 stopped at a cap, with no progress, or with no deferred count to follow.

This is a live run on the connected org, like the portal Run button. A handler that writes does write; `--until-drained` repeats it. Use it on `cynap-e2e` first when the handler is new.
