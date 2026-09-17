#!/usr/bin/env node
// CYN-1999 §8.1. The original PR-time projected-tree probe remains below. The
// post-publish mode is a five-leg public-mirror journey, with command seams so
// its decisions can be unit-tested without network access.

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

// mirror-projection.mjs is build machinery and, by design, never leaves the
// private monorepo (see scripts/mirror-projection.mjs's INCLUDED_SCRIPT_FILES
// comment). This module DOES ship -- it is the post-publish journey the
// published mirror runs against itself -- so it cannot hold a static import
// of a module the shipped tree does not contain: Node evaluates top-level
// imports eagerly, which is exactly what broke `--post-publish` on a fresh
// mirror clone (CYN-1999 fix-forward, run 35235475068). The only caller of
// this pair, runCleanMachineSmoke() below, runs ONLY the PR-time
// local-projection leg inside this private repo -- never `--post-publish` --
// so the import is deferred until that call, and its absence in the shipped
// tree is inert.

const MARKETPLACE_NAME = 'cynap-operator-plugin';
const PLUGIN_ID = `cynap-operator@${MARKETPLACE_NAME}`;
const MIRROR_CACHE_SEGMENT = join('.claude', 'plugins', 'cache', MARKETPLACE_NAME);
const LEGACY_REPLAY_TAG = 'v0.13.0';
const JOURNEY_SLUG = 'clean-machine-smoke';

class NotRun extends Error {}

function semverParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const left = semverParts(a);
  const right = semverParts(b);
  if (!left || !right) throw new Error(`clean-machine-smoke: invalid stable semver comparison (${a}, ${b})`);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function selectPreviousReleaseTag(tags, currentVersion) {
  return tags
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => compareVersions(tag.slice(1), currentVersion) < 0)
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0] ?? null;
}

export function parsePluginList(text) {
  let value;
  try {
    value = JSON.parse(String(text));
  } catch {
    throw new Error('clean-machine-smoke: `claude plugin list --json` did not return valid JSON');
  }
  if (!Array.isArray(value)) throw new Error('clean-machine-smoke: `claude plugin list --json` must return an array');
  return value;
}

export function assertInstalledPlugin({ records, expectedVersion, homeDir }) {
  const record = records.find((candidate) => candidate?.id === PLUGIN_ID);
  if (!record) throw new Error(`clean-machine-smoke: ${PLUGIN_ID} is absent from plugin list JSON`);
  if (record.version !== expectedVersion) {
    throw new Error(`clean-machine-smoke: ${PLUGIN_ID} expected version ${expectedVersion}, got ${String(record.version)}`);
  }
  if (typeof record.installPath !== 'string' || record.installPath.length === 0) {
    throw new Error('clean-machine-smoke: installed plugin record has no installPath');
  }
  const expectedCache = resolve(homeDir, MIRROR_CACHE_SEGMENT);
  const installedPath = resolve(record.installPath);
  if (!isAbsolute(installedPath) || relative(expectedCache, installedPath).startsWith('..')) {
    throw new Error(`clean-machine-smoke: installPath ${record.installPath} is not under the ${MARKETPLACE_NAME} mirror cache`);
  }
  return record;
}

export function assertInstalledTreeDigests({ installedPath, mirrorDir }) {
  const manifest = JSON.parse(readFileSync(join(mirrorDir, 'projection-manifest.json'), 'utf8'));
  if (!manifest.files || typeof manifest.files !== 'object' || Object.keys(manifest.files).length === 0) {
    throw new Error('clean-machine-smoke: projected tag has no digest manifest files');
  }
  for (const [file, expectedDigest] of Object.entries(manifest.files)) {
    const installedFile = join(installedPath, file);
    if (!existsSync(installedFile)) throw new Error(`clean-machine-smoke: installed mirror is missing ${file}`);
    const actualDigest = createHash('sha256').update(readFileSync(installedFile)).digest('hex');
    if (actualDigest !== expectedDigest) throw new Error(`clean-machine-smoke: installed digest differs for ${file}`);
  }
}

function commandOutput(execFileSyncImpl, command, args, options) {
  const output = execFileSyncImpl(command, args, { encoding: 'utf8', ...options });
  return typeof output === 'string' ? output : Buffer.from(output ?? '').toString('utf8');
}

function failureText(error) {
  return [error?.stdout, error?.stderr, error?.message]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => Buffer.isBuffer(part) ? part.toString('utf8') : String(part)).join('\n');
}

function expectCommandFailure(run, expected) {
  try {
    run();
  } catch (error) {
    const output = failureText(error);
    if (expected.test(output)) return output;
    throw new Error(`clean-machine-smoke: command failed without ${expected}: ${output}`);
  }
  throw new Error(`clean-machine-smoke: command unexpectedly succeeded; expected ${expected}`);
}

function taggedMirrorUrl(mirrorRepo, tag) {
  // CONFIRMED on a real GitHub runner (publish run 35241891876, CYN-1999
  // fix-forward #3): `#vX` pins marketplace add to this exact immutable Git
  // tag, including for the ANNOTATED tags this repo actually creates
  // (`.github/workflows/publish-operator-plugin.yml`'s `git tag -a`). The
  // `claude` CLI logs a benign warning while resolving the tag object to its
  // commit ("refs/tags/vX … is not a commit") but installs correctly — legs
  // 1-3 of the post-publish journey passed against it. No code here needs to
  // handle the peel; the CLI already does.
  return `https://github.com/${mirrorRepo}.git#${tag}`;
}

function annotation(stdout, kind, title, message) {
  stdout.write(`::${kind} title=${title}::${message.replace(/\r?\n/g, ' ')}\n`);
}

async function withFreshHome(run) {
  const homeDir = mkdtempSync(join(tmpdir(), 'cynap-operator-clean-home-'));
  try {
    return await run(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

function withHome(homeDir, baseEnv) {
  return { ...baseEnv, HOME: homeDir };
}

function listInstalled({ claudeBin, execFileSyncImpl, env }) {
  return parsePluginList(commandOutput(execFileSyncImpl, claudeBin, ['plugin', 'list', '--json'], { env }));
}

function installPinnedTag({ tag, expectedVersion, mirrorRepo, claudeBin, execFileSyncImpl, env, homeDir }) {
  commandOutput(execFileSyncImpl, claudeBin, ['plugin', 'marketplace', 'add', taggedMirrorUrl(mirrorRepo, tag)], { env });
  commandOutput(execFileSyncImpl, claudeBin, ['plugin', 'install', PLUGIN_ID, '--yes'], { env });
  return assertInstalledPlugin({ records: listInstalled({ claudeBin, execFileSyncImpl, env }), expectedVersion, homeDir });
}

function removeMarketplace({ claudeBin, execFileSyncImpl, env }) {
  commandOutput(execFileSyncImpl, claudeBin, ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], { env });
  // PROBE OWED: confirm whether removal deletes an old cache path while a
  // running proxy still has it open. The handover must not depend on retention.
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!address || typeof address === 'string') throw new Error('clean-machine-smoke: could not reserve a loopback port');
  return address.port;
}

async function waitForHealth(port, expectedVersion) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const health = await response.json();
        if (health.status !== 'authorizing') throw new Error(`clean-machine-smoke: no-login proxy is ${health.status}, not authorizing`);
        if (expectedVersion && health.pluginVersion !== expectedVersion) {
          throw new Error(`clean-machine-smoke: proxy expected ${expectedVersion}, got ${health.pluginVersion}`);
        }
        return health;
      }
    } catch (error) {
      if (String(error).includes('no-login proxy')) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`clean-machine-smoke: proxy did not expose /health on ${port}`);
}

function childExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('clean-machine-smoke: proxy did not exit after managed retire')), timeoutMs);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolvePromise({ code, signal }); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

async function startAuthorizingProxy({
  pluginPath, port, homeDir, slug = JOURNEY_SLUG, expectedVersion, reportedVersion, spawnImpl = spawn,
}) {
  const workDir = join(homeDir, 'CynapOperator', slug);
  mkdirSync(workDir, { recursive: true });
  const launcherPath = join(pluginPath, 'bin', 'operator-proxy-launcher.mjs');
  const proxyPath = !reportedVersion && existsSync(launcherPath) ? launcherPath : join(pluginPath, 'bin', 'operator-proxy.mjs');
  const versionArgs = reportedVersion ? ['--plugin-version', reportedVersion] : [];
  const child = spawnImpl(process.execPath, [proxyPath, '--port', String(port), '--prod', '--org-slug', slug, ...versionArgs], {
    cwd: workDir, env: withHome(homeDir, process.env), stdio: 'ignore',
  });
  await waitForHealth(port, expectedVersion);
  return { child, port, workDir, proxyPath };
}

async function retireProxy(proxy) {
  const noncePath = join(proxy.workDir, '.operator-control');
  const nonce = readFileSync(noncePath, 'utf8').trim();
  if (!nonce) throw new Error(`clean-machine-smoke: proxy control nonce missing at ${noncePath}`);
  const response = await fetch(`http://127.0.0.1:${proxy.port}/disconnect`, {
    method: 'POST', headers: { 'x-cynap-operator-control': nonce }, signal: AbortSignal.timeout(10_000),
  });
  const outcome = await response.json();
  if (!response.ok || outcome.stopped !== true || outcome.credentialRevoked !== true) {
    throw new Error(`clean-machine-smoke: managed proxy retire failed: ${JSON.stringify(outcome)}`);
  }
  await childExit(proxy.child);
  return outcome;
}

async function stopOwnedProxy(proxy) {
  if (!proxy?.child || proxy.child.exitCode !== null) return;
  try {
    await retireProxy(proxy);
  } catch {
    proxy.child.kill('SIGTERM');
    await childExit(proxy.child, 2_000).catch(() => {});
  }
}

function writeLaunchRecord(proxy) {
  const record = {
    slug: JOURNEY_SLUG, env: 'prod', authMode: 'interactive', port: proxy.port,
    proxyArgv: [proxy.proxyPath, '--port', String(proxy.port), '--prod', '--org-slug', JOURNEY_SLUG],
    launchCommand: `node ${proxy.proxyPath} --port ${proxy.port} --prod --org-slug ${JOURNEY_SLUG}`,
  };
  writeFileSync(join(proxy.workDir, 'proxy-launch.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function runInstallCurrentLeg(ctx) {
  return withFreshHome(async (homeDir) => {
    const env = withHome(homeDir, ctx.baseEnv);
    const current = installPinnedTag({ tag: `v${ctx.currentVersion}`, expectedVersion: ctx.currentVersion, homeDir, env, ...ctx });
    assertInstalledTreeDigests({ installedPath: current.installPath, mirrorDir: ctx.mirrorDir });
  });
}

async function runUpgradeLeg(ctx, tag, { legacyReplay = false } = {}) {
  return withFreshHome(async (homeDir) => {
    const env = withHome(homeDir, ctx.baseEnv);
    const oldVersion = tag.slice(1);
    const old = installPinnedTag({ tag, expectedVersion: oldVersion, homeDir, env, ...ctx });
    const port = await reservePort();
    let oldProxy;
    let currentProxy;
    try {
      oldProxy = await startAuthorizingProxy({ pluginPath: old.installPath, port, homeDir });
      removeMarketplace({ env, ...ctx });
      const current = installPinnedTag({ tag: `v${ctx.currentVersion}`, expectedVersion: ctx.currentVersion, homeDir, env, ...ctx });
      assertInstalledTreeDigests({ installedPath: current.installPath, mirrorDir: ctx.mirrorDir });
      const retired = await retireProxy(oldProxy);
      if (legacyReplay && retired.credentialIssued !== false) {
        throw new Error('clean-machine-smoke: v0.13.0 authorizing proxy unexpectedly issued a credential');
      }
      currentProxy = await startAuthorizingProxy({ pluginPath: current.installPath, port, homeDir, expectedVersion: ctx.currentVersion });
      const launch = writeLaunchRecord(currentProxy);
      if (launch.proxyArgv.includes('--plugin-version')) {
        throw new Error('clean-machine-smoke: launch record persists a plugin version instead of letting the launcher reread it');
      }
      if (oldProxy.child.exitCode === null || currentProxy.child.exitCode !== null) {
        throw new Error('clean-machine-smoke: handover did not leave exactly one owned proxy process');
      }
    } finally {
      await stopOwnedProxy(currentProxy);
      await stopOwnedProxy(oldProxy);
    }
  });
}

async function runRefusalsLeg(ctx) {
  return withFreshHome(async (homeDir) => {
    const env = withHome(homeDir, ctx.baseEnv);
    const installed = installPinnedTag({ tag: `v${ctx.currentVersion}`, expectedVersion: ctx.currentVersion, homeDir, env, ...ctx });
    const connectPath = join(installed.installPath, 'bin', 'cynap-connect.mjs');
    const disconnectPath = join(installed.installPath, 'bin', 'cynap-disconnect.mjs');
    const hookPath = join(installed.installPath, 'hooks', 'session-start.sh');
    const { stablePortForSlug } = await import(pathToFileURL(join(installed.installPath, 'lib', 'connect.mjs')).href);
    const port = stablePortForSlug(JOURNEY_SLUG);
    let proxy;
    try {
      proxy = await startAuthorizingProxy({ pluginPath: installed.installPath, port, homeDir, slug: 'different-org', expectedVersion: ctx.currentVersion });
      // A port already serving a DIFFERENT org is connect.mjs's own conflict
      // refusal (lib/connect.mjs:212-253, spec §5.2) — "identity mismatch" is
      // a distinct guard inside operator-disconnect.mjs, reached only during
      // an explicit disconnect's nonce/identity check, never during a fresh
      // connect against an occupied port (CYN-1999 fix-forward #3, run
      // 35241891876). Assert the refusal connect.mjs actually emits.
      expectCommandFailure(() => commandOutput(ctx.execFileSyncImpl, process.execPath, [connectPath, JOURNEY_SLUG], { env }), /port already serving org/);
      await stopOwnedProxy(proxy); proxy = undefined;

      // Direct launch supplies a future health version without inventing a future package.
      proxy = await startAuthorizingProxy({ pluginPath: installed.installPath, port, homeDir, expectedVersion: '999.0.0', reportedVersion: '999.0.0' });
      expectCommandFailure(() => commandOutput(ctx.execFileSyncImpl, process.execPath, [connectPath, JOURNEY_SLUG], { env }), /reload-plugins/);
      await stopOwnedProxy(proxy); proxy = undefined;

      proxy = await startAuthorizingProxy({ pluginPath: installed.installPath, port, homeDir, expectedVersion: ctx.currentVersion });
      const noncePath = join(proxy.workDir, '.operator-control');
      rmSync(noncePath, { force: true });
      expectCommandFailure(
        () => commandOutput(ctx.execFileSyncImpl, process.execPath, [disconnectPath, JOURNEY_SLUG], { env }),
        /\.operator-control.*restore the control file/i
      );
      writeLaunchRecord(proxy);
      writeFileSync(
        join(proxy.workDir, '.mcp.json'),
        `${JSON.stringify({ mcpServers: { 'cynap-operator': { type: 'http', url: `http://127.0.0.1:${port}/mcp` } } })}\n`
      );
      const marker = join(proxy.workDir, 'self-heal-ran');
      const launchPath = join(proxy.workDir, 'proxy-launch.json');
      const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
      writeFileSync(launchPath, `${JSON.stringify({ ...launch, launchCommand: `touch ${marker}` })}\n`);
      commandOutput(ctx.execFileSyncImpl, 'bash', [hookPath], { env, input: JSON.stringify({ cwd: proxy.workDir }) });
      if (existsSync(marker)) throw new Error('clean-machine-smoke: SessionStart self-heal ran despite a live lease');
    } finally {
      await stopOwnedProxy(proxy);
    }
  });
}

// CYN-1999 fix-forward #3 (spec 8.1): leg 5 only asserts against a previous
// tag whose OWN published self-update plan is fixed -- v0.15.0/v0.15.1 ship
// working `plugin_outdated` detection but their uninstall of the legacy
// `cynap-plugins` marketplace fails closed when that marketplace was never
// installed (the common case since the rename), and that is baked into an
// immutable already-published tag no later fix can repair (PR #3145). This
// mirrors the spec's existing 0.14->0.15 bootstrap carve-out (§10 point
// 5): an unrepairable old self-update is NOT RUN, not a failure.
export const SELF_UPDATE_CAPABLE_SINCE = '0.15.2';

/** Returns the NOT RUN reason for leg 5, or null when it must execute for real. */
export function autonomousUpdateLegSkipReason(previousTag, previousTagProxySource) {
  if (!previousTagProxySource.includes('plugin_outdated') || !previousTagProxySource.includes('PLUGIN_SELF_UPDATE_ARGV')) {
    return 'previous tag predates the §5.3 self-update';
  }
  if (compareVersions(previousTag.slice(1), SELF_UPDATE_CAPABLE_SINCE) < 0) {
    return `previous tag ${previousTag} predates self-update fix ${SELF_UPDATE_CAPABLE_SINCE}`;
  }
  return null;
}

function clonePreviousTag(ctx, tag) {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-operator-old-tag-'));
  try {
    commandOutput(ctx.execFileSyncImpl, ctx.gitBin, ['clone', '--depth', '1', '--branch', tag, `https://github.com/${ctx.mirrorRepo}.git`, dir], {});
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function runAutonomousUpdateLeg(ctx, previousTag) {
  const previousDir = clonePreviousTag(ctx, previousTag);
  try {
    const source = readFileSync(join(previousDir, 'bin', 'operator-proxy.mjs'), 'utf8');
    const skipReason = autonomousUpdateLegSkipReason(previousTag, source);
    if (skipReason) throw new NotRun(skipReason);
    await withFreshHome(async (homeDir) => {
      const env = withHome(homeDir, ctx.baseEnv);
      const oldVersion = previousTag.slice(1);
      const old = installPinnedTag({ tag: previousTag, expectedVersion: oldVersion, homeDir, env, ...ctx });
      // The old proxy's own updater refreshes a normal marketplace source. It
      // must not keep the deliberately tag-pinned source used by legs 1–3.
      removeMarketplace({ env, ...ctx });
      commandOutput(ctx.execFileSyncImpl, ctx.claudeBin, ['plugin', 'marketplace', 'add', `https://github.com/${ctx.mirrorRepo}.git`], { env });
      const oldProxy = await import(pathToFileURL(join(old.installPath, 'bin', 'operator-proxy.mjs')).href);
      const fixture = JSON.stringify({ ok: false, code: 'plugin_outdated', minimum: ctx.currentVersion });
      const refusal = oldProxy.detectPluginOutdated(fixture);
      if (!refusal || refusal.minimum !== ctx.currentVersion) {
        throw new Error('clean-machine-smoke: local plugin_outdated fixture was not recognized by the previous proxy');
      }
      const lines = [];
      const outcome = oldProxy.handlePluginOutdated({
        minimum: refusal.minimum,
        pluginVersion: oldVersion,
        guard: oldProxy.createPluginSelfUpdateGuard(),
        launchRecord: { proxyArgv: [join(old.installPath, 'bin', 'operator-proxy-launcher.mjs')], launchCommand: 'true' },
        runUpdate: ({ out }) => oldProxy.runPluginSelfUpdate({
          out,
          execFileImpl: (binary, argv) => commandOutput(ctx.execFileSyncImpl, binary, argv, { env }),
        }),
        readInstalled: () => assertInstalledPlugin({
          records: listInstalled({ claudeBin: ctx.claudeBin, execFileSyncImpl: ctx.execFileSyncImpl, env }),
          expectedVersion: ctx.currentVersion,
          homeDir,
        }).version,
        out: { write: (line) => lines.push(line) },
      });
      if (outcome !== 'ready_to_restart') {
        throw new Error(`clean-machine-smoke: recorded plugin_outdated fixture did not authorize restart (${outcome})`);
      }
      if (!lines.join('').includes(`-> ${ctx.currentVersion}`)) {
        throw new Error('clean-machine-smoke: self-update did not report the current plugin version');
      }
    });
  } finally {
    rmSync(previousDir, { recursive: true, force: true });
  }
}

export async function runPostPublishCleanMachineJourney({
  currentVersion,
  mirrorDir,
  mirrorRepo = 'Cynap-ai/cynap-operator-plugin',
  claudeBin = 'claude',
  gitBin = 'git',
  execFileSyncImpl = execFileSync,
  baseEnv = process.env,
  stdout = process.stdout,
} = {}) {
  if (!semverParts(currentVersion ?? '')) throw new Error('clean-machine-smoke: currentVersion must be stable semver');
  if (!mirrorDir) throw new Error('clean-machine-smoke: mirrorDir is required');
  const ctx = { currentVersion, mirrorDir, mirrorRepo, claudeBin, gitBin, execFileSyncImpl, baseEnv };
  const remoteTags = commandOutput(execFileSyncImpl, gitBin, ['ls-remote', '--tags', `https://github.com/${mirrorRepo}.git`], {});
  const tags = remoteTags.split('\n').map((line) => line.split('\t')[1]?.replace('refs/tags/', '').replace(/\^\{\}$/, '')).filter(Boolean);
  const previousTag = selectPreviousReleaseTag(tags, currentVersion);
  if (!previousTag) throw new Error(`clean-machine-smoke: no previous stable tag exists before v${currentVersion}`);
  const legs = [
    ['Install current tag', () => runInstallCurrentLeg(ctx)],
    ['Upgrade from previous tag', () => runUpgradeLeg(ctx, previousTag)],
    ['Replay F5 from v0.13.0', () => runUpgradeLeg(ctx, LEGACY_REPLAY_TAG, { legacyReplay: true })],
    ['Refusals', () => runRefusalsLeg(ctx)],
    ['Autonomous self-update', () => runAutonomousUpdateLeg(ctx, previousTag)],
  ];
  const failed = [];
  for (const [name, run] of legs) {
    try {
      await run();
      stdout.write(`[clean-machine-smoke] PASS — ${name}\n`);
    } catch (error) {
      if (error instanceof NotRun) {
        const message = `NOT RUN (${error.message})`;
        annotation(stdout, 'warning', `Clean-machine: ${name}`, message);
        stdout.write(`[clean-machine-smoke] ${name}: ${message}\n`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        annotation(stdout, 'error', `Clean-machine: ${name}`, message);
        failed.push(`${name}: ${message}`);
      }
    }
  }
  if (failed.length > 0) throw new Error(`clean-machine-smoke: ${failed.join('; ')}`);
}

export async function runCleanMachineSmoke({
  sourceDir,
  execFileSyncImpl = execFileSync,
  stdout = process.stdout,
} = {}) {
  const { projectTree, PLUGIN_ROOT } = await import('./mirror-projection.mjs');
  const resolvedSourceDir = sourceDir ?? PLUGIN_ROOT;
  const destDir = mkdtempSync(join(tmpdir(), 'cynap-clean-machine-smoke-'));
  try {
    projectTree({ sourceDir: resolvedSourceDir, destDir });
    const probePath = join(destDir, 'scripts', 'version-probe.mjs');
    execFileSyncImpl(process.execPath, [probePath], { cwd: destDir, stdio: 'inherit' });
    stdout.write(`[clean-machine-smoke] PASS — the projected mirror at ${destDir} passed its own shipped version-probe.mjs\n`);
  } finally {
    rmSync(destDir, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  try {
    if (argv[0] === '--post-publish') {
      const readOption = (name) => argv[argv.indexOf(name) + 1];
      await runPostPublishCleanMachineJourney({
        currentVersion: readOption('--current-version'),
        mirrorDir: readOption('--mirror-dir'),
        mirrorRepo: readOption('--mirror-repo'),
      });
      return;
    }
    await runCleanMachineSmoke();
  } catch (err) {
    process.stderr.write(`[clean-machine-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
