#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { CONTROL_FILE, CONTROL_HEADER, PREVIEW_PATH } from './operator-proxy.mjs';
import { formatPreviewFailure, formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';

const SHA = /^[a-f0-9]{40,64}$/;
const AUTOMATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ATTEMPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeDuration = (value) => Number.isSafeInteger(value) && value >= 0;
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
  return `cynap-preview: the poll budget ran out before the verdict was ready (the preview has not hung; its verdict can wait on the baseline run). Resume with /cynap-preview status ${attemptId}`;
}

function horizonHint(result) {
  if (result.status === 'waiting') return `cynap-preview: the queue wait reached its server deadline. Read /cynap-preview status ${result.attemptId} for the final state.`;
  if (result.status === 'pending' && Number.isSafeInteger(result.remaining_lease_ms)) {
    return `cynap-preview: the run lease and 60-second verdict grace ended. Read /cynap-preview status ${result.attemptId} for the final state.`;
  }
  return stillRunningHint(result.attemptId);
}

/** A pass the chain already honours while the attempt's own status read still says `pending`. Effect kinds are not known from here. */
function lagInferredPass(attemptId) {
  return { status: 'pass', attemptId, effectKinds: [], verdictSource: 'workspace_status' };
}

export function lagInferredNote(result) {
  return result?.verdictSource === 'workspace_status'
    ? `cynap-preview: a pass verdict already covers this commit; the attempt's own status read is still catching up, so its effect kinds are not shown. Read them with /cynap-preview status ${result.attemptId}\n`
    : '';
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
  if (body.status === 'waiting' && !safeDuration(body.remaining_queue_ms)) {
    throw Object.assign(new Error('operator preview status omitted a valid queue duration'), { code: 'preview_status_invalid' });
  }
  return body;
}

/** `cynap-preview status <attempt-id>`: the attempt's state and verdict, after the start's bounded poll has ended. */
export async function readPreviewStatus({ slug, attemptId, fetchImpl = fetch, nonceOverride = null }) {
  const { nonce, base } = previewRoute(slug, nonceOverride);
  return previewSummary(await readStatus({ base, nonce, previewId: attemptId, fetchImpl }));
}

/** The attempt's status read can lag its verdict (a recorded `pass` still read as `pending` for minutes). */
export const VERDICT_PROBE_EVERY_POLLS = 3;

/**
 * The second source for "does a verdict exist": the chain's own next action for this commit.
 * `workspace_status` stops asking for a preview of a handler once a pass verdict covers it, the
 * same read `/cynap-activate` acts on. True only when the commit is pending and no longer needs
 * this handler previewed; any read trouble, or a commit not on the chain, is "unknown" (false).
 */
export async function passVerdictCleared({ slug, automationId, commitSha, fetchImpl = fetch }) {
  try {
    const status = await mcpCall(`http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, 'workspace_status', {}, { fetchImpl });
    const entry = Array.isArray(status?.pending) ? status.pending.find((item) => item?.commit_sha === commitSha) : null;
    const action = entry?.next_action;
    if (!action) return false;
    if (action.kind !== 'handler_preview_required') return true;
    return Array.isArray(action.handlers) && !action.handlers.some((handler) => handler?.automation_id === automationId);
  } catch {
    return false;
  }
}

/** printed under a pass whose write-capable handler recorded no write. */
export const WROTE_NOTHING_NOTE = 'cynap-preview: warning preview_wrote_nothing — this handler can write (executeSql, knowledge.store or a send tool) '
  + 'but its preview recorded no write. A dry_run input or a branch the fixture never reaches proves nothing about the write path; '
  + 'preview with input that exercises it. The owner sees this warning on the effect review.';

export async function runPreview({ slug, automationId, commitSha, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = MAX_STATUS_POLLS, onStart = () => {}, onPosition = () => {}, nonceOverride = null,
  probeVerdict = (probe) => passVerdictCleared({ ...probe, fetchImpl }) }) {
  const { nonce, base } = previewRoute(slug, nonceOverride);
  const headers = { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce };
  const start = await fetchImpl(base, {
    method: 'POST', headers, body: JSON.stringify({ automationId, commitSha }),
  });
  const started = await start.json();
  if (!start.ok) {
    const refusal = { ...started, code: started?.code ?? started?.error ?? `HTTP ${start.status}` };
    throw Object.assign(new Error(formatRefusal(refusal, { command: 'cynap-preview' }).trim()), { code: refusal.code });
  }
  const previewId = started?.previewId;
  if (typeof previewId !== 'string') {
    throw Object.assign(new Error('operator preview returned no attempt id'), { code: 'preview_no_attempt_id' });
  }
  const initial = { status: 'preview_running', attemptId: previewId, effectKinds: [] };
  onStart(initial);
  let lastPosition = null;
  let queueBudgetMs = null;
  let leaseBudgetMs = null;
  let leaseZeroSeen = false;
  for (let poll = 0; ; poll += 1) {
    const delay = Math.min(2000 * (poll + 1), 10_000);
    await wait(delay);
    if (queueBudgetMs !== null) queueBudgetMs = Math.max(0, queueBudgetMs - delay);
    if (leaseBudgetMs !== null) leaseBudgetMs = Math.max(0, leaseBudgetMs - delay);
    const body = await readStatus({ base, nonce, previewId, fetchImpl });
    if (body.status !== 'pending' && body.status !== 'preview_running' && body.status !== 'waiting') return previewSummary(body);
    if (body.status === 'waiting') {
      const position = Number.isSafeInteger(body.position) && body.position > 0 ? body.position : null;
      if (position !== null && position !== lastPosition) onPosition(position);
      lastPosition = position;
      queueBudgetMs = queueBudgetMs === null ? body.remaining_queue_ms : Math.min(queueBudgetMs, body.remaining_queue_ms);
      if (queueBudgetMs === 0) return previewSummary(body);
      continue;
    } else {
      if (safeDuration(body.remaining_lease_ms)) {
        if (!leaseZeroSeen && body.remaining_lease_ms === 0) {
          leaseZeroSeen = true;
          leaseBudgetMs = 60_000;
        } else if (!leaseZeroSeen) {
          const serverBudget = Math.min(Number.MAX_SAFE_INTEGER, body.remaining_lease_ms + 60_000);
          leaseBudgetMs = leaseBudgetMs === null ? serverBudget : Math.min(leaseBudgetMs, serverBudget);
        }
      }
      if (leaseBudgetMs === 0) break;
      if (poll % VERDICT_PROBE_EVERY_POLLS === VERDICT_PROBE_EVERY_POLLS - 1 && await probeVerdict({ slug, automationId, commitSha })) {
        return lagInferredPass(previewId);
      }
      if (leaseBudgetMs !== null) continue;
    }
    // Legacy servers expose no horizon. Keep their bounded poll and status-resume path.
    if (poll + 1 < maxPolls) continue;
    break;
  }
  // One last read of both sources before calling a long wait "still running".
  const last = await readStatus({ base, nonce, previewId, fetchImpl });
  if (last.status !== 'pending' && last.status !== 'preview_running' && last.status !== 'waiting') return previewSummary(last);
  if (last.status !== 'waiting' && await probeVerdict({ slug, automationId, commitSha })) {
      return lagInferredPass(previewId);
  }
  return last.status === 'waiting' || Number.isSafeInteger(last.remaining_lease_ms) ? previewSummary(last) : initial;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, ...args } = parsePreviewArgs(argv);
  const result = command === 'status'
    ? await readPreviewStatus({ slug: resolveOrgSlug(), attemptId: args.attemptId })
    : await runPreview({
      slug: resolveOrgSlug(), ...args,
      onStart: (started) => process.stdout.write(`${JSON.stringify(operatorEffectOutput(started))}\n`),
      onPosition: (position) => process.stdout.write(`cynap-preview: waiting at queue position ${position}\n`),
    });
  process.stdout.write(`${JSON.stringify(operatorEffectOutput(result))}\n`);
  process.stdout.write(lagInferredNote(result));
  if (result.status === 'fail') process.stdout.write(`cynap-preview: ${formatPreviewFailure(result)}\n`);
  if (result.warnings?.includes('preview_wrote_nothing')) process.stdout.write(`${WROTE_NOTHING_NOTE}\n`);
  if (result.status === 'pending' || result.status === 'preview_running' || result.status === 'waiting') process.stdout.write(`${horizonHint(result)}\n`);
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
  applyGlobalFlags(import.meta.url);
  main().catch((error) => {
    process.stderr.write(`cynap-preview: failed (${failureCode(error)})${failureReason(error)}\n`);
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
