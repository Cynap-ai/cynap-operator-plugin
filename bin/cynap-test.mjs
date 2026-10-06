#!/usr/bin/env node
// /cynap-test — runs the org's tests on this machine.
//
// Org tests are `node:test` + `node:assert/strict` files (`*.test.ts`, `*.test.mts`, `*.test.js`,
// `*.test.mjs`) anywhere in the pulled working directory. They import the test context as
// `#cynap/testing`, which /cynap-pull installs. This command:
//   - refuses Node older than 22.18 and names the version it found;
//   - passes every test file EXPLICITLY (default discovery would miss `__tests__/`);
//   - runs `node --test` in ONE sandboxed process (`--test-isolation=none`, because the sandbox
//     forbids the child processes per-file isolation would spawn) with read access to the working
//     directory only: no writes, no child processes, an empty environment, and on Node >= 25 no
//     network. Pulled test files are untrusted — another seat may have written them.
//
// The verdict is self-assurance for the operator. Nothing on the plane or in platform CI reads it.
//
// Usage: node cynap-test.mjs [--dir <pulled dir>] [file…]
// Zero dependencies — Node built-ins + sibling modules only.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertConnectedOrg, listLocalFiles, readState, resolveOrgSlug, resolveWorkspaceDir } from '../lib/workspace-sync.mjs';
import { assertSupportedNode, assertNetworkGated, SANDBOX_ENV, sandboxExecArgv } from '../lib/sandboxed-node.mjs';
import { installTestingContext, testingContextIsCurrent } from '../lib/testing-context.mjs';

import { createDevAiBroker, bindDevAiBroker } from '../lib/dev-ai-broker.mjs';
import { warnCustomerAiReadiness } from '../lib/customer-ai-readiness-warning.mjs';

export const ORG_TEST_FILE_RE = /\.test\.(?:ts|mts|js|mjs|cjs)$/;
export const UNSUPPORTED_EXIT_CODE = 2;

const BUILTIN_SPECIFIERS = new Set([ 'node:test', 'node:assert', 'node:assert/strict' ]);

/** Detect runner/import shapes that this dependency-free sandbox cannot execute. */
export function inspectOrgTest(dir, file) {
  const source = readFileSync(resolvePath(dir, file), 'utf8');
  if (/\b(?:from\s*|import\s*\(|require\s*\()\s*['"]vitest(?:\/[^'"]*)?['"]/.test(source)) {
    return {
      file,
      reason: 'uses Vitest, which /cynap-test does not provide',
      fix: 'rewrite with node:test and node:assert/strict',
    };
  }

  const requireFromTest = createRequire(resolvePath(dir, file));
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  for (const specifier of specifiers) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('#') ||
      specifier.startsWith('node:') ||
      BUILTIN_SPECIFIERS.has(specifier)
    ) continue;
    try {
      requireFromTest.resolve(specifier);
    } catch {
      return {
        file,
        reason: `imports unavailable package "${specifier}"`,
        fix: 'remove the dependency or use a package available in the pulled workspace',
      };
    }
  }
  return null;
}

/**
 * The plugin-owned root package.json is `type: module`, so Node would load a `.js` test as ESM and
 * `require` would be undefined. A `.js` file that calls require() and has no ESM import/export is
 * CommonJS: it runs through a generated shim under `.cynap/` that compiles it as CJS in place
 * (relative requires still resolve from the test's own directory). Returns the path to pass to
 * `node --test`, relative to `realDir`.
 */
export function commonJsShimFor(realDir, file) {
  const source = readFileSync(resolvePath(realDir, file), 'utf8');
  const isCommonJs = file.endsWith('.js') && /\brequire\s*\(/.test(source) && !/^\s*(?:import|export)\b/m.test(source);
  if (!isCommonJs) return file;
  const shimRel = `.cynap/cjs-shims/${createHash('sha256').update(file).digest('hex').slice(0, 16)}.test.mjs`;
  const shim = [
    "import Module from 'node:module';",
    "import { readFileSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    `const file = ${JSON.stringify(resolvePath(realDir, file))};`,
    // Org `.js` files the test require()s are CommonJS too (node_modules keeps its own package type).
    `const root = ${JSON.stringify(`${realDir}/`)};`,
    "const loadJs = Module._extensions['.js'];",
    "Module._extensions['.js'] = (m, filename) => {",
    "  if (filename.startsWith(root) && !filename.includes('/node_modules/')) m._compile(readFileSync(filename, 'utf8'), filename);",
    '  else loadJs(m, filename);',
    '};',
    'const mod = new Module(file);',
    'mod.filename = file;',
    'mod.paths = Module._nodeModulePaths(dirname(file));',
    "mod._compile(readFileSync(file, 'utf8'), file);",
    '',
  ].join('\n');
  mkdirSync(resolvePath(realDir, '.cynap/cjs-shims'), { recursive: true });
  writeFileSync(resolvePath(realDir, shimRel), shim);
  return shimRel;
}

export function parseTestArgs(argv) {
  const out = { dir: null, files: [], realAi: false, model: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') out.dir = argv[++i];
    else if (argv[i] === '--real-ai') out.realAi = true;
    else if (argv[i] === '--model') {
      out.model = argv[++i];
      if (!out.model || out.model.startsWith('--')) throw new Error('cynap-test: --model needs a value');
    }
    else if (argv[i].startsWith('--')) throw new Error(`cynap-test: unrecognized option "${argv[i]}"`);
    else out.files.push(argv[i]);
  }
  if (out.model && !out.realAi) throw new Error('cynap-test: --model requires --real-ai');
  return out;
}

/** Every org test file in the working directory, as POSIX-relative paths. */
export function findOrgTests(dir) {
  return listLocalFiles(dir).filter((path) => !path.split('/').includes('node_modules') && ORG_TEST_FILE_RE.test(path));
}

/** The flags that run `node --test` in-process inside the sandbox. */
export function nodeTestArgv(realDir, files, flags = process.allowedNodeEnvironmentFlags) {
  const isolation = flags.has('--test-isolation')
    ? '--test-isolation=none'
    : flags.has('--experimental-test-isolation')
      ? '--experimental-test-isolation=none'
      : null;
  if (!isolation) {
    throw new Error(`cynap-test: Node ${process.versions.node} cannot run tests in-process, which the sandbox requires.`);
  }
  return [
    '--test',
    '--test-reporter=tap',
    ...(flags.has('--experimental-strip-types') ? ['--experimental-strip-types'] : []),
    isolation,
    ...sandboxExecArgv([realDir]),
    ...files,
  ];
}

export async function runOrgTests({ cwd = process.cwd(), argv = [], stdio = 'inherit', spawnImpl = spawn, createBroker = createDevAiBroker, warnReadiness = warnCustomerAiReadiness } = {}) {
  assertSupportedNode();
  const args = parseTestArgs(argv);
  if (args.realAi) assertNetworkGated();
  const aiMode = args.realAi ? 'real (developer)' : 'fixtures';
  const org = resolveOrgSlug({ cwd });
  const dir = resolveWorkspaceDir({ cwd, dir: args.dir, org });
  const state = readState(dir);
  if (!state) throw new Error(`cynap-test: ${dir} is not a pulled working directory — run /cynap-pull first.`);
  assertConnectedOrg(state, org, dir);

  // Resolve before any child, including empty runs: an opted-in broken binding is loud.
  const broker = args.realAi ? await createBroker({ model: args.model }) : null;
  const all = findOrgTests(dir);
  const requested = args.files.length > 0 ? args.files : all;
  const unknown = requested.filter((file) => !all.includes(file));
  if (unknown.length > 0) throw new Error(`cynap-test: not an org test file in ${dir}: ${unknown.join(', ')}`);
  const unsupported = requested.map((file) => inspectOrgTest(dir, file)).filter(Boolean);
  const files = requested.filter((file) => !unsupported.some((item) => item.file === file));
  // Advisory org readiness never chooses the local payer or gates the sandboxed test.
  await warnReadiness({ org });

  if (files.length === 0 && unsupported.length > 0) {
    return { ok: false, exitCode: UNSUPPORTED_EXIT_CODE, files, aiMode, unsupported, passed: 0, failed: 0, output: '' };
  }
  if (files.length === 0) return { ok: true, exitCode: 0, files, aiMode, output: '', note: 'no org test files — nothing to run' };

  if (args.realAi || !testingContextIsCurrent(dir)) installTestingContext(dir, { realAi: args.realAi });

  // Files are passed RELATIVE to the working directory: `node --test` treats its arguments as
  // glob patterns, and an absolute pattern starts its walk at `/`, which the sandbox denies.
  const realDir = realpathSync(dir);
  const child = spawnImpl(process.execPath, nodeTestArgv(realDir, files.map((file) => commonJsShimFor(realDir, file))), {
    cwd: realDir,
    env: SANDBOX_ENV,
    stdio: ['ignore', 'pipe', 'pipe', ...(broker ? ['ipc'] : [])],
  });
  if (broker) bindDevAiBroker(child, broker);
  let output = '';
  const capture = (chunk) => {
    output += chunk;
    if (stdio !== 'pipe') process.stdout.write(chunk);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code)));
  const passed = Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
  const failed = Number(output.match(/^# fail (\d+)$/m)?.[1] ?? 0);
  return { ok: exitCode === 0, exitCode, files, aiMode, unsupported, passed, failed, output };
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await runOrgTests({ argv });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return { ok: false };
  }
  for (const item of result.unsupported ?? []) {
    process.stderr.write(`UNSUPPORTED ${item.file}: ${item.reason}; ${item.fix}.\n`);
  }
  const verdict = result.note ??
    `passed ${result.passed} — failed ${result.failed} — unsupported ${(result.unsupported ?? []).length}`;
  process.stdout.write(`\ncynap-test: AI ${result.aiMode}; ${verdict}. Self-assurance only: nothing on the plane reads this result.\n`);
  process.exitCode = result.exitCode;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
