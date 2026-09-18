// CYN-1959 (Ship 4, 2026-09-16 founder ruling) — the proxy's reaction to a
// `plugin_outdated` answer.
//
// Every seam is injected: no `claude` CLI is invoked, no process is spawned, no
// file outside a temp dir is read. What is exercised is the DECISION — when an
// update runs, when a restart is authorized, and every path that must decline —
// plus the detector against the two wire shapes the answer really arrives in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPluginOutdated,
  runPluginSelfUpdate,
  readInstalledPluginVersion,
  createPluginSelfUpdateGuard,
  handlePluginOutdated,
  relaunchFromLaunchRecord,
  PLUGIN_MARKETPLACE_NAME,
  PLUGIN_QUALIFIED_ID,
  PLUGIN_SELF_UPDATE_ARGV,
  PLUGIN_OUTDATED_SCAN_LIMIT_BYTES,
} from '../../operator/operator-proxy.mjs';
import { OPERATOR_PLUGIN_INSTALL_COMMAND } from '../scripts/install-command.mjs';

function sink() {
  const lines = [];
  return { write: (s) => lines.push(s), text: () => lines.join('') };
}

const LAUNCH_RECORD = {
  slug: 'acme',
  launchCommand: "nohup node '/p/root/bin/operator-proxy-launcher.mjs' --prod >> '/w/proxy.log' 2>&1 & echo $! > '/w/proxy.pid'; disown",
  proxyArgv: ['/p/root/bin/operator-proxy-launcher.mjs', '--prod'],
};

// ── the detector ───────────────────────────────────────────────────────────

test('detects the answer in a plain JSON body', () => {
  const body = JSON.stringify({ ok: false, code: 'plugin_outdated', installed: '0.13.1', minimum: '0.14.0' });
  assert.deepEqual(detectPluginOutdated(body), { minimum: '0.14.0' });
});

test('detects the answer when it arrives JSON-encoded inside an MCP tool result', () => {
  // This is the REAL shape: the answer object is stringified into content[].text,
  // so every quote is backslash-escaped by the enclosing envelope.
  const answer = JSON.stringify({ ok: false, code: 'plugin_outdated', installed: null, minimum: '0.15.1' });
  const envelope = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: answer }] } });
  assert.ok(envelope.includes('\\"plugin_outdated\\"'), 'fixture must carry the escaped form');
  assert.deepEqual(detectPluginOutdated(envelope), { minimum: '0.15.1' });
});

test('detects the answer inside an SSE frame', () => {
  const answer = JSON.stringify({ ok: false, code: 'plugin_outdated', minimum: '1.0.0' });
  assert.deepEqual(
    detectPluginOutdated(`event: message\ndata: ${JSON.stringify({ result: { content: [{ text: answer }] } })}\n\n`),
    { minimum: '1.0.0' }
  );
});

test('returns null for every body that is not this answer', () => {
  for (const body of [
    '',
    null,
    undefined,
    '{"ok":true}',
    JSON.stringify({ ok: false, code: 'workspace_dirty' }),
    // The marker without a parseable minimum: refuse rather than update toward
    // a version we cannot name.
    '{"code":"plugin_outdated","minimum":"not-a-version"}',
    '{"code":"plugin_outdated"',
  ]) {
    assert.equal(detectPluginOutdated(body), null, JSON.stringify(body));
  }
});

test('the scan bound is a real cap, not a comment', () => {
  assert.equal(typeof PLUGIN_OUTDATED_SCAN_LIMIT_BYTES, 'number');
  assert.ok(PLUGIN_OUTDATED_SCAN_LIMIT_BYTES > 0 && PLUGIN_OUTDATED_SCAN_LIMIT_BYTES <= 1024 * 1024);
});

// ── the install surface ────────────────────────────────────────────────────

test('the proxy updates through the SAME qualified plugin id the install command owns', () => {
  // install-command.mjs is the owner of the qualified form; the proxy cannot
  // import it (bin/operator-proxy.mjs is a standalone build-copy), so this pins
  // the copy. An unqualified id resolves against a cached catalog and would
  // "update" to the release already on disk — a silent no-op forever.
  assert.ok(OPERATOR_PLUGIN_INSTALL_COMMAND.endsWith(PLUGIN_QUALIFIED_ID));
  assert.ok(PLUGIN_QUALIFIED_ID.endsWith(`@${PLUGIN_MARKETPLACE_NAME}`));
});

test('the update executes the full state-aware CLI plan, and is non-interactive', () => {
  assert.deepEqual(PLUGIN_SELF_UPDATE_ARGV, [
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'add', 'https://github.com/Cynap-ai/cynap-operator-plugin.git'],
    ['plugin', 'marketplace', 'update', PLUGIN_MARKETPLACE_NAME],
    ['plugin', 'list', '--json'],
    ['plugin', 'install', PLUGIN_QUALIFIED_ID, '--yes'],
    ['plugin', 'update', PLUGIN_QUALIFIED_ID, '--yes'],
    ['plugin', 'list', '--json'],
    ['plugin', 'uninstall', 'cynap-operator@cynap-plugins', '--yes'],
  ]);
  // `claude plugin update` refuses its confirmation prompt when stdout is not a
  // TTY, which a detached proxy's stdout never is. Without --yes this is dead.
  assert.ok(PLUGIN_SELF_UPDATE_ARGV[5].includes('--yes'));
});

test('runPluginSelfUpdate runs the full plan and accepts only a listed target version', () => {
  const calls = [];
  const result = runPluginSelfUpdate({
    minimum: '0.14.0',
    execFileImpl: (bin, argv) => {
      calls.push([bin, ...argv]);
      return argv.join(' ') === 'plugin list --json'
        ? JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: '0.14.0' }])
        : '';
    },
    out: sink(),
  });
  assert.deepEqual(result, { ok: true, reason: 'updated' });
  assert.deepEqual(calls, PLUGIN_SELF_UPDATE_ARGV.map((argv) => ['claude', ...argv]));
});

test('runPluginSelfUpdate tolerates the legacy uninstall step when there is nothing to remove', () => {
  // Real \`claude\` CLI behavior (CYN-1999 fix-forward #2): a machine that never
  // installed the pre-rename \`cynap-plugins\` marketplace -- the common case for
  // anyone onboarded after the rename -- makes this cleanup step fail every
  // time, even though the desired end state (no legacy install) already holds.
  const calls = [];
  const result = runPluginSelfUpdate({
    minimum: '0.14.0',
    execFileImpl: (bin, argv) => {
      calls.push([bin, ...argv]);
      if (argv[1] === 'uninstall') {
        const err = new Error('Command failed');
        err.stderr = 'Plugin "cynap-operator@cynap-plugins" not found in installed plugins';
        throw err;
      }
      return argv.join(' ') === 'plugin list --json'
        ? JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: '0.14.0' }])
        : '';
    },
    out: sink(),
  });
  assert.deepEqual(result, { ok: true, reason: 'updated' });
  assert.deepEqual(calls, PLUGIN_SELF_UPDATE_ARGV.map((argv) => ['claude', ...argv]));
});

test('runPluginSelfUpdate still fails closed on a genuine legacy-uninstall failure', () => {
  const out = sink();
  const result = runPluginSelfUpdate({
    minimum: '0.14.0',
    execFileImpl: (bin, argv) => {
      if (argv[1] === 'uninstall') {
        const err = new Error('Command failed');
        err.stderr = 'Plugin "cynap-operator@cynap-plugins" is locked by another process';
        throw err;
      }
      return argv.join(' ') === 'plugin list --json'
        ? JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: '0.14.0' }])
        : '';
    },
    out,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: 'update_failed',
    step: 'claude plugin uninstall cynap-operator@cynap-plugins --yes',
  });
  assert.match(out.text(), /locked by another process/);
});

test('runPluginSelfUpdate fails closed when the final plugin list does not prove the target version', () => {
  const result = runPluginSelfUpdate({
    minimum: '0.14.0',
    execFileImpl: () => JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: '0.13.9' }]),
    out: sink(),
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'verification_failed',
    step: 'claude plugin list --json',
  });
});

// The 2026-09-17 main-RED (publish run 35256409279). The gate was RIGHT to refuse,
// and the log could not say what it had observed: `verifiedPluginVersion` collapses
// "still one patch behind", "no record for this plugin", and "unparseable output"
// into one `null`, so the CI step could only report `verification_failed`. Those are
// three different bugs with three different fixes, so the failure now names the one
// it saw. Pinned here because the diagnosis is what the next responder reads first.
test('a failed version verification names the version it actually observed', () => {
  const out = sink();
  const result = runPluginSelfUpdate({
    minimum: '0.15.3',
    execFileImpl: () => JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: '0.15.2' }]),
    out,
  });

  assert.equal(result.reason, 'verification_failed');
  assert.match(out.text(), /observed 0\.15\.2/);
  assert.match(out.text(), /at or above 0\.15\.3/);
});

test('a failed version verification distinguishes an absent record from a stale one', () => {
  const out = sink();
  runPluginSelfUpdate({
    minimum: '0.15.3',
    execFileImpl: () => JSON.stringify([{ id: 'some-other-plugin', version: '9.9.9' }]),
    out,
  });

  assert.match(out.text(), /no version record for this plugin/);
});

test('a failed version verification distinguishes unparseable output from a stale one', () => {
  const out = sink();
  runPluginSelfUpdate({
    minimum: '0.15.3',
    execFileImpl: () => 'not json at all',
    out,
  });

  assert.match(out.text(), /no version record for this plugin/);
});

test('a missing `claude` CLI is a distinct, non-error outcome (Codex has no Claude Code CLI)', () => {
  const out = sink();
  const err = new Error('spawn claude ENOENT');
  err.code = 'ENOENT';
  const result = runPluginSelfUpdate({
    execFileImpl: () => {
      throw err;
    },
    out,
  });
  assert.deepEqual(result, { ok: false, reason: 'cli_absent' });
  assert.match(out.text(), /not on PATH/);
});

test('a failing update stops at the failing command and identifies it', () => {
  const calls = [];
  const result = runPluginSelfUpdate({
    execFileImpl: (bin, argv) => {
      calls.push(argv[1]);
      throw new Error('marketplace unreachable');
    },
    out: sink(),
  });
  assert.deepEqual(result, {
    ok: false,
    reason: 'update_failed',
    step: 'claude plugin marketplace list --json',
  });
  assert.equal(calls.length, 1);
});

// ── the installed-version read ─────────────────────────────────────────────

test('reads the installed version from the plugin root implied by the launch record', () => {
  const seen = [];
  const version = readInstalledPluginVersion({
    launchRecord: LAUNCH_RECORD,
    readFileImpl: (path) => {
      seen.push(path);
      return JSON.stringify({ version: '0.14.0' });
    },
  });
  assert.equal(version, '0.14.0');
  assert.match(seen[0], /\.claude-plugin\/plugin\.json$/);
});

test('an unreadable or shapeless manifest reads as null, never as a version', () => {
  assert.equal(readInstalledPluginVersion({ launchRecord: null }), null);
  assert.equal(readInstalledPluginVersion({ launchRecord: { proxyArgv: [] } }), null);
  assert.equal(
    readInstalledPluginVersion({
      launchRecord: LAUNCH_RECORD,
      readFileImpl: () => {
        throw new Error('ENOENT');
      },
    }),
    null
  );
  assert.equal(
    readInstalledPluginVersion({ launchRecord: LAUNCH_RECORD, readFileImpl: () => '{"name":"x"}' }),
    null
  );
});

// ── the loop guard ─────────────────────────────────────────────────────────

test('the guard claims a target version exactly once per process', () => {
  const guard = createPluginSelfUpdateGuard();
  assert.equal(guard.claim('0.14.0'), true);
  guard.release();
  assert.equal(guard.claim('0.14.0'), false, 'a second attempt at the same version must be refused');
  assert.equal(guard.claim('0.15.0'), true, 'a NEW target version is a new attempt');
});

test('the guard refuses a concurrent claim while one is in flight', () => {
  const guard = createPluginSelfUpdateGuard();
  assert.equal(guard.claim('0.14.0'), true);
  assert.equal(guard.claim('0.15.0'), false);
});

// ── the whole decision ─────────────────────────────────────────────────────

function decide(overrides = {}) {
  return handlePluginOutdated({
    minimum: '0.14.0',
    pluginVersion: '0.13.2',
    guard: createPluginSelfUpdateGuard(),
    launchRecord: LAUNCH_RECORD,
    runUpdate: () => ({ ok: true, reason: 'updated' }),
    readInstalled: () => '0.14.0',
    out: sink(),
    ...overrides,
  });
}

test('a successful update that really moved the on-disk version authorizes the restart', () => {
  assert.equal(decide(), 'ready_to_restart');
});

test('a second answer naming the same version is a no-op — the loop guard, end to end', () => {
  const guard = createPluginSelfUpdateGuard();
  const runs = [];
  const args = {
    guard,
    runUpdate: () => {
      runs.push(1);
      return { ok: true, reason: 'updated' };
    },
  };
  assert.equal(decide(args), 'ready_to_restart');
  assert.equal(decide(args), 'already_attempted');
  assert.equal(runs.length, 1, 'the update must run once per target version, not once per refusal');
});

test('an update that exits 0 without moving the version does NOT restart', () => {
  // The exact loop this closes: restarting into the same version reproduces the
  // same refusal on the very next call.
  const out = sink();
  assert.equal(decide({ readInstalled: () => '0.13.2', out }), 'still_outdated');
  assert.match(out.text(), /still 0\.13\.2/);
});

test('an unreadable post-update version does NOT restart', () => {
  assert.equal(decide({ readInstalled: () => null }), 'version_unreadable');
});

test('a failed or unavailable update never reaches the restart', () => {
  assert.equal(decide({ runUpdate: () => ({ ok: false, reason: 'cli_absent' }) }), 'cli_absent');
  assert.equal(decide({ runUpdate: () => ({ ok: false, reason: 'update_failed' }) }), 'update_failed');
});

test('an updated plugin with no launch record does not restart — never guess an org', () => {
  const out = sink();
  assert.equal(decide({ launchRecord: { proxyArgv: LAUNCH_RECORD.proxyArgv }, out }), 'no_launch_record');
  assert.match(out.text(), /wrong tenant/);
});

// ── the restart ────────────────────────────────────────────────────────────

test('the restart replays the RECORDED launch command — one restart path, shared with the self-heal hook', () => {
  const spawned = [];
  const result = relaunchFromLaunchRecord({
    launchRecord: LAUNCH_RECORD,
    cwd: '/w',
    spawnImpl: (bin, argv, opts) => {
      spawned.push({ bin, argv, opts });
      return { unref() {} };
    },
    out: sink(),
  });
  assert.deepEqual(result, { ok: true, reason: 'relaunched' });
  assert.equal(spawned[0].bin, '/bin/sh');
  assert.deepEqual(spawned[0].argv, ['-c', LAUNCH_RECORD.launchCommand]);
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.cwd, '/w');
});

test('a missing launch command refuses rather than inventing one', () => {
  const out = sink();
  const result = relaunchFromLaunchRecord({ launchRecord: {}, spawnImpl: () => assert.fail('must not spawn'), out });
  assert.deepEqual(result, { ok: false, reason: 'no_launch_record' });
  assert.match(out.text(), /wrong tenant/);
});

test('a spawn failure is reported, never thrown at the response path', () => {
  const result = relaunchFromLaunchRecord({
    launchRecord: LAUNCH_RECORD,
    spawnImpl: () => {
      throw new Error('EAGAIN');
    },
    out: sink(),
  });
  assert.deepEqual(result, { ok: false, reason: 'spawn_failed' });
});
