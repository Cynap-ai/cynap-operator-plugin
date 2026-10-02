#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { CONTROL_FILE, CONTROL_HEADER, PREVIEW_PATH } from './operator-proxy.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { resolveOrgSlug } from '../lib/workspace-sync.mjs';

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
  const { previewId, ...rest } = body ?? {};
  return { status: 'unknown', attemptId: null, effectKinds: [],
    ...operatorEffectOutput({ ...rest, attemptId: previewId }) };

}

export async function runPreview({ slug, automationId, commitSha, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = MAX_STATUS_POLLS, onStart = () => {}, nonceOverride = null }) {
  const nonce = nonceOverride ?? readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('operator preview: local control nonce is missing; run /cynap-connect again.');
  const base = `http://127.0.0.1:${stablePortForSlug(slug)}${PREVIEW_PATH}`;
  const headers = { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce };
  const start = await fetchImpl(base, {
    method: 'POST', headers, body: JSON.stringify({ automationId, commitSha }),
  });
  const started = await start.json();
  if (!start.ok) {
    const refusal = { ...started, code: started?.code ?? started?.error ?? `HTTP ${start.status}` };
    throw Object.assign(new Error(formatRefusal(refusal, { command: 'cynap-preview', commitSha }).trim()), { code: refusal.code });
  }
  const previewId = started?.previewId;
  if (typeof previewId !== 'string') throw new Error('operator preview returned no attempt id');
  const initial = { status: 'preview_running', attemptId: previewId, effectKinds: [] };
  onStart(initial);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await wait(Math.min(2000 * (poll + 1), 10_000));
    const response = await fetchImpl(`${base}/status/${previewId}`, { headers: { [CONTROL_HEADER]: nonce } });
    const body = await response.json();
    if (!response.ok) throw new Error(`operator preview status failed: HTTP ${response.status}`);
    if (body.status === 'pending' || body.status === 'preview_running') continue;
    return previewSummary(body);
  }
  return initial;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parsePreviewArgs(argv);
  const result = await runPreview({
    slug: resolveOrgSlug(), ...args,
    onStart: (started) => process.stdout.write(`${JSON.stringify(operatorEffectOutput(started))}\n`),
  });
  process.stdout.write(`${JSON.stringify(operatorEffectOutput(result))}\n`);
  return result;
}

/**
 * The underlying cause, on one bounded line. Without it a local ECONNREFUSED (the proxy
 * is down) printed exactly like a platform failure. `fetch` hides the socket error in `cause`.
 */
export function failureReason(error) {
  const parts = [error?.message, error?.cause?.code ?? error?.cause?.message]
    .filter((part) => typeof part === 'string' && part.length > 0);
  if (parts.length === 0) return '';
  return `: ${parts.join(': ').replace(/\s+/g, ' ').slice(0, 300)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`cynap-preview: failed (${operatorEffectOutput(error).code ?? 'preview_failed'})${failureReason(error)}\n`);
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
