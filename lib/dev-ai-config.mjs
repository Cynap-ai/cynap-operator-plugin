// Developer-local references only. This module never reads workspace configuration.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const MAX_TOKENS = 2_048;
export const MAX_CALLS = 10;
export function devAiConfigPath(home = homedir()) {
  return join(home, '.config', 'cynap-operator', 'dev-ai.json');
}
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, keys) => plain(v) && Object.keys(v).every((k) => keys.includes(k));
export function validateDevAiConfig(value) {
  const key = value?.key;
  if (!exactKeys(value, ['endpoint', 'key', 'allowedModels', 'defaultModel', 'maxTokens', 'callCap']) ||
      !['vercel', 'openrouter'].includes(value.endpoint) ||
      !exactKeys(key, ['kind', 'reference']) || !['keychain', 'op'].includes(key.kind) ||
      typeof key.reference !== 'string' || !key.reference.trim() || key.reference.length > 512 || /[\r\n\0]/.test(key.reference) ||
      (key.kind === 'op' && !/^op:\/\/[^/]+\/[^/]+\/.+/.test(key.reference)) ||
      !Array.isArray(value.allowedModels) || value.allowedModels.length < 1 || value.allowedModels.length > 32 ||
      !value.allowedModels.every((m) => typeof m === 'string' && /^[a-zA-Z0-9._:/-]{1,256}$/.test(m)) ||
      (value.defaultModel !== undefined && !value.allowedModels.includes(value.defaultModel)) ||
      !Number.isInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > MAX_TOKENS ||
      !Number.isInteger(value.callCap) || value.callCap < 1 || value.callCap > MAX_CALLS) {
    throw new Error('developer: invalid AI configuration; run /cynap-dev-ai with a key reference and bounded models.');
  }
  return { ...value, key: { ...key }, allowedModels: [...value.allowedModels] };
}
export function saveDevAiConfig(value, { home = homedir() } = {}) {
  const config = validateDevAiConfig(value);
  const file = devAiConfigPath(home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
export function readDevAiConfig({ home = homedir() } = {}) {
  let value;
  try { value = JSON.parse(readFileSync(devAiConfigPath(home), 'utf8')); }
  catch { throw new Error('developer: AI configuration unavailable; run /cynap-dev-ai first.'); }
  return validateDevAiConfig(value);
}
export function resolveDevAiKey(key, { execFile = execFileSync } = {}) {
  try {
    const args = key.kind === 'keychain' ? ['find-generic-password', '-w', '-s', key.reference] : ['read', key.reference];
    const value = execFile(key.kind === 'keychain' ? 'security' : 'op', args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: 16_384 }).trim();
    if (!value || /[\r\n\0]/.test(value)) throw new Error('invalid key');
    return value;
  } catch { throw new Error('developer: configured AI key could not be resolved; unlock or repair its local reference.'); }
}
