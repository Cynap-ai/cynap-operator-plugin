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
import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertConnectedOrg, listLocalFiles, readState, resolveOrgSlug } from '../lib/workspace-sync.mjs';
import { assertSupportedNode, SANDBOX_ENV, sandboxExecArgv } from '../lib/sandboxed-node.mjs';
import { installTestingContext, testingContextIsCurrent } from '../lib/testing-context.mjs';

export const ORG_TEST_FILE_RE = /\.test\.(?:ts|mts|js|mjs)$/;

export function parseTestArgs(argv) {
  const out = { dir: null, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') out.dir = argv[++i];
    else if (argv[i].startsWith('--')) throw new Error(`cynap-test: unrecognized option "${argv[i]}"`);
    else out.files.push(argv[i]);
  }
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
    ...(flags.has('--experimental-strip-types') ? ['--experimental-strip-types'] : []),
    isolation,
    ...sandboxExecArgv([realDir]),
    ...files,
  ];
}

export async function runOrgTests({ cwd = process.cwd(), argv = [], stdio = 'inherit', spawnImpl = spawn } = {}) {
  assertSupportedNode();
  const args = parseTestArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const dir = args.dir ? resolvePath(cwd, args.dir) : resolvePath(cwd, `cynap-${org}`);
  const state = readState(dir);
  if (!state) throw new Error(`cynap-test: ${dir} is not a pulled working directory — run /cynap-pull first.`);
  assertConnectedOrg(state, org);

  const all = findOrgTests(dir);
  const files = args.files.length > 0 ? args.files : all;
  const unknown = files.filter((file) => !all.includes(file));
  if (unknown.length > 0) throw new Error(`cynap-test: not an org test file in ${dir}: ${unknown.join(', ')}`);
  if (files.length === 0) return { ok: true, exitCode: 0, files, output: '', note: 'no org test files — nothing to run' };

  if (!testingContextIsCurrent(dir)) installTestingContext(dir);

  // Files are passed RELATIVE to the working directory: `node --test` treats its arguments as
  // glob patterns, and an absolute pattern starts its walk at `/`, which the sandbox denies.
  const realDir = realpathSync(dir);
  const child = spawnImpl(process.execPath, nodeTestArgv(realDir, files), {
    cwd: realDir,
    env: SANDBOX_ENV,
    stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code)));
  return { ok: exitCode === 0, exitCode, files, output };
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
  const verdict = result.note ?? `${result.ok ? 'PASS' : 'FAIL'} — ${result.files.length} org test file(s)`;
  process.stdout.write(`\ncynap-test: ${verdict}. Self-assurance only: nothing on the plane reads this result.\n`);
  process.exitCode = result.exitCode;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
