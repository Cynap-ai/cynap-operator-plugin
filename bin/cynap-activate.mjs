#!/usr/bin/env node
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

import { pathToFileURL } from 'node:url';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { chainReport, followGrant, ProxyUnreachableError, runActivation } from '../lib/activation-run-client.mjs';
import { ACTIVATE_GRANT_PATH, CONTROL_FILE, CONTROL_HEADER } from './operator-proxy.mjs';
import { runPreview } from './cynap-preview.mjs';
import { describeReady, readinessOf } from '../lib/activation-readiness.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE, unwrapToolEnvelope } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';

const USAGE = 'Usage: cynap-activate.mjs <64-character-commit-sha> [--reconcile] [--auto] [--json]\n       cynap-activate.mjs --through <64-character-commit-sha> [--json]';
const SHA = /^[a-f0-9]{64}$/i;

/** One commit by sha, or `--through <sha>`: one Owner approval for the pending chain up to it. */
export function parseActivateArgs(argv) {
  const count = (flag) => argv.filter((arg) => arg === flag).length;
  const throughAt = argv.indexOf('--through');
  const throughSha = throughAt === -1 ? undefined : argv[throughAt + 1];
  const rest = argv.filter((_, i) => i !== throughAt && (throughAt === -1 || i !== throughAt + 1));
  const flags = ['--reconcile', '--json', '--auto'];
  const reconcile = rest.includes('--reconcile');
  const json = rest.includes('--json');
  const auto = rest.includes('--auto');
  const positional = rest.filter((arg) => !flags.includes(arg));
  if (flags.some((flag) => count(flag) > 1) || count('--through') > 1 ||
      rest.some((arg) => arg.startsWith('--') && !flags.includes(arg))) {
    throw new Error(USAGE);
  }
  if (throughAt !== -1) {
    if (reconcile) throw new Error('cynap-activate: --through cannot be combined with --reconcile; reconcile one commit at a time.');
    if (auto) throw new Error(USAGE);
    if (positional.length !== 0 || !SHA.test(throughSha ?? '')) throw new Error(USAGE);
    return { throughSha: throughSha.toLowerCase(), reconcile: false, json };
  }
  if (positional.length !== 1 || !SHA.test(positional[0])) throw new Error(USAGE);
  return { commitSha: positional[0], reconcile, json, auto };
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

/** A run that ended without activating anything, as the refusal the CLI prints. */
function runRefusal(run, sha) {
  if (run.state === 'refused') return { ok: false, code: run.code, ...(run.message ? { message: run.message } : {}) };
  if (run.state === 'consent_expired' || run.state === 'consent_denied') return { ok: false, code: run.state, commit_sha: sha };
  if (run.state === 'replayed') return { ok: false, code: 'activation_credential_replayed', commit_sha: sha };
  const unwrapped = run.result == null ? null : unwrapToolEnvelope(run.result);
  if (unwrapped && unwrapped.ok === false) return unwrapped;
  return { ok: false, code: run.reason ?? 'activation_failed', ...(run.failureCode ? { failureCode: run.failureCode } : {}),
    ...(run.run_id ? { run_id: run.run_id } : {}) };
}

/** Still waiting for the Owner when the CLI stopped following: waiting, never failed. */
const consentPending = (run, sha) => ({ state: 'consent_pending', commit_sha: sha, run_id: run.run_id,
  message: 'the Owner has not answered yet; re-run the same /cynap-activate to keep following this request' });

/**
 * Start the proxy's activation run for one commit and render its typed outcome. The proxy owns
 * every deadline; the CLI reads the run with short calls and derives nothing from timing.
 */
export async function activate({ slug, commitSha, witness = false, reconcile = false, fetchImpl = fetch,
  settle = settleActivation, follow = runActivation, onProgress = () => {} }) {
  const run = await follow({ slug, fetchImpl, onProgress, body: {
    commit_sha: commitSha,
    ...(witness ? { witness: true } : {}),
    ...(reconcile ? { reconcile_operator_edits: true } : {}),
  } });
  if (run.state === 'consent_pending') return consentPending(run, commitSha);
  if (run.state !== 'activated' && run.state !== 'activating') return runRefusal(run, commitSha);
  if (witness) return { result: run.result == null ? null : unwrapToolEnvelope(run.result), witness: run.witness ?? null };
  const settled = await settle({ slug, commitSha, fetchImpl });
  return run.step_up && settled && typeof settled === 'object' ? { ...settled, step_up: run.step_up } : settled;
}

/**
 * `--through`: one Owner approval for the pending chain up to `throughSha`, then follow the grant
 * until it completes, stops or expires. A range of one on the test org keeps the automatic step-up
 * and settles like a single commit.
 */
export async function activateThrough({ slug, throughSha, fetchImpl = fetch, settle = settleActivation,
  follow = runActivation, followGrantImpl = followGrant, onProgress = () => {}, onStep = () => {} }) {
  const run = await follow({ slug, fetchImpl, onProgress, body: { through_sha: throughSha } });
  if (run.state === 'consent_pending') return consentPending(run, throughSha);
  if (run.state === 'activated' || run.state === 'activating') {
    const settled = await settle({ slug, commitSha: throughSha, fetchImpl });
    if (settled?.ok === false) return settled;
    return chainReport({ through: throughSha, members: [throughSha], grant: { cursor: 1, status: 'completed' }, state: 'completed' });
  }
  if (run.state !== 'accepted') return runRefusal(run, throughSha);
  const grant = await followGrantImpl({ slug, activationGrantId: run.activation_grant_id, fetchImpl, onStep });
  const state = grant.waited_out ? 'running' : grant.status;
  return { ...chainReport({ through: throughSha, members: run.members, grant, state }),
    activation_grant_id: run.activation_grant_id };
}

/** Read only the selected commit's next action through the plugin's local MCP proxy. */
export async function readActivationAction({ slug, commitSha, fetchImpl = fetch }) {
  const status = await mcpCall(`http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, 'workspace_status', {}, { fetchImpl });
  if (status?.ok === false) throw Object.assign(new Error(formatRefusal(status, { command: 'cynap-activate' }).trim()), { code: status.code });
  if (status?.ok !== true) throw new Error('workspace status unavailable');
  const selected = status.pending?.find((item) => item.commit_sha === commitSha);
  if (!selected) throw new Error('commit is not pending in this workspace');
  // The backend decides the entrance per Org; the plugin follows it, never decides.
  return { orgSlug: status.org_slug, nextAction: selected.next_action,
    entrance: status.activation_entrance === 'grant' ? 'grant' : 'legacy',
    changesUrl: typeof status.changes_url === 'string' ? status.changes_url : null };
}

/** How long link-and-wait follows the chain for the Owner's approval on the Changes page. */
export const GRANT_APPROVAL_WAIT_MS = 15 * 60 * 1000;

/**
 * Link-and-wait (§4.3): wait, bounded, until the commit starts or finishes activating on the chain,
 * then follow it like any activation. Nothing is approved here; the Owner approves on the Changes page.
 */
export async function waitForGrantActivation({ slug, commitSha, fetchImpl = fetch, waitMs = GRANT_APPROVAL_WAIT_MS,
  intervalMs = 5000, wait = sleep, settle = settleActivation }) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  for (let waited = 0; ; waited += intervalMs) {
    const status = await mcpCall(proxyUrl, 'workspace_status', {}, { fetchImpl });
    if (status?.ok === false) return status;
    const pending = status?.pending?.find((item) => item.commit_sha === commitSha);
    const moved = activatedOnChain(status, commitSha) || status?.head_state?.activating === commitSha ||
      status?.last_failure?.sha === commitSha || pending?.state === 'activating' || pending?.state === 'failed';
    if (moved) return settle({ slug, commitSha, fetchImpl });
    if (waited + intervalMs > waitMs) return { ok: false, code: 'grant_approval_pending', commit_sha: commitSha };
    await wait(intervalMs);
  }
}

/** The portal's acceptance answers within the proxy's activation call budget plus its outcome margin. */
const GRANT_ACCEPT_TIMEOUT_MS = 60_000;

/** `--auto` on a grant Org: the portal accepts the prefix as the test Org's Owner persona, or refuses. */
export async function acceptGrantAutomatically({ slug, commitSha, fetchImpl = fetch }) {
  const nonce = readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('operator activation: local control nonce is missing; run /cynap-connect again.');
  const response = await fetchImpl(`http://127.0.0.1:${stablePortForSlug(slug)}${ACTIVATE_GRANT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce },
    body: JSON.stringify({ through_sha: commitSha }),
    signal: AbortSignal.timeout(GRANT_ACCEPT_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.activation_grant_id !== 'string') {
    const code = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
    return { ok: false, code, ...(typeof body?.reason === 'string' ? { reason: body.reason } : {}),
      ...(typeof body?.code === 'string' ? { failure_code: body.code } : {}),
      ...(typeof body?.activation_grant_id === 'string' ? { activation_grant_id: body.activation_grant_id } : {}) };
  }
  return { ok: true, activation_grant_id: body.activation_grant_id, acceptance: body.acceptance };
}

/** A grant Org: `--auto` asks the portal to accept, otherwise print the Changes link; then wait on the chain. */
export async function runGrantActivation({ slug, commitSha, auto = false, changesUrl, onLink = () => {},
  acceptFn = acceptGrantAutomatically, waitFn = waitForGrantActivation }) {
  if (auto) {
    const accepted = await acceptFn({ slug, commitSha });
    if (accepted.ok !== true) return { ...accepted, ...(changesUrl ? { changes_url: changesUrl } : {}) };
  } else {
    onLink(changesUrl);
  }
  const settled = await waitFn({ slug, commitSha });
  return settled && typeof settled === 'object' && changesUrl ? { ...settled, changes_url: changesUrl } : settled;
}

/** Run every preview the next action asks for; the first non-pass is returned, a full pass is null. */
async function previewCommit({ slug, orgSlug, commitSha, nextAction, previewRunner, onProgress }) {
  const requests = nextAction.preview_requests;
  if (!Array.isArray(requests) || requests.length === 0) throw new Error('preview requests are missing');
  for (const request of requests) {
    if (request.method !== 'POST' || request.route !== '/preview/execute' ||
        request.body?.orgSlug !== orgSlug || request.body?.commitSha !== commitSha ||
        typeof request.body?.automationId !== 'string') throw new Error('preview request does not match the commit');
    const result = await previewRunner({ slug, automationId: request.body.automationId, commitSha, onStart: onProgress });
    onProgress(result);
    if (result.status !== 'pass') return result;
  }
  return null;
}

/** The pending chain from workspace_status, oldest first. */
export async function readPendingChain({ slug, fetchImpl = fetch }) {
  const status = await mcpCall(`http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, 'workspace_status', {}, { fetchImpl });
  if (status?.ok === false) throw Object.assign(new Error(formatRefusal(status, { command: 'cynap-activate' }).trim()), { code: status.code });
  if (status?.ok !== true) throw new Error('workspace status unavailable');
  return { orgSlug: status.org_slug, pending: Array.isArray(status.pending) ? status.pending : [] };
}

/**
 * `--through`: preview each handler member in chain order and stop at the first non-pass, before
 * any consent opens. The grant page itself shows the prefix the server will cover.
 */
export async function runThroughFlow({ slug, throughSha, chainReader = readPendingChain, previewRunner = runPreview,
  activateFn = activateThrough, onProgress = () => {}, onRun = () => {}, onStep = () => {} }) {
  const { orgSlug, pending } = await chainReader({ slug });
  const end = pending.findIndex((item) => item.commit_sha === throughSha);
  if (end === -1) throw new Error('commit is not pending in this workspace');
  for (const item of pending.slice(0, end + 1)) {
    if (item.next_action?.kind !== 'handler_preview_required') continue;
    const failed = await previewCommit({ slug, orgSlug, commitSha: item.commit_sha, nextAction: item.next_action,
      previewRunner, onProgress });
    if (failed) return failed;
  }
  return activateFn({ slug, throughSha, onProgress: onRun, onStep });
}

/** A pass is followed by a fresh status read before any owner step-up begins. */
export async function runActivationFlow({ slug, commitSha, reconcile = false, auto = false,
  statusReader = readActivationAction, previewRunner = runPreview, activateFn = activate,
  grantFn = runGrantActivation, onLink = () => {}, onProgress = () => {}, onRun = () => {} }) {
  let passedPreview = false;
  for (let round = 0; round < 10; round += 1) {
    const { orgSlug, nextAction, entrance, changesUrl } = await statusReader({ slug, commitSha });
    if (nextAction?.kind === 'handler_preview_required') {
      if (passedPreview) {
        throw new Error(`preview gate still requires a preview for the same commit ${commitSha} after a pass; stop and inspect the recorded verdict`);
      }
      const failed = await previewCommit({ slug, orgSlug, commitSha, nextAction, previewRunner, onProgress });
      if (failed) return failed;
      passedPreview = true;
      continue;
    }
    if (entrance === 'grant' && nextAction?.kind === 'step_up_and_activate') {
      return grantFn({ slug, commitSha, auto, changesUrl, onLink });
    }
    if (auto) throw new Error('--auto applies only to an Org on the Changes-page entrance');
    if (nextAction?.kind === 'step_up_and_activate' || (reconcile && nextAction?.kind === 'baseline_required')) {
      return activateFn({ slug, commitSha, reconcile, onProgress: onRun });
    }
    return { next_action: nextAction, state: nextAction?.kind ?? 'unavailable' };
  }
  throw new Error('preview gate did not advance after ten status reads');
}

/** The line for an error thrown before any refusal came back: name the cause, never just a bare code. */
export function describeActivateCrash(error) {
  if (error instanceof ProxyUnreachableError) {
    return `cynap-activate: proxy_unreachable (${error.causeCode}): ${error.message}\n`;
  }
  if (isProxyUnreachableError(error)) {
    const cause = error?.cause?.code ?? error?.code;
    return `cynap-activate: failed (proxy_unreachable, ${cause}): the operator proxy is not reachable (it restarts after a plugin update). Run /cynap-status, then re-run /cynap-activate.\n`;
  }
  const code = operatorEffectOutput(error).code ?? 'activation_failed';
  // undici's `fetch failed` hides the network fault in `cause.code` (a headers timeout, a TLS or
  // DNS fault): name it, or the operator cannot tell a slow proxy from a broken one.
  const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : null;
  const message = String(error?.message ?? '');
  const reason = (causeCode ? `${message} (${causeCode})` : message)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
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

/** One progress line for the proxy's run: where the Owner's approval stands. */
export function describeRun(run) {
  if (run.attached) return `attached to the activation already running (${run.run_id})`;
  if (run.state === 'consent_pending') {
    if (run.review === 'preparing') return 'preparing the review page';
    if (run.review === 'opened') return "approval page opened; waiting for the Owner's approval";
    return 'review ready';
  }
  return `approval: ${run.state}`;
}

/** One line per grant step. */
export function describeStep(grant) {
  const total = Number.isInteger(grant.total) ? grant.total : '?';
  if (grant.status === 'completed') return `completed: ${total} of ${total} commits activated`;
  if (grant.status === 'stopped' || grant.status === 'expired') {
    return `${grant.status} at commit ${grant.cursor + 1} of ${total}${grant.stopped_reason ? ` (${grant.stopped_reason})` : ''}`;
  }
  return `activating commit ${grant.cursor + 1} of ${total}`;
}

const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The chain report is CLI-built from typed fields; a free-text stop reason never reaches output. */
export function safeChainReport(result) {
  if (!result.stopped || SAFE_CODE.test(result.stopped.reason)) return result;
  return { ...result, stopped: { ...result.stopped, reason: 'stopped' } };
}

export function printChain(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${report.state}: ${report.members.filter((m) => m.outcome === 'activated').length} of ${report.members.length} commits through ${report.through.slice(0, 7)} activated\n`);
    if (report.stopped) {
      process.stdout.write(`stopped at commit ${report.stopped.at_position + 1} (${report.stopped.reason}); still pending: ${report.stopped.remaining.map((sha) => sha.slice(0, 7)).join(', ')}\n`);
    }
  }
  if (report.state !== 'completed') process.exitCode = 1;
  return report;
}

function printConsentPending(result, json) {
  process.stdout.write(json ? `${JSON.stringify(result)}\n` : `consent_pending: ${result.message}\n`);
  process.exitCode = 1;
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseActivateArgs(argv);
  const { json } = args;
  const slug = resolveOrgSlug();
  const onProgress = (status) => { const safe = operatorEffectOutput(status); process.stdout.write(`${json ? JSON.stringify(safe) : `preview: ${safe.status ?? 'unknown'}`}\n`); };
  const onRun = (run) => { if (!json) process.stdout.write(`${describeRun(run)}\n`); };
  const onStep = (grant) => { if (!json) process.stdout.write(`${describeStep(grant)}\n`); };
  const onLink = (url) => process.stdout.write(json
    ? `${JSON.stringify({ state: 'awaiting_owner_approval', changes_url: url ?? null })}\n`
    : `approve on the Changes page${url ? `: ${url}` : ''} — waiting for the Owner (up to ${GRANT_APPROVAL_WAIT_MS / 60000} minutes)\n`);
  const raw = args.throughSha
    ? await runThroughFlow({ slug, throughSha: args.throughSha, onProgress, onRun, onStep })
    : await runActivationFlow({ slug, commitSha: args.commitSha, reconcile: args.reconcile, auto: args.auto, onLink,
      onProgress, onRun });
  if (raw?.state === 'consent_pending') return printConsentPending(raw, json);
  if (Array.isArray(raw?.members) && typeof raw?.through === 'string') return printChain(safeChainReport(raw), json);
  const commitSha = args.commitSha ?? args.throughSha;
  const result = operatorEffectOutput(raw);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result?.ok === false || result?.code) {
    process.stdout.write(formatRefusal(result, { command: 'cynap-activate' }));
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
  applyGlobalFlags(import.meta.url);
  main().catch((error) => {
    process.stderr.write(describeActivateCrash(error));
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
