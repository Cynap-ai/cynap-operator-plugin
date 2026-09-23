#!/usr/bin/env node

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

import { runOperatorConnect } from '../lib/operator-connect.mjs';
import { readPluginVersion } from './operator-proxy-launcher.mjs';

/** The org a workspace directory belongs to: `~/CynapOperator/<slug>` names its own
 * slug, so a connect run from inside it needs no argument. Anything else is null. */
export function workspaceSlugFromCwd(cwd, operatorRoot = join(homedir(), 'CynapOperator')) {
  const dir = resolve(cwd);
  return dirname(dir) === resolve(operatorRoot) ? basename(dir) : null;
}

export function parseConnectArgs(argv, { cwd = process.cwd(), operatorRoot } = {}) {
  const explicit = argv[0] && !argv[0].startsWith('--') ? argv[0].trim() : '';
  const flags = explicit ? argv.slice(1) : argv;
  const unknown = flags.filter((value) => value !== '--staging');
  const slug = explicit || workspaceSlugFromCwd(cwd, operatorRoot) || '';
  if (!slug || unknown.length > 0) {
    throw new Error('Usage: cynap-connect.mjs <org-slug> [--staging] (the slug may be omitted inside ~/CynapOperator/<slug>)');
  }
  return { slug, env: flags.includes('--staging') ? 'staging' : 'prod' };
}

export function formatConnectMessage(result, {
  cwd = process.cwd(),
  realpath = realpathSync.native,
} = {}) {
  const workspace = realpath(result.workingDir);
  const current = realpath(cwd);
  const inWorkspace = current === workspace || current.startsWith(`${workspace}/`);
  const firstLine = inWorkspace
    ? `Reconnected to ${result.slug}. This session's operator tools use the new connection.`
    : `Connected to ${result.slug}. Open ~/CynapOperator/${result.slug}/ in Claude Code to use the operator tools. ` +
      'The first time, approve the project MCP server when asked.';
  const replacement = result.replaced
    ? `Replaced connector running plugin ${result.replaced.from} with ${result.replaced.to}; previous credential revoked.`
    : null;
  return [replacement, firstLine, `Workspace: ${result.workingDir}`].filter(Boolean).join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const { slug, env } = parseConnectArgs(argv);
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Reread fresh on every connect, and launch via the launcher (not
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

  process.stdout.write(`${formatConnectMessage(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
