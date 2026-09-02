---
description: Disconnect one Cynap operator workspace and report its credential-revocation outcome.
argument-hint: "<org-slug>"
---

# /cynap-disconnect

Run the managed disconnect exactly once:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-disconnect.mjs" $ARGUMENTS
```

The command verifies the loopback control plane belongs to the requested org,
then asks that proxy to revoke its own credential and stop. It reports whether
revocation was positively confirmed. Do not kill a PID or delete a workspace by
hand.
