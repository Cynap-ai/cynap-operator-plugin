---
description: Build a local Surface on the platform and inspect it on synthetic fixture data.
argument-hint: "<surfaceId> [--state <name>] [--dir <path>]"
---

# /cynap-render

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-render.mjs" $ARGUMENTS
```

Use the `fixture-render` skill. This validates the working directory as `/cynap-push --dry-run`
does, then calls `workspace_surface_render_build` for one Surface. It commits nothing.
The command never prints bundle bytes. It prints local loopback URLs and the request id.
It scaffolds a missing `surfaces/<id>/__fixtures__/render.json` from the matching template,
or from declared tools with empty placeholders. Rename a template's fixture alongside its
Surface when choosing a different id. Fill placeholders with invented data, never org rows.
Fixtures are excluded from both build input and push payloads.

Open each URL in a **visible** browser tab and read its `data-render-state` marker.
Only `settled` and `pending-by-fixture` permit a screenshot. `stalled`, `host-error`,
`protocol-mismatch`, or a labelled missing-fixture panel require a fix first.
A protocol mismatch names both versions and asks for a plugin update.
The loopback listener expires after 30 minutes; rerun the command after expiry.
