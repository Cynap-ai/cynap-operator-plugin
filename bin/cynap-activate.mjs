#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import {
  ACTIVATE_PATH, ACTIVATE_RESPONSE_BUDGET_MS, ACTIVATION_OUTCOMES, CONTROL_FILE, CONTROL_HEADER,
} from './operator-proxy.mjs';
import { runPreview } from './cynap-preview.mjs';
import { describeReady, readinessOf } from '../lib/activation-readiness.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE, unwrapToolEnvelope } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';

const USAGE = 'Usage: cynap-activate.mjs <64-character-commit-sha> [--reconcile] [--json]';

export function parseActivateArgs(argv) {
  const reconcile = argv.includes('--reconcile');
  const json = argv.includes('--json');
  const positional = argv.filter((arg) => arg !== '--reconcile' && arg !== '--json');
  if (positional.length !== 1 || argv.filter((arg) => arg === '--reconcile').length > 1 ||
      argv.filter((arg) => arg === '--json').length > 1 ||
      argv.some((arg) => arg.startsWith('--') && arg !== '--reconcile' && arg !== '--json') ||
      !/^[a-f0-9]{64}$/i.test(positional[0])) {
    throw new Error(USAGE);
  }
  return { commitSha: positional[0], reconcile, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to follow an `activating` answer on the chain, and then wait for readiness. Readiness
 * waits for the post-deploy projection (live lag p50 15.6 s, max 43.4 s); each read is one short
 * workspace_status call, never a request held open on the 29 s gateway path. */
export const ACTIVATION_SETTLE_MS = 10 * 60 * 1000;
export const READY_WAIT_MS = 90 * 1000;

export { describeReady, readinessOf };

/** "Was C activated?" is read from the chain: the live ref is C, or C is a recently
 * activated ancestor of it, and C is not the claimed head. Never inferred from timing. */
export function activatedOnChain(status, commitSha) {
  if (status?.head_state?.activating === commitSha) return false;
  if (status?.base_ref?.kind === 'commit' && status.base_ref.value === commitSha) return true;
  return Array.isArray(status?.recent) &&
    status.recent.some((entry) => entry.sha === commitSha && entry.outcome === 'activated');
}

const outcomeUnknown = (commitSha) => ({ ok: false, code: 'activation_outcome_unknown', commit_sha: commitSha });

/** Follow an accepted activation on the chain, then wait (bounded) for its readiness record. */
export async function settleActivation({
  slug, commitSha, fetchImpl = fetch, waitMs = ACTIVATION_SETTLE_MS, readyWaitMs = READY_WAIT_MS,
  intervalMs = 5000, wait = sleep,
}) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const readStatus = () => mcpCall(proxyUrl, 'workspace_status', {}, { fetchImpl });
  let status;
  for (let waited = 0; ; waited += intervalMs) {
    status = await readStatus();
    if (status?.ok === false) return status;
    if (activatedOnChain(status, commitSha)) break;
    const failure = status?.last_failure?.sha === commitSha ? status.last_failure : null;
    if (failure) {
      return { ok: false, code: 'activation_failed', commit_sha: commitSha, failure_code: failure.code,
        ...(failure.message ? { failure_message: failure.message } : {}) };
    }
    const pending = status?.pending?.find((item) => item.commit_sha === commitSha);
    if (pending?.state === 'failed') {
      return { ok: false, code: 'activation_failed', commit_sha: commitSha,
        ...(pending.failure_code ? { failure_code: pending.failure_code } : {}) };
    }
    const running = status?.head_state?.activating === commitSha || pending?.state === 'activating';
    if (!running || waited + intervalMs > waitMs) return outcomeUnknown(commitSha);
    await wait(intervalMs);
  }
  for (let waited = 0; ; waited += intervalMs) {
    const ready = readinessOf(status, commitSha);
    if (ready !== 'projecting' || waited + intervalMs > readyWaitMs) {
      return { ok: true, state: 'activated', commit_sha: commitSha, ready };
    }
    await wait(intervalMs);
    const next = await readStatus();
    if (next?.ok === false) return { ok: true, state: 'activated', commit_sha: commitSha, ready: 'unknown' };
    status = next;
  }
}

const OUTCOMES = new Set(ACTIVATION_OUTCOMES);

/**
 * POST /activate and render its one typed outcome. The proxy owns every deadline, and the wait
 * here is computed from them, so the proxy's answer arrives first; if it still does not, the
 * outcome is unknown and said so — never guessed from timing.
 */
export async function activate({ slug, commitSha, witness = false, reconcile = false, fetchImpl = fetch,
  budgetMs = ACTIVATE_RESPONSE_BUDGET_MS, settle = settleActivation }) {
  const noncePath = join(resolveWorkingDir(slug), CONTROL_FILE);
  const nonce = readFileSync(noncePath, 'utf8').trim();
  if (!nonce) throw new Error('operator activation: local control nonce is missing; run /cynap-connect again.');
  let response;
  try { response = await fetchImpl(`http://127.0.0.1:${stablePortForSlug(slug)}${ACTIVATE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce },
    body: JSON.stringify({
      commit_sha: commitSha,
      ...(witness ? { witness: true } : {}),
      ...(reconcile ? { reconcile_operator_edits: true } : {}),
    }),
    signal: AbortSignal.timeout(budgetMs),
  }); } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return outcomeUnknown(commitSha);
    throw error;
  }
  const body = await response.json().catch(() => null);
  const outcome = body?.outcome;
  if (!OUTCOMES.has(outcome)) {
    // A local refusal before any activation began (nonce, proxy not ready) carries no outcome.
    return body?.error ? { ok: false, code: body.error, message: body.message } : outcomeUnknown(commitSha);
  }
  if (outcome === 'consent_expired' || outcome === 'consent_denied') return { ok: false, code: outcome, commit_sha: commitSha };
  const unwrapped = body.result == null ? null : unwrapToolEnvelope(body.result);
  if (outcome === 'failed') {
    return unwrapped && unwrapped.ok === false
      ? unwrapped
      : { ok: false, code: body.error ?? 'activation_failed', ...(body.reason ? { failureCode: body.reason } : {}), message: body.message };
  }
  if (witness) return { result: unwrapped, witness: body.witness ?? null };
  const settled = await settle({ slug, commitSha, fetchImpl });
  return body.step_up && settled && typeof settled === 'object' ? { ...settled, step_up: body.step_up } : settled;
}

/** Read only the selected commit's next action through the plugin's local MCP proxy. */
export async function readActivationAction({ slug, commitSha, fetchImpl = fetch }) {
  const status = await mcpCall(`http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, 'workspace_status', {}, { fetchImpl });
  if (status?.ok === false) throw Object.assign(new Error(formatRefusal(status, { command: 'cynap-activate', commitSha }).trim()), { code: status.code });
  if (status?.ok !== true) throw new Error('workspace status unavailable');
  const selected = status.pending?.find((item) => item.commit_sha === commitSha);
  if (!selected) throw new Error('commit is not pending in this workspace');
  return { orgSlug: status.org_slug, nextAction: selected.next_action };
}

/** A pass is followed by a fresh status read before any owner step-up begins. */
export async function runActivationFlow({ slug, commitSha, reconcile = false, statusReader = readActivationAction,
  previewRunner = runPreview, activateFn = activate, onProgress = () => {} }) {
  let passedPreview = false;
  for (let round = 0; round < 10; round += 1) {
    const { orgSlug, nextAction } = await statusReader({ slug, commitSha });
    if (nextAction?.kind === 'handler_preview_required') {
      if (passedPreview) {
        throw new Error(`preview gate still requires a preview for the same commit ${commitSha} after a pass; stop and inspect the recorded verdict`);
      }
      const requests = nextAction.preview_requests;
      if (!Array.isArray(requests) || requests.length === 0) throw new Error('preview requests are missing');
      for (const request of requests) {
        if (request.method !== 'POST' || request.route !== '/preview/execute' ||
            request.body?.orgSlug !== orgSlug || request.body?.commitSha !== commitSha ||
            typeof request.body?.automationId !== 'string') throw new Error('preview request does not match the commit');
        const result = await previewRunner({ slug, automationId: request.body.automationId, commitSha,
          onStart: onProgress });
        onProgress(result);
        if (result.status !== 'pass') return result;
      }
      passedPreview = true;
      continue;
    }
    if (nextAction?.kind === 'step_up_and_activate' || (reconcile && nextAction?.kind === 'baseline_required')) {
      return activateFn({ slug, commitSha, reconcile });
    }
    return { next_action: nextAction, state: nextAction?.kind ?? 'unavailable' };
  }
  throw new Error('preview gate did not advance after ten status reads');
}

/** The line for an error thrown before any refusal came back: name the cause, never just a bare code. */
export function describeActivateCrash(error) {
  if (isProxyUnreachableError(error)) {
    return 'cynap-activate: failed (proxy_unreachable): the operator proxy is not reachable (it restarts after a plugin update). Run /cynap-status, then re-run /cynap-activate.\n';
  }
  const code = operatorEffectOutput(error).code ?? 'activation_failed';
  const reason = String(error?.message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  return `cynap-activate: failed (${code})${reason ? `: ${reason}` : ''}\n`;
}

/** The server answered with a next action instead of activating: nothing changed live. */
function notActivated(result) {
  return typeof result?.next_action?.kind === 'string' && result.ok === undefined &&
    result.state === undefined && result.status === undefined;
}

export function describeNotActivated(kind, commitSha) {
  const hint = kind === 'baseline_required'
    ? `the live files this commit changes carry no provenance stamp. Re-run /cynap-activate ${commitSha} --reconcile to adopt them.`
    : kind === 'blocked_by_chain' ? 'an earlier pending commit must activate first; see /cynap-status.'
    : 'see /cynap-status for the next step.';
  return `not activated (${kind}): ${hint}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const { commitSha, reconcile, json } = parseActivateArgs(argv);
  const slug = resolveOrgSlug();
  const result = operatorEffectOutput(await runActivationFlow({ slug, commitSha, reconcile,
    onProgress: (status) => { const safe = operatorEffectOutput(status); process.stdout.write(`${json ? JSON.stringify(safe) : `preview: ${safe.status ?? 'unknown'}`}\n`); } }));
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result?.ok === false || result?.code) {
    process.stdout.write(formatRefusal(result, { command: 'cynap-activate', commitSha }));
  }
  else if (notActivated(result)) process.stdout.write(describeNotActivated(result.next_action.kind, commitSha));
  else {
    process.stdout.write(`${result?.state ?? result?.status ?? result?.nextAction ?? 'activation submitted'}${result?.message ? `: ${result.message}` : ''}\n`);
    if (result?.ready) process.stdout.write(`${describeReady(result.ready)}\n`);
    if (result?.step_up === 'automatic') process.stdout.write('activated automatically on the test org (no browser step-up)\n');
    const action = result?.next_action;
    if (action?.command) process.stdout.write(`next: ${action.command}${action.reason ? ` — ${action.reason}` : ''}\n`);
    const url = result?.approval_url ?? result?.step_up_url ?? action?.approval_url;
    if (url) process.stdout.write(`approval: ${url}${result?.expires_in ? ` (valid for ${result.expires_in} seconds)` : result?.expires_at ? ` (valid until ${result.expires_at})` : ''}\n`);
  }
  if (!json && notActivated(result)) process.exitCode = 1;
  if (result?.ok === false || result?.code) process.exitCode = result.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(describeActivateCrash(error));
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
