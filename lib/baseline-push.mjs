// /cynap-push --baseline. The Owner's first checkpoint: the server assembles
// a byte-identical commit of the Org's live tree. This sends `{ intent:'baseline', expected_head_sha }`
// from `.cynap/state.json` and nothing else: it never reads the working directory or plans a push.
// It is a bootstrap, not a drift repair; drift is repaired with `/cynap-activate --reconcile`.

import { assertConnectedOrg, readState } from './workspace-sync.mjs';

/** The only flags `--baseline` combines with: where the workspace is, how to print, and the proxy. */
export const BASELINE_COMPATIBLE_FLAGS = new Set(['--baseline', '--dir', '--json', '--proxy-url']);

/** The bounded wait for the background assembly; past it the readback command is printed, never a re-send. */
export const BASELINE_WAIT_MS = 90_000;
export const BASELINE_POLL_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** True when the server predates the `baseline` intent: its schema refuses the enum or the missing changes. */
function isVersionSkew(text) {
  return /intent/i.test(text) && /(invalid|enum|expected|validation)/i.test(text);
}

function skewResult() {
  return {
    ok: false,
    reason: 'baseline_unsupported_server',
    message: 'this Cynap server does not support /cynap-push --baseline yet. Nothing was sent to the chain; try again after the platform update lands.',
  };
}

function readbackCommand(requestId) {
  return `/cynap-status --baseline ${requestId}`;
}

/** The counts the Owner approves, from the signed snapshot on the commit's approval view. */
function snapshotCounts(readBack) {
  const snapshot = readBack?.surface_approval?.baseline?.snapshot;
  if (!snapshot) return null;
  return {
    files: snapshot.entries.length,
    head_lacks: snapshot.consent.head_lacks.length,
    head_only: snapshot.consent.head_only.length,
    bytes_differ: snapshot.consent.bytes_differ.length,
    action_configs_failing: snapshot.consent.action_configs_failing.length,
  };
}

/**
 * Mints the baseline and waits a bounded time for its outcome. `call` is the MCP tool caller;
 * `sleepImpl` and `nowImpl` are injectable so tests never wait.
 */
export async function pushBaseline({ dir, org, call, sleepImpl = sleep, nowImpl = Date.now, onPhase = () => {} }) {
  const state = readState(dir);
  if (!state) return { ok: false, reason: 'no_state', message: `${dir}: no .cynap/state.json — run /cynap-pull first.` };
  assertConnectedOrg(state, org, dir);

  onPhase('requesting the baseline…');
  let minted;
  try {
    minted = await call('workspace_commit', { intent: 'baseline', expected_head_sha: state.base });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isVersionSkew(text)) return skewResult();
    throw error;
  }
  if (minted?.ok === false) {
    if (isVersionSkew(`${minted.code ?? ''} ${minted.message ?? ''}`) && !String(minted.code ?? '').startsWith('baseline_')) return skewResult();
    if (minted.code === 'parent_mismatch') {
      return { ok: false, reason: 'parent_mismatch', tip: minted.tip, message: 'the accepted tip moved — run /cynap-pull, then /cynap-push --baseline again.' };
    }
    return { ok: false, reason: minted.code, result: minted, message: `workspace_commit refused: ${minted.code}${minted.message ? ` — ${minted.message}` : ''}` };
  }
  const requestId = minted?.baseline_request_id;
  if (typeof requestId !== 'string') return skewResult();

  const deadline = nowImpl() + BASELINE_WAIT_MS;
  for (;;) {
    onPhase('assembling the baseline…');
    const status = await call('workspace_status', { baseline_request_id: requestId });
    const baseline = status?.baseline;
    if (baseline?.state === 'accepted') {
      const readBack = await call('workspace_get_commit', { sha: baseline.commit_sha });
      return {
        ok: true,
        baseline: true,
        requestId,
        commitSha: baseline.commit_sha,
        snapshotDigest: baseline.snapshot_digest,
        counts: snapshotCounts(readBack),
        portalPath: readBack?.next_action?.portal_path ?? null,
        nextAction: baseline.next_action,
      };
    }
    if (baseline?.state === 'refused' || baseline?.state === 'unknown_request') {
      return {
        ok: false,
        reason: baseline.code ?? baseline.state,
        result: baseline,
        message: `baseline refused: ${baseline.code ?? baseline.state}${baseline.path ? ` (${baseline.path})` : ''}${baseline.next_action ? ` — ${baseline.next_action}` : ''}`,
      };
    }
    if (nowImpl() >= deadline) {
      return { ok: true, baseline: true, pending: true, requestId, readback: readbackCommand(requestId) };
    }
    await sleepImpl(BASELINE_POLL_MS);
  }
}

/** The human lines for a baseline outcome (stdout); `--json` prints the result object instead. */
export function formatBaselineResult(result, mintHost) {
  if (result.pending) {
    return `baseline ${result.requestId} is still assembling. Read its outcome with: ${result.readback}\n`;
  }
  const lines = [`baseline committed ${result.commitSha} (snapshot ${result.snapshotDigest})`];
  if (result.counts) {
    const c = result.counts;
    lines.push(`  ${c.files} files; against the published head: ${c.head_lacks} it lacks, ${c.head_only} leave it, ${c.bytes_differ} differ`);
    if (c.action_configs_failing > 0) lines.push(`  ${c.action_configs_failing} action configs fail today's rules and keep the Org fenced until fixed`);
  }
  if (result.portalPath) lines.push(`approve: ${mintHost ?? ''}${result.portalPath}`);
  if (result.nextAction) lines.push(`next: ${result.nextAction}`);
  lines.push('A baseline is the first checkpoint only; drift is repaired with /cynap-activate --reconcile.');
  return `${lines.join('\n')}\n`;
}
