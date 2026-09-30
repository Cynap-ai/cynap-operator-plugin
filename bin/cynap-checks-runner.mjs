#!/usr/bin/env node
// The operator-local org-checks runner (spec §5).
//
// Zero external dependencies — Node built-ins only (the operator-proxy.mjs convention). Runs
// ENTIRELY operator-local as part of authoring: it reads the operator's LOCAL /cynap-connect
// working-dir bytes for BOTH the `checks/**` suites and the asserted-over config files — the same
// pending suites the activation gate evaluates — computes the verdict +
// the resultant-content fingerprint from a SINGLE snapshot so a mid-run edit cannot pass on stale
// bytes, and reports the terminal verdict via the `checks_verdict_report` MCP tool. The verdict is
// self-assurance: the activation gate re-interprets the suites itself and never reads it.
//
// Usage:
//   node cynap-checks-runner.mjs --commit-sha <64hex> [--workdir <dir>] [--proxy-url <url>]
//
// The proxy URL defaults to the loopback operator MCP proxy (operator-proxy.mjs); the proxy
// injects the fresh operator Bearer token, so this script never handles a credential.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  computeResultantFingerprint,
  collectFingerprintPaths,
  evaluateChecks,
} from './cynap-checks-core.mjs';
// The ONE loopback entry, shared with /cynap-pull and /cynap-push. This file
// used to carry its own byte-for-byte copy of it; two copies meant the
// connection- and consent-failure sentences could only ever be right in one of
// them.
import { mcpCall } from '../lib/workspace-sync.mjs';
import { reportTypecheck } from '../lib/handler-typecheck.mjs';

const DEFAULT_PROXY_URL = process.env.CYNAP_OPERATOR_MCP_URL ?? 'http://127.0.0.1:8790/mcp';

function parseArgs(argv) {
  const args = { workdir: process.cwd(), proxyUrl: DEFAULT_PROXY_URL, commitSha: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--commit-sha') args.commitSha = argv[++i];
    else if (flag === '--workdir') args.workdir = argv[++i];
    else if (flag === '--proxy-url') args.proxyUrl = argv[++i];
    else if (flag === '--typecheck-only') args.typecheckOnly = true;
  }
  return args;
}

// Strict `tsc` over the handler sources, run before the checks so failures surface before a push.
// `--typecheck-only` stops there (no commit sha needed); a failure exits 3.
function typecheckFirst(args) {
  const typecheck = reportTypecheck(args.workdir);
  if (args.typecheckOnly) {
    process.stdout.write(`${JSON.stringify({ typecheck }, null, 2)}\n`);
    process.exit(typecheck.status === 'fail' ? 3 : 0);
  }
  return typecheck;
}

function die(message) {
  process.stderr.write(`cynap-checks: ${message}\n`);
  process.exit(1);
}

// Recursively list the `checks/` JSON suites under the workdir → workspace-relative POSIX paths.
function listLocalCheckFiles(workdir) {
  const root = join(workdir, 'checks');
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith('.json')) out.push(relative(workdir, abs).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

function readLocalBytes(workdir, relPath) {
  const abs = join(workdir, relPath);
  return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const typecheck = typecheckFirst(args);
  if (!args.commitSha || !/^[0-9a-f]{64}$/.test(args.commitSha)) {
    die('missing/invalid --commit-sha (expect the 64-hex commit hash just committed)');
  }

  // Step 0 — load the PENDING suites from the working dir. A suite that fails to parse is fatal.
  const suitePaths = listLocalCheckFiles(args.workdir);
  const suites = [];
  for (const path of suitePaths) {
    try {
      suites.push(JSON.parse(Buffer.from(readLocalBytes(args.workdir, path)).toString('utf8')));
    } catch {
      die(`checks suite ${path} is not valid JSON`);
    }
  }

  // Step 1 — snapshot every F path ONCE from the LOCAL working dir (§5.1 step 1 — one snapshot for
  // both evaluation AND the fingerprint, so a mid-run edit can't pass assertions on old bytes while
  // fingerprinting new).
  const fPaths = collectFingerprintPaths(suites, suitePaths);
  const snapshot = new Map(fPaths.map((path) => [path, readLocalBytes(args.workdir, path)]));
  const resolve = (path) => snapshot.get(path) ?? null;

  // Steps 2+3 — evaluate + fingerprint from the SAME snapshot.
  const run = evaluateChecks(suites, resolve);
  const fingerprint = computeResultantFingerprint(fPaths.map((path) => ({ path, bytes: snapshot.get(path) ?? null })));

  const firstFailure = run.suites
    .flatMap((s) => s.assertions)
    .find((a) => !a.passed);
  const failureSummary = firstFailure ? `${firstFailure.op} ${firstFailure.file}: ${firstFailure.detail}` : undefined;

  // Step 4 — report the terminal verdict, bound to (commit_sha ⋈ resultant_fingerprint).
  const reported = await mcpCall(args.proxyUrl, 'checks_verdict_report', {
    checks_run_id: randomUUID(),
    commit_sha: args.commitSha,
    resultant_fingerprint: fingerprint,
    status: run.status,
    checks_run: { total: run.total, passed: run.passed, failed: run.failed },
    ...(failureSummary ? { failure_summary: failureSummary.slice(0, 2000) } : {}),
  });

  process.stdout.write(
    `${JSON.stringify({ status: run.status, total: run.total, passed: run.passed, failed: run.failed, resultant_fingerprint: fingerprint, reported, typecheck }, null, 2)}\n`
  );
  process.exit(run.status !== 'pass' ? 2 : typecheck.status === 'fail' ? 3 : 0);
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
