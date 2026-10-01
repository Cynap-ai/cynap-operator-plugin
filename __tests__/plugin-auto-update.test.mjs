// Proactive plugin update at session start: runProactivePluginUpdate with an
// injected command runner (no real `claude` calls) against a temp working dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runProactivePluginUpdate,
  PLUGIN_QUALIFIED_ID,
  PLUGIN_AUTO_UPDATE_STATE_FILE,
  PLUGIN_AUTO_UPDATE_THROTTLE_MS,
} from '../bin/operator-proxy.mjs';

const MARKETPLACE_DIR = '/fake/marketplaces/cynap-operator-plugin';
const sink = () => ({ lines: [], write(line) { this.lines.push(line); } });

function connectedDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-auto-update-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'cynap-operator': { url: 'http://127.0.0.1:1/mcp' } } }));
  return dir;
}

/** A runner whose registry reports `installed` until an `update` step runs, then `afterUpdate`. */
function fakeClaude({ installed, offered, afterUpdate = offered, failStep = null }) {
  const calls = [];
  let current = installed;
  const execFileImpl = async (_bin, argv) => {
    const step = argv.join(' ');
    calls.push(step);
    if (failStep && step.startsWith(failStep)) throw Object.assign(new Error('boom'), { stderr: 'boom' });
    if (step === 'plugin list --json') {
      return JSON.stringify([{ id: PLUGIN_QUALIFIED_ID, version: current, installPath: `/cache/${current}` }]);
    }
    if (step === 'plugin marketplace list --json') {
      return JSON.stringify([{ name: 'cynap-operator-plugin', installLocation: MARKETPLACE_DIR }]);
    }
    if (step.startsWith('plugin update')) current = afterUpdate;
    return '';
  };
  const readFileImpl = (path, enc) =>
    path === join(MARKETPLACE_DIR, '.claude-plugin', 'marketplace.json')
      ? JSON.stringify({ plugins: [{ name: 'cynap-operator', version: offered }] })
      : readFileSync(path, enc);
  return { calls, execFileImpl, readFileImpl };
}

const ran = (calls, prefix) => calls.some((c) => c.startsWith(prefix));

test('newer marketplace version: updates, verifies, records lastUpdate for the banner', async () => {
  const dir = connectedDir();
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33' });
  const result = await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake });
  assert.equal(result.reason, 'updated');
  assert.ok(ran(fake.calls, 'plugin marketplace update cynap-operator-plugin'));
  assert.ok(ran(fake.calls, 'plugin update cynap-operator@cynap-operator-plugin --yes'));
  const state = JSON.parse(readFileSync(join(dir, PLUGIN_AUTO_UPDATE_STATE_FILE), 'utf8'));
  assert.deepEqual(
    { from: state.lastUpdate.from, to: state.lastUpdate.to, announced: state.lastUpdate.announced },
    { from: '0.19.32', to: '0.19.33', announced: false }
  );
  assert.equal(existsSync(join(dir, '.plugin-auto-update.lock')), false, 'lock is released');
  rmSync(dir, { recursive: true });
});

test('same version: no install step runs', async () => {
  const dir = connectedDir();
  const fake = fakeClaude({ installed: '0.19.33', offered: '0.19.33' });
  const result = await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake });
  assert.equal(result.reason, 'current');
  assert.equal(ran(fake.calls, 'plugin update'), false);
  assert.equal(ran(fake.calls, 'plugin install'), false);
  rmSync(dir, { recursive: true });
});

test('an older marketplace version never downgrades', async () => {
  const dir = connectedDir();
  const fake = fakeClaude({ installed: '0.19.33', offered: '0.19.9' });
  assert.equal((await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake })).reason, 'current');
  assert.equal(ran(fake.calls, 'plugin update'), false);
  rmSync(dir, { recursive: true });
});

test('throttle: a second run inside the window makes no claude calls; after the window it checks again', async () => {
  const dir = connectedDir();
  const first = fakeClaude({ installed: '0.19.33', offered: '0.19.33' });
  const t0 = 1_000_000_000_000;
  await runProactivePluginUpdate({ cwd: dir, nowMs: t0, out: sink(), ...first });
  const second = fakeClaude({ installed: '0.19.32', offered: '0.19.33' });
  const throttled = await runProactivePluginUpdate({ cwd: dir, nowMs: t0 + 60_000, out: sink(), ...second });
  assert.equal(throttled.reason, 'throttled');
  assert.deepEqual(second.calls, []);
  const later = await runProactivePluginUpdate({
    cwd: dir,
    nowMs: t0 + PLUGIN_AUTO_UPDATE_THROTTLE_MS + 1,
    out: sink(),
    ...second,
  });
  assert.equal(later.reason, 'updated');
  rmSync(dir, { recursive: true });
});

test('update failure is fail-open: no throw, no lastUpdate, lock released', async () => {
  const dir = connectedDir();
  const out = sink();
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33', failStep: 'plugin update' });
  const result = await runProactivePluginUpdate({ cwd: dir, out, ...fake });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'update_failed');
  assert.match(out.lines.join(''), /self-update FAILED/);
  assert.equal(JSON.parse(readFileSync(join(dir, PLUGIN_AUTO_UPDATE_STATE_FILE), 'utf8')).lastUpdate, undefined);
  assert.equal(existsSync(join(dir, '.plugin-auto-update.lock')), false);
  rmSync(dir, { recursive: true });
});

test('marketplace refresh failure is fail-open', async () => {
  const dir = connectedDir();
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33', failStep: 'plugin marketplace update' });
  const result = await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake });
  assert.equal(result.reason, 'refresh_failed');
  assert.equal(ran(fake.calls, 'plugin update'), false);
  rmSync(dir, { recursive: true });
});

test('an update that does not move the on-disk version is reported failed, not recorded', async () => {
  const dir = connectedDir();
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33', afterUpdate: '0.19.32' });
  const result = await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake });
  assert.equal(result.reason, 'verification_failed');
  assert.equal(JSON.parse(readFileSync(join(dir, PLUGIN_AUTO_UPDATE_STATE_FILE), 'utf8')).lastUpdate, undefined);
  rmSync(dir, { recursive: true });
});

test('one-flight: a held lock makes a concurrent session a no-op; a stale lock is reclaimed', async () => {
  const dir = connectedDir();
  mkdirSync(join(dir, '.plugin-auto-update.lock'));
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33' });
  assert.equal((await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake })).reason, 'locked');
  assert.deepEqual(fake.calls, []);
  const stale = await runProactivePluginUpdate({ cwd: dir, nowMs: Date.now() + 11 * 60_000, out: sink(), ...fake });
  assert.equal(stale.reason, 'updated');
  rmSync(dir, { recursive: true });
});

test('not a connected dir: no-op, no claude calls, no state written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-auto-update-plain-'));
  const fake = fakeClaude({ installed: '0.19.32', offered: '0.19.33' });
  const result = await runProactivePluginUpdate({ cwd: dir, out: sink(), ...fake });
  assert.equal(result.reason, 'not_connected');
  assert.deepEqual(fake.calls, []);
  assert.equal(existsSync(join(dir, PLUGIN_AUTO_UPDATE_STATE_FILE)), false);
  rmSync(dir, { recursive: true });
});
