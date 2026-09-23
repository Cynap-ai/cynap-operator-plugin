import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { probeProxyHealth, resolveWorkingDir, stablePortForSlug } from './connect.mjs';
import {
  CONTROL_FILE,
  CONTROL_HEADER,
  DISCONNECT_PATH,
} from '../bin/operator-proxy.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 100;
const STARTUP_DISCOVERY_TIMEOUT_MS = 2_000;

async function inspectProxy(slug) {
  return probeProxyHealth({ port: stablePortForSlug(slug) });
}

function hasLiveStartupReceipt(slug) {
  const pidPath = join(resolveWorkingDir(slug), 'proxy.pid');
  if (!existsSync(pidPath)) return false;
  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForLifecycle({
  slug,
  timeoutMs = STARTUP_DISCOVERY_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  inspect = inspectProxy,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const health = await inspect(slug);
    if (health) return health;
    await sleep(pollMs);
  }
  return null;
}

export async function requestProxyDisconnect({
  slug,
  controlPath = join(resolveWorkingDir(slug), CONTROL_FILE),
  fetchImpl = fetch,
}) {
  const port = stablePortForSlug(slug);
  let controlNonce;
  try {
    controlNonce = readFileSync(controlPath, 'utf8').trim();
  } catch {
    throw new Error(
      `operator disconnect: local control nonce is missing at ${controlPath}; ` +
        'restore the control file by running /cynap-connect again, then retry /cynap-disconnect.'
    );
  }
  if (!controlNonce) {
    throw new Error(
      `operator disconnect: local control nonce is missing at ${controlPath}; ` +
        'restore the control file by running /cynap-connect again, then retry /cynap-disconnect.'
    );
  }
  const response = await fetchImpl(`http://127.0.0.1:${port}${DISCONNECT_PATH}`, {
    method: 'POST',
    headers: { [CONTROL_HEADER]: controlNonce },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.stopped !== true) {
    throw new Error(`operator disconnect: managed shutdown failed (${response.status})`);
  }
  if (typeof body.credentialIssued !== 'boolean' || typeof body.credentialRevoked !== 'boolean') {
    throw new Error('operator disconnect: managed shutdown returned an invalid outcome');
  }
  return body;
}

async function waitForProxyDown({
  slug,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  inspect = inspectProxy,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!(await inspect(slug))) return true;
    await sleep(pollMs);
  }
  return false;
}

/**
 * Ask the tenant-proven local proxy to revoke its own credential and stop. This never
 * signals a PID obtained from an unauthenticated health response. The control listener
 * exists before browser PKCE begins, so a pending authorization is disconnectable too.
 */
export async function runOperatorDisconnect({
  slug: rawSlug,
  inspect = inspectProxy,
  hasStartupReceipt = hasLiveStartupReceipt,
  waitForLifecycle: waitForStarting = (input) => waitForLifecycle({ ...input, inspect }),
  requestDisconnect = requestProxyDisconnect,
  waitUntilDown = (input) => waitForProxyDown({ ...input, inspect }),
}) {
  const slug = rawSlug?.trim() ?? '';
  if (!slug) throw new Error('operator disconnect: org slug is required');

  let health = await inspect(slug);
  if (!health && hasStartupReceipt(slug)) {
    health = await waitForStarting({ slug, inspect });
    if (!health) {
      throw new Error(
        'operator disconnect: connector process exists but its managed control plane is unreachable'
      );
    }
  }
  if (!health) return { status: 'already_disconnected', slug };
  if (health.org !== slug) {
    throw new Error(
      `operator disconnect: local connector identity mismatch (expected ${slug}, got ${health.org ?? 'unknown'})`
    );
  }

  const outcome = await requestDisconnect({ slug });
  const stopped = await waitUntilDown({ slug });
  if (!stopped) throw new Error('operator disconnect: connector did not stop after managed shutdown');

  return {
    status: 'disconnected',
    slug,
    credentialIssued: outcome.credentialIssued,
    credentialRevoked: outcome.credentialRevoked,
    revocationWitness: outcome.revocationWitness ?? null,
  };
}
