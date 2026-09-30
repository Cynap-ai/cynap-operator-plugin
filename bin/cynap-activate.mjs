#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { ACTIVATE_PATH, CONTROL_FILE, CONTROL_HEADER } from './operator-proxy.mjs';

const USAGE = 'Usage: cynap-activate.mjs <64-character-commit-sha> [--reconcile]';

export function parseActivateArgs(argv) {
  const reconcile = argv.includes('--reconcile');
  const positional = argv.filter((arg) => arg !== '--reconcile');
  if (positional.length !== 1 || argv.length - positional.length > 1 || !/^[a-f0-9]{64}$/i.test(positional[0])) {
    throw new Error(USAGE);
  }
  return { commitSha: positional[0], reconcile };
}

export async function activate({ slug, commitSha, witness = false, reconcile = false, fetchImpl = fetch }) {
  const noncePath = join(resolveWorkingDir(slug), CONTROL_FILE);
  const nonce = readFileSync(noncePath, 'utf8').trim();
  if (!nonce) throw new Error('operator activation: local control nonce is missing; run /cynap-connect again.');
  const response = await fetchImpl(`http://127.0.0.1:${stablePortForSlug(slug)}${ACTIVATE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce },
    body: JSON.stringify({
      commit_sha: commitSha,
      ...(witness ? { witness: true } : {}),
      ...(reconcile ? { reconcile_operator_edits: true } : {}),
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`operator activation failed: ${body?.error ?? response.status}`);
  }
  return witness ? { result: body.result, witness: body.witness ?? null } : body.result;
}

export async function main(argv = process.argv.slice(2)) {
  const { commitSha, reconcile } = parseActivateArgs(argv);
  const slug = basename(process.cwd());
  const result = await activate({ slug, commitSha, reconcile });
  process.stdout.write(`${typeof result === 'string' ? result : JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
