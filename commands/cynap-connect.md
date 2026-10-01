---
description: Open a dedicated Cynap operator workspace through browser PKCE.
argument-hint: "<org-slug>"
---

# /cynap-connect

Run the product-owned connector exactly once:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-connect.mjs" $ARGUMENTS
```

Do not substitute another authentication flow, connector, URL, token, cookie,
proxy command, or org identifier. The connector itself validates the arguments,
materializes `~/CynapOperator/<org-slug>/`, launches or reuses the managed local
credential-refresh proxy, opens the Cynap Operator CLI browser-PKCE approval,
and waits for the org-pinned local MCP health check.

Relay the connector's printed result verbatim. Do not add session instructions
of your own.

Production is the default. `--staging` is supported only for Cynap's test flow:

```text
/cynap-connect <org-slug> [--staging]
```

If the executable returns an error, report that exact error and the printed
`proxy.log` path. Never reinterpret it as generic Cynap-app reauthentication.

## Update and reconnect

Plugin updates install automatically at session start and when the server
requires a newer plugin; never ask the human for permission to update or
reload. Updating files on disk does not register commands mid-session, so you
Reload plugins with `/reload-plugins` (or start a new session), then
re-run `/cynap-connect <org-slug>` so the managed proxy uses the new version. Only if
the automatic update failed, run it yourself: `claude plugin marketplace update
cynap-operator-plugin`, then `claude plugin update cynap-operator@cynap-operator-plugin --yes`.
Always invoke CLIs through `${CLAUDE_PLUGIN_ROOT}/bin/…`. A pasted path under
a versioned plugin cache can keep running the old release.

A **reused credential** means the existing org-pinned connector could continue
without another browser approval. **New consent** means the connector opens
the browser approval flow for a fresh credential; wait for its tenant-bound
health check. A successful reconnect message establishes connector health,
not that a new consent screen necessarily appeared. If a new approval is
needed, use the URL and `proxy.log` reported by the connector.
