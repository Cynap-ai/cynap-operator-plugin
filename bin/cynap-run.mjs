#!/usr/bin/env node
// /cynap-run — start one real run of an automation and, with --wait, block until it is terminal.
// With --until-drained it re-triggers while the handler reports deferred rows, under a hard cap on
// iterations and wall time. The loop lives here, in the plugin: the platform gains no self-continuation.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';
import { PLUGIN_OUTDATED_EXIT_CODE } from '../lib/format-refusal.mjs';
import { isProxyUnreachableError, mcpCall, resolveOrgSlug } from '../lib/workspace-sync.mjs';

const USAGE = 'Usage: cynap-run.mjs <automation-id> [--input <json> | --input-file <path>] [--wait] [--until-drained] ' +
  '[--drain-key <field>] [--max-iterations <n>] [--max-minutes <n>] [--json]';
const AUTOMATION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const DEFAULT_MAX_ITERATIONS = 20;
export const HARD_MAX_ITERATIONS = 100;
export const DEFAULT_MAX_MINUTES = 60;
export const HARD_MAX_MINUTES = 360;
/** The numeric fields a handler's result may carry to say "this many rows are left for another run". */
export const DEFAULT_DRAIN_KEYS = Object.freeze(['rows_deferred', 'deferred', 'rows_remaining', 'remaining']);
/** Exit codes: 0 finished (drained when asked), 1 run failed or a call was refused, 3 a cap or no-progress stop. */
export const EXIT_FAILED = 1;
export const EXIT_NOT_DRAINED = 3;
const IN_FLIGHT = new Set(['running', 'dispatched', 'pending']);

function positiveInt(value, max, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw Object.assign(new Error(`${flag} must be a whole number from 1 to ${max}`), { code: 'usage' });
  return n;
}

export function parseRunArgs(argv, { readFile = (path) => readFileSync(path, 'utf8') } = {}) {
  const args = { automationId: null, input: undefined, wait: false, untilDrained: false, drainKey: null,
    maxIterations: DEFAULT_MAX_ITERATIONS, maxMinutes: DEFAULT_MAX_MINUTES, json: false };
  const usage = (message) => Object.assign(new Error(message ? `${message}\n${USAGE}` : USAGE), { code: 'usage' });
  const parseJson = (text, flag) => {
    let value;
    try { value = JSON.parse(text); } catch { throw usage(`${flag} is not valid JSON`); }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw usage(`${flag} must be a JSON object`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw usage(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--wait') args.wait = true;
    else if (arg === '--until-drained') { args.untilDrained = true; args.wait = true; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--input') args.input = parseJson(next(), '--input');
    else if (arg === '--input-file') args.input = parseJson(readFile(next()), '--input-file');
    else if (arg === '--drain-key') {
      args.drainKey = next();
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(args.drainKey)) throw usage('--drain-key must be a plain field name');
    } else if (arg === '--max-iterations') args.maxIterations = positiveInt(next(), HARD_MAX_ITERATIONS, '--max-iterations');
    else if (arg === '--max-minutes') args.maxMinutes = positiveInt(next(), HARD_MAX_MINUTES, '--max-minutes');
    else if (arg.startsWith('--')) throw usage(`unrecognized argument "${arg}"`);
    else if (args.automationId === null) args.automationId = arg;
    else throw usage('only one automation id is accepted');
  }
  if (!args.automationId || !AUTOMATION.test(args.automationId)) throw usage();
  return args;
}

/**
 * The handler's own "rows left" count. An operator seat reads `run_evidence_get` redacted: `summary.value`
 * is a placeholder string and only the handler result's TOP-LEVEL finite numbers/booleans survive, as
 * `summary.valueCounters`. A full-free-text caller gets `summary.value` as an object. Top-level keys only.
 */
export function readDeferred(summary, drainKey = null) {
  const keys = drainKey ? [drainKey] : DEFAULT_DRAIN_KEYS;
  const layers = [summary?.valueCounters];
  const value = summary?.value;
  if (value && typeof value === 'object' && !Array.isArray(value)) layers.push(value);
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const key of keys) {
      const count = layer[key];
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) return { key, count };
    }
  }
  return null;
}

/** One run's outcome, from `run_evidence_get`'s own bundle: status, deferred count, the first error as the platform stated it. */
export function summarizeRun(bundle, drainKey = null) {
  const run = bundle?.run ?? {};
  const reason = run.errorReason ?? null;
  const deferred = readDeferred(bundle?.summary, drainKey);
  return { status: run.status ?? 'unknown', terminal: run.terminal === true,
    ok: run.status === 'success', deferred, errorClass: run.errorClass ?? null,
    error: reason ? JSON.stringify(reason) : null, executionMs: run.executionMs ?? null };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pollDelayMs = (poll) => Math.min(3000 + poll * 2000, 15_000);

async function callTool(call, name, args) {
  const result = await call(name, args);
  if (result?.ok === false) throw Object.assign(new Error(`${name} refused: ${result.code ?? 'error'}${result.message ? ` — ${result.message}` : ''}`), { code: result.code ?? 'tool_refused' });
  return result;
}

/**
 * Trigger, wait, and (optionally) drain. `call(name, args)` is the proxy tool call; `wait`/`now` are
 * seams for tests. Never throws for a run that ended badly: the verdict is in the returned `outcome`.
 */
export async function runAutomation({ args, call, wait = sleep, now = Date.now, log = () => {} }) {
  const deadline = now() + args.maxMinutes * 60_000;
  const iterations = [];
  let previous = null;
  let stalled = 0;
  for (let n = 1; n <= (args.untilDrained ? args.maxIterations : 1); n += 1) {
    const trigger = await callTool(call, 'automation_run_trigger',
      { automation_id: args.automationId, ...(args.input === undefined ? {} : { input: args.input }) });
    const runId = trigger.run_id;
    if (typeof runId !== 'string') throw Object.assign(new Error('automation_run_trigger returned no run id'), { code: 'no_run_id' });
    if (!args.wait) {
      log(`run ${runId} dispatched`);
      return { outcome: 'dispatched', iterations: [{ n, runId, status: 'dispatched' }] };
    }
    let summary = null;
    for (let poll = 0; ; poll += 1) {
      if (now() >= deadline) {
        iterations.push({ n, runId, status: 'wait_timeout' });
        log(`iteration ${n}: run ${runId} still running when the ${args.maxMinutes}-minute wall cap was reached`);
        return { outcome: 'wall_cap', iterations, runId };
      }
      await wait(pollDelayMs(poll));
      let bundle;
      try {
        bundle = await callTool(call, 'run_evidence_get', { logId: runId });
      } catch (error) {
        // The run row can lag the dispatch by a moment; any other refusal is real.
        if (error?.code === 'run_not_found' && poll < 5) continue;
        throw error;
      }
      summary = summarizeRun(bundle, args.drainKey);
      if (summary.terminal && !IN_FLIGHT.has(summary.status)) break;
    }
    const record = { n, runId, status: summary.status, deferred: summary.deferred?.count ?? null,
      deferredKey: summary.deferred?.key ?? null, error: summary.error, errorClass: summary.errorClass, executionMs: summary.executionMs };
    iterations.push(record);
    log(`iteration ${n}/${args.untilDrained ? args.maxIterations : 1}: run ${runId} ${summary.status}` +
      `${record.deferred === null ? ', no deferred count in the result' : `, ${record.deferred} deferred (${record.deferredKey})`}` +
      `${summary.error ? `, error ${summary.error}` : ''}`);
    // A degraded run that still names its backlog made partial progress: a drain continues past it.
    const continues = args.untilDrained && summary.status === 'degraded' && record.deferred !== null;
    if (!summary.ok && !continues) return { outcome: 'failed', iterations, runId };
    if (!args.untilDrained) return { outcome: 'finished', iterations, runId };
    if (record.deferred === null) return { outcome: 'no_deferred_count', iterations, runId };
    if (record.deferred === 0) return { outcome: 'drained', iterations, runId };
    // A re-trigger that leaves the backlog as large as it was is not draining it: stop after two.
    stalled = previous !== null && record.deferred >= previous ? stalled + 1 : 0;
    if (stalled >= 2) return { outcome: 'no_progress', iterations, runId };
    previous = record.deferred;
  }
  return { outcome: 'iteration_cap', iterations, runId: iterations.at(-1)?.runId };
}

const OUTCOME_TEXT = Object.freeze({
  dispatched: 'dispatched (not waiting)',
  finished: 'run reached a terminal status',
  drained: 'drained: the last run reported 0 deferred',
  failed: 'a run did not succeed; no further runs were triggered',
  wall_cap: 'stopped at the wall-time cap; the run may still be going',
  iteration_cap: 'stopped at the iteration cap; rows are still deferred',
  no_progress: 'stopped: two re-triggers in a row did not shrink the deferred count',
  no_deferred_count: 'finished, but the result carries no deferred count to drain (set --drain-key if it uses another field)',
});

export function exitCodeFor(outcome) {
  if (outcome === 'failed') return EXIT_FAILED;
  if (['wall_cap', 'iteration_cap', 'no_progress', 'no_deferred_count'].includes(outcome)) return EXIT_NOT_DRAINED;
  return 0;
}

export async function main(argv = process.argv.slice(2), { call, out = process.stdout, err = process.stderr, wait, now } = {}) {
  const args = parseRunArgs(argv);
  const slug = resolveOrgSlug();
  const proxyUrl = `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`;
  const caller = call ?? ((name, toolArgs) => mcpCall(proxyUrl, name, toolArgs));
  const result = await runAutomation({ args, call: caller, wait, now, log: (line) => err.write(`cynap-run: ${line}\n`) });
  out.write(`${JSON.stringify({ outcome: result.outcome, automationId: args.automationId, iterations: result.iterations })}\n`);
  err.write(`cynap-run: ${OUTCOME_TEXT[result.outcome]}\n`);
  return { ...result, exitCode: exitCodeFor(result.outcome) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyGlobalFlags(import.meta.url);
  main().then((result) => { process.exitCode = result.exitCode; }).catch((error) => {
    const detail = isProxyUnreachableError(error) ? 'the operator proxy is not reachable; run /cynap-status' : String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 400);
    process.stderr.write(`cynap-run: failed (${error?.code ?? 'run_failed'}): ${detail}\n`);
    process.exitCode = error?.code === 'plugin_outdated' ? PLUGIN_OUTDATED_EXIT_CODE : EXIT_FAILED;
  });
}
