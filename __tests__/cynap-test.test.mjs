// /cynap-test — the org test runner. Runs REAL `node --test` children in the sandbox.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findOrgTests, inspectOrgTest, nodeTestArgv, runOrgTests, UNSUPPORTED_EXIT_CODE } from '../bin/cynap-test.mjs';
import { assertSupportedNode, FORBIDDEN_GRANTS } from '../lib/sandboxed-node.mjs';

const inProcess = (() => {
  try {
    nodeTestArgv('/', []);
    return true;
  } catch {
    return false;
  }
})();
const needsInProcess = { skip: !inProcess && 'needs a Node that runs tests in-process; CI runs these in the Node 25 step' };

const ORG = 'acme';
let cwd;
let dir;

function write(rel, source) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, source);
}

beforeEach(() => {
  cwd = join(mkdtempSync(join(tmpdir(), 'cynap-org-tests-')), ORG);
  dir = join(cwd, `cynap-${ORG}`);
  mkdirSync(join(dir, '.cynap'), { recursive: true });
  writeFileSync(join(dir, '.cynap', 'state.json'), JSON.stringify({ org: ORG, base: null, files: {} }));
});
afterEach(() => rmSync(join(cwd, '..'), { recursive: true, force: true }));

test('runs .ts org tests that import #cynap/testing and a relative helper', needsInProcess, async () => {
  write('automations/lib/price.ts', 'export function price(n: number): number { return n * 2; }\n');
  write(
    'automations/__tests__/price.test.ts',
    `import { test } from 'node:test';
     import assert from 'node:assert/strict';
     import { createMockContext } from '#cynap/testing';
     import { price } from '../lib/price.ts';
     test('doubles', () => assert.equal(price(2), 4));
     test('context', () => assert.equal(typeof createMockContext().tools.knowledge.advancedQuery, 'function'));\n`
  );
  const result = await runOrgTests({ cwd, stdio: 'pipe' });
  assert.equal(result.ok, true, result.output);
  assert.deepEqual(result.files, ['automations/__tests__/price.test.ts']);
  assert.match(result.output, /pass 2\b/);
  // /cynap-test installed the context itself because this directory was never pulled for real.
  assert.ok(existsSync(join(dir, '.cynap', 'testing.mjs')));
});

test('a failing assertion fails the run', needsInProcess, async () => {
  write('checks/__tests__/x.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('x', () => assert.equal(1, 2));\n`);
  const result = await runOrgTests({ cwd, stdio: 'pipe' });
  assert.equal(result.ok, false);
  assert.match(result.output, /fail 1\b/);
});

test('a test cannot write, spawn, or read outside the working directory', needsInProcess, async () => {
  const outside = join(cwd, 'outside-secret.txt');
  writeFileSync(outside, 'secret');
  write(
    'a.test.mjs',
    `import { test } from 'node:test';
     import assert from 'node:assert/strict';
     import { writeFileSync, readFileSync } from 'node:fs';
     import { execSync } from 'node:child_process';
     test('write', () => assert.throws(() => writeFileSync('owned.txt', 'x'), { code: 'ERR_ACCESS_DENIED' }));
     test('spawn', () => assert.throws(() => execSync('true'), { code: 'ERR_ACCESS_DENIED' }));
     test('read outside', () => assert.throws(() => readFileSync(${JSON.stringify(outside)}), { code: 'ERR_ACCESS_DENIED' }));
     test('env', () => assert.deepEqual(Object.keys(process.env).filter((k) => !k.startsWith('__CF_') && k !== 'NODE_TEST_WORKER_ID'), []));\n`
  );
  const result = await runOrgTests({ cwd, stdio: 'pipe' });
  assert.equal(result.ok, true, result.output);
  assert.match(result.output, /pass 4\b/);
  assert.equal(existsSync(join(dir, 'owned.txt')), false);
});

test('only *.test.* files are selected, never node_modules or plugin-owned paths', () => {
  write('automations/__tests__/fixtures/data.ts', 'export const x = 1;\n');
  write('automations/__tests__/a.test.ts', '');
  write('node_modules/pkg/b.test.js', '');
  write('.cynap/c.test.mjs', '');
  write('d.test.mjs', '');
  write('e.test.cjs', '');
  assert.deepEqual(findOrgTests(dir), ['automations/__tests__/a.test.ts', 'd.test.mjs', 'e.test.cjs']);
});

test('marks Vitest and unavailable packages unsupported with a concrete fix', () => {
  write('vitest.test.ts', "import { test } from 'vitest';\n");
  write('missing.test.mjs', "import helper from 'not-installed-anywhere';\n");
  assert.match(inspectOrgTest(dir, 'vitest.test.ts').reason, /Vitest/);
  assert.match(inspectOrgTest(dir, 'vitest.test.ts').fix, /node:test/);
  assert.match(inspectOrgTest(dir, 'missing.test.mjs').reason, /not-installed-anywhere/);
});

test('refuses require() in ESM .js with a rename-to-.cjs fix', async () => {
  write('esm-require.test.js', "const { test } = require('node:test');\n");
  const refused = await runOrgTests({ cwd, argv: ['esm-require.test.js'], stdio: 'pipe' });
  assert.equal(refused.exitCode, UNSUPPORTED_EXIT_CODE);
  assert.match(refused.unsupported[0].fix, /rename it to \.cjs/);
});

test('runs .cjs tests when the sandbox permits', needsInProcess, async () => {
  write('commonjs.test.cjs', "const { test } = require('node:test'); const assert = require('node:assert/strict'); test('CJS runs', () => assert.equal(1, 1));\n");
  const runnable = await runOrgTests({ cwd, argv: ['commonjs.test.cjs'], stdio: 'pipe' });
  assert.equal(runnable.ok, true, runnable.output);
  assert.equal(runnable.passed, 1);
  assert.equal(runnable.failed, 0);
});

test('returns the unsupported exit code when every selected test is unsupported', async () => {
  write('only-vitest.test.ts', "import { test } from 'vitest';\n");
  const result = await runOrgTests({ cwd, stdio: 'pipe' });
  assert.equal(result.exitCode, UNSUPPORTED_EXIT_CODE);
  assert.equal(result.files.length, 0);
  assert.equal(result.unsupported.length, 1);
});

test('refuses a file that is not an org test', async () => {
  write('context/notes.md', '# x');
  await assert.rejects(runOrgTests({ cwd, argv: ['context/notes.md'], stdio: 'pipe' }), /not an org test file/);
});

test('refuses a working directory pulled for another org', async () => {
  writeFileSync(join(dir, '.cynap', 'state.json'), JSON.stringify({ org: 'other', base: null, files: {} }));
  await assert.rejects(runOrgTests({ cwd, stdio: 'pipe' }), /different org/);
});

test('refuses Node older than 22.18 and names the version it found', () => {
  assert.throws(() => assertSupportedNode('22.17.1'), /Node 22\.17\.1 is too old — .*>= 22\.18\.0/);
  assert.doesNotThrow(() => assertSupportedNode('22.18.0'));
  assert.doesNotThrow(() => assertSupportedNode('25.1.0'));
});

test('the node --test argv grants reading the working directory and nothing else', needsInProcess, () => {
  const argv = nodeTestArgv('/w', ['/w/a.test.ts']);
  assert.ok(argv.includes('--permission'));
  assert.deepEqual(argv.filter((a) => a.startsWith('--allow-')), ['--allow-fs-read=/w']);
  for (const grant of FORBIDDEN_GRANTS) assert.ok(!argv.some((a) => a.startsWith(grant)), grant);
  assert.ok(argv.some((a) => /test-isolation=none$/.test(a)));
  assert.equal(argv.at(-1), '/w/a.test.ts');
});

test('an org with no tests passes vacuously and says so', async () => {
  const result = await runOrgTests({ cwd, stdio: 'pipe' });
  assert.equal(result.ok, true);
  assert.match(result.note, /no org test files/);
  assert.equal(readFileSync(join(dir, '.cynap', 'state.json'), 'utf8').includes(ORG), true);
});
