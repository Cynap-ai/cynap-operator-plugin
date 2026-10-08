#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describeReady, readinessOf } from '../lib/activation-readiness.mjs';
import { probeProxyHealth, stablePortForSlug } from '../lib/connect.mjs';
import { formatNextAction, formatRefusal, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { assertConnectedOrg, mcpCall, readState, resolveOrgSlug, resolveWorkspaceDir, STATE_REL_PATH } from '../lib/workspace-sync.mjs';

export function parseStatusArgs(argv) {
  if (argv.length === 0) return { dir: null, json: false };
  const args = { dir: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir' && argv[i + 1]) args.dir = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else throw new Error('Usage: cynap-status.mjs [--dir <workspace>] [--json]');
  }
  return args;
}

export async function status({ cwd = process.cwd(), argv = [], fetchImpl = fetch, probe = probeProxyHealth } = {}) {
  const args = parseStatusArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const root = resolveWorkspaceDir({ cwd, dir: args.dir, org });
  const statePath = join(root, STATE_REL_PATH);
  const state = existsSync(statePath) ? readState(root) : null;
  if (state) assertConnectedOrg(state, org, root);
  const workspace = { org, root: state ? root : null, statePath: state ? statePath : null };
  const operatorHome = join(homedir(), 'CynapOperator');
  const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  const slugs = existsSync(operatorHome) ? readdirSync(operatorHome).filter((slug) => existsSync(join(operatorHome, slug, '.mcp.json'))) : [];
  if (!slugs.includes(org)) slugs.push(org);
  const proxies = await Promise.all(slugs.map(async (slug) => ({ slug, port: stablePortForSlug(slug),
    health: await probe({ port: stablePortForSlug(slug), fetchImpl }) })));
  const selected = proxies.find((item) => item.slug === org);
  if (!selected.health?.ok) return { ok: false, reason: 'proxy_down', org, workspace, proxies, installedVersion: manifest.version,
    message: `the ${org} proxy is not healthy — run /cynap-connect ${org}.` };
  const platform = await mcpCall(`http://127.0.0.1:${selected.port}/mcp`, 'workspace_status', {}, { fetchImpl });
  if (platform?.ok === false) return { ok: false, reason: platform.code, result: platform, org, workspace, proxies, installedVersion: manifest.version, message: platform.message };
  return { ok: true, org, workspace, proxies, platform, installedVersion: manifest.version, localBase: state?.base ?? null,
    behind: Boolean(state && state.base !== platform.accepted_tip) };
}

export function formatStatus(result) {
  const lines = [];
  for (const proxy of result.proxies ?? []) {
    const health = proxy.health;
    lines.push(`${proxy.slug}: ${health?.ok ? 'UP' : 'DOWN'} on ${proxy.port}${health?.pluginVersion ? `, plugin ${health.pluginVersion}` : ''}${health?.pid ? `, pid ${health.pid}` : ''}${health?.startedAt ? `, since ${health.startedAt}` : ''}${health?.credExpiresInHours != null ? `, credential ${health.credExpiresInHours}h left` : ''}${health?.ok && health.pluginVersion !== result.installedVersion ? ' — STALE BUILD; reconnect to load the installed plugin' : ''}`);
  }
  if (!result.ok) return `${lines.join('\n')}\n${formatRefusal(result, { command: 'cynap-status' })}`;
  const s = result.platform;
  lines.push(`workspace: ${result.workspace.root ?? '(unresolved)'} (${result.org})`);
  // name the live commit and whether it is serving, not "deployed" (that only ever meant
  // a content manifest exists).
  const liveCommit = s.base_ref?.kind === 'commit' ? s.base_ref.value : null;
  lines.push(`live commit: ${liveCommit ?? (s.base_ref ? 'none (no commit activated yet)' : 'unknown')}`);
  lines.push(liveCommit ? describeReady(readinessOf(s, liveCommit)) : 'ready: unknown');
  if (s.accepted_tip && s.accepted_tip !== liveCommit) lines.push(`tip ${s.accepted_tip}: accepted, not activated`);
  // The digest hashes classified config files only; a handler-code activation leaves it unchanged,
  // so it never stands in for what is serving. The live commit above is that.
  lines.push(`config digest: ${s.live_digest ?? 'none'} (config files only; handler code is not in it)`);
  if (s.deployment_state === 'degraded') lines.push('live deployment identity could not be read reliably; inspect the platform before activation');
  if (s.last_failure) lines.push(`last failure: ${s.last_failure.code ?? s.last_failure.reason ?? JSON.stringify(s.last_failure)}`);
  if (s.frozen) lines.push('chain frozen: recovery currently needs a platform admin.');
  const chain = Array.isArray(s.chain) ? s.chain : [];
  lines.push(`pending chain: ${chain.length}`);
  for (const commit of chain) {
    const activation = s.pending?.find((entry) => entry.commit_sha === commit.sha);
    const action = activation?.next_action;
    lines.push(`  ${commit.sha} by ${commit.author_id ?? activation?.author ?? 'unknown'}: ${activation?.state ?? 'pending'}${action?.kind === 'blocked_by_chain' ? ` (blocked by ${action.next_commit_sha})` : ''}`);
    const next = formatNextAction(action);
    if (next) lines.push(`    ${next.replaceAll('\n', '\n    ')}`);
    else if (action?.kind) lines.push(`    next: ${action.kind}${action.reason ? ` — ${action.reason}` : ''}`);
  }
  if (result.behind) lines.push(`local base ${result.localBase ?? 'none'} is behind the accepted tip — pull before editing.`);
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await status({ argv });
  process.stdout.write(argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result));
  if (!result.ok) process.exitCode = result.reason === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
