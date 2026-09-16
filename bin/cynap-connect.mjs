#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runOperatorConnect } from '../lib/operator-connect.mjs';
import { readPluginVersion } from './operator-proxy-launcher.mjs';

export function parseConnectArgs(argv) {
  const slug = argv[0]?.trim() ?? '';
  const flags = argv.slice(1);
  const unknown = flags.filter((value) => value !== '--staging');
  if (!slug || slug.startsWith('--') || unknown.length > 0) {
    throw new Error('Usage: cynap-connect.mjs <org-slug> [--staging]');
  }
  return { slug, env: flags.includes('--staging') ? 'staging' : 'prod' };
}

export async function main(argv = process.argv.slice(2)) {
  const { slug, env } = parseConnectArgs(argv);
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  // CYN-1959: reread fresh on every connect, and launch via the launcher (not
  // operator-proxy.mjs directly) so a later SessionStart self-heal relaunch
  // also rereads fresh rather than replaying a version baked into the
  // persisted launch record.
  const pluginVersion = readPluginVersion({ pluginRoot });
  const result = await runOperatorConnect({
    slug,
    env,
    proxyPath: join(pluginRoot, 'bin', 'operator-proxy-launcher.mjs'),
    pluginVersion,
  });

  process.stdout.write(
    [
      `Connected to ${result.slug} as a Cynap operator.`,
      `Workspace: ${result.workingDir}`,
      `Credential expires: ${result.health.credExpiresAt ?? 'managed by the local connector'}`,
      'Open that workspace in a new Claude Code session to use the operator tools.',
    ].join('\n') + '\n'
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
