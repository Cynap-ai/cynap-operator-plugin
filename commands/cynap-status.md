---
description: Show operator proxy health and the workspace commit chain.
argument-hint: "[--dir <workspace>] [--json]"
---

# /cynap-status

Run the read-only status command:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-status.mjs" $ARGUMENTS
```

It probes each known proxy's `/health` endpoint and shows its plugin version, then reads `workspace_status` for the resolved workspace. It reports the live commit, the accepted tip, the config digest (classified config files only, so a handler-code activation does not change it), deployment state, pending commits and their next actions. `degraded` means the platform could not read the live deployment identity reliably. If the local base is behind the accepted tip, pull before editing. A frozen chain currently needs a platform admin to recover.

The command reads only; it does not connect, activate, or modify a workspace. A stale `.mcp.json` alone does not mean a proxy is running.
