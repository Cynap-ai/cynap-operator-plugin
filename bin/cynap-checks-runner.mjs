#!/usr/bin/env node
// The operator-local org-checks runner (spec §5).
//
// Zero external dependencies — Node built-ins only (the operator-proxy.mjs convention). Runs
// ENTIRELY operator-local as part of authoring: it reads the operator's LOCAL /cynap-connect
// working-dir pending bytes for the asserted-over config files (NEVER the workspace read tools,
// which serve the stale deployed HEAD), reads the deployed HEAD `checks/**` suites through the
// local operator proxy (HEAD-correct there, since checks are DEFERRED and only a git-merged
// checks file gates anything), computes the verdict + the resultant-content fingerprint from a
// SINGLE snapshot so a mid-run edit cannot pass on stale bytes, and reports the terminal verdict
// via the `checks_verdict_report` MCP tool. The backend recomputes the fingerprint server-side
// and refuses on mismatch — so this attestation cannot gate untested content.
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

const DEFAULT_PROXY_URL = process.env.CYNAP_OPERATOR_MCP_URL ?? 'http://127.0.0.1:8790/mcp';

function parseArgs(argv) {
  const args = { workdir: process.cwd(), proxyUrl: DEFAULT_PROXY_URL, commitSha: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--commit-sha') args.commitSha = argv[++i];
    else if (flag === '--workdir') args.workdir = argv[++i];
    else if (flag === '--proxy-url') args.proxyUrl = argv[++i];
  }
  return args;
}

function die(message) {
  process.stderr.write(`cynap-checks: ${message}\n`);
  process.exit(1);
}

let rpcId = 0;
async function mcpCall(proxyUrl, name, args) {
  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!response.ok) {
    const pathSuffix = args && typeof args.path === 'string' ? `(${args.path})` : '';
    throw new Error(`MCP ${name}${pathSuffix} HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) throw new Error(`MCP ${name} error: ${JSON.stringify(body.error)}`);
  // Prefer the structured content; fall back to the first text block.
  const result = body.result ?? {};
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find?.((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : result;
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

async function fetchHeadCheckFiles(proxyUrl) {
  // The DEPLOYED HEAD checks/** tree (HEAD-correct: checks are DEFERRED, only a git-merged file
  // gates). workspace_tree lists; workspace_get_file returns bytes (base64 or utf8 content).
  const tree = await mcpCall(proxyUrl, 'workspace_tree', {});
  const entries = Array.isArray(tree?.entries) ? tree.entries : Array.isArray(tree) ? tree : [];
  const paths = entries
    .map((e) => (typeof e === 'string' ? e : e?.path))
    .filter((p) => typeof p === 'string' && p.startsWith('checks/') && p.endsWith('.json'))
    .sort();
  const bytesByPath = new Map();
  for (const path of paths) {
    const file = await mcpCall(proxyUrl, 'workspace_get_file', { path });
    // A reply without `{encoding, content}` is refused, never read as an empty file: checks
    // that run against zero bytes would pass or fail for the wrong reason.
    if (typeof file?.content !== 'string' || (file.encoding !== 'utf8' && file.encoding !== 'base64')) {
      throw new Error(`workspace_get_file ${path}: reply has no {encoding, content}`);
    }
    bytesByPath.set(path, new Uint8Array(Buffer.from(file.content, file.encoding)));
  }
  return bytesByPath;
}

function readLocalBytes(workdir, relPath) {
  const abs = join(workdir, relPath);
  return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.commitSha || !/^[0-9a-f]{64}$/.test(args.commitSha)) {
    die('missing/invalid --commit-sha (expect the 64-hex commit hash just committed)');
  }

  // Step 0 — load the gate from HEAD; refuse on local-checks drift (spec §5.1 step 0). A draft
  // checks/ file gates NOTHING until git-merged; attesting under it would produce an unexplained
  // checks_verdict_content_mismatch at activation.
  const headChecks = await fetchHeadCheckFiles(args.proxyUrl);
  const localCheckPaths = listLocalCheckFiles(args.workdir);
  const headPaths = [...headChecks.keys()].sort();
  const localBytesForCheck = new Map(localCheckPaths.map((p) => [p, readLocalBytes(args.workdir, p)]));
  const sameSet = headPaths.length === localCheckPaths.length && headPaths.every((p, i) => p === localCheckPaths[i]);
  const sameBytes =
    sameSet &&
    headPaths.every((p) => Buffer.compare(Buffer.from(headChecks.get(p)), Buffer.from(localBytesForCheck.get(p) ?? [])) === 0);
  if (!sameBytes) {
    die('your local checks/ differs from the deployed HEAD — a draft gates nothing until git-merged. Merge the checks change first, then re-run.');
  }

  // Parse the HEAD suites (the authoritative gate). A HEAD suite that fails to parse is fatal.
  const suites = [];
  for (const path of headPaths) {
    try {
      suites.push(JSON.parse(Buffer.from(headChecks.get(path)).toString('utf8')));
    } catch {
      die(`deployed checks suite ${path} is not valid JSON`);
    }
  }

  // Step 1 — snapshot every F path ONCE: HEAD bytes for the checks/** suites, LOCAL pending bytes
  // for every asserted-over config file (§5.1 step 1 — one snapshot for both evaluation AND the
  // fingerprint, so a mid-run edit can't pass assertions on old bytes while fingerprinting new).
  const fPaths = collectFingerprintPaths(suites, headPaths);
  const snapshot = new Map();
  for (const path of fPaths) {
    if (headChecks.has(path)) snapshot.set(path, headChecks.get(path)); // checks/** → HEAD
    else snapshot.set(path, readLocalBytes(args.workdir, path)); // asserted config → LOCAL pending
  }
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
    `${JSON.stringify({ status: run.status, total: run.total, passed: run.passed, failed: run.failed, resultant_fingerprint: fingerprint, reported }, null, 2)}\n`
  );
  process.exit(run.status === 'pass' ? 0 : 2);
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
