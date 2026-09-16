// CYN-1959 (Ship 3, Q20/ADR-0084 Decision 2) — bin/operator-proxy-launcher.mjs
// rereads .claude-plugin/plugin.json's version fresh on every start and
// threads it into operator-proxy.mjs as --plugin-version, WITHOUT ever
// persisting the version into the launch record (that's proxyPath pointing at
// this launcher, never the version itself). Pure node --test, no real process
// spawned — readVersion/runProxy are both injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPluginVersion, buildVersionedProxyArgs, main } from '../bin/operator-proxy-launcher.mjs';

function makePluginRoot(version) {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-plugin-launcher-test-'));
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'cynap-operator', version }, null, 2) + '\n'
  );
  return dir;
}

test('readPluginVersion reads the version fresh from plugin.json each call — no caching', () => {
  const pluginRoot = makePluginRoot('1.0.0');
  try {
    assert.equal(readPluginVersion({ pluginRoot }), '1.0.0');
    writeFileSync(
      join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cynap-operator', version: '2.0.0' }, null, 2) + '\n'
    );
    assert.equal(readPluginVersion({ pluginRoot }), '2.0.0', 'a second read after the file changed must see the new value');
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('readPluginVersion fails closed on a manifest with no version string', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'cynap-plugin-launcher-test-'));
  mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
  writeFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'cynap-operator' }));
  try {
    assert.throws(() => readPluginVersion({ pluginRoot }), /no "version" string/);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test('buildVersionedProxyArgs appends --plugin-version to the caller argv', () => {
  assert.deepEqual(
    buildVersionedProxyArgs(['--allow-org', 'org-1', '--port', '39001'], '1.2.3'),
    ['--allow-org', 'org-1', '--port', '39001', '--plugin-version', '1.2.3']
  );
});

test('buildVersionedProxyArgs refuses a caller-supplied --plugin-version rather than silently colliding', () => {
  assert.throws(
    () => buildVersionedProxyArgs(['--plugin-version', '0.0.1'], '1.2.3'),
    /must not be supplied by the caller/
  );
});

test('main() reads the version fresh and forwards argv + --plugin-version to operator-proxy.mjs\'s main, in-process (same pid)', async () => {
  let received;
  await main(['--allow-org', 'org-1', '--port', '39001'], {
    readVersion: () => '3.4.5',
    runProxy: async (argv) => {
      received = argv;
    },
  });
  assert.deepEqual(received, ['--allow-org', 'org-1', '--port', '39001', '--plugin-version', '3.4.5']);
});

test('main() rereads the version on every call — a second call after a plugin upgrade sees the new version', async () => {
  let calls = 0;
  const versions = ['1.0.0', '1.0.1'];
  const received = [];
  const readVersion = () => versions[calls++];
  const runProxy = async (argv) => received.push(argv);
  await main([], { readVersion, runProxy });
  await main([], { readVersion, runProxy });
  assert.deepEqual(received[0], ['--plugin-version', '1.0.0']);
  assert.deepEqual(received[1], ['--plugin-version', '1.0.1'], 'a self-heal relaunch after an upgrade must see the NEW version, never the first call\'s cached one');
});
