# /cynap-status

Reports the real state of every per-org operator connection on this machine:
which orgs have a working directory, whether each one's proxy is actually
alive, on what port, at what plugin version, and how long it has been up.

Takes no arguments. Read-only — it never launches, kills, mints, or writes
anything.

## Why this exists

`/cynap-connect` necessarily sets up a connection that a *different* session
consumes, so "did that work?" was previously unanswerable from either side: the
connecting session can't use the MCP server, and the consuming session only
finds out by having a tool call fail. A dead proxy and a healthy one looked
identical from the outside — both leave a perfectly valid `.mcp.json` on disk.
This command reads liveness from the proxy itself rather than from a file.

## What it does

1. List the per-org working directories: every subdirectory of
   `~/CynapOperator/` that contains a `.mcp.json`. If the operator says
   "nothing was created", show them the absolute path. For each one, compare
   its absolute path against the CURRENT session's `$PWD` — the one directory
   that matches (if any) is the org THIS session is actually attached to;
   every other listed org is a connection that exists on the machine but that
   some *other* session (or none, right now) is using.
2. For each one, read its pinned port from `.mcp.json`
   (`mcpServers["cynap-operator"].url`) and probe
   `GET http://127.0.0.1:<port>/health` — `probeProxyHealth({ port })` in
   `lib/connect.mjs`. The probe is the source of truth; a `.mcp.json` on disk
   proves only that a connect once ran, never that anything is listening now.
3. Report per org:
   - **UP** — `{ok:true}`, with `org`, `env`, `port`, proxy `version`, `pid`,
     and uptime derived from `startedAt`. Mark the row whose working directory
     matches `$PWD` with a trailing **`◀ attached in THIS session`** — that is
     the one org whose MCP tools are actually reachable from the session
     running this command right now; every other UP row is healthy for
     whichever session is using it, not this one.
   - **DOWN** — nothing healthy on the pinned port. Say what to do: open a
     session in that directory (the SessionStart hook relaunches the proxy from
     `proxy-launch.json` automatically), or re-run `/cynap-connect <org>`.
   - **STALE BUILD** — up, but `version` is older than the installed plugin
     (`.claude-plugin/plugin.json`). A long-lived proxy keeps running the build
     it started with, so a plugin update does NOT reach it until it restarts.
     This is exactly how an operator ends up debugging a bug that is already
     fixed on disk — call it out explicitly.
   - **Credential expiry** — every UP row also carries `credExpiresAt` /
     `credExpiresInHours` from the same `/health` probe (CYN-1080; `null` for
     an `--e2e` cookie-leg connection, which has no absolute credential TTL).
     Show the hours-remaining next to the row; if `credExpiresInHours` is
     below ~6 (and not null), prefix the row with **`⚠️`** and say the
     credential is close to expiring — re-running `/cynap-connect <org>` mints
     a fresh one. `/health` never carries the token itself, only this
     timestamp-derived count, so nothing secret is ever printed.
4. Flag anything **orphaned**: a listening proxy whose org does not match any
   working dir, or a stale `proxy.pid` whose process is gone. Report them; do
   not kill anything without the operator asking.

## Usage

```
/cynap-status
```

## Reporting rules

- Report what the probe actually returned. Never infer "connected" from the
  presence of `.mcp.json`, a `proxy.pid`, or a line in `proxy.log` — those are
  all leftovers of a past connect and survive the process they describe.
- If every org is DOWN, say so plainly and point at `/cynap-connect <org>`.
- Include each working directory's absolute path so the operator can find it.
- If `$PWD` doesn't match ANY discovered working directory, say so plainly —
  this session is not attached to any operator org right now, regardless of
  what else is UP on the machine.
- A credential-expiry warning is informational, not a failure — an org can be
  UP and reachable right now while still carrying the `⚠️` if its window is
  closing soon.
