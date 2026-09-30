---
description: Run a read-only operator script from operator/scripts/ against the connected org.
argument-hint: "[--dir <path>] <path> [args…]"
---

# /cynap-run-script

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-run-script.mjs" $ARGUMENTS
```

Runs one operator script from the pulled working directory (`./cynap-<org>/` by default, or
`--dir <path>`). The script lives under `operator/scripts/` and has one contract:

```js
export default async function ({ mcp, org, args }) {
  const status = await mcp.call('workspace_status', {});
  return { org, status };
}
```

- `mcp.call(name, args)` calls a read tool and resolves to its result; `mcp.listTools()` lists
  the tools the script may call.
- `org` is the connected org's slug. `args` are the words after the script path.
- Whatever the function returns is printed as JSON.

## Read-only, enforced by the server

The command mints its own short-lived token, scoped to **read only** (`workspace:read`, plus
`workspace:read-ops` when your seat has run/journal access). The server refuses every write tool
on that token, so a script cannot commit, activate, propose or discard anything — whatever it
sends. The script never sees the token, and never talks to the local proxy.

## Sandboxed

Pulled files are untrusted — another seat may have written the script. It runs in a separate
Node process that may only **read** the working directory: no file writes, no child processes,
an empty environment, and no network — so it cannot reach the local proxy either. Its only way
out is `mcp`. Denying the network needs **Node ≥ 25**; an older Node is refused with the version
it found.

## Refusals

- the working directory was pulled for a different org than the one this session is connected to;
- the proxy, or the token it minted, belongs to a different org;
- the path is outside `operator/scripts/`, is a symlink, or does not exist.

## Usage

```
/cynap-run-script operator/scripts/weekly-summary.mjs --since 2026-09-01
```
