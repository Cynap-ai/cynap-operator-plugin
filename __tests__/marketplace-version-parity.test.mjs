// CYN-1060 — version-parity gate across ALL THREE manifests that declare the
// operator plugin's version.
//
// The repo-root `.claude-plugin/marketplace.json` is what a `github`-sourced
// marketplace (`/plugin marketplace add Cynap-ai/cynap-monorepo-next`) reads to
// decide whether an installed plugin has an update available. It carries its own
// explicit `plugins[].version`, so it is a SECOND source of truth alongside the
// plugin's own `plugin.json` — and it silently drifted through two consecutive
// version bumps (#2028 0.5.0, #2088 0.5.1), both of which touched only the files
// under tooling/operator-plugin/. The observable symptom: the Plugins UI pinned
// "Version 0.4.0" with the Update button greyed out, so the CYN-992 session-trail
// fix could not reach an operator's machine.
//
// manifest-conformance.test.mjs cannot catch this: every assertion there is
// scoped to PLUGIN_ROOT (tooling/operator-plugin), so the repo-root manifest is
// structurally invisible to it. This file deliberately reaches UP to the repo
// root — the same way build-copy-parity.test.mjs does — so a bump that misses
// any one of the three files goes red in CI instead of shipping a dead Update
// button.
//
// (The durable fix is CYN-902's collapse to ONE marketplace source, which
// deletes the repo-root manifest entirely. Until that lands, this is the gate.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');

const PLUGIN_NAME = 'cynap-operator';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const PLUGIN_JSON_PATH = join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json');
const NESTED_MARKETPLACE_PATH = join(PLUGIN_ROOT, '.claude-plugin', 'marketplace.json');
const ROOT_MARKETPLACE_PATH = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

/** The plugin's own manifest is the single source of record for its version. */
function pluginVersion() {
  return readJson(PLUGIN_JSON_PATH).version;
}

/** Pull the cynap-operator entry out of a marketplace manifest. */
function marketplaceEntry(manifestPath) {
  const manifest = readJson(manifestPath);
  assert.ok(Array.isArray(manifest.plugins), `${manifestPath}: plugins[] must be an array`);
  const entry = manifest.plugins.find((p) => p.name === PLUGIN_NAME);
  assert.ok(entry, `${manifestPath}: no "${PLUGIN_NAME}" entry in plugins[]`);
  return entry;
}

test('repo-root marketplace.json advertises the SAME version as plugin.json', () => {
  // Guard the file's existence explicitly: if CYN-902's collapse deletes the
  // repo-root manifest, this test should be deleted with it — not silently pass.
  assert.ok(
    existsSync(ROOT_MARKETPLACE_PATH),
    'repo-root .claude-plugin/marketplace.json is missing. If this was deleted deliberately ' +
      '(CYN-902 collapse to one marketplace source), delete this test in the same change.'
  );
  const entry = marketplaceEntry(ROOT_MARKETPLACE_PATH);
  assert.equal(
    entry.version,
    pluginVersion(),
    `repo-root marketplace.json pins ${PLUGIN_NAME}@${entry.version} but plugin.json is ` +
      `${pluginVersion()}. A github-sourced marketplace reads the ROOT manifest to offer updates, ` +
      'so this drift greys out the Update button and strands the installed version (CYN-1060).'
  );
});

test('nested plugin marketplace.json advertises the SAME version as plugin.json', () => {
  const entry = marketplaceEntry(NESTED_MARKETPLACE_PATH);
  assert.equal(
    entry.version,
    pluginVersion(),
    `tooling/operator-plugin/.claude-plugin/marketplace.json pins ${PLUGIN_NAME}@${entry.version} ` +
      `but plugin.json is ${pluginVersion()}.`
  );
});

test('the repo-root manifest points at the plugin subdirectory that actually exists', () => {
  const entry = marketplaceEntry(ROOT_MARKETPLACE_PATH);
  assert.equal(entry.source, './tooling/operator-plugin', 'root manifest source path changed');
  assert.ok(
    existsSync(join(REPO_ROOT, 'tooling', 'operator-plugin', '.claude-plugin', 'plugin.json')),
    'root manifest source path does not resolve to a plugin'
  );
});
