import { stablePortForSlug } from './connect.mjs';
import { mcpCall } from './workspace-sync.mjs';
import { CUSTOMER_AI_ADMISSION_REASON_NAMES } from './customer-ai-admission-reasons.mjs';

const MAX_ROUTES = 32;
// A fixed literal, never the server's string: workspace text must not reach the terminal through this line.
export const CUSTOMER_AI_CONFIG_PATH = 'config/ai.json';
const safeId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(id) ? id : '(route unavailable)';

/** Print only closed status fields. Never print a raw tool failure, config body or credential. */
export function formatReadinessWarning(route) {
  const verdict = route?.would_admit;
  const knownReason = CUSTOMER_AI_ADMISSION_REASON_NAMES.includes(verdict?.reason);
  const reason = knownReason ? verdict.reason : 'unknown';
  const actor = !knownReason ? 'platform' : ['owner', 'operator', 'platform', 'retry'].includes(verdict?.actor) ? verdict.actor : reason === 'admitted' || reason === 'not_applicable_byok' ? 'none' : 'platform';
  const byok = reason === 'not_applicable_byok' ? "; unchecked: runtime pays with the org's key" : '';
  return `cynap-test: WARNING org Customer AI ${safeId(route?.id)}: ${reason} (actor ${actor})${byok}. Advisory only; the local run continues.\n`;
}

/** Trusted parent only. Server-side config resolution discovers routes; workspace text cannot choose an org. */
export async function warnCustomerAiReadiness({ org,
  call = (args) => mcpCall(`http://127.0.0.1:${stablePortForSlug(org)}/mcp`, 'customer_ai_readiness_get', args),
  write = (line) => process.stdout.write(line),
} = {}) {
  const unavailable = () => write('cynap-test: WARNING org Customer AI unavailable (read failed); actor platform. Advisory only; the local run continues.\n');
  let discovery;
  try { discovery = await call({}); }
  catch { unavailable(); return; }
  if (discovery?.ok !== true || !Array.isArray(discovery.routes) || discovery.config?.status === 'read_failed') {
    unavailable(); return;
  }
  const ids = [...new Set(discovery.routes.map((r) => r?.id).filter((id) => safeId(id) === id))];
  if (ids.length === 0) {
    if (discovery.routes.length > 0) { unavailable(); return; }
    if (discovery.config?.file?.present === false) {
      write(`cynap-test: WARNING org Customer AI: ${CUSTOMER_AI_CONFIG_PATH} is missing (actor operator); create it from the configure-customer-ai skill template. Advisory only; the local run continues.\n`);
      return;
    }
    write('cynap-test: WARNING org Customer AI: no routes declared; route_not_in_org_config (actor operator). Advisory only; the local run continues.\n');
    return;
  }
  if (ids.length > MAX_ROUTES) unavailable();
  for (const routeId of ids.slice(0, MAX_ROUTES)) {
    try {
      const result = await call({ route_id: routeId });
      const route = result?.ok === true ? result.routes?.find((r) => r.id === routeId) : null;
      if (route) write(formatReadinessWarning(route));
      else unavailable();
    } catch { unavailable(); }
  }
}
