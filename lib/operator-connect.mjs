import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { PROXY_BUSY_STATUS, planConnect, probeProxyHealth } from './connect.mjs';
import { runOperatorDisconnect } from './operator-disconnect.mjs';

// PKCE's browser sign-in window is five minutes; leave room for the health
// poll to observe completion and report a useful handover failure.
export const DEFAULT_HEALTH_TIMEOUT_MS = 7 * 60 * 1000;
const DEFAULT_HEALTH_POLL_MS = 250;

function connectedResult(plan, health, reused, replaced) {
  return {
    status: 'connected',
    reused,
    slug: plan.slug,
    env: plan.env,
    personaRoute: 'operator_pkce',
    workingDir: plan.workingDir,
    mcpJsonPath: plan.mcpJsonPath,
    health,
    ...(replaced ? { replaced } : {}),
  };
}

function comparePluginVersions(left, right) {
  const parse = (value) => String(value ?? '0.0.0').match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? [0, 0, 0];
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Start the product-owned local connector as a detached process. The credential remains
 * inside the proxy; the project MCP file and launch receipt contain no token or cookie.
 */
export async function launchOperatorProxy(plan, { spawnImpl = spawn } = {}) {
  if (!Array.isArray(plan.proxyArgv) || plan.proxyArgv.length === 0) {
    throw new Error('operator connect: proxy argv is missing');
  }

  const [proxyPath, ...args] = plan.proxyArgv;
  const logPath = join(plan.workingDir, 'proxy.log');
  const pidPath = join(plan.workingDir, 'proxy.pid');
  const logFd = openSync(logPath, 'a');
  const logOffset = fstatSync(logFd).size;
  const launchedAt = new Date().toISOString();
  try {
    const child = spawnImpl(process.execPath, [proxyPath, ...args], {
      cwd: plan.workingDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error('operator connect: proxy did not return a process id');
    }
    writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });
    return { pid: child.pid, launchedAt, logPath, logOffset, pidPath, child };
  } finally {
    closeSync(logFd);
  }
}

/**
 * True when a healthy proxy that is NOT the process this connect launched may
 * still stand in for it: the self-update successor of the proxy that held the
 * port (it restarts from the same launch record under a new pid, after our own
 * launch lost the bind), or a SessionStart relaunch. Either is acceptable only
 * if it started after our launch and runs at least this session's plugin — an
 * older proxy still squatting the port stays a refusal.
 */
export function isAcceptableSuccessor(health, { launchedAt, pluginVersion }) {
  if (!launchedAt || !pluginVersion) return false;
  const started = Date.parse(health.startedAt ?? '');
  if (!Number.isFinite(started) || started < Date.parse(launchedAt)) return false;
  return comparePluginVersions(health.pluginVersion, pluginVersion) >= 0;
}

/** Wait until the connector proves both liveness and the expected org/environment. */
export async function waitForOperatorHealth({
  plan,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  pollMs = DEFAULT_HEALTH_POLL_MS,
  probe = probeProxyHealth,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  expectedPid,
  launchedAt,
  pluginVersion,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const health = await probe({ port: plan.port });
    if (health?.status === PROXY_BUSY_STATUS) {
      await sleep(pollMs);
      continue;
    }
    if (health) {
      if (health.org !== plan.slug || health.env !== plan.env) {
        throw new Error(
          `operator connect: local connector identity mismatch ` +
            `(expected ${plan.slug}/${plan.env}, got ${health.org ?? 'unknown'}/${health.env ?? 'unknown'})`
        );
      }
      if (health.status === 'login_timed_out') {
        throw new Error(
          'operator connect: the browser sign-in timed out — nobody approved it. Run /cynap-connect again ' +
            'and approve the sign-in page.'
        );
      }
      if (health.ok !== true || health.status === 'authorizing') {
        await sleep(pollMs);
        continue;
      }
      if (expectedPid && health.pid !== expectedPid && !isAcceptableSuccessor(health, { launchedAt, pluginVersion })) {
        throw new Error(
          `operator connect: healthy proxy pid ${health.pid ?? 'unknown'} did not match launched pid ${expectedPid}`
        );
      }
      return health;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `operator connect: browser sign-in timed out or the local connector did not become healthy; ` +
      `inspect ${join(plan.workingDir, 'proxy.log')}`
  );
}

function consentHandoverHint(workingDir, logOffset = 0) {
  const logPath = join(workingDir, 'proxy.log');
  try {
    // Only what this launch wrote: an earlier launch's consent URL has expired.
    const log = readFileSync(logPath).subarray(logOffset).toString('utf8');
    const urls = [...log.matchAll(/https?:\/\/[^\s"'<>]+\/operator-cli\/authorize\?[^\s"'<>]+/g)];
    const url = urls.at(-1)?.[0]?.replace(/[),.;]+$/, '');
    if (url) return `\nConsent is pending or failed. Open this URL and approve it in the browser:\n${url}`;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return `\nConsent may be pending or failed. Approve it in the browser; inspect ${logPath} for the consent URL.`;
    }
  }
  return `\nConsent may be pending or failed. Approve it in the browser; inspect ${logPath} for the consent URL.`;
}

function withHandoverHint(error, workingDir, logOffset = 0) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Consent (?:is|may be) pending or failed/.test(message)) return error;
  if (!/sign-in|login.*timed out|did not become healthy|authorizing/i.test(message)) return error;
  return new Error(`${message}${consentHandoverHint(workingDir, logOffset)}`, { cause: error });
}

/** Retire the running connector through its managed control plane, and refuse
 * to continue unless any credential it held is proven revoked. */
async function retireConnector(disconnect, slug) {
  const retired = await disconnect({ slug });
  if (retired.status !== 'disconnected' || (retired.credentialIssued && retired.credentialRevoked !== true)) {
    throw new Error(
      `Could not revoke the connector's credential (expires ${retired.credExpiresAt ?? 'unknown'}); ` +
        'nothing was replaced. Retry /cynap-connect.'
    );
  }
  return retired;
}

/**
 * Stable product seam for portal/install journeys and `/cynap-connect`.
 *
 * It owns the full local half of the journey: materialize one org workspace, choose the
 * operator-PKCE auth mode, launch/reuse the refresh proxy, and return only after `/health`
 * proves the expected tenant. It never calls the generic Cynap app/device authorization path.
 */
export async function runOperatorConnect({
  slug,
  env = 'prod',
  proxyPath,
  pluginVersion,
  plan = planConnect,
  launch = launchOperatorProxy,
  waitForHealth = waitForOperatorHealth,
  disconnect = runOperatorDisconnect,
}) {
  if (!pluginVersion) {
    throw new Error('operator connect: pluginVersion is required (read fresh from plugin.json by the caller)');
  }
  const connectPlan = await plan({ slug, env, proxyPath });
  const waitWithHandover = async (options, logOffset = 0) => {
    try {
      return await waitForHealth(options);
    } catch (error) {
      throw withHandoverHint(error, connectPlan.workingDir, logOffset);
    }
  };
  const waitForLaunched = (launched) =>
    waitWithHandover(
      { plan: connectPlan, expectedPid: launched.pid, launchedAt: launched.launchedAt, pluginVersion },
      launched.logOffset
    );
  const launchAndWait = async () => {
    const launched = await launch(connectPlan);
    try {
      return { launched, health: await waitForLaunched(launched) };
    } catch (error) {
      if (launched.child?.exitCode === null && launched.child?.signalCode === null) {
        launched.child.kill('SIGTERM');
      }
      throw withHandoverHint(error, connectPlan.workingDir, launched.logOffset);
    }
  };

  if (connectPlan.env === 'prod' && connectPlan.authMode !== 'interactive') {
    throw new Error(
      'operator connect: production connections must launch the operator PKCE route'
    );
  }
  if (connectPlan.action === 'conflict') {
    throw new Error(`operator connect: ${connectPlan.actionReason ?? 'local connector conflict'}`);
  }
  if (connectPlan.action === 'relaunch') {
    // A proxy whose sign-in timed out: retire it through the managed control
    // plane (revoking anything it holds), then start a fresh sign-in.
    await retireConnector(disconnect, connectPlan.slug);
    const { health } = await launchAndWait();
    return connectedResult(connectPlan, health, false);
  }
  if (connectPlan.action === 'reuse' || connectPlan.action === 'wait') {
    // A busy port carries no identity, so judge the proxy that answers once it
    // is free. An authorizing lease already reports its identity and version:
    // judge it now, so a newer connector refuses at once instead of after a
    // sign-in nobody is going to approve.
    const probed = connectPlan.health;
    const current = probed?.status === PROXY_BUSY_STATUS ? await waitWithHandover({ plan: connectPlan }) : probed;
    if (connectPlan.env === 'prod' && current?.authMode !== 'interactive') {
      throw new Error(
        'operator connect: existing connector is not a proven operator PKCE proxy; disconnect it and retry'
      );
    }
    const versionOrder = comparePluginVersions(current?.pluginVersion, pluginVersion);
    if (versionOrder > 0) {
      throw new Error(
        `operator connect: this session runs plugin ${pluginVersion}; the connector already runs ` +
          `${current?.pluginVersion ?? 'unknown'}. Run /reload-plugins and retry.`
      );
    }
    if (versionOrder < 0 || !current?.pluginVersion) {
      const retired = await retireConnector(disconnect, connectPlan.slug);
      const { health } = await launchAndWait();
      return connectedResult(connectPlan, health, false, {
        from: current?.pluginVersion ?? 'unknown',
        to: pluginVersion,
        credentialRevoked: retired.credentialRevoked,
      });
    }
    const health = connectPlan.action === 'wait' && current === probed ? await waitWithHandover({ plan: connectPlan }) : current;
    return connectedResult(connectPlan, health, true);
  }
  if (connectPlan.action !== 'launch') {
    throw new Error(`operator connect: unsupported plan action ${String(connectPlan.action)}`);
  }

  const { health } = await launchAndWait();
  return connectedResult(connectPlan, health, false);
}
