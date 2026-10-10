#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { CONTROL_FILE, CONTROL_HEADER, PREVIEW_PATH } from './operator-proxy.mjs';
import { formatPreviewFailure, formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, resolveOrgSlug } from '../lib/workspace-sync.mjs';

const SHA = /^[a-f0-9]{40,64}$/;
const AUTOMATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_STATUS_POLLS = 36;
const USAGE = 'Usage: cynap-preview.mjs <automation-id> <commit-sha> | cynap-preview.mjs status <attempt-id>';

/**
 * `status <attempt-id>` reads one attempt's verdict; `<automation-id> <commit-sha>` starts a
 * preview. A commit sha is never UUID-shaped, so an automation named `status` can still be previewed.
 */
export function parsePreviewArgs(argv) {
  if (argv.length === 2 && argv[0] === 'status' && ATTEMPT.test(argv[1] ?? '')) {
    return { command: 'status', attemptId: argv[1].toLowerCase() };
  }
  if (argv.length !== 2 || !AUTOMATION.test(argv[0] ?? '') || !SHA.test(argv[1] ?? '')) {
    throw Object.assign(new Error(USAGE), { code: 'usage' });
  }
  return { command: 'start', automationId: argv[0], commitSha: argv[1] };
}

/** What to run once the bounded poll gives up on an attempt that is still running. */
export function stillRunningHint(attemptId) {
  return `cynap-preview: the preview is still running after the bounded wait. Read its verdict later with /cynap-preview status ${attemptId}`;
}

export function previewSummary(body) {
  const { previewId, ...rest } = body ?? {};
  return { status: 'unknown', attemptId: null, effectKinds: [],
    ...operatorEffectOutput({ ...rest, attemptId: previewId }) };
}

function previewRoute(slug, nonceOverride) {
  const nonce = nonceOverride ?? readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) {
    throw Object.assign(new Error('operator preview: local control nonce is missing; run /cynap-connect again.'), { code: 'not_connected' });
  }
  return { nonce, base: `http://127.0.0.1:${stablePortForSlug(slug)}${PREVIEW_PATH}` };
}

/** One read of `GET /preview/status/{previewId}` through the local proxy; the body as the server sent it. */
async function readStatus({ base, nonce, previewId, fetchImpl }) {
  const response = await fetchImpl(`${base}/status/${previewId}`, { headers: { [CONTROL_HEADER]: nonce } });
  const body = await response.json();
  if (response.status === 404) {
    throw Object.assign(new Error('operator preview status: no such attempt in this org, or its verdict has expired'), { code: 'preview_not_found' });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`operator preview status failed: HTTP ${response.status}`), { code: `status_http_${response.status}` });
  }
  return body;
}

/** `cynap-preview status <attempt-id>`: the attempt's state and verdict, after the start's bounded poll has ended. */
export async function readPreviewStatus({ slug, attemptId, fetchImpl = fetch, nonceOverride = null }) {
  const { nonce, base } = previewRoute(slug, nonceOverride);
  return previewSummary(await readStatus({ base, nonce, previewId: attemptId, fetchImpl }));
}

export async function runPreview({ slug, automationId, commitSha, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = MAX_STATUS_POLLS, onStart = () => {}, nonceOverride = null }) {
  const { nonce, base } = previewRoute(slug, nonceOverride);
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
  if (typeof previewId !== 'string') {
    throw Object.assign(new Error('operator preview returned no attempt id'), { code: 'preview_no_attempt_id' });
  }
  const initial = { status: 'preview_running', attemptId: previewId, effectKinds: [] };
  onStart(initial);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await wait(Math.min(2000 * (poll + 1), 10_000));
    const body = await readStatus({ base, nonce, previewId, fetchImpl });
    if (body.status === 'pending' || body.status === 'preview_running') continue;
    return previewSummary(body);
  }
  return initial;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, ...args } = parsePreviewArgs(argv);
  const result = command === 'status'
    ? await readPreviewStatus({ slug: resolveOrgSlug(), attemptId: args.attemptId })
    : await runPreview({
      slug: resolveOrgSlug(), ...args,
      onStart: (started) => process.stdout.write(`${JSON.stringify(operatorEffectOutput(started))}\n`),
    });
  process.stdout.write(`${JSON.stringify(operatorEffectOutput(result))}\n`);
  if (result.status === 'fail') process.stdout.write(`cynap-preview: ${formatPreviewFailure(result)}\n`);
  if (result.status === 'pending' || result.status === 'preview_running') process.stdout.write(`${stillRunningHint(result.attemptId)}\n`);
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

/** The code a local failure prints with: a named cause, never a bare `preview_failed` when one is known. */
export function failureCode(error) {
  if (isProxyUnreachableError(error)) return 'proxy_unreachable';
  return operatorEffectOutput(error).code ?? 'preview_failed';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`cynap-preview: failed (${failureCode(error)})${failureReason(error)}\n`);
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
