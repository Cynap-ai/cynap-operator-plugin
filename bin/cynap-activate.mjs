#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { ACTIVATE_PATH, CONTROL_FILE, CONTROL_HEADER } from './operator-proxy.mjs';
import { runPreview } from './cynap-preview.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE, unwrapToolEnvelope } from '../lib/format-refusal.mjs';
import { mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';

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

export async function reconcileActivation({ slug, commitSha, fetchImpl = fetch }) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const call = (name, args) => mcpCall(proxyUrl, name, args, { fetchImpl });
  const status = await call('workspace_status', {});
  if (status?.ok === false) return status;
  if (status.live_digest === commitSha) return { ok: true, state: 'activated', commit_sha: commitSha };
  const unconfirmed = (state, extra = {}) => ({
    ok: false, code: 'activation_not_confirmed', state, commit_sha: commitSha, ...extra,
    message: `activation not confirmed: ${state}. The activation request timed out; check /cynap-status before retrying.`,
  });
  const pending = status.pending?.find((item) => item.commit_sha === commitSha);
  if (pending) return unconfirmed(pending.state ?? 'pending', pending.next_action ? { next_action: pending.next_action } : {});
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
  if (!response.ok || body?.ok !== true) return { ok: false, code: body?.error ?? `HTTP ${response.status}`, message: body?.message };
  const result = unwrapToolEnvelope(body.result);
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

export async function main(argv = process.argv.slice(2)) {
  const { commitSha, reconcile, json } = parseActivateArgs(argv);
  const slug = resolveOrgSlug();
  const result = await runActivationFlow({ slug, commitSha, reconcile,
    onProgress: (status) => process.stdout.write(`${json ? JSON.stringify(status) : `preview: ${status.status}`}\n`) });
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result?.ok === false || result?.code) process.stdout.write(formatRefusal(result, { command: 'cynap-activate', commitSha }));
  else {
    process.stdout.write(`${result?.state ?? result?.status ?? result?.nextAction ?? 'activation submitted'}${result?.message ? `: ${result.message}` : ''}\n`);
    const action = result?.next_action;
    if (action?.command) process.stdout.write(`next: ${action.command}${action.reason ? ` — ${action.reason}` : ''}\n`);
    const url = result?.approval_url ?? result?.step_up_url ?? action?.approval_url;
    if (url) process.stdout.write(`approval: ${url}${result?.expires_in ? ` (valid for ${result.expires_in} seconds)` : result?.expires_at ? ` (valid until ${result.expires_at})` : ''}\n`);
  }
  if (result?.ok === false || result?.code) process.exitCode = result.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
