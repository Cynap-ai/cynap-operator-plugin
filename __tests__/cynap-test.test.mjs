// /cynap-test — the org test runner. Runs REAL `node --test` children in the sandbox.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findOrgTests, inspectOrgTest, nodeTestArgv, runOrgTests, UNSUPPORTED_EXIT_CODE } from '../bin/cynap-test.mjs';
import { assertSupportedNode, assertNetworkGated, networkIsGated, FORBIDDEN_GRANTS } from '../lib/sandboxed-node.mjs';

const inProcess = (() => {
  try {
    nodeTestArgv('/', []);
    return true;
  } catch {
    return false;
  }
})();
const needsInProcess = { skip: !inProcess && 'needs a Node that runs tests in-process; CI runs these in the Node 25 step' };

const needsNetworkGate = { skip: (!inProcess || !networkIsGated()) && 'real AI requires Node network permissions' };

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

test('runs a CommonJS .js test (require) although the plugin-owned package.json is type:module', needsInProcess, async () => {
  write('helper.js', 'module.exports = { one: 1 };\n');
  write(
    'cjs.test.js',
    "const { test } = require('node:test'); const assert = require('node:assert/strict'); const h = require('./helper.js'); test('CJS .js runs', () => assert.equal(h.one, 1));\n"
  );
  const ran = await runOrgTests({ cwd, argv: ['cjs.test.js'], stdio: 'pipe' });
  assert.equal(ran.ok, true, ran.output);
  assert.equal(ran.passed, 1);
  assert.equal(ran.unsupported.length, 0);
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

test('fixtures never create an AI broker or network binding', needsInProcess, async () => {
  write('fixtures.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createMockContext } from '#cynap/testing'; test('fixture', async () => assert.equal(await createMockContext({ llmComplete: () => 'fixture' }).tools.llm.complete('synthetic'), 'fixture'));`);
  const ran = await runOrgTests({ cwd, stdio: 'pipe', createBroker: () => { throw new Error('broker must not bind'); } });
  assert.equal(ran.aiMode, 'fixtures');
  assert.equal(ran.ok, true, ran.output);
});

test('real AI is brokered over IPC; empty env and no socket; fixture mode restores', needsNetworkGate, async () => {
  const { spawn } = await import('node:child_process');
  const { CustomerAiRequestSchema } = await import('../lib/customer-ai-request-schema.mjs');
  const { createDevAiBroker } = await import('../lib/dev-ai-broker.mjs');
  const wire = [];
  let httpCalls = 0;
  write('ai.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import net from 'node:net'; import { createMockContext } from '#cynap/testing'; test('real', async () => { assert.deepEqual(Object.keys(process.env).filter((key) => !key.startsWith('__CF_') && key !== 'NODE_TEST_WORKER_ID'), []); await assert.rejects(new Promise((resolve, reject) => { const socket = net.connect({ host: '127.0.0.1', port: 9 }); socket.on('error', reject); socket.on('connect', () => { socket.destroy(); resolve(); }); }), { code: 'ERR_ACCESS_DENIED' }); await assert.rejects(createMockContext().tools.llm.complete('synthetic', { invalid: 1n }), /developer/); assert.equal(await createMockContext({ llmComplete: () => 'fixture' }).tools.llm.complete('synthetic'), 'real answer'); });`);
  const ran = await runOrgTests({ cwd, argv: ['--real-ai'], stdio: 'pipe',
    createBroker: () => createDevAiBroker({ schema: CustomerAiRequestSchema,
      config: { endpoint: 'vercel', key: { kind: 'op', reference: 'op://local/item/key' }, allowedModels: ['test/model'], defaultModel: 'test/model', maxTokens: 20, callCap: 1 },
      resolveKey: () => 'fake-private-value',
      fetchImpl: async (_url, options) => { httpCalls++; assert.equal(options.headers.Authorization, 'Bearer fake-private-value'); assert.equal(JSON.parse(options.body).max_tokens, 20); return { ok: true, json: async () => ({ choices: [{ message: { content: 'real answer' } }], key: 'fake-private-value' }) }; },
    }),
    spawnImpl: (binary, args, options) => {
      assert.deepEqual(options.env, {});
      assert.doesNotMatch(JSON.stringify([args, options]), /fake-private-value|op:\/\//);
      const child = spawn(binary, args, options);
      child.on('message', (message) => wire.push(message));
      const send = child.send.bind(child);
      child.send = (message, ...rest) => { wire.push(message); return send(message, ...rest); };
      return child;
    },
  });
  assert.equal(ran.ok, true, ran.output);
  assert.equal(ran.aiMode, 'real (developer)');
  assert.equal(httpCalls, 1);
  assert.doesNotMatch(JSON.stringify(wire), /fake-private-value|op:\/\//);
  assert.equal(wire[0].type, 'llmComplete');
  write('ai.test.mjs', `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { createMockContext } from '#cynap/testing'; test('fixture restored', async () => assert.equal(await createMockContext({ llmComplete: () => 'fixture' }).tools.llm.complete('synthetic'), 'fixture'));`);
  const fixtures = await runOrgTests({ cwd, stdio: 'pipe', createBroker: () => { throw new Error('not opted in'); } });
  assert.equal(fixtures.ok, true, fixtures.output);
});

test('broken key binding fails before child spawn, even for an empty run', needsNetworkGate, async () => {
  await assert.rejects(runOrgTests({ cwd, argv: ['--real-ai'], createBroker: () => { throw new Error('developer: configured AI key could not be resolved'); }, spawnImpl: () => { throw new Error('must not spawn'); } }), /could not be resolved/);
});

test('real AI refuses a runtime that cannot deny sockets', () => {
  assert.throws(() => assertNetworkGated('22.18.0', new Set()), /cannot deny network/);
});
