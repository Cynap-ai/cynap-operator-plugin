// Copied into the reserved testing import only on an explicitly opted-in run.
// No credential, provider configuration, or socket capability exists here.
import { createMockContext as fixtureContext } from './testing-fixtures.mjs';
export { mockQueryResponse, materializeStoredEntity, platformEntityHash } from './testing-fixtures.mjs';

let nextId = 0;
const pending = new Map();
process.on('message', (message) => {
  if (message?.type !== 'llmResult') return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (pending.size === 0) process.channel?.unref();
  if (message.ok) waiter.resolve(message.value);
  else waiter.reject(Object.assign(new Error(message.error), { actor: 'developer' }));
});
process.on('disconnect', () => {
  for (const waiter of pending.values()) waiter.reject(new Error('developer: broker_disconnected'));
  pending.clear();
});
process.channel?.unref();
function llmComplete(prompt, options) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    if (!process.connected) return reject(new Error('developer: broker_disconnected'));
    pending.set(id, { resolve, reject });
    process.channel?.ref();
    const failed = () => {
      pending.delete(id);
      if (pending.size === 0) process.channel?.unref();
      reject(new Error('developer: invalid_request_or_disconnected'));
    };
    try {
      process.send({ type: 'llmComplete', id, prompt, options }, (error) => {
        if (error) failed();
      });
    } catch { failed(); }
  });
}
export function createMockContext(options = {}) {
  return fixtureContext({ ...options, llmComplete });
}
