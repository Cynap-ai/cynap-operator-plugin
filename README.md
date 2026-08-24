<!-- GENERATED MIRROR — do not edit. This file is produced by
     tooling/operator-plugin/scripts/publish-public-mirror.mjs from the
     private Cynap monorepo. Edits here are overwritten on the next publish. -->

# Cynap Operator Plugin

Version 0.12.0. A Claude Code / Codex plugin that connects a working
directory to the Cynap operator plane — one organization per directory, over
MCP.

## Install

```
/plugin marketplace add Cynap-ai/cynap-operator-plugin
/plugin install cynap-operator
```

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

## What ships here

- `bin/operator-proxy.mjs` — the loopback mint-proxy. `.mcp.json` never
  carries a raw Authorization header; the proxy re-mints your token
  server-side as it approaches expiry.
- `lib/connect.mjs` — the `/cynap-connect` mechanics (org resolution, port
  selection, working-directory + `.mcp.json` materialization).
- `commands/cynap-connect.md` — the `/cynap-connect` slash command.
- `hooks/` — a fail-open `SessionEnd` hook that signals the proxy so it can
  record a session trail if this session touched the operator plane.
- `skills/` — authoring skills that teach an AI operator how to build
  correctly on the Cynap platform: choosing the right automation mode,
  authoring flows/handlers/deterministic automations/schema changes, and the
  platform's hard invariants.
- `scripts/version-probe.mjs` — a conformance gate you can run yourself:
  `node scripts/version-probe.mjs`.

## Access

Connecting to a real organization requires an owner-issued access grant. Ask
your Cynap contact to grant you access — you'll receive an invite email to
accept before your first `/cynap-connect`.

## Support

File issues at `Cynap-ai/cynap-operator-plugin`, or contact your Cynap
account team.

---

_This repository is a generated public mirror of an internal package,
rebuilt from source on every change. Do not open PRs against this repo
directly — changes are authored upstream._
