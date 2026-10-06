---
description: Configure local AI testing with a reference to your own provider key.
argument-hint: "--endpoint <vercel|openrouter> <--keychain item|--op op://reference> --allow-model <model> [--default-model <default>]"
---

# /cynap-dev-ai

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-dev-ai.mjs" $ARGUMENTS
```

Provide a macOS Keychain item name or a 1Password `op://` reference, never the key itself.
The command stores only that reference, provider choice and model bounds in
`~/.config/cynap-operator/dev-ai.json`, outside the workspace. Repeat `--allow-model`
to allow multiple models; `--default-model` selects the default from that set and is required for multiple allowed models. A sole allowed model is selected automatically.
`--max-tokens` and `--call-cap` may narrow the plugin's fixed ceilings.

Use `/cynap-test --real-ai` to opt in for one run. Use synthetic prompts and fixtures.
Only the trusted parent resolves the key and calls the provider. An unresolved key
fails loudly. Provider denials stay local with actor `developer`; no other key or payer
is tried. `/cynap-checks` remains deterministic and never binds this broker.
