#!/usr/bin/env node
// CYN-1959 (Ship 3, Q20/ADR-0084 Decision 2) — thin launcher that rereads
// .claude-plugin/plugin.json's version FRESH on every start and threads it
// into operator-proxy.mjs as --plugin-version.
//
// This indirection exists because the launch record (proxy-launch.json,
// written once at /cynap-connect time) points at THIS file, never at
// operator-proxy.mjs directly. If the plugin version were baked into that
// record instead, a SessionStart self-heal relaunch (which replays the
// recorded argv verbatim, possibly long after the original /cynap-connect)
// would resend a STALE version if the plugin had been upgraded in between.
// Reading the manifest here, on every start, means the version sent upstream
// always matches the plugin version actually running right now.
//
// Runs operator-proxy.mjs's main() IN-PROCESS (never spawns a further child)
// so the launcher's own pid stays the proxy's pid — connect.mjs's health
// check pins on that pid, and a double-fork would break it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main as runOperatorProxy } from './operator-proxy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Reads plugin.json's version fresh — never cached across calls. */
export function readPluginVersion({ pluginRoot = join(__dirname, '..') } = {}) {
  const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`operator-proxy-launcher: ${manifestPath} has no "version" string`);
  }
  return manifest.version;
}

/** Appends --plugin-version to the caller's argv. Refuses if the caller
 * already supplied one — the launcher is the SOLE owner of this flag, so a
 * caller-supplied value would either silently lose (last-wins) or trigger
 * operator-proxy.mjs's own "supplied more than once" refusal depending on
 * argv order; failing closed here surfaces the real bug immediately instead. */
export function buildVersionedProxyArgs(argv, pluginVersion) {
  if (argv.includes('--plugin-version')) {
    throw new Error(
      'operator-proxy-launcher: --plugin-version must not be supplied by the caller — the launcher owns it'
    );
  }
  return [...argv, '--plugin-version', pluginVersion];
}

export async function main(
  argv = process.argv.slice(2),
  { runProxy = runOperatorProxy, readVersion = readPluginVersion } = {}
) {
  const pluginVersion = readVersion();
  await runProxy(buildVersionedProxyArgs(argv, pluginVersion));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
