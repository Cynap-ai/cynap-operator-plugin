import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { planConnect, probeProxyHealth } from './connect.mjs';
import { runOperatorDisconnect } from './operator-disconnect.mjs';

const DEFAULT_HEALTH_TIMEOUT_MS = 5 * 60 * 1000;
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
    return { pid: child.pid, logPath, pidPath, child };
  } finally {
    closeSync(logFd);
  }
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
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const health = await probe({ port: plan.port });
    if (health) {
      if (health.org !== plan.slug || health.env !== plan.env) {
        throw new Error(
          `operator connect: local connector identity mismatch ` +
            `(expected ${plan.slug}/${plan.env}, got ${health.org ?? 'unknown'}/${health.env ?? 'unknown'})`
        );
      }
      if (health.ok !== true || health.status === 'authorizing') {
        await sleep(pollMs);
        continue;
      }
      if (expectedPid && health.pid !== expectedPid) {
        throw new Error(
          `operator connect: healthy proxy pid ${health.pid ?? 'unknown'} did not match launched pid ${expectedPid}`
        );
      }
      return health;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `operator connect: local connector did not become healthy; inspect ${join(plan.workingDir, 'proxy.log')}`
  );
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

  if (connectPlan.env === 'prod' && connectPlan.authMode !== 'interactive') {
    throw new Error(
      'operator connect: production connections must launch the operator PKCE route'
    );
  }
  if (connectPlan.action === 'conflict') {
    throw new Error(`operator connect: ${connectPlan.actionReason ?? 'local connector conflict'}`);
  }
  if (connectPlan.action === 'reuse' || connectPlan.action === 'wait') {
    if (connectPlan.env === 'prod' && connectPlan.health?.authMode !== 'interactive') {
      throw new Error(
        'operator connect: existing connector is not a proven operator PKCE proxy; disconnect it and retry'
      );
    }
    const versionOrder = comparePluginVersions(connectPlan.health?.pluginVersion, pluginVersion);
    if (versionOrder > 0) {
      throw new Error(
        `operator connect: this session runs plugin ${pluginVersion}; the connector already runs ` +
          `${connectPlan.health?.pluginVersion ?? 'unknown'}. Run /reload-plugins and retry.`
      );
    }
    if (versionOrder < 0 || !connectPlan.health?.pluginVersion) {
      const retired = await disconnect({ slug: connectPlan.slug });
      if (retired.status !== 'disconnected' || (retired.credentialIssued && retired.credentialRevoked !== true)) {
        throw new Error(
          `Could not revoke the connector's credential (expires ${retired.credExpiresAt ?? 'unknown'}); ` +
            'nothing was replaced. Retry /cynap-connect.'
        );
      }
      const launched = await launch(connectPlan);
      const health = await waitForHealth({ plan: connectPlan, expectedPid: launched.pid });
      return connectedResult(connectPlan, health, false, {
        from: connectPlan.health?.pluginVersion ?? 'unknown',
        to: pluginVersion,
        credentialRevoked: retired.credentialRevoked,
      });
    }
    const health =
      connectPlan.action === 'wait'
        ? await waitForHealth({ plan: connectPlan })
        : connectPlan.health;
    return connectedResult(connectPlan, health, true);
  }
  if (connectPlan.action !== 'launch') {
    throw new Error(`operator connect: unsupported plan action ${String(connectPlan.action)}`);
  }

  const launched = await launch(connectPlan);
  try {
    const health = await waitForHealth({ plan: connectPlan, expectedPid: launched.pid });
    return connectedResult(connectPlan, health, false);
  } catch (error) {
    if (launched.child?.exitCode === null && launched.child?.signalCode === null) {
      launched.child.kill('SIGTERM');
    }
    throw error;
  }
}
