import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPreviewFailure, formatRefusal, PLUGIN_OUTDATED_EXIT_CODE, unwrapToolEnvelope } from '../lib/format-refusal.mjs';
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

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
});

// The next step comes from the server's resolver, printed once; the plugin invents none.
test('a refusal prints the server next step once, with its command, and nothing of its own', () => {
  const sha = 'a'.repeat(64);
  const line = 'Next step (you): Run /cynap-preview for the automation at this commit, then ask the Owner to approve again.';
  const text = formatRefusal({ ok: false, code: 'handler_unproven', message: `No pass preview stands.\n${line}`,
    next_action: { owner: 'operator', retryable: false, reason: line.slice('Next step (you): '.length), command: `/cynap-preview a1 ${sha}` } });
  assert.equal(text.split(line).length - 1, 1);
  assert.match(text, new RegExp(`next: /cynap-preview a1 ${sha}`));
  assert.doesNotMatch(formatRefusal({ code: 'handler_unproven', next_action: { owner: 'operator', reason: 'r' } }), /<automation-id>/);
});

test('a guard throw keeps its server line through the formatter', () => {
  const text = formatRefusal({ ok: false, code: 'release_halted',
    message: "release_halted: Tool 'x' is paused while new work is halted\nNext step (Cynap): Wait until Cynap lifts the halt on new work, then retry the same call; nothing in it needs to change." });
  assert.match(text, /Next step \(Cynap\): Wait until Cynap lifts the halt/);
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
  const text = formatRefusal({ ok: false, code: 'automatic_step_up_failed', failureCode: 'handler_preview_required',
    next_action: { owner: 'operator', retryable: false, reason: 'Run /cynap-preview for the automation at this commit.', command: `/cynap-preview a1 ${sha}` } },
  { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: automatic_step_up_failed \(handler_preview_required\): no passing preview/);
  assert.doesNotMatch(text, /Re-run \/cynap-activate once/);
  assert.match(text, new RegExp(`next: /cynap-preview a1 ${sha}`));
});

// an outcome the CLI could not learn is said to be unknown, never given a guessed cause.
test('an unknown activation outcome says so and points at /cynap-status', () => {
  const text = formatRefusal({ ok: false, code: 'activation_outcome_unknown', commit_sha: 'a'.repeat(64) }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: activation_outcome_unknown: outcome unknown — run \/cynap-status/);
  assert.doesNotMatch(text, /request refused|timed out|refused/);
});

test('consent expiry and consent denial are distinct answers', () => {
  const expired = formatRefusal({ ok: false, code: 'consent_expired' }, { command: 'cynap-activate' });
  const denied = formatRefusal({ ok: false, code: 'consent_denied' }, { command: 'cynap-activate' });
  assert.match(expired, /^cynap-activate: consent_expired: nobody approved the activation/);
  assert.match(denied, /^cynap-activate: consent_denied: the activation was declined/);
});

test('a recorded activation failure names the code and reason', () => {
  const text = formatRefusal({ ok: false, code: 'activation_failed', commit_sha: 'a'.repeat(64),
    failure_code: 'preview_ack_required', failure_message: 'acknowledge the\nno-preview notice' }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: activation_failed: the activation ran and was refused: preview_ack_required \(acknowledge the no-preview notice\)/);
  assert.doesNotMatch(text, /timed out/);
});

test('activation_pending reads as accepted, never as refused', () => {
  const text = formatRefusal({ ok: false, code: 'activation_pending', commit_sha: 'a'.repeat(64) }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: activation_pending: activation accepted; post-deploy is still awaiting/);
  assert.doesNotMatch(text, /refused/);
});

test('surface_approval_required names the portal approve path, not a generic failure', () => {
  const text = formatRefusal({ ok: false, code: 'surface_approval_required', failureCode: 'surface_approval_required' },
    { command: 'cynap-activate', commitSha: 'a'.repeat(64) });
  assert.match(text, /^cynap-activate: surface_approval_required: /);
  assert.match(text, /from the portal: Changes/);
  assert.doesNotMatch(text, /the activation request failed/);
});

// A preview failure prints the closed facts of the status read, never "withheld" and never error text.
test('a capture_tool_failed verdict prints the code and whether the baseline failed too', () => {
  const text = formatRefusal({ status: 'fail', failureCode: 'capture_tool_failed', baselineOutcome: 'failed',
    error: 'GET https://openapi.writeupp.com/patients/123 -> 429', message: 'private body' }, { command: 'cynap-preview' });
  assert.match(text, /^cynap-preview: capture_tool_failed: an effect-producing tool call failed during the preview/);
  assert.match(text, /\n  baseline: failed too .*may not come from your commit/);
  assert.doesNotMatch(text, /withheld|writeupp|patients|private body/);
});

// A baseline run that succeeded with an unusable effect record is never "failed too".
test('a diff_unavailable baseline prints that it succeeded, never that it failed too', () => {
  const text = formatPreviewFailure(operatorEffectOutput({ status: 'fail', failureCode: 'capture_tool_failed', baselineOutcome: 'diff_unavailable' }));
  assert.match(text, /\n  baseline: succeeded on its own copy, but its effects could not be compared with yours/);
  assert.doesNotMatch(text, /failed too/);
});

test('a handler_runtime_error verdict prints the failure location and the baseline result', () => {
  const text = formatPreviewFailure(operatorEffectOutput({ status: 'fail', failureCode: 'handler_runtime_error',
    failureLocation: { errorName: 'TypeError', site: 'handler.js:4:9' }, baselineOutcome: 'succeeded' }));
  assert.equal(text, [
    'handler_runtime_error: the candidate handler threw; fix it at the location below and preview again',
    '  failureLocation: TypeError at handler.js:4:9',
    '  baseline: succeeded on its own copy, so look at what your commit changed',
  ].join('\n'));
});

test('a rejected tool call prints its fault, then the Build Facts matched to it, after the code', () => {
  const text = formatPreviewFailure(operatorEffectOutput({ status: 'fail', failureCode: 'handler_runtime_error',
    failureLocation: { errorName: 'Error', site: 'handler.js:7:3',
      fault: { reason: 'tool_error', callIndex: 0, tool: 'knowledge.advancedQuery', rejectionCode: 'READ_TOO_LARGE' } },
    buildFacts: [{ id: 'fact:advanced-query-page-by-row-width', rule: 'Both ceilings reject it as READ_TOO_LARGE.', remedy: 'Page with a smaller explicit limit.' }] }));
  assert.equal(text, [
    'handler_runtime_error: the candidate handler threw; fix it at the location below and preview again',
    '  failureLocation: Error at handler.js:7:3',
    '  fault: tool_error in knowledge.advancedQuery (READ_TOO_LARGE)',
    '  build fact [fact:advanced-query-page-by-row-width]: Both ceilings reject it as READ_TOO_LARGE.',
    '    fix: Page with a smaller explicit limit.',
  ].join('\n'));
});

test('a fault rejection code outside the closed set, and a fact without a valid id, are dropped', () => {
  const safe = operatorEffectOutput({ status: 'fail', failureCode: 'handler_runtime_error',
    failureLocation: { errorName: 'Error', fault: { reason: 'tool_error', rejectionCode: 'PATIENT_JO' } },
    buildFacts: [{ id: 'patient Jo', rule: 'x' }, { id: 'fact:ok', rule: 'line\u0007one', remedy: null }] });
  assert.deepEqual(safe.failureLocation, { errorName: 'Error', fault: { reason: 'tool_error' } });
  assert.deepEqual(safe.buildFacts, [{ id: 'fact:ok', rule: 'line one', remedy: null }]);
});

test('a first promotion says there was no baseline to compare with', () => {
  assert.match(formatPreviewFailure({ failureCode: 'preview_timeout', baselineOutcome: 'not_dispatched' }),
    /^preview_timeout\n  baseline: not run \(no accepted version/);
});

test('a hostile failure location or baseline value never reaches the printed facts', () => {
  const safe = operatorEffectOutput({ status: 'fail', failureCode: 'handler_runtime_error', baselineOutcome: 'failed; patient Jo',
    failureLocation: { errorName: 'TypeError: patient Jo', site: 'handler.js:4:9 patient Jo', message: 'patient Jo' } });
  assert.equal(safe.failureLocation, undefined);
  assert.equal(safe.baselineOutcome, undefined);
  assert.doesNotMatch(formatPreviewFailure(safe), /patient Jo/);
  const siteOnly = operatorEffectOutput({ failureLocation: { errorName: 'RangeError', site: 'handler.js:4:9 patient Jo' } });
  assert.deepEqual(siteOnly.failureLocation, { errorName: 'RangeError' });
});

test('an activation result with a fail status is not formatted as a preview failure', () => {
  const text = formatRefusal({ ok: false, status: 'fail', code: 'consent_denied' }, { command: 'cynap-activate' });
  assert.match(text, /^cynap-activate: consent_denied: the activation was declined/);
});

test('preview_running without the running attempt\'s details still states the rule', () => {
  assert.match(formatRefusal({ code: 'preview_running' }, { command: 'cynap-preview' }),
    /^cynap-preview: preview_running: an org runs one preview at a time, and another preview is still running\./);
  assert.match(formatRefusal({ code: 'preview_running', previewId: 'p1' }, { command: 'cynap-preview' }),
    /attempt p1 is still running\. Wait for its verdict with \/cynap-preview status p1/);
});

test('a frozen workspace refusal points the agent at the runbook decision tree', () => {
  const text = formatRefusal({ ok: false, code: 'workspace_writes_frozen' }, { command: 'cynap-push' });
  assert.match(text, /Next step \(Cynap\):/);
  assert.match(text, /next: read-only diagnosis, then draft the platform-admin request from the "Frozen handler activation: decision tree" section of the workspace-activation-incomplete runbook/);
  assert.match(text, /do not retry or re-activate/);
});
