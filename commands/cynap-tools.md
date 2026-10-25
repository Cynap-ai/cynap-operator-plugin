---
description: List the tools this connection can call, or print one tool's input schema.
argument-hint: "[<tool-name>] [--json] [--org <slug>]"
---

# /cynap-tools

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-tools.mjs" $ARGUMENTS
```

With no name it prints `name(required, optional?)  first sentence` for every tool the connected proxy exposes. With a tool name it prints that tool's description and input schema, so an argument name is read, not guessed. Read-only.
