#!/usr/bin/env node
// /cynap-push — spec §7.3. Plans create/update/delete against `.cynap/state.json`, refuses
// locally on a non-activatable path, runs the org's checks/ suite (if any) against the planned
// bytes, validates against the tip, and commits. Never activates (spec: "/cynap-push never
// activates"). Zero external dependencies — Node built-ins + sibling lib modules only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import { encodeContent } from '../lib/content-codec.mjs';
import { classifyPath, collectFingerprintPaths, effectForKind, evaluateChecks } from './cynap-checks-core.mjs';
import { buildPushPlan } from '../lib/workspace-diff.mjs';
import { checkPushEffects, classifyForPush } from '../lib/workspace-kinds.mjs';
import { runChecksPreflight } from '../lib/workspace-checks-preflight.mjs';
import { formatRefusal, refusalErrors, refusalRunId, SURFACE_REFUSAL_MESSAGES, PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import {
  assertConnectedOrg,
  listLocalFiles,
  mcpCall,
  readState,
  resolveOrgSlug,
  resolveWorkspaceDir,
  sha256Hex,
  writeStateAtomic,
} from '../lib/workspace-sync.mjs';

const VALID_INTENTS = new Set(['edit', 'repair', 'revert', 'provision', 'migration', 'drift_repair']);
const SURFACE_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

export function parsePushArgs(argv) {
  const args = { dir: null, dryRun: false, json: false, message: null, intent: 'edit', proxyUrl: null, rebuild: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dir') args.dir = argv[++i];
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--json') args.json = true;
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

/**
 * The surfaces a successful commit built: every surface the push touched (or
 * `--rebuild` named) that still has a file after it. A surface the push deleted outright built
 * nothing, so it gets no candidate line.
 */
export function builtSurfaceIds(plan, nextFiles, rebuild) {
  const ids = new Set(rebuild ? [rebuild] : []);
  for (const path of [...plan.creates, ...plan.updates, ...plan.deletes]) {
    const match = /^surfaces\/([^/]+)\//.exec(path);
    if (match) ids.add(match[1]);
  }
  const paths = Object.keys(nextFiles);
  return [...ids].filter((id) => paths.some((path) => path.startsWith(`surfaces/${id}/`))).sort();
}

/** The portal origin the connected proxy logs in against (its `/health` `mintHost`), or null. */
async function readMintHost(proxyUrl, fetchImpl) {
  try {
    const res = await fetchImpl(new URL('/health', proxyUrl).href, { method: 'GET', signal: AbortSignal.timeout(1_500) });
    const health = res?.ok ? await res.json() : null;
    return typeof health?.mintHost === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(health.mintHost) ? health.mintHost : null;
  } catch {
    return null; // No origin: the candidate line prints the portal path alone.
  }
}

/** `<mintHost>/<org>/_surface-candidate/<commit_sha>/<surfaceId>/` (Owner/Admin, read tools only). */
export function candidateUrl(mintHost, org, commitSha, surfaceId) {
  return `${mintHost ?? ''}/${org}/_surface-candidate/${commitSha}/${surfaceId}/`;
}

export async function push({ cwd = process.cwd(), argv = [], fetchImpl = fetch, onPhase = () => {} } = {}) {
  const args = parsePushArgs(argv);
  onPhase('reading local workspace…');
  const org = resolveOrgSlug({ cwd });
  const proxyUrl = args.proxyUrl ?? `http://127.0.0.1:${stablePortForSlug(org)}/mcp`;
  const dir = resolveWorkspaceDir({ cwd, dir: args.dir, org });

  const state = readState(dir);
  if (!state) return { ok: false, reason: 'no_state', message: `${dir}: no .cynap/state.json — run /cynap-pull first.` };
  assertConnectedOrg(state, org, dir);

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
  const effects = checkPushEffects(touched, classifyPath, effectForKind, plan.deletes);
  if (effects) {
    return { ok: false, reason: 'commit_spans_irreversible_effects', effects,
      paths: touched.map((path) => ({ path, class: effectForKind(classifyPath(path)) })),
      message: 'Commit each irreversible effect separately, with only permitted riders. Deleted handler sources may be committed only with inert files.' };
  }
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
  onPhase('running live checks…');
  const preflight = await runChecksPreflight({
    call,
    resolvePlanned: (path) => (plannedBytes.has(path) ? plannedBytes.get(path) : undefined),
    plannedPaths: [...plannedBytes.keys()],
    evaluateChecks,
    collectFingerprintPaths,
    // The pull already holds most of what the preflight reads: reuse a local file whose sha256
    // is the one asked for, and read over the wire only what differs.
    resolveLocal: (path, sha256) => {
      if (local.get(path) !== sha256) return undefined;
      const bytes = readFileSync(join(dir, path));
      return sha256Hex(bytes) === sha256 ? new Uint8Array(bytes) : undefined;
    },
    base: { sha: state.base, files: base },
  });
  if (preflight.ran && preflight.run.status === 'fail') {
    const f = preflight.firstFailure;
    return {
      ok: false,
      reason: 'checks_failed',
      run: preflight.run,
      message: `checks failed: ${f ? `${f.op} ${f.file}: ${f.detail}` : 'unknown assertion failed'}${f?.guidance ? ` — ${f.guidance}` : ''}`,
    };
  }

  const operations = [
    ...plan.creates.map((path) => ({ op: 'create', path, ...encodeContent(plannedBytes.get(path)) })),
    ...plan.updates.map((path) => ({ op: 'update', path, ...encodeContent(plannedBytes.get(path)) })),
    ...plan.deletes.map((path) => ({ op: 'delete', path })),
  ];
  const changes = { operations };

  // Step 3: validate against the tip; refuse on findings.
  onPhase('validating…');
  const validated = await call('workspace_validate', { changes });
  if (validated?.ok === false) {
    return {
      ok: false,
      reason: validated.code ?? 'validation_failed',
      result: validated,
      validationErrors: refusalErrors(validated),
      validationRunId: refusalRunId(validated),
      message: `workspace_validate refused: ${validated.code}${validated.message ? ` — ${validated.message}` : ''}`,
    };
  }
  // A validation RUN that failed carries no `ok` field — only `status` and its findings. It is
  // the verdict workspace_commit reaches for these bytes, so a dry run must not report it as a pass.
  if (validated?.status === 'failed') {
    const errors = Array.isArray(validated.errors) ? validated.errors : [];
    return {
      ok: false,
      reason: 'validation_failed',
      result: validated,
      validationErrors: errors,
      validationRunId: refusalRunId(validated),
      message: `workspace_validate found ${errors.length} error${errors.length === 1 ? '' : 's'} — workspace_commit refuses these bytes.`,
    };
  }

  if (args.dryRun) {
    const liveTree = await call('workspace_tree', { commit: 'live', prefix: 'checks/', include_hashes: true });
    if (liveTree?.ok === false) return { ok: false, reason: liveTree.code, result: liveTree, message: liveTree.message };
    return { ok: true, dryRun: true, plan, checksRan: preflight.ran, checks: preflight.run,
      checkBase: liveTree.commit_sha ?? null, validated };
  }

  // Step 4: commit.
  onPhase('committing…');
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
    return {
      ok: false,
      reason: committed.code,
      result: committed,
      validationErrors: refusalErrors(committed),
      validationRunId: refusalRunId(committed),
      message: `workspace_commit refused: ${committed.code}${committed.message ? ` — ${committed.message}` : ''}`,
    };
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
  const surfaces = builtSurfaceIds(plan, nextFiles, args.rebuild);
  const mintHost = surfaces.length > 0 ? await readMintHost(proxyUrl, fetchImpl) : null;

  return {
    ok: true,
    commitSha,
    replayed: committed.replayed === true,
    plan,
    state: readBack?.ok === false ? null : readBack?.state ?? null,
    position: readBack?.ok === false ? null : readBack?.position ?? null,
    activation: committed.activation ?? null,
    nextAction: committed.activation?.next_action ?? committed.next_action ?? readBack?.next_action ?? null,
    candidateUrls: surfaces.map((id) => candidateUrl(mintHost, org, commitSha, id)),
    surfaceWarnings: Array.isArray(committed.surface_warnings) ? committed.surface_warnings : [],
  };
}

function formatSurfaceWarning(warning) {
  const at = warning.file ? `${warning.file}${warning.line ? `:${warning.line}` : ''}: ` : '';
  return `warning: [${warning.rule}] ${at}${warning.message}`;
}

function printRefusal(result) {
  process.stderr.write(formatRefusal(result));
}

export async function main(argv = process.argv.slice(2), { cwd, fetchImpl } = {}) {
  let result;
  const started = Date.now();
  const onPhase = (phase) => process.stderr.write(`[${Math.floor((Date.now() - started) / 1000)}s] ${phase}\n`);
  try {
    result = await push({ argv, onPhase, cwd, fetchImpl });
  } catch (error) {
    // A local-safety violation (a symlink in the tree, a malformed state.json) THROWS rather
    // than returning a structured {ok:false} — same stderr+exit1 shape either way.
    process.stderr.write(`cynap-push: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.reason === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : 1;
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    printRefusal(result);
    process.exitCode = (result.reason === 'plugin_outdated' || result.result?.code === 'plugin_outdated') ? PLUGIN_OUTDATED_EXIT_CODE : 1;
    return result;
  }
  if (result.noop) {
    process.stdout.write(`${result.message}\n`);
    return result;
  }
  if (result.dryRun) {
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const op of ['creates', 'updates', 'deletes']) {
        process.stdout.write(`${op}: ${result.plan[op].length}\n`);
        for (const path of result.plan[op]) {
          const kind = classifyPath(path);
          const effect = effectForKind(kind);
          process.stdout.write(`  ${path} (${kind}${effect ? `, ${effect}` : ''})\n`);
        }
      }
      const checks = result.checks?.suites?.flatMap((suite) => suite.assertions.map((assertion) => ({ suite, assertion }))) ?? [];
      process.stdout.write(`checks (live suite + this push's check files @${result.checkBase ?? 'empty'}): ${checks.filter(({ assertion }) => assertion.passed).length} passed\n`);
      for (const { suite, assertion } of checks) process.stdout.write(`  ${suite.id ?? suite.file ?? 'suite'}: ${assertion.op ?? assertion.name ?? 'check'}\n`);
      process.stdout.write(`validation: ${result.validated?.status ?? 'passed'}${result.validated?.id ? ` (run ${result.validated.id})` : ''}\n`);
    }
    return result;
  }
  if (argv.includes('--json')) process.stdout.write(
    `${JSON.stringify(
      {
        commit_sha: result.commitSha,
        replayed: result.replayed,
        chain_state: result.state,
        chain_position: result.position,
        activation: result.activation,
        ...(result.candidateUrls.length > 0 ? { candidate_urls: result.candidateUrls } : {}),
        ...(result.surfaceWarnings.length > 0 ? { surface_warnings: result.surfaceWarnings } : {}),
      },
      null,
      2
    )}\n`
  );
  else {
    process.stdout.write(`committed ${result.commitSha}${result.state ? ` (${result.state})` : ''}\n`);
    for (const url of result.candidateUrls) process.stdout.write(`candidate: ${url}\n`);
    for (const warning of result.surfaceWarnings) process.stdout.write(`${formatSurfaceWarning(warning)}\n`);
    if (result.nextAction?.command) process.stdout.write(`next: ${result.nextAction.command}${result.nextAction.reason ? ` — ${result.nextAction.reason}` : ''}\n`);
    if (result.nextAction?.kind === 'baseline_required') process.stdout.write('This commit needs --reconcile before activation.\n');
    if (result.nextAction?.kind === 'handler_preview_required') process.stdout.write(`Preview the handler before activation: /cynap-preview <automation-id> ${result.commitSha}\n`);
    if (result.nextAction?.kind === 'handler_unpreviewable_ack_required') process.stdout.write('This browser handler cannot be previewed; the owner acknowledges activating it without a preview at the approval step.\n');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
