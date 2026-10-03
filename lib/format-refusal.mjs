import { operatorEffectOutput } from './effect-disclosure.mjs';
import { SURFACE_REFUSAL_DOCS } from './surface-contract.generated.mjs';
// Shared operator-facing refusal text. Exit 2 means the installed plugin is too old.
export const PLUGIN_OUTDATED_EXIT_CODE = 2;

export function unwrapToolEnvelope(value) {
  if (typeof value === 'string') {
    const candidates = [value, ...value.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())];
    for (const candidate of candidates.reverse()) {
      try { return unwrapToolEnvelope(JSON.parse(candidate)); } catch { /* inspect the next envelope */ }
    }
    return { ok: false, code: 'tool_error', message: value };
  }
  if (value?.error) return { ok: false, code: value.error.code ?? 'rpc_error', message: value.error.message ?? String(value.error) };
  const result = value?.result?.content || value?.result?.structuredContent ? value.result : value;
  if (result?.structuredContent) return result.structuredContent;
  const content = result?.content?.find?.((item) => typeof item.text === 'string')?.text;
  if (content) {
    try { return JSON.parse(content); } catch { return { ok: false, code: 'tool_error', message: content }; }
  }
  return result;
}

// A preview verdict, not a surface-build refusal: the candidate's effect-producing tool call failed.
const PREVIEW_CAPTURE_TOOL_FAILED_MESSAGE =
  'an effect-producing tool call failed during the preview (its error text is withheld); fix the failing call, or stop the handler swallowing its error, and preview again';

// The surface refusal meanings come from the builder's one owner, through the generated module.
export const SURFACE_REFUSAL_MESSAGES = Object.freeze(
  Object.fromEntries(Object.entries(SURFACE_REFUSAL_DOCS).map(([code, doc]) => [code, doc.meaning]))
);

export function refusalErrors(refusal) {
  const errors = refusal?.run?.errors ?? refusal?.errors;
  return Array.isArray(errors) ? errors : [];
}

export function refusalRunId(refusal) {
  const id = refusal?.run?.id ?? refusal?.id;
  return typeof id === 'string' ? id : null;
}

export function formatValidationErrors(errors) {
  const lines = errors.slice(0, 50).map((finding) => {
    const at = finding.path ? `${finding.path}${finding.line ? `:${finding.line}` : ''}: ` : '';
    return `  ${finding.code ? `[${finding.code}] ` : ''}${at}${finding.message}`;
  });
  if (errors.length > 50) lines.push(`  … ${errors.length - 50} more`);
  return lines.join('\n');
}

function formatEntry(entry) {
  if (typeof entry === 'string') return `  ${entry}`;
  if (!entry?.path) return null;
  return `  ${entry.path}${entry.class ? ` (${entry.class})` : entry.kind ? ` (${entry.kind})` : ''}${entry.entrance ? ` — entrance: ${entry.entrance}` : ''}`;
}

export function formatRefusalDetails(refusal) {
  if (!refusal || typeof refusal !== 'object') return '';
  const lines = [];
  for (const entry of ['paths', 'forbidden', 'refusals'].flatMap((key) => (Array.isArray(refusal[key]) ? refusal[key] : []))) {
    const line = formatEntry(entry);
    if (line) lines.push(line);
  }
  for (const key of ['gate_change_paths', 'other_paths', 'uncovered_paths']) {
    if (Array.isArray(refusal[key])) lines.push(`  ${key}: ${refusal[key].join(', ')}`);
  }
  if (Array.isArray(refusal.effects)) lines.push(`  effects: ${refusal.effects.join(', ')}`);
  if (Array.isArray(refusal.schema_deltas)) lines.push(...refusal.schema_deltas.map((delta) => `  ${delta}`));
  return lines.join('\n');
}

export function formatSurfaceRefusal(result) {
  const findings = result.findings ?? result.result?.findings ?? [];
  const lines = findings.slice(0, 20).map((finding) => {
    const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ''}` : ''}: ` : '';
    return `  ${where}${finding.message} [${finding.rule}]`;
  });
  if (findings.length > 20) lines.push(`  … ${findings.length - 20} more`);
  if (result.hint) lines.push(`Fix: ${result.hint}`);
  if (result.retryable) lines.push('This is retryable — re-run /cynap-push.');
  return lines.join('\n');
}

export function formatNextAction(action) {
  if (!action) return '';
  if (typeof action === 'string') return `next: ${action}`;
  const command = action.command ?? action.next_action;
  const reason = action.reason ?? action.message;
  return [command ? `next: ${command}` : '', reason ? `  ${reason}` : ''].filter(Boolean).join('\n');
}

// What the activation proxy's refusal codes mean, with the next step. Nothing was activated in any of them.
const ACTIVATION_REFUSALS = {
  automatic_step_up_failed: 'the automatic test-org step-up failed, nothing was activated. Re-run /cynap-activate once; if it repeats, read proxy.log.',
  automatic_step_up_refused: 'the automatic test-org step-up was refused, nothing was activated. Read proxy.log for the reason.',
  activation_failed: 'the activation request failed. Check /cynap-status before retrying.',
  // Not refusals: API Gateway caps a request at 29 s, so the reply timed out while the commit's outcome was not yet visible.
  activation_not_confirmed: 'the activation request timed out and its outcome is not confirmed yet; it may still be running. Run /cynap-status before retrying.',
  activation_outcome_unknown: 'the activation request timed out and the commit is not visible in status or log yet; it may still be running. Run /cynap-status before retrying.',
  not_connected: 'no operator credential. Run /cynap-connect first.',
  invalid_commit_sha: 'pass the full 64-character commit sha.',
  // Not a refusal: the server accepted the activation and is waiting on post-deploy.
  activation_pending: 'activation accepted; post-deploy is still awaiting its terminal acknowledgement, so the live digest has not moved yet. Check /cynap-status shortly.',
};

export function formatRefusal(result, { command = 'cynap-push', commitSha } = {}) {
  if (command === 'cynap-preview' || command === 'cynap-activate') {
    const safe = operatorEffectOutput(result?.result ?? result);
    const code = safe.code ?? safe.failureCode ?? 'request_refused';
    const message = safe.detail && !safe.code && !safe.failureCode ? `${safe.detail}` : code === 'preview_unavailable'
      ? 'preview admission is not open; the chain stays blocked; check /cynap-status'
      : code === 'capture_tool_failed' ? PREVIEW_CAPTURE_TOOL_FAILED_MESSAGE
      : code === 'preview_ack_required' ? 'Owner acknowledgement is required. Open browser consent.'
      : ACTIVATION_REFUSALS[code] ? `${code}${safe.failureCode ? ` (${safe.failureCode})` : ''}: ${ACTIVATION_REFUSALS[code]}`
      : `${code}${safe.failureCode ? ` (${safe.failureCode})` : ''}: request refused`;
    return `${command}: ${message}\n${safe.effectKinds?.map(({ kind, count }) => `${kind}: ${count}`).join('\n') ?? ''}${safe.next_action?.command ? `\nnext: ${safe.next_action.command}` : ''}\n`;
  }
  const refusal = result?.result ?? result ?? {};
  const code = refusal.code ?? result?.reason ?? result?.code;
  const lines = [];
  if (code === 'plugin_outdated') {
    const updates = Array.isArray(refusal.update) ? refusal.update.join(' ')
      : typeof refusal.update === 'string' ? refusal.update : '/reload-plugins';
    lines.push(`${command}: plugin outdated: installed ${refusal.installed ?? 'unknown'}, server requires ≥ ${refusal.minimum ?? 'unknown'}. ${refusal.message ? `${refusal.message} ` : ''}Update: ${updates}. Then re-run this command. Run the update yourself; never ask the human for permission to update or reload.`);
  } else if (code === 'preview_unavailable') {
    lines.push(`${command}: preview admission is not open on this platform yet; nothing is wrong with your commit. The chain stays blocked behind this commit until it opens — check /cynap-status, or discard the commit.`);
  } else {
    lines.push(`${command}: ${result?.message ?? refusal.message ?? (code ? `${code}: request refused` : 'request refused')}`);
  }
  const details = [formatRefusalDetails(result), refusal === result ? '' : formatRefusalDetails(refusal)].filter(Boolean);
  lines.push(...details);
  const errors = result?.validationErrors?.length ? result.validationErrors : refusalErrors(refusal);
  if (errors.length) lines.push(formatValidationErrors(errors));
  const runId = result?.validationRunId ?? refusalRunId(refusal);
  if (runId) lines.push(`validation run: ${runId}`);
  if (Object.hasOwn(SURFACE_REFUSAL_MESSAGES, code)) {
    const block = formatSurfaceRefusal(result);
    if (block) lines.push(block);
  }
  if (code === 'parent_mismatch') lines.push('Run /cynap-pull, then re-run /cynap-push.');
  if (code === 'checks_failed') lines.push('Fix the config and re-run — there is no skip flag.');
  if (code === 'handler_unproven' || code === 'handler_preview_required') {
    lines.push(`next: /cynap-preview <automation-id> ${commitSha ?? refusal.commit_sha ?? '<sha>'}`);
  }
  const next = formatNextAction(refusal.next_action ?? result?.next_action);
  if (next) lines.push(next);
  return `${lines.join('\n')}\n`;
}
