<!-- GENERATED MIRROR — do not edit. This file is produced by
     the mirror publisher from the
     private Cynap monorepo. Edits here are overwritten on the next publish. -->

# Cynap Operator Plugin

Version 0.17.5. A Claude Code / Codex plugin that connects a working
directory to the Cynap operator plane — one organization per directory, over
MCP.

## Install

```
/plugin marketplace add https://github.com/Cynap-ai/cynap-operator-plugin.git
/plugin install cynap-operator@cynap-operator-plugin
```

Always use the qualified `<plugin>@<marketplace>` install form shown above —
an unqualified install reads a cached marketplace catalog without refreshing
it, so a machine that cached an old release keeps installing that release and
never notices an update exists. After installing, enable auto-update for the
`cynap-operator-plugin` marketplace so this stays current automatically.

## Usage

```
/cynap-connect <org-slug>
```

This materializes a dedicated working directory at
`~/CynapOperator/<org-slug>/`, launches a per-org loopback proxy
(`bin/operator-proxy.mjs`) that mints and refreshes a short-lived operator
token on your behalf, and writes a project-scoped `.mcp.json` pointing
Claude Code / Codex at that proxy. Reconnecting with a different org slug
creates another independent directory + proxy port — you can work across
multiple orgs side by side.

The command uses the dedicated operator browser-PKCE route and returns only
after the local tenant-bound MCP health check passes. It never asks for a
generic Cynap app reauthentication, a session cookie, a bearer token, an org
id, a proxy path, or a hand-written MCP URL.

Disconnect and revoke the local connection with:

```text
/cynap-disconnect <org-slug>
```

## What ships here

- `bin/operator-proxy.mjs` — the loopback mint-proxy. `.mcp.json` never
  carries a raw Authorization header; the proxy re-mints your token
  server-side as it approaches expiry.
- `lib/connect.mjs` — the `/cynap-connect` mechanics (org resolution, port
  selection, working-directory + `.mcp.json` materialization).
- `lib/operator-connect.mjs` and `lib/operator-disconnect.mjs` — the stable
  managed lifecycle seams used by the slash commands.
- `commands/cynap-connect.md` — the `/cynap-connect` slash command.
- `commands/cynap-disconnect.md` — the tenant-checked disconnect command.
- `commands/cynap-checks.md` / `commands/cynap-status.md` — run the org's
  config checks, and report the connection's state.
- `hooks/` — a fail-open `SessionEnd` hook that signals the proxy so it can
  record a session trail if this session touched the operator plane.
- `skills/` — authoring skills that teach an AI operator how to build
  correctly on the Cynap platform: choosing the right automation mode,
  authoring flows/handlers/deterministic automations/schema changes, and the
  platform's hard invariants.
- `scripts/version-probe.mjs` — a conformance gate you can run yourself:
  `node scripts/version-probe.mjs`.
- `scripts/clean-machine-smoke.mjs` — the clean-machine journey probe: proves
  install, connect, disconnect and self-update work on a machine with no
  other Cynap context.

## Access

Owners and members can connect their own organization as Internal operators.
An External operator needs an owner-issued grant; accept its invite before the
first `/cynap-connect`. The browser consent page identifies which basis and
bounded capability will be used.

## Support

File issues at `Cynap-ai/cynap-operator-plugin`, or contact your Cynap
account team.

---

_This repository is a generated public mirror of an internal package,
rebuilt from source on every change. Do not open PRs against this repo
directly — changes are authored upstream._
