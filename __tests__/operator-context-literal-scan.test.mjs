// The backend context-resource-kind literal must appear NOWHERE in this
// plugin package except:
//   (a) bin/operator-proxy.mjs — the build-copy of the proxy source, which
//       owns the ONE canonical occurrence (the operatorContextUri helper);
//   (b) this test file itself, whose needle is built by concatenation so it
//       never self-trips the scan.
// Everything else (the hook, README, commands, skills) must derive the
// pointer from /health.contextUri instead of typing the literal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const THIS_FILE = fileURLToPath(import.meta.url);

// Built by concatenation — a literal `operator-context` in THIS source file
// would otherwise self-trip the very scan it defines.
const NEEDLE = 'operator' + '-context';

const ALLOWED_RELATIVE_PATHS = new Set(['bin/operator-proxy.mjs', relative(PLUGIN_ROOT, THIS_FILE)]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(absPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(absPath);
  }
}

test('the backend context-resource-kind literal appears nowhere in this plugin package except the proxy build-copy and this test', () => {
  const files = [];
  walk(PLUGIN_ROOT, files);
  assert.ok(files.length > 10, `expected to scan a real tree, only found ${files.length} files`);

  const offenders = [];
  for (const absPath of files) {
    const relPath = relative(PLUGIN_ROOT, absPath);
    if (ALLOWED_RELATIVE_PATHS.has(relPath)) continue;
    let text;
    try {
      text = readFileSync(absPath, 'utf8');
    } catch {
      continue; // not a text file (e.g. binary) — nothing to scan
    }
    if (text.includes(NEEDLE)) {
      offenders.push(relPath);
    }
  }
  assert.deepEqual(offenders, [], `the literal "${NEEDLE}" leaked into: ${offenders.join(', ')}`);
});

test('bin/operator-proxy.mjs (the allowlisted copy) DOES still carry the literal — a sanity control proving the scan actually works', () => {
  const binPath = join(PLUGIN_ROOT, 'bin', 'operator-proxy.mjs');
  const text = readFileSync(binPath, 'utf8');
  assert.ok(text.includes(NEEDLE), 'expected the build-copy to still define operatorContextUri');
});

test('the hook script derives its pointer from /health.contextUri, not a typed literal', () => {
  const hookPath = join(PLUGIN_ROOT, 'hooks', 'session-start-banner.sh');
  const text = readFileSync(hookPath, 'utf8');
  assert.ok(!text.includes(NEEDLE));
  assert.ok(text.includes('.contextUri'), 'the hook must read the pointer from the /health JSON field');
});
