#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { MAX_CALLS, MAX_TOKENS, saveDevAiConfig } from '../lib/dev-ai-config.mjs';

export function parseDevAiArgs(argv) {
  let args = { allowedModels: [], maxTokens: MAX_TOKENS, callCap: MAX_CALLS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('developer: missing setup option value');
    if (flag === '--endpoint') args = { ...args, endpoint: value };
    else if (flag === '--keychain' || flag === '--op') {
      if (args.key) throw new Error('developer: choose one key reference');
      args = { ...args, key: { kind: flag === '--op' ? 'op' : 'keychain', reference: value } };
    } else if (flag === '--allow-model') args = { ...args, allowedModels: [...args.allowedModels, value] };
    else if (flag === '--default-model') args = { ...args, defaultModel: value };
    else if (flag === '--max-tokens') args = { ...args, maxTokens: Number(value) };
    else if (flag === '--call-cap') args = { ...args, callCap: Number(value) };
    else throw new Error('developer: unknown setup option');
  }
  if (new Set(args.allowedModels).size > 1 && args.defaultModel === undefined) {
    throw new Error('developer: multiple allowed models require /cynap-dev-ai --default-model');
  }
  return args;
}
export function main(argv = process.argv.slice(2)) {
  try {
    saveDevAiConfig(parseDevAiArgs(argv));
    process.stdout.write('cynap-dev-ai: saved developer-local reference. Real calls require /cynap-test --real-ai.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
