import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('platform-invariants carries the canonical automatic-until-activation rule', () => {
  const doc = read('skills/platform-invariants/SKILL.md');
  assert.match(doc, /^## Lifecycle: automatic until activation$/m);
  assert.match(doc, /never ask the human in chat/);
  assert.match(doc, /owner's browser step-up is the\napproval/);
});

test('workspace guard deny reason names the operator route and does not tell the agent to ask a human', () => {
  const src = read('lib/workspace-guard.mjs');
  const reason = src.slice(src.indexOf('const DENY_REASON'), src.indexOf("';", src.indexOf('const DENY_REASON')));
  assert.doesNotMatch(reason, /ask a human/i);
  assert.match(reason, /cynap-push/);
  assert.match(reason, /\/cynap-activate/);
});

test('push and activate docs treat push as a draft and activation step-up as the approval', () => {
  const push = read('commands/cynap-push.md');
  assert.match(push, /A push is a draft/);
  assert.doesNotMatch(push, /ask (the human|the owner|for approval)|needs? (chat )?approval/i);
  assert.match(read('commands/cynap-activate.md'), /do not ask in chat first/);
});
