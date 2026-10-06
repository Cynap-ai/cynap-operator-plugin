import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readSkill(name) {
  return readFileSync(join(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8');
}

test('customer AI guidance pins the funding, provider, and authorization boundary', () => {
  const guidance = readSkill('configure-customer-ai');

  for (const required of [
    'config/ai.json',
    'intent only',
    'Customer AI paragraph in base context part 5',
    'customer_ai_readiness_get',
    '/cynap-test --real-ai',
    '/cynap-dev-ai',
    'authenticated human',
    'org billing permission',
    'no automatic fallback',
    'SDK_UPGRADE_REQUIRED',
    'stable request identity',
  ]) {
    assert.match(guidance, new RegExp(required, 'i'), `missing customer AI guidance: ${required}`);
  }

  assert.doesNotMatch(guidance, /\| Funding \|/);
  assert.match(guidance, /Developer provider denials stay local/);
  assert.match(guidance, /JEV[\s\S]*evaluate-only[\s\S]*probability[\s\S]*authorization/i);
  assert.match(guidance, /credentials[\s\S]*endpoints?[\s\S]*funding[\s\S]*prices?[\s\S]*reservation/i);
  assert.match(guidance, /secrets[\s\S]*config[\s\S]*logs[\s\S]*results/i);
});

test('every AI-capable authoring route sends the operator through customer AI guidance', () => {
  for (const skill of [
    'platform-invariants',
    'choose-the-right-mode',
    'author-a-flow',
    'author-a-deterministic-automation',
    'author-a-code-execution',
  ]) {
    assert.match(readSkill(skill), /configure-customer-ai/, `${skill} must route AI work to configure-customer-ai`);
  }
});

test('mode guidance does not promise free AI or equate BYOK with flow execution', () => {
  const combined = [readSkill('choose-the-right-mode'), readSkill('author-a-flow')].join('\n');

  assert.doesNotMatch(combined, /~free/);
  assert.doesNotMatch(combined, /BYOK-LLM config/);
});
