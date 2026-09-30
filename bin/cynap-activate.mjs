#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { ACTIVATE_PATH, CONTROL_FILE, CONTROL_HEADER } from './operator-proxy.mjs';
import { runPreview } from './cynap-preview.mjs';

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

/** Read only the selected commit's next action through the plugin's local MCP proxy. */
export async function readActivationAction({ slug, commitSha, fetchImpl = fetch }) {
  const response = await fetchImpl(`http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'cynap-activate-status', method: 'tools/call',
      params: { name: 'workspace_status', arguments: {} } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`workspace status failed: HTTP ${response.status}`);
  const text = await response.text();
  const dataLine = text.split('\n').filter((line) => line.startsWith('data:')).pop();
  const envelope = JSON.parse(dataLine ? dataLine.slice(5).trim() : text);
  if (envelope.error || envelope.result?.isError) throw new Error('workspace status refused');
  const content = envelope.result?.content?.find((item) => typeof item.text === 'string')?.text;
  const status = content ? JSON.parse(content) : envelope.result?.structuredContent;
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
    return { nextAction: nextAction?.kind ?? 'unavailable' };
  }
  throw new Error('preview gate did not advance after ten status reads');
}

export async function main(argv = process.argv.slice(2)) {
  const { commitSha, reconcile } = parseActivateArgs(argv);
  const slug = basename(process.cwd());
  const result = await runActivationFlow({ slug, commitSha, reconcile,
    onProgress: (status) => process.stdout.write(`${JSON.stringify(status)}\n`) });
  process.stdout.write(`${typeof result === 'string' ? result : JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
