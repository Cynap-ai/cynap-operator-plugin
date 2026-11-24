// the CLI side of the proxy's activation run object. The CLI starts a run with one
// POST, then reads it with short GETs; no request is held open across the Owner's consent wait, so
// a dropped loopback connection costs one retry, never the activation.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkingDir, stablePortForSlug } from './connect.mjs';
import { unwrapToolEnvelope } from './format-refusal.mjs';
import { ACTIVATE_PATH, ACTIVATION_OUTCOMES, CONTROL_FILE, CONTROL_HEADER } from '../bin/operator-proxy.mjs';

/** Connection-class failures a restarting or briefly busy proxy produces. Anything else is real. */
export const CONNECTION_RETRY_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNREFUSED']);
export const CONNECTION_RETRIES = 3;
export const CONNECTION_RETRY_WINDOW_MS = 10_000;
/** How often the CLI reads its run, and how long it follows one: the 15-minute consent window,
 * the review-readiness wait and the proxy's own call deadlines all end inside it. */
export const RUN_POLL_MS = 2000;
export const RUN_WAIT_MS = 20 * 60 * 1000;
/** How often the CLI reads an accepted grant, and the slack past its `run_deadline`. */
export const GRANT_POLL_MS = 5000;
export const GRANT_DEADLINE_SLACK_MS = 60 * 1000;
const GRANT_FALLBACK_WAIT_MS = 35 * 60 * 1000;

export const GRANT_TERMINAL = new Set(['completed', 'stopped', 'expired']);
const RUN_TERMINAL = new Set(ACTIVATION_OUTCOMES);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The proxy stayed unreachable through every retry. `causeCode` is the last socket error. */
export class ProxyUnreachableError extends Error {
  constructor(causeCode, runId = null) {
    super(runId
      ? `the operator proxy stopped answering (${causeCode}); activation run ${runId} may still be waiting for the Owner. Run /cynap-status, then re-run the same /cynap-activate to attach to it.`
      : `the operator proxy is not reachable (${causeCode}); it restarts after a plugin update. Run /cynap-status, then re-run /cynap-activate.`);
    this.name = 'ProxyUnreachableError';
    this.code = 'proxy_unreachable';
    this.causeCode = causeCode;
    this.runId = runId;
  }
}

export function connectionCode(error) {
  const code = error?.cause?.code ?? error?.code;
  return typeof code === 'string' && CONNECTION_RETRY_CODES.has(code) ? code : null;
}

/** One proxy call. A connection-class error is retried at most three times within ten seconds. */
export async function callProxy(call, { wait = sleep, now = Date.now, runId = null } = {}) {
  const started = now();
  for (let retries = 0; ; retries += 1) {
    try {
      return await call();
    } catch (error) {
      const code = connectionCode(error);
      if (!code) throw error;
      const delay = 500 * 2 ** retries;
      if (retries >= CONNECTION_RETRIES || now() - started + delay > CONNECTION_RETRY_WINDOW_MS) {
        throw new ProxyUnreachableError(code, runId);
      }
      await wait(delay);
    }
  }
}

function readNonce(slug) {
  const nonce = readFileSync(join(resolveWorkingDir(slug), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('operator activation: local control nonce is missing; run /cynap-connect again.');
  return nonce;
}

const proxyBase = (slug) => `http://127.0.0.1:${stablePortForSlug(slug)}`;

/**
 * Start (or attach to) the run for this request and follow it to a terminal state. A run still
 * waiting for consent is reported as waiting, never as failed.
 */
export async function runActivation({
  slug, body, fetchImpl = fetch, wait = sleep, now = Date.now, pollMs = RUN_POLL_MS, waitMs = RUN_WAIT_MS,
  onProgress = () => {},
}) {
  const nonce = readNonce(slug);
  const headers = { [CONTROL_HEADER]: nonce };
  // One id for every retry of this POST: a lost 202 followed by a fast run must answer that run,
  // never start a second consent.
  const attemptBody = JSON.stringify({ ...body, attempt_id: randomBytes(16).toString('hex') });
  const started = await callProxy(() => fetchImpl(`${proxyBase(slug)}${ACTIVATE_PATH}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: attemptBody,
  }), { wait, now });
  const startBody = await started.json().catch(() => null);
  if (started.status !== 202 || typeof startBody?.run_id !== 'string') {
    return { state: 'refused', code: startBody?.error ?? 'activation_unavailable',
      ...(startBody?.message ? { message: startBody.message } : {}),
      ...(startBody?.run_id ? { run_id: startBody.run_id } : {}) };
  }
  const runId = startBody.run_id;
  if (startBody.attached) onProgress({ run_id: runId, attached: true, state: startBody.state });
  const began = now();
  let seen = '';
  for (;;) {
    const response = await callProxy(() => fetchImpl(`${proxyBase(slug)}${ACTIVATE_PATH}/${runId}`, { headers }),
      { wait, now, runId });
    const run = await response.json().catch(() => null);
    if (response.status === 404) return { state: 'refused', code: 'activation_run_not_found', run_id: runId };
    if (response.status !== 200 || !run) return { state: 'refused', code: run?.error ?? 'activation_unavailable', run_id: runId };
    const marker = `${run.state}/${run.review ?? ''}`;
    if (marker !== seen) {
      seen = marker;
      onProgress(run);
    }
    if (RUN_TERMINAL.has(run.state)) return run;
    if (now() - began + pollMs > waitMs) return { ...run, state: 'consent_pending', waited_out: true };
    await wait(pollMs);
  }
}

/** One `workspace_status` read for an exact grant id through the local proxy. */
async function readGrant({ slug, activationGrantId, fetchImpl, wait, now }) {
  const response = await callProxy(() => fetchImpl(`${proxyBase(slug)}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'workspace_status', arguments: { activation_grant_id: activationGrantId } } }),
  }), { wait, now });
  const status = unwrapToolEnvelope(await response.json().catch(() => null));
  const grant = status?.activation_grant;
  return grant && grant.id === activationGrantId ? grant : null;
}

/**
 * Follow an accepted grant until `completed`, `stopped` or `expired`. The wait cap is the server's
 * `run_deadline` plus slack; a grant still running past it is reported as such, never guessed.
 */
export async function followGrant({
  slug, activationGrantId, fetchImpl = fetch, wait = sleep, now = Date.now, pollMs = GRANT_POLL_MS,
  onStep = () => {},
}) {
  const began = now();
  let lastStep = null;
  for (;;) {
    const grant = await readGrant({ slug, activationGrantId, fetchImpl, wait, now });
    const step = grant ? `${grant.cursor}/${grant.status}` : null;
    if (step && step !== lastStep) {
      lastStep = step;
      onStep(grant);
    }
    if (grant && GRANT_TERMINAL.has(grant.status)) return grant;
    const deadline = Date.parse(grant?.run_deadline ?? '');
    const cap = Number.isFinite(deadline) ? deadline + GRANT_DEADLINE_SLACK_MS : began + GRANT_FALLBACK_WAIT_MS;
    if (now() + pollMs > cap) return { ...(grant ?? { id: activationGrantId }), status: grant?.status ?? 'unknown', waited_out: true };
    await wait(pollMs);
  }
}

/**
 * The `--json` shape for a chain: `{state, through, members:[{sha, position, outcome}],
 * stopped?:{at_position, reason, remaining:[sha]}}`. Positions before the cursor activated; the
 * cursor's member is where a stopped grant stopped; the rest never ran.
 */
export function chainReport({ through, members, grant, state }) {
  const shas = Array.isArray(members) ? members : [];
  const cursor = Number.isInteger(grant?.cursor) ? grant.cursor : 0;
  const ended = grant && (grant.status === 'stopped' || grant.status === 'expired');
  const report = {
    state,
    through,
    members: shas.map((sha, position) => ({
      sha,
      position,
      outcome: position < cursor ? 'activated' : ended && position === cursor ? grant.status : 'pending',
    })),
  };
  if (ended && cursor < shas.length) {
    report.stopped = { at_position: cursor, reason: grant.stopped_reason ?? grant.status, remaining: shas.slice(cursor) };
  }
  return report;
}
