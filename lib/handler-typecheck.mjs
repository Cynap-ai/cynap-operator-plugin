// Strict `tsc` over the org's handler sources, run by /cynap-checks before a push.
//
// Once an org's config lives only on the platform, no repository build typechecks its handlers.
// So the operator's machine runs the strict check before the push: every handler source
// (`automations/*.ts`, `automations/handlers/*/handler.ts`) against the bundled `@cynap/sdk`
// declarations (lib/cynap-sdk-types.mjs) and Node's own types. The platform runs the same check
// at commit time, from the same pins and options (lib/handler-typecheck-contract.mjs).
//
// The plugin has no dependencies, so the compiler — plus the schema library the SDK declarations
// import, at the version they were built against — is fetched once, pinned, into a per-user cache
// (`npm install --prefix`). When that cannot happen — no npm, offline — the check reports NOT RUN
// with the reason; it never reports a pass it did not earn. Set CYNAP_TYPECHECK_TOOLCHAIN to a
// directory whose node_modules already holds both packages to skip the fetch.
//
// Zero dependencies — Node built-ins + sibling modules only.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';

import { classifyPath } from '../bin/cynap-checks-core.mjs';
import { CYNAP_SDK_DECLARATIONS } from './cynap-sdk-types.mjs';
import { handlerCompilerOptions, TOOLCHAIN_PINS } from './handler-typecheck-contract.mjs';
import { listLocalFiles } from './workspace-sync.mjs';

export { TOOLCHAIN_PINS };

/** The SDK registry decides what a handler source is: an `org-test` under `automations/` never is. */
export function findHandlerSources(dir) {
  return listLocalFiles(dir).filter((path) => classifyPath(path) === 'handler-source' && !path.endsWith('.d.ts'));
}

function toolchainComplete(root) {
  return (
    existsSync(join(root, 'node_modules', 'typescript', 'bin', 'tsc')) &&
    existsSync(join(root, 'node_modules', '@types', 'node', 'package.json')) &&
    existsSync(join(root, 'node_modules', 'zod', 'package.json'))
  );
}

/** Returns `{ ok: true, root }` or `{ ok: false, reason }`. Installs the pinned compiler once. */
export function resolveToolchain({
  env = process.env,
  cacheRoot = join(homedir(), '.cache', 'cynap-operator', 'typecheck'),
  execImpl = execFileSync,
} = {}) {
  if (env.CYNAP_TYPECHECK_TOOLCHAIN) {
    const root = resolvePath(env.CYNAP_TYPECHECK_TOOLCHAIN);
    return toolchainComplete(root)
      ? { ok: true, root }
      : { ok: false, reason: `CYNAP_TYPECHECK_TOOLCHAIN=${root} lacks node_modules/typescript, @types/node or zod` };
  }
  const root = join(cacheRoot, Object.entries(TOOLCHAIN_PINS).map(([name, version]) => `${name.replace('/', '-')}-${version}`).join('_'));
  if (toolchainComplete(root)) return { ok: true, root };
  try {
    mkdirSync(root, { recursive: true });
    execImpl(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      [
        'install',
        '--prefix',
        root,
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        ...Object.entries(TOOLCHAIN_PINS).map(([name, version]) => `${name}@${version}`),
      ],
      { stdio: 'pipe', timeout: 180_000 }
    );
  } catch (error) {
    return { ok: false, reason: `could not install the pinned compiler (${error instanceof Error ? error.message.split('\n')[0] : error})` };
  }
  return toolchainComplete(root) ? { ok: true, root } : { ok: false, reason: `the compiler install at ${root} is incomplete` };
}

/**
 * The /cynap-checks view of a typecheck: writes each diagnostic (or the NOT RUN reason) to
 * `write`, and returns the summary the runner prints and exits on. A check that could not run
 * says so — it is never reported as a pass.
 */
export function reportTypecheck(dir, { write = (line) => process.stderr.write(`${line}\n`), typecheck = typecheckHandlers } = {}) {
  const result = typecheck(dir);
  if (!result.ran) {
    write(`cynap-checks: strict handler typecheck NOT RUN — ${result.reason}`);
    return { status: 'not_run', reason: result.reason };
  }
  for (const d of result.diagnostics) write(`${d.file}:${d.line}:${d.column} ${d.code} ${d.message}`);
  return { status: result.ok ? 'pass' : 'fail', files: result.files.length, errors: result.diagnostics.length };
}

const DIAGNOSTIC_RE =/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/**
 * Typechecks every handler source in `dir`. Returns
 * `{ ran: true, ok, files, diagnostics }` or `{ ran: false, reason }`.
 */
export function typecheckHandlers(dir, { toolchain = resolveToolchain(), execImpl = execFileSync } = {}) {
  const files = findHandlerSources(dir);
  if (files.length === 0) return { ran: true, ok: true, files, diagnostics: [] };
  if (!toolchain.ok) return { ran: false, reason: toolchain.reason };

  const scratch = mkdtempSync(join(tmpdir(), 'cynap-typecheck-'));
  try {
    // A real package layout: `@cynap/sdk` holds the bundled declarations, and its one outside
    // import resolves to the pinned install through a sibling link.
    const sdkRoot = join(scratch, 'node_modules', '@cynap', 'sdk');
    for (const [path, text] of Object.entries(CYNAP_SDK_DECLARATIONS)) {
      mkdirSync(dirname(join(sdkRoot, path)), { recursive: true });
      writeFileSync(join(sdkRoot, path), text);
    }
    symlinkSync(join(toolchain.root, 'node_modules', 'zod'), join(scratch, 'node_modules', 'zod'), 'dir');
    const tsconfig = join(scratch, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: handlerCompilerOptions({ typeRoot: join(toolchain.root, 'node_modules', '@types'), sdkRoot }),
        files: files.map((file) => resolvePath(dir, file)),
      })
    );
    let output = '';
    try {
      // Run from the working directory so every diagnostic path is relative to it.
      execImpl(process.execPath, [join(toolchain.root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', tsconfig, '--pretty', 'false'], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      if (!output.trim()) return { ran: false, reason: `the compiler failed without diagnostics (${error.message})` };
    }
    const diagnostics = output
      .split('\n')
      .map((line) => line.match(DIAGNOSTIC_RE))
      .filter(Boolean)
      .map(([, file, line, column, code, message]) => ({
        file: relative(resolvePath(dir), resolvePath(dir, file)).split(sep).join('/'),
        line: Number(line),
        column: Number(column),
        code,
        message,
      }));
    if (output.trim() && diagnostics.length === 0) {
      return { ran: false, reason: `the compiler failed with output this check cannot read: ${output.slice(0, 500)}` };
    }
    return { ran: true, ok: diagnostics.length === 0, files, diagnostics };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
