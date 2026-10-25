import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXIT_FAILED, EXIT_NOT_DRAINED, exitCodeFor, parseRunArgs, readDeferred, runAutomation, summarizeRun,
} from '../bin/cynap-run.mjs';

// Exactly as the platform evidence reader defines it (the redacted operator read).
const FREE_TEXT_OMITTED = '[customer-authored free text omitted: read it in the Cynap portal]';

const bundle = (status, value, extra = {}) => ({ ok: true, kind: 'bundle',
  run: { status, terminal: !['running', 'dispatched', 'pending'].includes(status), errorClass: null, errorReason: null, executionMs: 5, ...extra },
  summary: value === undefined ? null : { value: FREE_TEXT_OMITTED, valueCounters: value } });

/** A scripted platform: each trigger yields the next run id; each evidence read answers per run id. */
function fakePlatform(runs) {
  const calls = [];
  let triggered = 0;
  const reads = new Map();
  const call = async (name, args) => {
    calls.push({ name, args });
    if (name === 'automation_run_trigger') { triggered += 1; return { ok: true, run_id: `run-${triggered}`, status: 'dispatched' }; }
    const script = runs[Number(args.logId.split('-')[1]) - 1];
    const seen = reads.get(args.logId) ?? 0;
    reads.set(args.logId, seen + 1);
    return script[Math.min(seen, script.length - 1)];
  };
  return { call, calls };
}

const clock = () => { let t = 0; return { now: () => t, wait: async (ms) => { t += ms; } }; };
const args = (over = {}) => ({ ...parseRunArgs(['sync', '--until-drained']), ...over });

test('parseRunArgs: --until-drained implies --wait; caps are bounded; bad input is a usage error', () => {
  const parsed = parseRunArgs(['sync', '--until-drained', '--max-iterations', '5', '--input', '{"month":"2026-09"}']);
  assert.equal(parsed.wait, true);
  assert.equal(parsed.maxIterations, 5);
  assert.deepEqual(parsed.input, { month: '2026-09' });
  assert.throws(() => parseRunArgs(['sync', '--max-iterations', '101']), /1 to 100/);
  assert.throws(() => parseRunArgs(['sync', '--max-minutes', '0']), /1 to 360/);
  assert.throws(() => parseRunArgs(['sync', '--input', '[1]']), /JSON object/);
  assert.throws(() => parseRunArgs(['sync', '--bogus']), /unrecognized argument "--bogus"/);
  assert.throws(() => parseRunArgs(['../x']), /Usage/);
  assert.deepEqual(parseRunArgs(['sync', '--input-file', 'p.json'], { readFile: () => '{"a":1}' }).input, { a: 1 });
});

test('readDeferred reads valueCounters (top-level only), an object value, and a named key', () => {
  const redacted = (valueCounters) => ({ value: FREE_TEXT_OMITTED, valueCounters });
  assert.deepEqual(readDeferred(redacted({ rows_deferred: 7 })), { key: 'rows_deferred', count: 7 });
  assert.deepEqual(readDeferred(redacted({ left: 3 }), 'left'), { key: 'left', count: 3 });
  assert.deepEqual(readDeferred({ value: { remaining: 0 } }), { key: 'remaining', count: 0 });
  assert.equal(readDeferred({ value: FREE_TEXT_OMITTED }), null);
  assert.equal(readDeferred({ value: { metrics: { rows_deferred: 9 } } }), null);
  assert.equal(readDeferred(redacted({ ok: true })), null);
  assert.equal(readDeferred(undefined), null);
});

test('summarizeRun keeps the first error exactly as the platform structured it', () => {
  const summary = summarizeRun(bundle('failure', undefined, { errorClass: 'handler_reported', errorReason: { category: 'handler', code: 'E1' } }));
  assert.equal(summary.ok, false);
  assert.equal(summary.error, '{"category":"handler","code":"E1"}');
});

test('without --wait it dispatches once and returns the run id', async () => {
  const { call, calls } = fakePlatform([]);
  const result = await runAutomation({ args: parseRunArgs(['sync']), call });
  assert.equal(result.outcome, 'dispatched');
  assert.equal(result.iterations[0].runId, 'run-1');
  assert.deepEqual(calls.map((c) => c.name), ['automation_run_trigger']);
});

test('--wait polls until terminal and reports the run', async () => {
  const { call } = fakePlatform([[bundle('running'), bundle('running'), bundle('success', { rows_deferred: 0 })]]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: parseRunArgs(['sync', '--wait']), call, now, wait });
  assert.equal(result.outcome, 'finished');
  assert.equal(result.iterations[0].status, 'success');
  assert.equal(result.iterations[0].deferred, 0);
});

test('--until-drained re-triggers with the same input while rows are deferred, then stops at 0', async () => {
  const { call, calls } = fakePlatform([
    [bundle('success', { rows_deferred: 40 })], [bundle('success', { rows_deferred: 15 })], [bundle('success', { rows_deferred: 0 })],
  ]);
  const { now, wait } = clock();
  const lines = [];
  const result = await runAutomation({ args: args({ input: { month: '2026-09' } }), call, now, wait, log: (l) => lines.push(l) });
  assert.equal(result.outcome, 'drained');
  assert.deepEqual(result.iterations.map((i) => i.deferred), [40, 15, 0]);
  const triggers = calls.filter((c) => c.name === 'automation_run_trigger');
  assert.equal(triggers.length, 3);
  assert.ok(triggers.every((t) => JSON.stringify(t.args.input) === '{"month":"2026-09"}'));
  assert.equal(lines.length, 3, 'one printed summary per iteration');
  assert.match(lines[0], /iteration 1\/20: run run-1 success, 40 deferred \(rows_deferred\)/);
  assert.equal(exitCodeFor('drained'), 0);
});

test('the iteration cap is hard', async () => {
  const runs = Array.from({ length: 10 }, (_, i) => [bundle('success', { rows_deferred: 1000 - i * 10 })]);
  const { call, calls } = fakePlatform(runs);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args({ maxIterations: 3 }), call, now, wait });
  assert.equal(result.outcome, 'iteration_cap');
  assert.equal(calls.filter((c) => c.name === 'automation_run_trigger').length, 3);
  assert.equal(exitCodeFor(result.outcome), EXIT_NOT_DRAINED);
});

test('the wall-time cap stops a run that never finishes', async () => {
  const { call } = fakePlatform([[bundle('running')]]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args({ maxMinutes: 1 }), call, now, wait });
  assert.equal(result.outcome, 'wall_cap');
  assert.equal(result.iterations[0].status, 'wait_timeout');
});

test('a failed run stops the loop with the error, and no further run is triggered', async () => {
  const { call, calls } = fakePlatform([
    [bundle('success', { rows_deferred: 9 })],
    [bundle('failure', undefined, { errorClass: 'handler_reported', errorReason: { code: 'BOOM' } })],
  ]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args(), call, now, wait });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.iterations.length, 2);
  assert.equal(result.iterations[1].error, '{"code":"BOOM"}');
  assert.equal(calls.filter((c) => c.name === 'automation_run_trigger').length, 2);
  assert.equal(exitCodeFor('failed'), EXIT_FAILED);
});

test('a degraded run that reports its backlog continues the drain; only a failure stops it', async () => {
  const { call, calls } = fakePlatform([
    [bundle('degraded', { rows_deferred: 30 })], [bundle('degraded', { rows_deferred: 12 })], [bundle('success', { rows_deferred: 0 })],
  ]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args(), call, now, wait });
  assert.equal(result.outcome, 'drained');
  assert.deepEqual(result.iterations.map((i) => i.status), ['degraded', 'degraded', 'success']);
  assert.equal(calls.filter((c) => c.name === 'automation_run_trigger').length, 3);
});

test('a degraded run with no backlog count, or outside a drain, still stops as failed', async () => {
  const { now, wait } = clock();
  const uncounted = fakePlatform([[bundle('degraded', { rows_hydrated: 5 })], [bundle('success', { rows_deferred: 0 })]]);
  const drain = await runAutomation({ args: args(), call: uncounted.call, now, wait });
  assert.equal(drain.outcome, 'failed');
  assert.equal(uncounted.calls.filter((c) => c.name === 'automation_run_trigger').length, 1);
  const single = fakePlatform([[bundle('degraded', { rows_deferred: 30 })]]);
  const once = await runAutomation({ args: parseRunArgs(['sync', '--wait']), call: single.call, now, wait });
  assert.equal(once.outcome, 'failed');
});

test('two re-triggers that do not shrink the backlog stop as no_progress', async () => {
  const { call } = fakePlatform([[bundle('success', { rows_deferred: 50 })], [bundle('success', { rows_deferred: 50 })], [bundle('success', { rows_deferred: 60 })], [bundle('success', { rows_deferred: 1 })]]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args(), call, now, wait });
  assert.equal(result.outcome, 'no_progress');
  assert.equal(result.iterations.length, 3);
});

test('a result with no deferred count is reported, not looped on', async () => {
  const { call, calls } = fakePlatform([[bundle('success', { ok: true })]]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args(), call, now, wait });
  assert.equal(result.outcome, 'no_deferred_count');
  assert.equal(calls.filter((c) => c.name === 'automation_run_trigger').length, 1);
});

test('a nested metrics.rows_deferred is not read: the run stops as no_deferred_count, not drained', async () => {
  const nested = { ...bundle('success', { ok: true }), summary: { value: FREE_TEXT_OMITTED } };
  const { call, calls } = fakePlatform([[nested]]);
  const { now, wait } = clock();
  const result = await runAutomation({ args: args(), call, now, wait });
  assert.equal(result.outcome, 'no_deferred_count');
  assert.equal(exitCodeFor(result.outcome), EXIT_NOT_DRAINED);
  assert.equal(calls.filter((c) => c.name === 'automation_run_trigger').length, 1);
});

test('a refused trigger throws its code; a run row that lags the dispatch is retried', async () => {
  await assert.rejects(runAutomation({ args: parseRunArgs(['sync', '--wait']),
    call: async () => ({ ok: false, code: 'input_invalid', message: 'required_run_parameter:safety_confirmation' }) }),
  (error) => error.code === 'input_invalid' && /safety_confirmation/.test(error.message));
  let reads = 0;
  const call = async (name) => {
    if (name === 'automation_run_trigger') return { ok: true, run_id: 'run-1' };
    reads += 1;
    return reads === 1 ? { ok: false, code: 'run_not_found' } : bundle('success', {});
  };
  const { now, wait } = clock();
  const result = await runAutomation({ args: parseRunArgs(['sync', '--wait']), call, now, wait });
  assert.equal(result.outcome, 'finished');
  assert.equal(reads, 2);
});
