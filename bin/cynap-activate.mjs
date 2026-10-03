#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { ACTIVATE_PATH, CONTROL_FILE, CONTROL_HEADER } from './operator-proxy.mjs';
import { runPreview } from './cynap-preview.mjs';
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

/** An upstream gateway timeout says nothing about the activation itself: it may still be running. */
const GATEWAY_TIMEOUT_CODES = new Set(['http_502', 'http_503', 'http_504']);

export async function reconcileActivation({
  slug, commitSha, fetchImpl = fetch, waitMs = 10 * 60 * 1000, intervalMs = 5000, wait = sleep,
}) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const call = (name, args) => mcpCall(proxyUrl, name, args, { fetchImpl });
  // Bounded: while the server reports the commit as `activating`, re-read until it lands or the
  // budget runs out, so a slow activation is reported by its real outcome, not as a failure.
  let status;
  for (let waited = 0; ; waited += intervalMs) {
    status = await call('workspace_status', {});
    if (status?.ok === false) return status;
    if (status.live_digest === commitSha) return { ok: true, state: 'activated', commit_sha: commitSha };
    const activating = status.pending?.some((item) => item.commit_sha === commitSha && item.state === 'activating');
    if (!activating || waited + intervalMs > waitMs) break;
    await wait(intervalMs);
  }
  const unconfirmed = (state, extra = {}) => ({
    ok: false, code: 'activation_not_confirmed', state, commit_sha: commitSha, ...extra,
    message: `activation not confirmed: ${state}. The activation request timed out; check /cynap-status before retrying.`,
  });
  const pending = status.pending?.find((item) => item.commit_sha === commitSha);
  if (pending) return unconfirmed(pending.state ?? 'pending', {
    ...(pending.next_action ? { next_action: pending.next_action } : {}),
    ...(pending.failure_code ? { failure_code: pending.failure_code } : {}),
  });
  const log = await call('workspace_log', { limit: 20 });
  const commit = log?.commits?.find((item) => item.commit_sha === commitSha || item.sha === commitSha);
  if (!commit) return unconfirmed('unknown', { code: 'activation_outcome_unknown' });
  if (commit.outcome === 'activated' || commit.outcome === 'ancestor') {
    return { ok: true, state: commit.outcome, commit_sha: commitSha };
  }
  return unconfirmed(commit.outcome ?? 'recorded');
}

export async function activate({ slug, commitSha, witness = false, reconcile = false, fetchImpl = fetch }) {
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
    signal: AbortSignal.timeout(5 * 60 * 1000),
  }); } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return reconcileActivation({ slug, commitSha, fetchImpl });
    throw error;
  }
  if ([502, 503, 504].includes(response.status)) return reconcileActivation({ slug, commitSha, fetchImpl });
  const body = await response.json().catch(() => null);
  if (body?.error === 'activation_failed' && GATEWAY_TIMEOUT_CODES.has(body?.failureCode)) {
    return reconcileActivation({ slug, commitSha, fetchImpl });
  }
  if (!response.ok || body?.ok !== true) return { ok: false, code: body?.error ?? `http_${response.status}`, ...(body?.failureCode ? { failureCode: body.failureCode } : {}), message: body?.message };
  const unwrapped = unwrapToolEnvelope(body.result);
  // The server accepts the activation and finishes it in the background: poll to its real outcome.
  const settled = unwrapped?.code === 'activation_pending' && !witness
    ? await reconcileActivation({ slug, commitSha, fetchImpl })
    : unwrapped;
  const result = body.step_up && settled && typeof settled === 'object' ? { ...settled, step_up: body.step_up } : settled;
  return witness ? { result, witness: body.witness ?? null } : result;
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
  previewRunner = runPreview, activateFn = activate, onProgress = () => {}, onNotice = () => {} }) {
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
    // A browser handler cannot be previewed: the owner step-up page asks the owner to acknowledge
    // that it goes live without a preview. Only the author's own step-up (`command`) opens it here.
    if (nextAction?.kind === 'handler_unpreviewable_ack_required' && typeof nextAction.command === 'string') {
      onNotice(describeUnpreviewable(nextAction));
      return activateFn({ slug, commitSha, reconcile });
    }
    return { next_action: nextAction, state: nextAction?.kind ?? 'unavailable' };
  }
  throw new Error('preview gate did not advance after ten status reads');
}

/** What the owner is about to acknowledge, by handler id; never source or row data. */
export function describeUnpreviewable(nextAction) {
  const ids = (Array.isArray(nextAction?.handlers) ? nextAction.handlers : [])
    .map((handler) => handler?.automation_id).filter((id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(id));
  return `no preview: ${ids.length ? ids.join(', ') : 'this handler'} declares the browser capability, which preview cannot run. ` +
    'The owner approval page asks the owner to acknowledge activating it without a preview.\n';
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
    : kind === 'handler_unpreviewable_ack_required' ? 'a browser handler cannot be previewed; the org owner must approve it and acknowledge activating it without a preview.'
    : 'see /cynap-status for the next step.';
  return `not activated (${kind}): ${hint}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const { commitSha, reconcile, json } = parseActivateArgs(argv);
  const slug = resolveOrgSlug();
  const result = operatorEffectOutput(await runActivationFlow({ slug, commitSha, reconcile,
    onProgress: (status) => { const safe = operatorEffectOutput(status); process.stdout.write(`${json ? JSON.stringify(safe) : `preview: ${safe.status ?? 'unknown'}`}\n`); },
    onNotice: (line) => { if (!json) process.stdout.write(line); } }));
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result?.ok === false || result?.code) {
    process.stdout.write(formatRefusal(result, { command: 'cynap-activate', commitSha }));
    if (result.code === 'activation_pending' && result.step_up === 'automatic') process.stdout.write('activated automatically on the test org (no browser step-up)\n');
  }
  else if (notActivated(result)) process.stdout.write(describeNotActivated(result.next_action.kind, commitSha));
  else {
    process.stdout.write(`${result?.state ?? result?.status ?? result?.nextAction ?? 'activation submitted'}${result?.message ? `: ${result.message}` : ''}\n`);
    if (result?.step_up === 'automatic') process.stdout.write('activated automatically on the test org (no browser step-up)\n');
    const action = result?.next_action;
    if (action?.command) process.stdout.write(`next: ${action.command}${action.reason ? ` — ${action.reason}` : ''}\n`);
    const url = result?.approval_url ?? result?.step_up_url ?? action?.approval_url;
    if (url) process.stdout.write(`approval: ${url}${result?.expires_in ? ` (valid for ${result.expires_in} seconds)` : result?.expires_at ? ` (valid until ${result.expires_at})` : ''}\n`);
  }
  if (!json && notActivated(result)) process.exitCode = 1;
  if (result?.code === 'activation_pending') return result;
  if (result?.ok === false || result?.code) process.exitCode = result.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(describeActivateCrash(error));
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
