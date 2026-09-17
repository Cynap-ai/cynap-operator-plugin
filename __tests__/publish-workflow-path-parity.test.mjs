// CYN-1999 fix-forward (run 35235475068) — the post-publish job clones the
// published mirror with NO cynap-monorepo checkout and then runs
// `node mirror/scripts/<file>.mjs`. If the projection does not ship that
// exact file, the job fails on a fresh mirror clone with no local signal:
// the PR-time smoke (below) projects locally and never sees the gap, and
// the publish job itself only surfaces it AFTER a tag is already public.
// This test closes that gap: it scans the workflow file for every
// `mirror/scripts/*.mjs` invocation and asserts the projected tree actually
// contains it, so a future addition that forgets to update
// INCLUDED_SCRIPT_FILES fails at PR time instead of on a published tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { projectTree } from '../scripts/mirror-projection.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'publish-operator-plugin.yml');

function referencedMirrorScripts() {
  const text = readFileSync(WORKFLOW_PATH, 'utf8');
  const re = /mirror\/scripts\/([\w.-]+\.mjs)/g;
  const found = new Set();
  let match;
  while ((match = re.exec(text)) !== null) found.add(match[1]);
  return [...found];
}

test('every mirror/scripts/*.mjs the publish workflow invokes is present in the projected tree', () => {
  const scripts = referencedMirrorScripts();
  assert.ok(scripts.length > 0, 'the scan found zero mirror/scripts references — the regex or the workflow moved; fix the scan before trusting it');

  const destDir = mkdtempSync(join(tmpdir(), 'cynap-publish-workflow-path-parity-'));
  try {
    projectTree({ destDir });
    for (const script of scripts) {
      assert.ok(
        existsSync(join(destDir, 'scripts', script)),
        `publish-operator-plugin.yml runs mirror/scripts/${script}, but the projection does not ship scripts/${script} — add it to INCLUDED_SCRIPT_FILES in mirror-projection.mjs`
      );
    }
  } finally {
    rmSync(destDir, { recursive: true, force: true });
  }
});
