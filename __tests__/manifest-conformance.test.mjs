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
import { readFileSync, existsSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  assertNoTemplatedAuthHeader,
  assertComponentDirsAtRoot,
  assertMarketplaceNameMatchesPlugin,
} from '../scripts/version-probe.mjs';
import { buildProjectMcpJson } from '../lib/connect.mjs';
import { projectTree } from '../scripts/mirror-projection.mjs';

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

// The fixture goes in a scratch dir, never in __tests__/: mirror-projection's
// projectTree walks __tests__ as a SHIPPED directory, and `node --test` runs
// these files concurrently — a fixture written into the tracked tree is visible
// to that walk for the few ms it exists, and vanishes before the walk reads it
// (ENOENT mid-projection). Ship 3 added several more projectTree callers, so
// the window is no longer narrow enough to ignore.
test('a templated Authorization header would be rejected (regression guard)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-templated-mcp-'));
  const fixturePath = join(scratch, 'templated-mcp.json');
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
    rmSync(scratch, { recursive: true, force: true });
  }
});

// CYN-1959 (Ship 3, Q19): the monorepo source tree carries NO installable
// marketplace.json any more — the mirror projection is the only thing that
// produces one, at .claude-plugin/marketplace.json inside the PROJECTED tree
// (where `claude plugin marketplace add <projected-dir>` finds it). This test
// projects a throwaway copy of the current source and validates THAT output,
// rather than asserting a source-tree file that no longer exists.
function projectScratch() {
  const dest = mkdtempSync(join(tmpdir(), 'cynap-manifest-conformance-'));
  projectTree({ destDir: dest, sourceSha: 'fixed-test-sha' });
  return dest;
}

test('the source package ships no installable marketplace.json (generated only by projection)', () => {
  assert.ok(
    !existsSync(join(PLUGIN_ROOT, '.claude-plugin', 'marketplace.json')),
    'the source tree must not carry a marketplace.json — it is generated only by mirror-projection.mjs; ' +
      'local development uses `claude --plugin-dir tooling/operator-plugin`',
  );
  assert.ok(!existsSync(join(PLUGIN_ROOT, 'marketplace.json')));
});

test('projected marketplace.json lives at .claude-plugin/marketplace.json (where `claude plugin marketplace add` finds it) with no stale root copy', () => {
  const dest = projectScratch();
  try {
    assert.ok(
      existsSync(join(dest, '.claude-plugin', 'marketplace.json')),
      'marketplace.json must be at .claude-plugin/marketplace.json — `claude plugin marketplace add` looks ONLY there',
    );
    assert.ok(
      !existsSync(join(dest, 'marketplace.json')),
      'a stale package-root marketplace.json is invisible to `marketplace add` — delete it',
    );
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('projected marketplace.json name matches plugin.json name and carries a renames map', () => {
  const dest = projectScratch();
  try {
    const marketplacePath = join(dest, '.claude-plugin', 'marketplace.json');
    assert.doesNotThrow(() =>
      assertMarketplaceNameMatchesPlugin(
        join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'),
        marketplacePath
      )
    );
    const marketplaceJson = readJson(marketplacePath);
    assert.ok(Object.prototype.hasOwnProperty.call(marketplaceJson, 'renames'));
    assert.equal(typeof marketplaceJson.renames, 'object');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
