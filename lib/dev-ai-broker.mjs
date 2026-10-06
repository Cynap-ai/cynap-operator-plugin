// Trusted parent only. Neither configuration nor credentials cross the IPC seam.
import { randomUUID } from 'node:crypto';
import { readDevAiConfig, resolveDevAiKey, validateDevAiConfig } from './dev-ai-config.mjs';
export { MAX_TOKENS, MAX_CALLS } from './dev-ai-config.mjs';

const ENDPOINTS = Object.freeze({
  vercel: 'https://ai-gateway.vercel.sh/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
});
export class DevAiError extends Error {
  constructor(reason) { super(`developer: ${reason}`); this.actor = 'developer'; this.reason = reason; }
}
async function canonicalSchema() {
  try { return (await import('./customer-ai-request-schema.mjs')).CustomerAiRequestSchema; }
  catch { throw new DevAiError('request_schema_unavailable; build the plugin request-schema bundle'); }
}
function requestFor(schema, prompt, options) {
  if (typeof prompt !== 'string' || !options || typeof options !== 'object' || Array.isArray(options)) throw new DevAiError('invalid_request');
  const { max_tokens, maxTokens, ...fields } = options;
  if ([max_tokens, maxTokens, fields.max_output_tokens].filter((x) => x !== undefined).length > 1) throw new DevAiError('invalid_request');
  const tokens = max_tokens !== undefined ? max_tokens : maxTokens;
  const parsed = schema.safeParse({ customer_ai_protocol: 1, client_request_id: randomUUID(), operation: 'text', task: 'sdk.complete', input: { prompt }, ...fields,
    ...(tokens !== undefined ? { max_output_tokens: tokens } : {}) });
  if (!parsed.success || parsed.data.operation !== 'text' || parsed.data.prompt_format !== undefined || parsed.data.schema !== undefined || parsed.data.questions !== undefined) throw new DevAiError('invalid_request');
  // complete's input is exactly one plain prompt. Structured and tool rounds are not this seam.
  const input = parsed.data.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.prompt !== 'string') throw new DevAiError('invalid_request');
  return parsed.data;
}
export async function createDevAiBroker({ config = readDevAiConfig(), schema, resolveKey = resolveDevAiKey, fetchImpl = fetch, model } = {}) {
  const local = validateDevAiConfig(config);
  const validator = schema ?? await canonicalSchema();
  if (model !== undefined && !local.allowedModels.includes(model)) throw new DevAiError('model_not_allowed');
  const key = await resolveKey(local.key);
  let calls = 0;
  return Object.freeze({
    async complete(prompt, options = {}) {
      const request = requestFor(validator, prompt, options);
      const selected = request.model ?? model ?? local.defaultModel
        ?? (local.allowedModels.length === 1 ? local.allowedModels[0] : undefined);
      if (selected === undefined) throw new DevAiError('model required; run /cynap-dev-ai --default-model with an allowed model');
      if (!local.allowedModels.includes(selected)) throw new DevAiError('model_not_allowed');
      const tokens = request.max_output_tokens ?? local.maxTokens;
      if (tokens > local.maxTokens) throw new DevAiError('token_limit');
      if (calls >= local.callCap) throw new DevAiError('call_limit');
      calls += 1;
      try {
        const response = await fetchImpl(ENDPOINTS[local.endpoint], {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: selected, max_tokens: tokens, messages: [{ role: 'user', content: request.input.prompt }] }),
        });
        if (!response.ok) throw new DevAiError('provider_denied');
        const body = await response.json();
        const answer = body?.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || answer.includes(key)) throw new DevAiError('invalid_provider_response');
        return answer;
      } catch (error) {
        if (error instanceof DevAiError) throw error;
        throw new DevAiError('provider_unavailable');
      }
    },
  });
}
export function bindDevAiBroker(child, broker) {
  const listener = async (message) => {
    if (message?.type !== 'llmComplete' || !Number.isSafeInteger(message.id) || message.id < 1) return;
    let result;
    try { result = { ok: true, value: await broker.complete(message.prompt, message.options) }; }
    catch (error) { result = { ok: false, actor: 'developer', error: error instanceof DevAiError ? error.message : 'developer: invalid_request' }; }
    if (child.connected) child.send({ type: 'llmResult', id: message.id, ...result }, (error) => {
      if (error && child.connected) child.disconnect();
    });
  };
  child.on('message', listener);
  child.once('close', () => child.removeListener('message', listener));
}
