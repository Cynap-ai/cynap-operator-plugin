#!/usr/bin/env node
// /cynap-propose: prepare the exact-tree proof for an accepted commit and propose it on a claimed Request.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { CONTROL_FILE, CONTROL_HEADER, PREPARE_PROOF_PATH, PREPARE_PROOF_RESPONSE_BUDGET_MS } from './operator-proxy.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';

const USAGE = 'Usage: cynap-propose.mjs <64-character-commit-sha> --request <number> [--json]';

export function parseProposeArgs(argv) {
  const json = argv.includes('--json');
  const flagAt = argv.indexOf('--request');
  const rawNumber = flagAt >= 0 ? argv[flagAt + 1] : undefined;
  const positional = argv.filter((arg, index) => arg !== '--json' && index !== flagAt && index !== flagAt + 1);
  if (flagAt < 0 || argv.filter((arg) => arg === '--request').length > 1 ||
      argv.filter((arg) => arg === '--json').length > 1 ||
      !/^[1-9][0-9]{0,14}$/.test(rawNumber ?? '') ||
      positional.length !== 1 || !/^[a-f0-9]{64}$/i.test(positional[0])) {
    throw new Error(USAGE);
  }
  return { commitSha: positional[0], number: Number(rawNumber), json };
}

/** POST /prepare-proof. The proxy mints and spends the proof credential; only the receipt comes back. */
export async function prepareProof({ slug, requestId, expectedStateVersion, commitSha, fetchImpl = fetch,
  budgetMs = PREPARE_PROOF_RESPONSE_BUDGET_MS }) {
  const nonce = readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('operator proposal: local control nonce is missing; run /cynap-connect again.');
  const response = await fetchImpl(`http://127.0.0.1:${stablePortForSlug(slug)}${PREPARE_PROOF_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce },
    body: JSON.stringify({ request_id: requestId, expected_state_version: expectedStateVersion, commit_sha: commitSha }),
    signal: AbortSignal.timeout(budgetMs),
  });
  const body = await response.json().catch(() => null);
  if (body?.ok === true && typeof body.receipt === 'string') return body;
  if (body?.ok === false && typeof body.code === 'string') return body;
  // A local refusal before the tool ran (nonce, body, credential mint) carries `error`.
  return { ok: false, code: typeof body?.error === 'string' ? body.error : 'prepare_proof_failed',
    ...(typeof body?.failureCode === 'string' ? { failureCode: body.failureCode } : {}) };
}

/**
 * Read the Request, refuse locally unless it is claimed, prepare the proof, then propose. The
 * Request's id and state_version go to both server calls exactly as request_get returned them.
 */
export async function runProposeFlow({ slug, commitSha, number, fetchImpl = fetch, prepare = prepareProof }) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const read = await mcpCall(proxyUrl, 'request_get', { number }, { fetchImpl });
  if (read?.ok === false) return read;
  const request = read?.request;
  if (!request) return { ok: false, code: 'request_not_found' };
  if (request.state !== 'claimed') {
    return { ok: false, code: 'request_not_claimed', ...(typeof request.state === 'string' ? { state: request.state } : {}) };
  }
  const proof = await prepare({ slug, requestId: request.id, expectedStateVersion: request.state_version, commitSha, fetchImpl });
  if (proof?.ok !== true) return proof;
  const result = await mcpCall(proxyUrl, 'request_operator_transition', {
    id: request.id,
    verb: 'propose',
    expected_state_version: request.state_version,
    proposal_ref: commitSha,
    proof_receipt: proof.receipt,
  }, { fetchImpl });
  if (result?.ok === false) return result;
  return { ok: true, request_number: number, request_id: request.id, commit_sha: commitSha, result };
}

// What each refusal means and the next step. Nothing was proposed in any of them.
const OWNER_MUST_PROPOSE = 'this seat cannot prepare the proof a proposal needs. Today only the Owner (or an admitted external commit grant) can; ask the Owner to run /cynap-propose.';
const PROPOSE_HINTS = Object.freeze({
  request_not_found: 'no Request with that number in this org. Check the number with request_query.',
  request_not_claimed: 'only a claimed Request can be proposed. Claim it first (request_operator_transition with verb: claim), or read its state with request_get.',
  forbidden_actor: OWNER_MUST_PROPOSE,
  tool_not_available: OWNER_MUST_PROPOSE,
  proof_credential_refused: OWNER_MUST_PROPOSE,
  proof_credential_failed: 'the proof credential could not be minted. Run /cynap-status; if the operator credential expired, run /cynap-connect, then re-run /cynap-propose.',
  prepare_proof_failed: 'the proof preparation call did not complete. Nothing was proposed; re-run /cynap-propose.',
  invalid_local_control_nonce: 'the local proxy refused this command. Run /cynap-connect again.',
  REQUEST_PROPOSAL_INTENDED_OUTCOMES_REQUIRED: 'the commit has no Intended outcomes citing the Request\'s Scope. Make a new Request-bound workspace_commit whose change_overview.intended_outcomes cite Scope outcome lines (see the summarize-your-change skill), then propose that commit.',
  REQUEST_ARTIFACT_UNOWNED: 'a file this commit adds or changes belongs to no Solution. Add the listed paths to a Solution entry in solutions.json in a new commit, then propose that commit.',
  REQUEST_PREAPPROVAL_PROOF_INVALID: 'the proof no longer matches the Request or the commit (the Request changed in between). Re-run /cynap-propose to prepare a fresh proof.',
  REQUEST_PREAPPROVAL_PROOF_EXPIRED: 'the proof expired before the proposal landed. Re-run /cynap-propose.',
});

/** A thrown server refusal can arrive as plain text; its REQUEST_* code is then inside the message. */
export function refusalCode(result) {
  const code = typeof result?.code === 'string' ? result.code : '';
  if (Object.hasOwn(PROPOSE_HINTS, code)) return code;
  return /\bREQUEST_[A-Z0-9_]+\b/.exec(String(result?.message ?? ''))?.[0] ?? code;
}

export function describeProposeRefusal(result) {
  const code = refusalCode(result);
  const text = formatRefusal(result, { command: 'cynap-propose' });
  const named = code && !text.includes(code) ? `cynap-propose: refused (${code})\n` : '';
  const state = code === 'request_not_claimed' && result?.state ? `The Request is ${result.state}. ` : '';
  const hint = Object.hasOwn(PROPOSE_HINTS, code) ? `Next step: ${state}${PROPOSE_HINTS[code]}\n` : '';
  return `${named}${text}${hint}`;
}

/** The line for an error thrown before any refusal came back. */
export function describeProposeCrash(error) {
  if (isProxyUnreachableError(error)) {
    return 'cynap-propose: failed (proxy_unreachable): the operator proxy is not reachable (it restarts after a plugin update). Run /cynap-status, then re-run /cynap-propose.\n';
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return 'cynap-propose: failed (outcome_unknown): the local proxy did not answer in time. Read the Request with request_get before retrying.\n';
  }
  const reason = String(error?.message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  return `cynap-propose: failed${reason ? `: ${reason}` : ''}\n`;
}

export async function main(argv = process.argv.slice(2), { run = runProposeFlow, out = process.stdout } = {}) {
  const { commitSha, number, json } = parseProposeArgs(argv);
  const result = await run({ slug: resolveOrgSlug(), commitSha, number });
  if (json) out.write(`${JSON.stringify(result)}\n`);
  else if (result?.ok === true) out.write(`proposed: Request ${number} now carries commit ${commitSha}. It waits for the Owner's approval.\n`);
  else out.write(describeProposeRefusal(result));
  if (result?.ok !== true) process.exitCode = refusalCode(result) === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyGlobalFlags(import.meta.url);
  main().catch((error) => {
    process.stderr.write(describeProposeCrash(error));
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
