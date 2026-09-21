// Unit tests for lib/workspace-sync.mjs. Every filesystem-safety rule is tested as a refusal,
// and the symlink cases matter most.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assertSafeRemotePath,
  collisionKey,
  findCaseCollisions,
  resolveContainedPath,
  hasSymlinkOnPath,
  listLocalFiles,
  WorkspaceSyncError,
  readState,
  writeStateAtomic,
  assertConnectedOrg,
  sha256Hex,
  resolveOrgSlug,
} from '../lib/workspace-sync.mjs';

function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cyn1998-c2p-sync-'));
  return dir;
}

// ---------------------------------------------------------------------------
// assertSafeRemotePath
// ---------------------------------------------------------------------------

test('assertSafeRemotePath accepts an ordinary relative path', () => {
  assert.equal(assertSafeRemotePath('automations/foo.json'), 'automations/foo.json');
});

test('assertSafeRemotePath refuses ".." traversal', () => {
  assert.throws(() => assertSafeRemotePath('../etc/passwd'), WorkspaceSyncError);
  assert.throws(() => assertSafeRemotePath('automations/../../etc/passwd'), WorkspaceSyncError);
});

test('assertSafeRemotePath refuses an absolute path (POSIX and Windows)', () => {
  assert.throws(() => assertSafeRemotePath('/etc/passwd'), WorkspaceSyncError);
  assert.throws(() => assertSafeRemotePath('C:/Windows/system32'), WorkspaceSyncError);
});

test('assertSafeRemotePath refuses a path under the reserved .cynap/ directory', () => {
  assert.throws(() => assertSafeRemotePath('.cynap/state.json'), WorkspaceSyncError);
  assert.throws(() => assertSafeRemotePath('.cynap/x/y.json'), WorkspaceSyncError);
});

test('assertSafeRemotePath refuses a NUL byte', () => {
  assert.throws(() => assertSafeRemotePath(`automations/foo${String.fromCharCode(0)}.json`), WorkspaceSyncError);
});

test('assertSafeRemotePath refuses an empty path', () => {
  assert.throws(() => assertSafeRemotePath(''), WorkspaceSyncError);
});

// ---------------------------------------------------------------------------
// case-fold collisions (spec §7.1: "on every filesystem, not just the
// case-insensitive ones")
// ---------------------------------------------------------------------------

test('collisionKey folds case and normalizes NFC', () => {
  assert.equal(collisionKey('Automations/Foo.json'), 'automations/foo.json');
});

test('findCaseCollisions flags two paths that differ only by case', () => {
  const collisions = findCaseCollisions(['context/Profile.md', 'context/profile.md']);
  assert.equal(collisions.length, 1);
});

test('findCaseCollisions is empty for genuinely distinct paths', () => {
  assert.deepEqual(findCaseCollisions(['a.json', 'b.json', 'a/b.json']), []);
});

// ---------------------------------------------------------------------------
// path containment
// ---------------------------------------------------------------------------

test('resolveContainedPath resolves a normal path inside dir', () => {
  const dir = scratchDir();
  try {
    const abs = resolveContainedPath(dir, 'a/b.json');
    assert.equal(abs, join(dir, 'a', 'b.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveContainedPath refuses a path that escapes dir', () => {
  const dir = scratchDir();
  try {
    assert.throws(() => resolveContainedPath(dir, '../escape.json'), WorkspaceSyncError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// symlink refusal — "the one that matters"
// ---------------------------------------------------------------------------

test('hasSymlinkOnPath detects a symlinked ANCESTOR directory, not just the leaf', () => {
  const dir = scratchDir();
  try {
    const realTarget = join(dir, 'outside-target');
    mkdirSync(realTarget, { recursive: true });
    const linkedDir = join(dir, 'linked');
    symlinkSync(realTarget, linkedDir);
    const leaf = join(linkedDir, 'file.json');
    assert.equal(hasSymlinkOnPath(dir, leaf), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hasSymlinkOnPath is false for an ordinary nested path with no symlink', () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    assert.equal(hasSymlinkOnPath(dir, join(dir, 'a', 'b', 'c.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLocalFiles refuses the moment it finds a symlink anywhere in the tree', () => {
  const dir = scratchDir();
  try {
    writeFileSync(join(dir, 'ok.json'), '{}');
    symlinkSync(join(dir, 'ok.json'), join(dir, 'evil-link.json'));
    assert.throws(() => listLocalFiles(dir), WorkspaceSyncError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLocalFiles refuses a symlinked SUBDIRECTORY, not just a symlinked file', () => {
  const dir = scratchDir();
  try {
    const realTarget = join(dir, 'real');
    mkdirSync(realTarget, { recursive: true });
    writeFileSync(join(realTarget, 'x.json'), '{}');
    symlinkSync(realTarget, join(dir, 'linked-dir'));
    assert.throws(() => listLocalFiles(dir), WorkspaceSyncError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listLocalFiles excludes .cynap/ and returns sorted POSIX-relative paths', () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, '.cynap'), { recursive: true });
    writeFileSync(join(dir, '.cynap', 'state.json'), '{}');
    mkdirSync(join(dir, 'automations'), { recursive: true });
    writeFileSync(join(dir, 'automations', 'b.json'), '{}');
    writeFileSync(join(dir, 'a.json'), '{}');
    assert.deepEqual(listLocalFiles(dir), ['a.json', 'automations/b.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// state.json
// ---------------------------------------------------------------------------

test('readState returns null when no state file exists', () => {
  const dir = scratchDir();
  try {
    assert.equal(readState(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeStateAtomic + readState round-trip, and the write is atomic (no .tmp- file left behind)', () => {
  const dir = scratchDir();
  try {
    writeStateAtomic(dir, { org: 'cynap-e2e', base: 'a'.repeat(64), files: { 'a.json': 'sha' } });
    const state = readState(dir);
    assert.deepEqual(state, { org: 'cynap-e2e', base: 'a'.repeat(64), files: { 'a.json': 'sha' } });
    const stateDir = join(dir, '.cynap');
    const leftoverTmp = readdirSync(stateDir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftoverTmp, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readState refuses a malformed state.json', () => {
  const dir = scratchDir();
  try {
    mkdirSync(join(dir, '.cynap'), { recursive: true });
    writeFileSync(join(dir, '.cynap', 'state.json'), JSON.stringify({ org: 'x' }));
    assert.throws(() => readState(dir), WorkspaceSyncError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertConnectedOrg refuses when state.org does not match the connected org', () => {
  assert.throws(() => assertConnectedOrg({ org: 'cynap', base: null, files: {} }, 'cynap-e2e'), WorkspaceSyncError);
});

test('assertConnectedOrg is a no-op when they match', () => {
  assert.doesNotThrow(() => assertConnectedOrg({ org: 'cynap-e2e', base: null, files: {} }, 'cynap-e2e'));
});

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

test('sha256Hex is deterministic', () => {
  assert.equal(sha256Hex(Buffer.from('hello')), sha256Hex(Buffer.from('hello')));
  assert.notEqual(sha256Hex(Buffer.from('hello')), sha256Hex(Buffer.from('world')));
});

test('resolveOrgSlug infers the org from the basename of cwd', () => {
  assert.equal(resolveOrgSlug({ cwd: '/Users/op/CynapOperator/cynap-e2e' }), 'cynap-e2e');
});

test('hasSymlinkOnPath detects a DANGLING symlinked ancestor (lstat, not existsSync)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyn1998-c2p-dangling-'));
  try {
    symlinkSync(join(dir, 'does-not-exist'), join(dir, 'sub'));
    assert.equal(hasSymlinkOnPath(dir, join(dir, 'sub', 'file.md')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
