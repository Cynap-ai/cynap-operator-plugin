// Closed operator output projection. Resolved targets belong only in browser consent.
import {
  BUILD_FACT_ID_PATTERN, HANDLER_SITE_PATTERN, MAX_PREVIEW_TOOL_FAULTS, PREVIEW_BASELINE_OUTCOMES, PREVIEW_ERROR_NAMES,
  PREVIEW_FAULT_CODE_PATTERN, safeHandlerFault, TOOL_REJECTION_CODES,
} from './preview-contract.generated.mjs';

const KINDS = new Set(['message', 'money', 'trigger', 'http-write', 'db-write', 'artifact', 'unknown']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,200}$/;
// an activation's readiness, read only from the server's projected marker.
const READINESS = new Set(['yes', 'projecting', 'failed', 'unknown']);
const STATUSES = new Set(['unknown', 'pending', 'preview_running', 'pass', 'fail', 'superseded', 'activated', 'activating', 'ancestor', 'recorded', 'activation_submitted']);
// A refusal whose `code` is a free-text sentence (the proxy's `{error: error.message}`, `HTTP 502`)
// fails IDENTIFIER and would vanish. Keep it as a bounded, control-char-free `detail` so the real
// reason reaches the user; `message` and every other free-text field stay dropped.
const DETAIL_MAX = 200;
function refusalDetail(body) {
  if (body?.ok !== false) return undefined;
  // `detail` is read back so projecting an already-projected result (main -> formatRefusal) is stable.
  const source = typeof body.code === 'string' && !IDENTIFIER.test(body.code) ? body.code : body.detail;
  if (typeof source !== 'string') return undefined;
  const text = source.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, DETAIL_MAX);
  return text || undefined;
}
// The server-stored reason an activation was refused, bounded and control-char-free.
function failureMessage(body) {
  if (typeof body?.failure_message !== 'string') return undefined;
  return body.failure_message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, DETAIL_MAX) || undefined;
}
// A preview failure's closed facts. The error class and handler.js site, never the error text; the
// typed fault with only a closed rejection code. The sets come from their owners, generated.
const BASELINE_OUTCOMES = new Set(PREVIEW_BASELINE_OUTCOMES);
const ERROR_NAMES = new Set(PREVIEW_ERROR_NAMES);
// The running attempt a preview_running refusal names.
const AUTOMATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
function failureFault(value) {
  const fault = safeHandlerFault(value);
  if (!fault) return undefined;
  const { rejectionCode, ...rest } = fault;
  return { ...rest, ...(TOOL_REJECTION_CODES.includes(rejectionCode) ? { rejectionCode } : {}) };
}
function failureLocation(value) {
  if (!ERROR_NAMES.has(value?.errorName)) return undefined;
  const fault = failureFault(value.fault);
  return { errorName: value.errorName, ...(typeof value.site === 'string' && HANDLER_SITE_PATTERN.test(value.site) ? { site: value.site } : {}),
    ...(fault ? { fault } : {}) };
}
// Why a preview's deciding tool call failed: HandlerFault codes only, bounded.
export function toolFaultViews(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_PREVIEW_TOOL_FAULTS).flatMap((fault) =>
    typeof fault?.code === 'string' && PREVIEW_FAULT_CODE_PATTERN.test(fault.code) ? [{ code: fault.code }] : []);
}
// The Build Facts the server pushed for a failed preview. Server-authored registry text,
// bounded and control-char-free; an entry without a valid fact id is dropped.
const FACT_TEXT_MAX = 600;
const MAX_FACTS = 16;
const factText = (value) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, FACT_TEXT_MAX) : '');
export function buildFactViews(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FACTS).flatMap((fact) => {
    if (typeof fact?.id !== 'string' || !BUILD_FACT_ID_PATTERN.test(fact.id) || !factText(fact.rule)) return [];
    return [{ id: fact.id, rule: factText(fact.rule), remedy: factText(fact.remedy) || null,
      ...(factText(fact.enforced_by) ? { enforced_by: factText(fact.enforced_by) } : {}) }];
  });
}
export function effectKindCounts(value) {
  return Array.isArray(value) ? value.filter((entry) => KINDS.has(entry?.kind) && Number.isSafeInteger(entry?.count) && entry.count >= 0)
    .map(({ kind, count }) => ({ kind, count })) : [];
}
function navigationUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)?cynap\.ai$/.test(url.hostname) || url.pathname !== '/operator-cli/authorize') return undefined;
    const allowed = new Set(['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'org', 'request_kind', 'commit_sha']);
    const params = new URLSearchParams([...url.searchParams.entries()].filter(([key]) => allowed.has(key)));
    return `${url.origin}${url.pathname}${params.size ? `?${params}` : ''}`;
  } catch { return undefined; }
}
export function operatorEffectOutput(body) {
  const booleans = Object.fromEntries(['ok', 'success'].filter((key) => typeof body?.[key] === 'boolean').map((key) => [key, body[key]]));
  const statuses = Object.fromEntries(['status', 'state'].filter((key) => STATUSES.has(body?.[key])).map((key) => [key, body[key]]));
  const identifiers = Object.fromEntries(['attemptId', 'previewId', 'commit_sha', 'revisionId', 'code', 'failureCode', 'failure_code']
    .filter((key) => typeof body?.[key] === 'string' && IDENTIFIER.test(body[key])).map((key) => [key, body[key]]));
  const navigation = Object.fromEntries(['approval_url', 'step_up_url'].flatMap((key) => {
    const value = navigationUrl(body?.[key]); return value ? [[key, value]] : [];
  }));
  const action = body?.next_action;
  const next = action && typeof action === 'object' ? {
    ...(['step_up_and_activate', 'handler_preview_required', 'baseline_required', 'blocked_by_chain', 'activation_pending'].includes(action.kind) ? { kind: action.kind } : {}),
    ...(typeof action.command === 'string' && /^\/(?:cynap-status|reload-plugins|cynap-activate [a-f0-9]{64}|cynap-preview [a-zA-Z0-9_-]+ [a-f0-9]{40,64})$/.test(action.command) ? { command: action.command } : {}),
    ...(navigationUrl(action.approval_url) ? { approval_url: navigationUrl(action.approval_url) } : {}),
  } : {};
  const detail = refusalDetail(body);
  const reason = failureMessage(body);
  const location = failureLocation(body?.failureLocation);
  return { ...booleans, ...statuses, ...identifiers, ...navigation,
    ...(detail ? { detail } : {}),
    ...(reason ? { failure_message: reason } : {}),
    ...(location ? { failureLocation: location } : {}),
    ...(BASELINE_OUTCOMES.has(body?.baselineOutcome) ? { baselineOutcome: body.baselineOutcome } : {}),
    ...(toolFaultViews(body?.candidateFaults).length > 0 ? { candidateFaults: toolFaultViews(body.candidateFaults) } : {}),
    ...(body?.baselineAlsoFailed === true ? { baselineAlsoFailed: true } : {}),
    ...(body?.rule === 'one_preview_per_org' ? { rule: body.rule } : {}),
    ...(typeof body?.automationId === 'string' && AUTOMATION_ID.test(body.automationId) ? { automationId: body.automationId } : {}),
    ...(typeof body?.startedAt === 'string' && TIMESTAMP.test(body.startedAt) ? { startedAt: body.startedAt } : {}),
    ...(Array.isArray(body?.effectKinds) ? { effectKinds: effectKindCounts(body.effectKinds) } : {}),
    ...(buildFactViews(body?.buildFacts).length > 0 ? { buildFacts: buildFactViews(body.buildFacts) } : {}),
    ...(body?.step_up === 'automatic' || body?.step_up === 'browser' ? { step_up: body.step_up } : {}),
    ...(READINESS.has(body?.ready) ? { ready: body.ready } : {}),
    ...(Number.isSafeInteger(body?.expires_in) && body.expires_in >= 0 ? { expires_in: body.expires_in } : {}),
    ...(Object.keys(next).length ? { next_action: next } : {}),
  };
}
