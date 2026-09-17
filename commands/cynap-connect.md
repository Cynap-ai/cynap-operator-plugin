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
