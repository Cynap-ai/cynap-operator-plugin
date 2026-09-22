// hooks/session-start.sh — the self-heal relaunch, and the plugin-root rebase
// that keeps it from reviving a STALE build.
//
// Claude Code caches every plugin version in its own directory, so the
// `launchCommand` recorded by `/cynap-connect` names the root that ran connect —
// not the root installed now. Replaying it verbatim after an update revives the
// predecessor (the 2026-09-22 0.17.5 -> 0.17.3 restart). The hook rebases the
// record onto `$CLAUDE_PLUGIN_ROOT` before relaunching, and REFUSES rather than
// relaunching a build it cannot name.
//
// Runs the REAL bash script. The proxy is never started: the recorded command is
// a marker write, which is what proves WHICH root the hook would have launched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const HOOK_PATH = join(PLUGIN_ROOT, 'hooks', 'session-start.sh');

// Port 9 (discard) is closed on a dev machine and in CI, so the hook's /health
// probe fails immediately — the dead-proxy branch, without a stub server.
const DEAD_PORT = 9;

const scratchDirs = [];

function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A plugin root the hook can import `bin/operator-proxy.mjs` from — the real
 * build copy, so the rebase under test is the shipped one. */
function makePluginRoot(version) {
  const root = join(scratchDir('cynap-selfheal-root-'), version);
  mkdirSync(join(root, 'bin'), { recursive: true });
  copyFileSync(join(PLUGIN_ROOT, 'bin', 'operator-proxy.mjs'), join(root, 'bin', 'operator-proxy.mjs'));
  return root;
}

/** A `/cynap-connect` working dir whose recorded launch command writes the
 * launcher path it would have run into `launched.txt`. */
function makeConnectDir(recordedRoot) {
  const cwd = scratchDir('cynap-selfheal-wd-');
  const launcher = `${recordedRoot}/bin/operator-proxy-launcher.mjs`;
  writeFileSync(
    join(cwd, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'cynap-operator': { type: 'http', url: `http://127.0.0.1:${DEAD_PORT}/mcp` } } })
  );
  writeFileSync(
    join(cwd, 'proxy-launch.json'),
    `${JSON.stringify(
      {
        slug: 'acme',
        port: 41234,
        proxyArgv: [launcher, '--prod'],
        launchCommand: `printf '%s' '${launcher}' > '${join(cwd, 'launched.txt')}'`,
      },
      null,
      2
    )}\n`
  );
  return cwd;
}

// No in-process server here (the /health probe just hits a closed port), so the
// synchronous form is safe — see session-end-hook.test.mjs for why a stubbed
// hook must use the async one instead.
function runHook(cwd, env = {}) {
  return execFileSync('bash', [HOOK_PATH], {
    env: { ...process.env, ...env },
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
  });
}

test('a dead proxy is relaunched from the CURRENT plugin root, not the recorded one', () => {
  const currentRoot = makePluginRoot('0.18.1');
  const cwd = makeConnectDir('/stale/cache/cynap-operator/0.17.3');

  const stdout = runHook(cwd, { CLAUDE_PLUGIN_ROOT: currentRoot });
  assert.equal(stdout, '', 'the hook writes nothing to stdout');

  const launched = readFileSync(join(cwd, 'launched.txt'), 'utf8');
  assert.equal(launched, `${currentRoot}/bin/operator-proxy-launcher.mjs`);
  assert.ok(!launched.includes('0.17.3'), 'the stale root must not survive into the relaunch');

  // The rebase is persisted, so the next reader (and the proxy's own restart
  // path) sees the successor rather than re-deriving it.
  const persisted = JSON.parse(readFileSync(join(cwd, 'proxy-launch.json'), 'utf8'));
  assert.equal(persisted.proxyArgv[0], `${currentRoot}/bin/operator-proxy-launcher.mjs`);
  assert.equal(persisted.proxyArgv[1], '--prod');
  assert.equal(persisted.slug, 'acme', 'unrelated recorded fields survive');
  assert.equal(persisted.port, 41234);
  assert.ok(persisted.launchCommand.includes(currentRoot));
});

test('a record already naming the current root is relaunched and left byte-identical', () => {
  const currentRoot = makePluginRoot('0.18.1');
  const cwd = makeConnectDir(currentRoot);
  const before = readFileSync(join(cwd, 'proxy-launch.json'), 'utf8');

  runHook(cwd, { CLAUDE_PLUGIN_ROOT: currentRoot });

  assert.equal(
    readFileSync(join(cwd, 'launched.txt'), 'utf8'),
    `${currentRoot}/bin/operator-proxy-launcher.mjs`
  );
  assert.equal(readFileSync(join(cwd, 'proxy-launch.json'), 'utf8'), before, 'an unchanged record is not rewritten');
});

test('a record that cannot be rebased is NOT relaunched — a stale build is worse than no proxy', () => {
  const currentRoot = makePluginRoot('0.18.1');
  const cwd = makeConnectDir('/stale/cache/cynap-operator/0.17.3');
  // A launch command that does not name the recorded plugin root: re-pointing it
  // would be a guess, so the rebase refuses and the hook declines to relaunch.
  const record = JSON.parse(readFileSync(join(cwd, 'proxy-launch.json'), 'utf8'));
  writeFileSync(
    join(cwd, 'proxy-launch.json'),
    `${JSON.stringify({ ...record, launchCommand: 'nohup node proxy.mjs &' }, null, 2)}\n`
  );

  const stdout = runHook(cwd, { CLAUDE_PLUGIN_ROOT: currentRoot });

  assert.equal(stdout, '');
  assert.ok(!existsSync(join(cwd, 'launched.txt')), 'nothing may be launched when the successor is unknown');
});

test('a non-connect dir stays a no-op', () => {
  const currentRoot = makePluginRoot('0.18.1');
  const bare = scratchDir('cynap-selfheal-bare-');
  runHook(bare, { CLAUDE_PLUGIN_ROOT: currentRoot });
  assert.ok(!existsSync(join(bare, 'proxy-launch.json')));
});

test('without $CLAUDE_PLUGIN_ROOT the hook still relaunches — fail-open, never a dead session', () => {
  // Codex and a plain `bash hooks/session-start.sh` have no plugin root. The
  // rebase is an improvement on the recorded command, not a precondition for it.
  const recordedRoot = '/stale/cache/cynap-operator/0.17.3';
  const cwd = makeConnectDir(recordedRoot);

  runHook(cwd, { CLAUDE_PLUGIN_ROOT: '' });

  assert.equal(readFileSync(join(cwd, 'launched.txt'), 'utf8'), `${recordedRoot}/bin/operator-proxy-launcher.mjs`);
});
