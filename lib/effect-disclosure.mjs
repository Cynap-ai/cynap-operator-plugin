// Closed operator output projection. Resolved targets belong only in browser consent.
const KINDS = new Set(['message', 'money', 'trigger', 'http-write', 'db-write', 'artifact', 'unknown']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,200}$/;
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
  return { ...booleans, ...statuses, ...identifiers, ...navigation,
    ...(detail ? { detail } : {}),
    ...(reason ? { failure_message: reason } : {}),
    ...(Array.isArray(body?.effectKinds) ? { effectKinds: effectKindCounts(body.effectKinds) } : {}),
    ...(body?.step_up === 'automatic' || body?.step_up === 'browser' ? { step_up: body.step_up } : {}),
    ...(Number.isSafeInteger(body?.expires_in) && body.expires_in >= 0 ? { expires_in: body.expires_in } : {}),
    ...(Object.keys(next).length ? { next_action: next } : {}),
  };
}
