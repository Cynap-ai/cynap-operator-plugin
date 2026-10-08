import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOMER_AI_CONFIG_PATH } from './customer-ai-readiness-warning.mjs';

const HANDLER_CONFIG = /^automations\/(?:handlers\/[^/]+\/config|[^/]+)\.json$/;

/**
 * Handler configs in the local tree that declare an `llm.*` tool while the tree has no
 * config/ai.json. Advisory: the push still commits. Returns [] when the file exists.
 */
export function automationsMissingCustomerAiConfig(dir, paths) {
  if (paths.includes(CUSTOMER_AI_CONFIG_PATH)) return [];
  return paths.filter((path) => HANDLER_CONFIG.test(path)).flatMap((path) => {
    let config;
    try { config = JSON.parse(readFileSync(join(dir, path), 'utf8')); } catch { return []; }
    const tools = config?.execution?.allowed_tools;
    return Array.isArray(tools) && tools.some((tool) => typeof tool === 'string' && tool.startsWith('llm.')) ? [path] : [];
  }).sort();
}

export function formatCustomerAiConfigWarning(paths) {
  return `warning: [customer_ai_config_missing] ${paths.join(', ')} ${paths.length === 1 ? 'calls' : 'call'} llm.* but ` +
    `${CUSTOMER_AI_CONFIG_PATH} does not exist. BYOK calls run with no allowedModels check or org call limits, and ` +
    `native calls are refused. Create it from the configure-customer-ai skill template.`;
}
