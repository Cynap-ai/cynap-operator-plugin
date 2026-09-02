#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { runOperatorDisconnect } from '../lib/operator-disconnect.mjs';

export function parseDisconnectArgs(argv) {
  if (argv.length !== 1 || !argv[0]?.trim() || argv[0].startsWith('--')) {
    throw new Error('Usage: cynap-disconnect.mjs <org-slug>');
  }
  return { slug: argv[0].trim() };
}

export async function main(argv = process.argv.slice(2)) {
  const { slug } = parseDisconnectArgs(argv);
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
