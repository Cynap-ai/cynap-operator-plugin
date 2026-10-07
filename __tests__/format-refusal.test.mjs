import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRefusal, PLUGIN_OUTDATED_EXIT_CODE, unwrapToolEnvelope } from '../lib/format-refusal.mjs';

test('plugin version refusal includes installed, minimum, update commands and optional message', () => {
  const text = formatRefusal({ ok: false, code: 'plugin_outdated', installed: '0.19.1', minimum: '0.19.2',
    message: 'A newer build is required.', update: ['claude plugin update x', '/reload-plugins'] }, { command: 'cynap-pull' });
  assert.match(text, /cynap-pull: plugin outdated: installed 0\.19\.1, server requires ≥ 0\.19\.2/);
  assert.match(text, /A newer build is required\. Update: claude plugin update x \/reload-plugins\. Then re-run this command/);
  assert.equal(PLUGIN_OUTDATED_EXIT_CODE, 2);
});

test('top-level effect paths, validation run and next action survive formatting', () => {
  const text = formatRefusal({ reason: 'commit_spans_irreversible_effects', message: 'Split the commit',
    effects: ['schema', 'handler:a'], paths: [{ path: 'context/schema.json', class: 'schema' }],
    validationRunId: 'run-1', next_action: { command: '/cynap-pull', reason: 'tip moved' } });
  assert.match(text, /context\/schema\.json \(schema\)/);
  assert.match(text, /effects: schema, handler:a/);
  assert.match(text, /validation run: run-1/);
  assert.match(text, /next: \/cynap-pull\n  tip moved/);
});

test('preview admission and proof refusals give the operator a concrete route', () => {
  assert.match(formatRefusal({ code: 'preview_unavailable' }), /chain stays blocked.*check \/cynap-status/);
  assert.match(formatRefusal({ code: 'handler_unproven' }, { commitSha: 'a'.repeat(64) }), /\/cynap-preview <automation-id> a{64}/);
});

test('tool decoder unwraps JSON-RPC and SSE text from the activation proxy', () => {
  const envelope = { result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'checks_uncovered_path', message: 'Missing a check' }) }] } };
  assert.deepEqual(unwrapToolEnvelope(JSON.stringify(envelope)), { ok: false, code: 'checks_uncovered_path', message: 'Missing a check' });
  assert.deepEqual(unwrapToolEnvelope(`event: message\ndata: ${JSON.stringify(envelope)}\n\n`),
    { ok: false, code: 'checks_uncovered_path', message: 'Missing a check' });
});

test('formatRefusal tolerates non-array paths/forbidden/refusals and prints uncovered_paths', () => {
  const text = formatRefusal({ ok: false, code: 'x', message: 'm', paths: 'nope', forbidden: {}, refusals: null,
    uncovered_paths: ['a.json', 'b.json'] });
  assert.match(text, /uncovered_paths: a\.json, b\.json/);
});

// An activation refusal names its code and upstream cause, and never prints prose.
test('cynap-activate refusal names the code and failureCode instead of request_refused', () => {
  const text = formatRefusal({ ok: false, code: 'automatic_step_up_failed', failureCode: 'schema_plan_unavailable',
    message: 'private upstream body' }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: automatic_step_up_failed \(schema_plan_unavailable\): the automatic test-org step-up failed, nothing was activated\./);
  assert.doesNotMatch(text, /request_refused|private upstream body/);
  assert.match(formatRefusal({ ok: false, code: 'http_400' }, { command: 'cynap-activate' }), /^cynap-activate: http_400: request refused/);
});

test('cynap-activate names the preview as the next step when the step-up reports handler_preview_required', () => {
  const sha = 'a'.repeat(64);
  const text = formatRefusal({ ok: false, code: 'automatic_step_up_failed', failureCode: 'handler_preview_required' },
    { command: 'cynap-activate', commitSha: sha });
  assert.match(text, /^cynap-activate: automatic_step_up_failed \(handler_preview_required\): no passing preview/);
  assert.doesNotMatch(text, /Re-run \/cynap-activate once/);
  assert.match(text, new RegExp(`next: /cynap-preview <automation-id> ${sha}`));
});

// After a gateway timeout the plugin reconciles; an activation it cannot yet confirm is still running, not refused.
test('an unconfirmed activation says it may still be running instead of "request refused"', () => {
  for (const code of ['activation_not_confirmed', 'activation_outcome_unknown']) {
    const text = formatRefusal({ ok: false, code, commit_sha: 'a'.repeat(64) }, { command: 'cynap-activate' });
    assert.match(text, new RegExp(`^cynap-activate: ${code}: the activation request timed out`));
    assert.doesNotMatch(text, /request refused/);
  }
});

test('an unconfirmed activation with a recorded failure names the code and reason, not a timeout', () => {
  const text = formatRefusal({ ok: false, code: 'activation_not_confirmed', commit_sha: 'a'.repeat(64),
    failure_code: 'preview_ack_required', failure_message: 'acknowledge the\nno-preview notice' }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: activation_not_confirmed: the activation ran and was refused: preview_ack_required \(acknowledge the no-preview notice\)/);
  assert.doesNotMatch(text, /timed out/);
});

test('activation_pending reads as accepted, never as refused', () => {
  const text = formatRefusal({ ok: false, code: 'activation_pending', commit_sha: 'a'.repeat(64) }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: activation_pending: activation accepted; post-deploy is still awaiting/);
  assert.doesNotMatch(text, /refused/);
});
