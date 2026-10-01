#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runOperatorDisconnect } from '../lib/operator-disconnect.mjs';
import { probeProxyHealth, stablePortForSlug } from '../lib/connect.mjs';
import { resolveWorkspace } from '../lib/workspace-sync.mjs';

export function parseDisconnectArgs(argv) {
  if (argv.length > 1 || (argv.length === 1 && (!argv[0]?.trim() || argv[0].startsWith('--')))) {
    throw new Error('Usage: cynap-disconnect.mjs [org-slug]');
  }
  return { slug: argv[0]?.trim() ?? null };
}

export async function resolveDisconnectSlug({ cwd = process.cwd(), probe = probeProxyHealth } = {}) {
  const workspace = resolveWorkspace({ cwd });
  if (workspace.statePath || workspace.root) return workspace.org;
  const base = join(homedir(), 'CynapOperator');
  const slugs = existsSync(base) ? readdirSync(base).filter((slug) => existsSync(join(base, slug, '.mcp.json'))) : [];
  const live = (await Promise.all(slugs.map(async (slug) => ({ slug, health: await probe({ port: stablePortForSlug(slug) }) })))).filter((item) => item.health?.ok);
  if (live.length === 1) return live[0].slug;
  throw new Error('No single connected workspace was found — run from the workspace root or pass an org slug.');
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseDisconnectArgs(argv);
  const slug = parsed.slug ?? await resolveDisconnectSlug();
  const result = await runOperatorDisconnect({ slug });
  if (result.status === 'already_disconnected') {
    process.stdout.write(`${slug} is already disconnected.\n`);
  } else if (result.credentialRevoked) {
    process.stdout.write(
      result.credentialIssued
        ? `Disconnected ${slug}; local credential revocation was confirmed.\n`
        : `Disconnected ${slug} before a local credential was issued.\n`
    );
  } else {
    process.stderr.write(
      `Disconnected ${slug}, but credential revocation could not be confirmed; it remains bounded by its absolute expiry.\n`
    );
    process.exitCode = 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
