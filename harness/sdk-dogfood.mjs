#!/usr/bin/env node
// CYN-785 (CYN-768 P0) — Agent SDK dogfood harness SKELETON.
//
// Shows the correct loading mechanic for connecting an Agent SDK session to
// this plugin: `plugins: [{ type: 'local', path: <pluginRoot> }]` — NOT the
// CLI-only `--plugin-dir` flag, which the SDK does not accept (see
// the published operator contract line 39).
//
// This is a SKELETON: if @anthropic-ai/claude-agent-sdk isn't installed
// anywhere in this monorepo (it is not, as of P0), it prints clear setup
// instructions and exits 0 rather than failing the gate. The full dogfood
// loop (mint a real query against cynap-e2e through the SDK) is P6
// acceptance, not this script.

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

async function tryLoadSdk() {
  try {
    return await import(SDK_PACKAGE);
  } catch {
    return null;
  }
}

function printSetupInstructions() {
  process.stdout.write(
    [
      `[sdk-dogfood] "${SDK_PACKAGE}" is not installed in this workspace.`,
      '',
      'To run the full dogfood loop:',
      `  1. pnpm add ${SDK_PACKAGE} (in a scratch dir or a dedicated package — NOT a`,
      '     monorepo workspace dependency; this harness is a standalone dogfood tool,',
      '     not a shipped runtime dependency of any @cynap/* package).',
      '  2. Import { query } (or the SDK\'s equivalent entrypoint) and pass:',
      '',
      '       plugins: [{ type: "local", path: "' + PLUGIN_ROOT + '" }]',
      '',
      '     — this is the SDK-native loading mechanic (NOT the CLI --plugin-dir flag,',
      '     which the SDK does not accept).',
      '  3. Run /cynap-connect cynap-e2e first in a working directory so the loopback',
      '     proxy is already listening before the SDK session starts (the plugin does',
      '     not auto-launch the proxy on its own — see commands/cynap-connect.md).',
      '  4. Issue a query using the cynap-operator MCP server (e.g. workspace_status)',
      '     and confirm a real response comes back from cynap-e2e.',
      '',
      'This skeleton exits 0 because the SDK is an optional dev dependency for this',
      'dogfood tool, not a build requirement of the plugin package itself.',
      '',
    ].join('\n')
  );
}

async function main() {
  const sdk = await tryLoadSdk();
  if (!sdk) {
    printSetupInstructions();
    process.exit(0);
  }

  process.stdout.write(
    `[sdk-dogfood] ${SDK_PACKAGE} detected. Loading plugin from ${PLUGIN_ROOT} via ` +
      'plugins: [{ type: "local", path: ... }].\n' +
      '[sdk-dogfood] Full live-query dogfood loop against cynap-e2e is P6 acceptance — ' +
      'this skeleton only confirms the SDK import + loading mechanic.\n'
  );
  // Intentionally not calling sdk.query(...) here — the live dogfood loop
  // (P6) drives a real query against cynap-e2e and asserts a real response.
  // This skeleton's job ends at "the SDK loaded and the mechanic is correct."
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[sdk-dogfood] fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
