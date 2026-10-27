#!/usr/bin/env node
// /cynap-discard: orphan a pending accepted commit and every commit after it, after showing that range.
import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';

const USAGE = 'Usage: cynap-discard.mjs <64-character-commit-sha> --reason <text> [--dry-run] [--json]';
const REASON_MAX = 2000;

export function parseDiscardArgs(argv) {
  const flagAt = argv.indexOf('--reason');
  const reason = flagAt >= 0 ? String(argv[flagAt + 1] ?? '').trim() : '';
  const json = argv.includes('--json');
  const dryRun = argv.includes('--dry-run');
  const positional = argv.filter((arg, index) => arg !== '--json' && arg !== '--dry-run' &&
    index !== flagAt && index !== flagAt + 1);
  const once = (flag) => argv.filter((arg) => arg === flag).length <= 1;
  if (flagAt < 0 || !reason || reason.length > REASON_MAX || reason.startsWith('--') ||
      !once('--reason') || !once('--json') || !once('--dry-run') ||
      positional.length !== 1 || !/^[a-f0-9]{64}$/i.test(positional[0])) {
    throw new Error(USAGE);
  }
  return { commitSha: positional[0].toLowerCase(), reason, dryRun, json };
}

/** The pending commits a discard of `commitSha` would orphan: that commit and every one after it. */
export function discardRange(status, commitSha) {
  const rows = Array.isArray(status?.chain) ? status.chain : [];
  const target = rows.find((row) => row.sha === commitSha);
  if (!target) return null;
  return rows.filter((row) => row.position >= target.position)
    .sort((a, b) => a.position - b.position)
    .map(({ sha, message, author_id: authorId }) => ({ sha, message, author_id: authorId }));
}

/**
 * Read the chain, refuse locally unless the commit is pending on it, then discard once. Never
 * retried: a discard that landed but lost its reply answers `commit_orphaned` on a second call.
 */
export async function runDiscardFlow({ slug, commitSha, reason, dryRun, fetchImpl = fetch }) {
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const status = await mcpCall(proxyUrl, 'workspace_status', {}, { fetchImpl });
  if (status?.ok === false) return status;
  const range = discardRange(status, commitSha);
  if (!range) return { ok: false, code: 'commit_not_pending', commit_sha: commitSha };
  if (status?.head_state?.activating && range.some((row) => row.sha === status.head_state.activating)) {
    return { ok: false, code: 'commit_activating', commit_sha: status.head_state.activating };
  }
  if (dryRun) return { ok: true, dry_run: true, would_discard: range, accepted_tip: status.accepted_tip };
  const result = await mcpCall(proxyUrl, 'workspace_discard_commit', { commit: commitSha, reason }, { fetchImpl });
  if (result?.ok === false) return result;
  return { ok: true, discarded: result?.discarded ?? [], removed_commits: result?.removed_commits ?? [],
    accepted_tip: result?.accepted_tip ?? null };
}

// What each refusal means and the next step. Nothing was discarded in any of them.
const DISCARD_HINTS = Object.freeze({
  commit_not_pending: 'that commit is not pending on the accepted chain (it is live, already discarded, or unknown). Run /cynap-status to see the pending chain.',
  commit_unknown: 'the platform does not know that commit. Run /cynap-status to see the pending chain.',
  commit_orphaned: 'that commit was already discarded. Run /cynap-status, then /cynap-pull.',
  commit_activating: 'a commit in that range is activating right now. Wait for the activation to finish, check /cynap-status, then run /cynap-discard again if it is still pending.',
  forbidden_actor: 'you may discard only a range whose every commit you authored. Ask the Owner to discard it, or discard from a later commit that is all yours.',
  workspace_writes_frozen: 'workspace writes are frozen for this org. Nothing can be discarded until the freeze is lifted.',
});

const shortSha = (sha) => String(sha).slice(0, 12);
const listRows = (rows) => rows.map((row) => `  ${shortSha(row.sha)}  ${row.message ?? ''}`.trimEnd()).join('\n');

export function describeDiscard(result) {
  if (result?.dry_run) {
    return `would discard ${result.would_discard.length} commit(s), newest last:\n${listRows(result.would_discard)}\n` +
      'Nothing was discarded. Re-run without --dry-run to discard them.\n';
  }
  return `discarded ${result.discarded.length} commit(s):\n${listRows(result.discarded)}\n` +
    `accepted tip: ${result.accepted_tip ?? 'unknown'}\n` +
    'Next step: run /cynap-pull before editing, so your local base is the accepted tip again.\n';
}

export function describeDiscardRefusal(result) {
  const code = typeof result?.code === 'string' ? result.code : '';
  const text = formatRefusal(result, { command: 'cynap-discard' });
  const named = code && !text.includes(code) ? `cynap-discard: refused (${code})\n` : '';
  const hint = Object.hasOwn(DISCARD_HINTS, code) ? `Next step: ${DISCARD_HINTS[code]}\n` : '';
  return `${named}${text}${hint}`;
}

/** The line for an error thrown before any reply came back. A lost discard reply is not retried. */
export function describeDiscardCrash(error) {
  if (isProxyUnreachableError(error)) {
    return 'cynap-discard: failed (proxy_unreachable): the operator proxy is not reachable (it restarts after a plugin update). Run /cynap-status, then re-run /cynap-discard.\n';
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return 'cynap-discard: failed (outcome_unknown): no reply came back, so the discard may have landed. Run /cynap-status before retrying; a second discard of a discarded commit answers commit_orphaned.\n';
  }
  const reason = String(error?.message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  return `cynap-discard: failed${reason ? `: ${reason}` : ''}\n`;
}

export async function main(argv = process.argv.slice(2), { run = runDiscardFlow, out = process.stdout } = {}) {
  const { commitSha, reason, dryRun, json } = parseDiscardArgs(argv);
  const result = await run({ slug: resolveOrgSlug(), commitSha, reason, dryRun });
  if (json) out.write(`${JSON.stringify(result)}\n`);
  else out.write(result?.ok === true ? describeDiscard(result) : describeDiscardRefusal(result));
  if (result?.ok !== true) process.exitCode = result?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyGlobalFlags(import.meta.url);
  main().catch((error) => {
    process.stderr.write(describeDiscardCrash(error));
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  });
}
