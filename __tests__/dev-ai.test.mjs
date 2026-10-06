import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CustomerAiRequestSchema } from '../lib/customer-ai-request-schema.mjs';
import { createDevAiBroker, MAX_TOKENS, MAX_CALLS } from '../lib/dev-ai-broker.mjs';
import { saveDevAiConfig, readDevAiConfig, resolveDevAiKey } from '../lib/dev-ai-config.mjs';

const config = { endpoint: 'openrouter', key: { kind: 'keychain', reference: 'local-test-item' }, allowedModels: ['test/model'], defaultModel: 'test/model', maxTokens: MAX_TOKENS, callCap: MAX_CALLS };
const broker = (options = {}) => createDevAiBroker({ config, schema: CustomerAiRequestSchema, resolveKey: () => 'fake-private-value', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'synthetic answer' } }] }) }), ...options });

test('setup saves only a reference and bounds in developer home', () => {
  const home = mkdtempSync(join(tmpdir(), 'dev-ai-config-'));
  try {
    saveDevAiConfig(config, { home });
    assert.deepEqual(readDevAiConfig({ home }), config);
    assert.doesNotMatch(readFileSync(join(home, '.config/cynap-operator/dev-ai.json'), 'utf8'), /fake-private-value/);
    assert.throws(() => saveDevAiConfig({ ...config, keyValue: 'forbidden' }, { home }), /configuration/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('keychain and op resolve through mocked CLI without shell interpolation', () => {
  const calls = [];
  const exec = (file, args) => { calls.push([file, args]); return 'fake-private-value\n'; };
  assert.equal(resolveDevAiKey(config.key, { execFile: exec }), 'fake-private-value');
  assert.equal(resolveDevAiKey({ kind: 'op', reference: 'op://local/item/key' }, { execFile: exec }), 'fake-private-value');
  assert.deepEqual(calls, [['security', ['find-generic-password', '-w', '-s', 'local-test-item']], ['op', ['read', 'op://local/item/key']]]);
});

test('unresolvable keys fail loudly and discard CLI output', () => {
  assert.throws(() => resolveDevAiKey(config.key, { execFile: () => { throw new Error('private CLI output'); } }), /developer.*key could not be resolved/);
  assert.throws(() => resolveDevAiKey(config.key, { execFile: () => '' }), /could not be resolved/);
});

test('canonical schema, models, and token bounds reject before HTTP', async () => {
  let calls = 0;
  const ai = await broker({ fetchImpl: () => { calls++; throw new Error('unexpected'); } });
  for (const [prompt, options] of [[3, {}], ['synthetic', { endpoint: 'forbidden' }], ['synthetic', { model: 'other/model' }], ['synthetic', { max_tokens: MAX_TOKENS + 1 }], ['synthetic', { max_output_tokens: 0 }], ['synthetic', { max_tokens: null }], ['synthetic', { operation: 'extract' }]]) {
    await assert.rejects(ai.complete(prompt, options), /developer.*(invalid_request|model_not_allowed|token_limit)/);
  }
  assert.equal(calls, 0);
});

test('call cap counts dispatched calls, including concurrent and failed calls', async () => {
  let calls = 0;
  const ai = await broker({ config: { ...config, callCap: 2 }, fetchImpl: async () => { calls++; return { ok: false, status: 402 }; } });
  await Promise.all(Array.from({ length: 3 }, () => assert.rejects(ai.complete('synthetic'), /developer.*(provider_denied|call_limit)/)));
  assert.equal(calls, 2);
});

test('HTTP and provider failures never reflect body, credentials, or endpoint', async () => {
  const ai = await broker({ fetchImpl: async () => { throw new Error('fake-private-value'); } });
  await assert.rejects(ai.complete('synthetic'), (e) => e.actor === 'developer' && !e.message.includes('fake-private-value'));
  const denied = await broker({ fetchImpl: async () => ({ ok: false, status: 403, json: () => { throw new Error('must not read denial body'); } }) });
  await assert.rejects(denied.complete('synthetic'), /developer: provider_denied/);
});

test('real broker returns only text and never raw provider metadata', async () => {
  const ai = await broker();
  assert.equal(await ai.complete('synthetic'), 'synthetic answer');
});

test('local envelope can only narrow the named ceilings', () => {
  const home = mkdtempSync(join(tmpdir(), 'dev-ai-bounds-'));
  try {
    for (const narrowed of [{ maxTokens: MAX_TOKENS + 1 }, { callCap: MAX_CALLS + 1 }, { allowedModels: [] }, { defaultModel: 'other/model' }, { endpoint: 'custom' }, { key: { kind: 'op', reference: 'literal-key' } }]) {
      assert.throws(() => saveDevAiConfig({ ...config, ...narrowed }, { home }), /configuration/);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('explicit run model must be allowed, and credential-bearing responses are rejected', async () => {
  await assert.rejects(broker({ model: 'other/model' }), /model_not_allowed/);
  const ai = await broker({ fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'fake-private-value' } }] }) }) });
  await assert.rejects(ai.complete('synthetic'), /invalid_provider_response/);
});

test('setup command accepts references only; test flags require per-run opt-in', async () => {
  const { parseDevAiArgs } = await import('../bin/cynap-dev-ai.mjs');
  const { parseTestArgs } = await import('../bin/cynap-test.mjs');
  assert.deepEqual(parseDevAiArgs(['--endpoint', 'openrouter', '--keychain', 'local-item', '--allow-model', 'test/model']).key, { kind: 'keychain', reference: 'local-item' });
  assert.throws(() => parseDevAiArgs(['--key', 'literal-value']), /unknown setup/);
  assert.throws(() => parseDevAiArgs(['--keychain', 'item', '--op', 'op://v/i/k']), /one key reference/);
  assert.throws(() => parseTestArgs(['--model', 'test/model']), /requires --real-ai/);
  assert.throws(() => parseTestArgs(['--real-ai', '--model']), /needs a value/);
  assert.equal(parseTestArgs(['--real-ai']).realAi, true);
});


test('model-less completion selects the sole allowed model', async () => {
  const ai = await broker({ config: { ...config, defaultModel: undefined }, fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'test/model');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'sole model' } }] }) };
  } });
  assert.equal(await ai.complete('synthetic'), 'sole model');
});

test('ambiguous model-less completion and setup name the default-model command', async () => {
  const multi = { ...config, allowedModels: ['test/model', 'test/other'], defaultModel: undefined };
  const ai = await broker({ config: multi });
  await assert.rejects(ai.complete('synthetic'), /\/cynap-dev-ai --default-model/);
  const { parseDevAiArgs } = await import('../bin/cynap-dev-ai.mjs');
  assert.throws(() => parseDevAiArgs(['--allow-model', 'test/model', '--allow-model', 'test/other']), /\/cynap-dev-ai --default-model/);
  assert.equal(parseDevAiArgs(['--allow-model', 'test/model', '--allow-model', 'test/other', '--default-model', 'test/other']).defaultModel, 'test/other');
});
