// /cynap-discard: the bin's read → range → discard flow. Pure `node --test`, no real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeDiscard, describeDiscardCrash, describeDiscardRefusal, discardRange, parseDiscardArgs, runDiscardFlow,
} from '../bin/cynap-discard.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const status = {
  accepted_tip: C,
  head_state: null,
  chain: [
    { sha: A, message: 'add bot', author_id: 'u1', position: 0 },
    { sha: B, message: 'swap model', author_id: 'u1', position: 1 },
    { sha: C, message: 'revert model', author_id: 'u1', position: 2 },
  ],
};

function mcpDouble(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { name, arguments: args } = JSON.parse(init.body).params;
    calls.push({ url, name, args });
    return { ok: true, json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify(answers[name]) }] } }) };
  };
  return { calls, fetchImpl };
}

test('parseDiscardArgs needs one commit digest and a non-empty --reason', () => {
  assert.deepEqual(parseDiscardArgs([B.toUpperCase(), '--reason', ' refused swap ']),
    { commitSha: B, reason: 'refused swap', dryRun: false, json: false });
  assert.deepEqual(parseDiscardArgs(['--dry-run', B, '--reason', 'x', '--json']),
    { commitSha: B, reason: 'x', dryRun: true, json: true });
  for (const argv of [[B], [B, '--reason'], [B, '--reason', '  '], [B, '--reason', '--json'], ['abc', '--reason', 'x'],
    [B, A, '--reason', 'x'], [B, '--reason', 'x', '--reason', 'y'], [B, '--reason', 'r'.repeat(2001)]]) {
    assert.throws(() => parseDiscardArgs(argv), /Usage/, argv.join(' '));
  }
});

test('discardRange is the commit and every pending commit after it, oldest first', () => {
  assert.deepEqual(discardRange(status, B).map((row) => row.sha), [B, C]);
  assert.deepEqual(discardRange(status, A).map((row) => row.sha), [A, B, C]);
  assert.equal(discardRange(status, 'd'.repeat(64)), null);
  assert.equal(discardRange({}, A), null);
});

test('a dry run reads the chain and never calls discard', async () => {
  const { calls, fetchImpl } = mcpDouble({ workspace_status: status });
  const result = await runDiscardFlow({ slug: 'acme', commitSha: B, reason: 'x', dryRun: true, fetchImpl });
  assert.deepEqual(calls.map((call) => call.name), ['workspace_status']);
  assert.deepEqual(result.would_discard.map((row) => row.sha), [B, C]);
  assert.match(describeDiscard(result), /would discard 2 commit\(s\)[\s\S]*Nothing was discarded/);
});

test('a pending commit is discarded once with its reason, and the reply points at /cynap-pull', async () => {
  const answer = { ok: true, discarded: [{ sha: B, author_id: 'u1', message: 'swap model' }, { sha: C, author_id: 'u1', message: 'revert model' }],
    removed_commits: [B, C], accepted_tip: A };
  const { calls, fetchImpl } = mcpDouble({ workspace_status: status, workspace_discard_commit: answer });
  const result = await runDiscardFlow({ slug: 'acme', commitSha: B, reason: 'refused swap', dryRun: false, fetchImpl });
  assert.deepEqual(calls.map((call) => call.name), ['workspace_status', 'workspace_discard_commit']);
  assert.deepEqual(calls[1].args, { commit: B, reason: 'refused swap' });
  assert.match(calls[1].url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.deepEqual(result, { ok: true, ...answer });
  const text = describeDiscard(result);
  assert.match(text, /discarded 2 commit\(s\)/);
  assert.match(text, new RegExp(`accepted tip: ${A}`));
  assert.match(text, /\/cynap-pull/);
});

test('a commit that is not pending is refused locally without a discard call', async () => {
  const { calls, fetchImpl } = mcpDouble({ workspace_status: status });
  const result = await runDiscardFlow({ slug: 'acme', commitSha: 'd'.repeat(64), reason: 'x', dryRun: false, fetchImpl });
  assert.equal(result.code, 'commit_not_pending');
  assert.deepEqual(calls.map((call) => call.name), ['workspace_status']);
  assert.match(describeDiscardRefusal(result), /commit_not_pending[\s\S]*\/cynap-status/);
});

test('a range holding the activating commit is refused locally', async () => {
  const { calls, fetchImpl } = mcpDouble({ workspace_status: { ...status, head_state: { activating: C } } });
  const result = await runDiscardFlow({ slug: 'acme', commitSha: B, reason: 'x', dryRun: false, fetchImpl });
  assert.deepEqual(result, { ok: false, code: 'commit_activating', commit_sha: C });
  assert.deepEqual(calls.map((call) => call.name), ['workspace_status']);
});

test('a server refusal is surfaced with its code and a next step', async () => {
  const refusal = { ok: false, code: 'forbidden_actor', message: 'You may discard only a range you authored every commit in, or hold the owner seat.' };
  const { fetchImpl } = mcpDouble({ workspace_status: status, workspace_discard_commit: refusal });
  const result = await runDiscardFlow({ slug: 'acme', commitSha: B, reason: 'x', dryRun: false, fetchImpl });
  assert.deepEqual(result, refusal);
  assert.match(describeDiscardRefusal(result), /forbidden_actor[\s\S]*Ask the Owner/);
});

test('a lost reply is outcome_unknown and says to read the chain before retrying', () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  assert.match(describeDiscardCrash(timeout), /outcome_unknown[\s\S]*\/cynap-status before retrying/);
});
