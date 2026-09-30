// The /cynap-checks strict handler typecheck — the paths that need no compiler. The real compiler
// run is exercised by sdk-types-parity.test.mjs, where a pinned toolchain exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findHandlerSources,
  reportTypecheck,
  resolveToolchain,
  TOOLCHAIN_PINS,
  typecheckHandlers,
} from '../lib/handler-typecheck.mjs';
import { CYNAP_SDK_DECLARATIONS, SDK_TYPE_PINS } from '../lib/cynap-sdk-types.mjs';
import { HANDLER_COMPILER_OPTIONS, TOOLCHAIN_PINS as CONTRACT_PINS } from '../lib/handler-typecheck-contract.mjs';

function scratch() {
  return mkdtempSync(join(tmpdir(), 'cynap-typecheck-unit-'));
}

test('selects exactly the handler-source paths', () => {
  const dir = scratch();
  try {
    for (const rel of [
      'automations/flat.ts',
      'automations/handlers/a/handler.ts',
      'automations/handlers/a/helper.ts',
      'automations/__tests__/x.test.ts',
      'automations/foo.test.ts',
      'automations/handlers/a/__tests__/y.test.ts',
      'automations/nested/deep.ts',
      'context/notes.ts',
    ]) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), '');
    }
    assert.deepEqual(findHandlerSources(dir), ['automations/flat.ts', 'automations/handlers/a/handler.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an org with no handler sources passes without needing a compiler', () => {
  const dir = scratch();
  try {
    const result = typecheckHandlers(dir, { toolchain: { ok: false, reason: 'unused' } });
    assert.deepEqual(result, { ran: true, ok: true, files: [], diagnostics: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing compiler is reported NOT RUN with its reason, never as a pass', () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, 'automations'));
    writeFileSync(join(dir, 'automations', 'x.ts'), 'export {};\n');
    const lines = [];
    const summary = reportTypecheck(dir, {
      write: (line) => lines.push(line),
      typecheck: (d) => typecheckHandlers(d, { toolchain: { ok: false, reason: 'npm not found' } }),
    });
    assert.deepEqual(summary, { status: 'not_run', reason: 'npm not found' });
    assert.match(lines[0], /NOT RUN — npm not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed compiler install resolves to a reason, not a throw', () => {
  const cacheRoot = scratch();
  try {
    const result = resolveToolchain({
      env: {},
      cacheRoot,
      execImpl: () => {
        throw new Error('spawn npm ENOENT');
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /could not install the pinned compiler \(spawn npm ENOENT\)/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('reportTypecheck prints each diagnostic as path:line:column code message', () => {
  const lines = [];
  const summary = reportTypecheck('/w', {
    write: (line) => lines.push(line),
    typecheck: () => ({
      ran: true,
      ok: false,
      files: ['automations/a.ts'],
      diagnostics: [{ file: 'automations/a.ts', line: 3, column: 7, code: 'TS2322', message: 'bad' }],
    }),
  });
  assert.deepEqual(summary, { status: 'fail', files: 1, errors: 1 });
  assert.deepEqual(lines, ['automations/a.ts:3:7 TS2322 bad']);
});

test('the toolchain pins the compiler and schema library the declarations were built with', () => {
  assert.equal(TOOLCHAIN_PINS.typescript, SDK_TYPE_PINS.typescript);
  assert.equal(TOOLCHAIN_PINS.zod, SDK_TYPE_PINS.zod);
  assert.match(TOOLCHAIN_PINS['@types/node'], /^22\./);
  assert.ok(CYNAP_SDK_DECLARATIONS['index.d.ts'], 'the bundled declarations have no barrel');
});

// The platform typechecks the same source at commit time and must reach the same
// verdict, so it imports lib/handler-typecheck-contract.mjs. This pins that the local runner
// reads the contract too, rather than keeping pins or options of its own.
test('the local runner checks with the contract pins and compiler options, and nothing else', () => {
  assert.equal(TOOLCHAIN_PINS, CONTRACT_PINS);
  assert.deepEqual(Object.keys(CONTRACT_PINS).sort(), ['@types/node', 'typescript', 'undici-types', 'zod']);

  const dir = scratch();
  try {
    mkdirSync(join(dir, 'automations'));
    writeFileSync(join(dir, 'automations', 'x.ts'), 'export {};\n');
    let written;
    const result = typecheckHandlers(dir, {
      toolchain: { ok: true, root: '/toolchain' },
      // Stands in for the compiler process: read the tsconfig the runner handed it.
      execImpl: (_node, args) => {
        written = JSON.parse(readFileSync(args[args.indexOf('-p') + 1], 'utf8'));
        return '';
      },
    });
    assert.equal(result.ok, true);
    const { typeRoots, paths, ...shared } = written.compilerOptions;
    assert.deepEqual(shared, JSON.parse(JSON.stringify(HANDLER_COMPILER_OPTIONS)));
    assert.deepEqual(typeRoots, [join('/toolchain', 'node_modules', '@types')]);
    assert.deepEqual(Object.keys(paths), ['@cynap/sdk', '@cynap/sdk/*']);
    assert.deepEqual(written.files, [join(dir, 'automations', 'x.ts')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
