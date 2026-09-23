#!/usr/bin/env node
// /cynap-push — spec §7.3. Plans create/update/delete against `.cynap/state.json`, refuses
// locally on a non-activatable path, runs the org's checks/ suite (if any) against the planned
// bytes, validates against the tip, and commits. Never activates (spec: "/cynap-push never
// activates"). Zero external dependencies — Node built-ins + sibling lib modules only.

import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import { encodeContent } from '../lib/content-codec.mjs';
import { classifyPath, collectFingerprintPaths, evaluateChecks } from './cynap-checks-core.mjs';
import { buildPushPlan } from '../lib/workspace-diff.mjs';
import { classifyForPush } from '../lib/workspace-kinds.mjs';
import { runChecksPreflight } from '../lib/workspace-checks-preflight.mjs';
import {
  assertConnectedOrg,
  listLocalFiles,
  mcpCall,
  readState,
  resolveOrgSlug,
  sha256Hex,
  writeStateAtomic,
} from '../lib/workspace-sync.mjs';

const VALID_INTENTS = new Set(['edit', 'repair', 'revert', 'provision', 'migration', 'drift_repair']);
const SURFACE_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * The surface build gate's refusal codes, one operator-facing line each. The server sends the
 * findings (the log excerpt) and a fix hint; this names what went wrong. Keys are pinned to the
 * server's refusal-code list by a private parity test, so a code the server can send never
 * reaches an operator as an unexplained failure.
 */
export const SURFACE_REFUSAL_MESSAGES = Object.freeze({
  surface_build_failed: 'the surface build failed',
  surface_lint_failed: 'the surface source uses a construct surfaces may not use',
  surface_import_rejected: 'the surface imports a module outside the allowed set',
  surface_manifest_invalid: 'the surface directory, routes.json or tools.json is invalid',
  surface_tool_not_callable: 'the surface calls a tool it may not call',
  surface_csp_not_empty: 'a _meta.ui.csp domain list is not empty',
  surface_too_large: 'the built surface bundle is over its size cap',
  surface_too_many: 'this push touches more than one surface',
  surface_receipt_invalid: 'the platform could not verify the build',
  surface_build_busy: 'another surface build for this org is running',
  surface_build_timeout: 'the surface build did not fit in this request',
});

export function parsePushArgs(argv) {
  const args = { dir: null, dryRun: false, message: null, intent: 'edit', proxyUrl: null, rebuild: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dir') args.dir = argv[++i];
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '-m' || flag === '--message') args.message = argv[++i];
    else if (flag === '--intent') args.intent = argv[++i];
    else if (flag === '--proxy-url') args.proxyUrl = argv[++i];
    else if (flag === '--rebuild') args.rebuild = argv[++i];
    else throw new Error(`cynap-push: unrecognized argument "${flag}"`);
  }
  if (!args.dryRun && !args.message) throw new Error('cynap-push: -m/--message is required (unless --dry-run)');
  if (!VALID_INTENTS.has(args.intent)) {
    throw new Error(`cynap-push: --intent must be one of ${[...VALID_INTENTS].join(', ')}`);
  }
  if (args.rebuild !== null && !SURFACE_ID_PATTERN.test(args.rebuild ?? '')) {
    throw new Error('cynap-push: --rebuild needs a surface id (the <id> of surfaces/<id>/)');
  }
  return args;
}

function readLocalFileMap(dir) {
  const map = new Map();
  for (const path of listLocalFiles(dir)) map.set(path, sha256Hex(readFileSync(join(dir, path))));
  return map;
}

export async function push({ cwd = process.cwd(), argv = [], fetchImpl = fetch } = {}) {
  const args = parsePushArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const proxyUrl = args.proxyUrl ?? `http://127.0.0.1:${stablePortForSlug(org)}/mcp`;
  const dir = args.dir ? resolvePath(cwd, args.dir) : resolvePath(cwd, `cynap-${org}`);

  const state = readState(dir);
  if (!state) return { ok: false, reason: 'no_state', message: `${dir}: no .cynap/state.json — run /cynap-pull first.` };
  assertConnectedOrg(state, org);

  const base = new Map(Object.entries(state.files));
  const local = readLocalFileMap(dir); // throws WorkspaceSyncError on a symlink (spec §7.1)
  const plan = buildPushPlan({ base, local });

  // `--rebuild <surfaceId>` is a no-change operator commit — the platform never
  // commits into an org chain, so a new SDK minor reaches a surface only through this push.
  if (!args.rebuild && plan.creates.length === 0 && plan.updates.length === 0 && plan.deletes.length === 0) {
    return { ok: true, noop: true, message: 'nothing to push — the local tree matches the last pull.' };
  }

  // Step 1: refuse locally on a non-activatable path, naming each path's entrance (spec §4.3/§7.3).
  const touched = [...plan.creates, ...plan.updates, ...plan.deletes];
  const refusals = touched.map((path) => classifyForPush(path, classifyPath)).filter(Boolean);
  if (refusals.length > 0) {
    return {
      ok: false,
      reason: 'kind_not_activatable',
      refusals,
      message: refusals.map((r) => `${r.path}: ${r.kind}${r.entrance ? ` (entrance: ${r.entrance})` : ''}`).join('\n'),
    };
  }

  const plannedBytes = new Map();
  for (const path of [...plan.creates, ...plan.updates]) plannedBytes.set(path, readFileSync(join(dir, path)));
  for (const path of plan.deletes) plannedBytes.set(path, null);

  const call = (name, callArgs) => mcpCall(proxyUrl, name, callArgs, { fetchImpl });

  // Step 2: checks preflight — no skip flag, because a commit that can't activate blocks the chain.
  const preflight = await runChecksPreflight({
    call,
    resolvePlanned: (path) => (plannedBytes.has(path) ? plannedBytes.get(path) : undefined),
    evaluateChecks,
    collectFingerprintPaths,
  });
  if (preflight.ran && preflight.run.status === 'fail') {
    const f = preflight.firstFailure;
    return {
      ok: false,
      reason: 'checks_failed',
      run: preflight.run,
      message: `checks failed: ${f ? `${f.op} ${f.file}: ${f.detail}` : 'unknown assertion failed'}`,
    };
  }

  const operations = [
    ...plan.creates.map((path) => ({ op: 'create', path, ...encodeContent(plannedBytes.get(path)) })),
    ...plan.updates.map((path) => ({ op: 'update', path, ...encodeContent(plannedBytes.get(path)) })),
    ...plan.deletes.map((path) => ({ op: 'delete', path })),
  ];
  const changes = { operations };

  // Step 3: validate against the tip; refuse on findings.
  const validated = await call('workspace_validate', { changes });
  if (validated?.ok === false) {
    return { ok: false, reason: 'validation_failed', result: validated, message: `workspace_validate refused: ${validated.code}` };
  }

  if (args.dryRun) {
    return { ok: true, dryRun: true, plan, checksRan: preflight.ran, validated };
  }

  // Step 4: commit.
  const committed = await call('workspace_commit', {
    changes,
    message: args.message,
    intent: args.intent,
    expected_head_sha: state.base,
    ...(args.rebuild ? { rebuild_surface_id: args.rebuild } : {}),
  });

  if (committed?.ok === false) {
    if (committed.code === 'parent_mismatch') {
      return {
        ok: false,
        reason: 'parent_mismatch',
        tip: committed.tip,
        message: `the accepted tip moved — run /cynap-pull. Current tip: ${committed.tip?.sha} by ${committed.tip?.author_id}: "${committed.tip?.message}"`,
      };
    }
    if (committed.code === 'chain_full') {
      return {
        ok: false,
        reason: 'chain_full',
        depth: committed.depth,
        nextCommitSha: committed.next_commit_sha,
        message: `the accepted chain is full (${committed.depth} pending) — activate or discard a pending commit before pushing again.`,
      };
    }
    if (Object.hasOwn(SURFACE_REFUSAL_MESSAGES, committed.code)) {
      return {
        ok: false,
        reason: committed.code,
        result: committed,
        findings: Array.isArray(committed.findings) ? committed.findings : [],
        hint: typeof committed.hint === 'string' ? committed.hint : null,
        retryable: committed.retryable === true,
        message: `${committed.code}: ${SURFACE_REFUSAL_MESSAGES[committed.code]}.`,
      };
    }
    return { ok: false, reason: committed.code, result: committed, message: `workspace_commit refused: ${committed.code}` };
  }

  const commitSha = committed.commit.commit_sha;

  // Step 5: update state atomically.
  const nextFiles = { ...state.files };
  for (const path of plan.creates) nextFiles[path] = local.get(path);
  for (const path of plan.updates) nextFiles[path] = local.get(path);
  for (const path of plan.deletes) delete nextFiles[path];
  writeStateAtomic(dir, { org, base: commitSha, files: nextFiles });

  // Step 6: print the chain position + Spec A's activation block (verbatim, when present).
  const readBack = await call('workspace_get_commit', { sha: commitSha });

  return {
    ok: true,
    commitSha,
    replayed: committed.replayed === true,
    plan,
    state: readBack?.ok === false ? null : readBack?.state ?? null,
    position: readBack?.ok === false ? null : readBack?.position ?? null,
    activation: committed.activation ?? null,
  };
}

function formatFinding(finding) {
  const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ''}` : ''}: ` : '';
  return `  ${where}${finding.message} [${finding.rule}]`;
}

/** The surface refusal block: the log excerpt, then the fix hint. */
export function formatSurfaceRefusal(result) {
  const lines = (result.findings ?? []).slice(0, 20).map(formatFinding);
  if ((result.findings ?? []).length > 20) lines.push(`  … ${result.findings.length - 20} more`);
  if (result.hint) lines.push(`Fix: ${result.hint}`);
  if (result.retryable) lines.push('This is retryable — re-run /cynap-push.');
  return lines.join('\n');
}

function printRefusal(result) {
  process.stderr.write(`cynap-push: ${result.message}\n`);
  if (Object.hasOwn(SURFACE_REFUSAL_MESSAGES, result.reason)) {
    const block = formatSurfaceRefusal(result);
    if (block) process.stderr.write(`${block}\n`);
  }
  if (result.reason === 'parent_mismatch') process.stderr.write('Run /cynap-pull, then re-run /cynap-push.\n');
  if (result.reason === 'checks_failed') process.stderr.write('Fix the config and re-run — there is no skip flag.\n');
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await push({ argv });
  } catch (error) {
    // A local-safety violation (a symlink in the tree, a malformed state.json) THROWS rather
    // than returning a structured {ok:false} — same stderr+exit1 shape either way.
    process.stderr.write(`cynap-push: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    printRefusal(result);
    process.exitCode = 1;
    return result;
  }
  if (result.noop) {
    process.stdout.write(`${result.message}\n`);
    return result;
  }
  if (result.dryRun) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, plan: result.plan, checksRan: result.checksRan }, null, 2)}\n`);
    return result;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        commit_sha: result.commitSha,
        replayed: result.replayed,
        chain_state: result.state,
        chain_position: result.position,
        activation: result.activation,
      },
      null,
      2
    )}\n`
  );
  if (!result.activation) {
    process.stdout.write('(no activation guidance in this response — Spec A’s next_action block is not yet returned by workspace_commit)\n');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
