#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { CONTROL_FILE, CONTROL_HEADER, PREVIEW_PATH } from './operator-proxy.mjs';

const SHA = /^[a-f0-9]{40,64}$/;
const AUTOMATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MAX_STATUS_POLLS = 36;

export function parsePreviewArgs(argv) {
  if (argv.length !== 2 || !AUTOMATION.test(argv[0] ?? '') || !SHA.test(argv[1] ?? '')) {
    throw new Error('Usage: cynap-preview.mjs <automation-id> <commit-sha>');
  }
  return { automationId: argv[0], commitSha: argv[1] };
}

export function previewSummary(body) {
  const effectKinds = Array.isArray(body?.effectKinds)
    ? body.effectKinds.filter((entry) => typeof entry?.kind === 'string' && Number.isInteger(entry?.count))
      .map((entry) => ({ kind: entry.kind, count: entry.count }))
    : [];
  return {
    status: body?.status ?? 'unknown',
    attemptId: body?.previewId ?? null,
    ...(body?.failureCode ? { failureCode: body.failureCode } : {}),
    ...(body?.operatorText ? { operatorText: body.operatorText } : {}),
    effectKinds,
  };
}

export async function runPreview({ slug, automationId, commitSha, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = MAX_STATUS_POLLS, onStart = () => {} }) {
  const nonce = readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('operator preview: local control nonce is missing; run /cynap-connect again.');
  const base = `http://127.0.0.1:${stablePortForSlug(slug)}${PREVIEW_PATH}`;
  const headers = { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce };
  const start = await fetchImpl(base, {
    method: 'POST', headers, body: JSON.stringify({ automationId, commitSha }),
  });
  const started = await start.json();
  if (!start.ok) {
    throw new Error(`operator preview refused: ${started?.error ?? start.status}`);
  }
  const previewId = started?.previewId;
  if (typeof previewId !== 'string') throw new Error('operator preview returned no attempt id');
  const initial = { status: 'preview_running', attemptId: previewId, effectKinds: [] };
  onStart(initial);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await wait(Math.min(2000 * (poll + 1), 10_000));
    const response = await fetchImpl(`${base}/status/${previewId}`, { headers: { [CONTROL_HEADER]: nonce } });
    const body = await response.json();
    if (!response.ok) throw new Error(`operator preview status failed: ${body?.error ?? response.status}`);
    if (body.status === 'pending' || body.status === 'preview_running') continue;
    return previewSummary(body);
  }
  return initial;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parsePreviewArgs(argv);
  const result = await runPreview({
    slug: basename(process.cwd()), ...args,
    onStart: (started) => process.stdout.write(`${JSON.stringify(started)}\n`),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
