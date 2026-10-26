// An outdated plugin still parses every response that now carries an owned next step.
// The two readers below are frozen copies of the older plugin's `next_action` readers; never
// update them to match the current code — they stand for the plugin a customer has not updated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorEffectOutput } from '../lib/effect-disclosure.mjs';

function outdatedFormatNextAction(action) {
  if (!action) return '';
  if (typeof action === 'string') return `next: ${action}`;
  const command = action.command ?? action.next_action;
  const reason = action.reason ?? action.message;
  return [command ? `next: ${command}` : '', reason ? `  ${reason}` : ''].filter(Boolean).join('\n');
}

function outdatedNextProjection(action) {
  return action && typeof action === 'object' ? {
    ...(['step_up_and_activate', 'handler_preview_required', 'baseline_required', 'blocked_by_chain', 'activation_pending'].includes(action.kind) ? { kind: action.kind } : {}),
    ...(typeof action.command === 'string' && /^\/(?:cynap-status|reload-plugins|cynap-activate [a-f0-9]{64}|cynap-preview [a-zA-Z0-9_-]+ [a-f0-9]{40,64})$/.test(action.command) ? { command: action.command } : {}),
  } : {};
}

const sha = 'b'.repeat(64);
// The shapes the server sends: a resolver-filled object, and a tool's own object with resolver fields merged in.
const responses = [
  { ok: false, code: 'handler_unproven', message: 'No pass preview.\nNext step (you): Run /cynap-preview.',
    next_action: { owner: 'operator', reason: 'Run /cynap-preview.', retryable: false, command: `/cynap-preview a1 ${sha}` } },
  { ok: false, code: 'parent_mismatch', message: 'Moved.\nNext step (you): Run /cynap-pull, then re-run /cynap-push.',
    next_action: { owner: 'operator', reason: 'Run /cynap-pull, then re-run /cynap-push.', retryable: false } },
  { ok: false, code: 'step_up_required', next_action: { kind: 'step_up_and_activate', command: `/cynap-activate ${sha}`,
    owner: 'owner', reason: 'Approve in the browser.', retryable: false } },
];

test('the outdated readers parse every new next_action shape and still show its command and reason', () => {
  for (const body of responses) {
    const printed = outdatedFormatNextAction(body.next_action);
    if (body.next_action.command) assert.match(printed, new RegExp(`next: ${body.next_action.command}`));
    assert.match(printed, new RegExp(body.next_action.reason.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    const projected = outdatedNextProjection(body.next_action);
    assert.ok(!('owner' in projected) && !('retryable' in projected));
  }
});

test('the current effect reader keeps owner and retryable, never the free-text reason', () => {
  const safe = operatorEffectOutput(responses[0]);
  assert.deepEqual(safe.next_action, { command: `/cynap-preview a1 ${sha}`, owner: 'operator', retryable: false });
  const hostile = operatorEffectOutput({ ok: false, next_action: { owner: 'root', retryable: 'yes', reason: 'private' } });
  assert.equal(hostile.next_action, undefined);
});
