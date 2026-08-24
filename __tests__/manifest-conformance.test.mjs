// CYN-785 (CYN-768 P0) — plugin.json / marketplace.json shape conformance:
// root-level component dirs, immutable name parity, renames map, no
// templated Authorization header. Mirrors the static assertions in
// scripts/version-probe.mjs so the gate is exercised both as a unit test and
// as the standalone probe script.
//
// The plugin intentionally ships NO plugin-root .mcp.json (see FIX 1 /
// README "Why there is no plugin-root MCP server"): Claude Code dedupes
// plugin MCP servers by ENDPOINT, not name, so a fixed-port plugin-root
// server would coexist with — never override — the per-dir ephemeral-port
// servers /cynap-connect generates, producing a permanently-failed
// auto-connect on plugin enable. The only .mcp.json this package ever
// produces is the per-dir config from lib/connect.mjs buildProjectMcpJson,
// asserted here and in connect.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoTemplatedAuthHeader,
  assertComponentDirsAtRoot,
  assertMarketplaceNameMatchesPlugin,
} from '../scripts/version-probe.mjs';
import { buildProjectMcpJson } from '../lib/connect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('plugin.json exists with a name and version', () => {
  const pluginJson = readJson(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
  assert.equal(typeof pluginJson.name, 'string');
  assert.ok(pluginJson.name.length > 0);
  assert.equal(typeof pluginJson.version, 'string');
});

test('component dirs (commands/, skills/) live at plugin root, not under .claude-plugin/', () => {
  assert.ok(existsSync(join(PLUGIN_ROOT, 'commands')), 'commands/ must exist at plugin root');
  assert.ok(existsSync(join(PLUGIN_ROOT, 'skills')), 'skills/ must exist at plugin root');
  assert.doesNotThrow(() => assertComponentDirsAtRoot(PLUGIN_ROOT));
});

test('no plugin-root .mcp.json ships (endpoint-dedupe collision guard)', () => {
  assert.ok(
    !existsSync(join(PLUGIN_ROOT, '.mcp.json')),
    'a plugin-root .mcp.json on a fixed port would coexist with (not be overridden by) the ' +
      'per-dir ephemeral-port servers /cynap-connect generates — Claude Code dedupes plugin MCP ' +
      'servers by endpoint, not name.'
  );
});

test('the generated per-dir .mcp.json (buildProjectMcpJson) carries no templated Authorization header', () => {
  const generated = buildProjectMcpJson({ port: 12345 });
  assert.doesNotThrow(() => assertNoTemplatedAuthHeader(generated));
});

test('a templated Authorization header would be rejected (regression guard)', () => {
  const fixturePath = join(__dirname, '__fixtures-templated-mcp.json');
  const fixture = {
    mcpServers: {
      bad: {
        type: 'http',
        url: 'https://example.invalid/mcp',
        headers: { Authorization: 'Bearer ${SOME_TOKEN}' },
      },
    },
  };
  writeFileSync(fixturePath, JSON.stringify(fixture));
  try {
    assert.throws(() => assertNoTemplatedAuthHeader(fixturePath), /templated Authorization header/);
  } finally {
    rmSync(fixturePath, { force: true });
  }
});

test('marketplace.json lives at .claude-plugin/marketplace.json (where `claude plugin marketplace add` finds it) with no stale root copy', () => {
  assert.ok(
    existsSync(join(PLUGIN_ROOT, '.claude-plugin', 'marketplace.json')),
    'marketplace.json must be at .claude-plugin/marketplace.json — `claude plugin marketplace add` looks ONLY there',
  );
  assert.ok(
    !existsSync(join(PLUGIN_ROOT, 'marketplace.json')),
    'a stale package-root marketplace.json is invisible to `marketplace add` — delete it',
  );
});

test('marketplace.json name matches plugin.json name and carries a renames map', () => {
  const marketplacePath = join(PLUGIN_ROOT, '.claude-plugin', 'marketplace.json');
  assert.doesNotThrow(() =>
    assertMarketplaceNameMatchesPlugin(
      join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
      marketplacePath
    )
  );
  const marketplaceJson = readJson(marketplacePath);
  assert.ok(Object.prototype.hasOwnProperty.call(marketplaceJson, 'renames'));
  assert.equal(typeof marketplaceJson.renames, 'object');
});
