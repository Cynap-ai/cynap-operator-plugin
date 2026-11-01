// GENERATED — DO NOT EDIT. Run scripts/build-preview-contract.mjs.
export const HANDLER_FILE_NAME = 'handler.js';
export const HANDLER_SITE_PATTERN = /^handler\.js:[1-9]\d{0,5}:[1-9]\d{0,4}$/;
export const PREVIEW_ERROR_NAMES = [
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError',
]         ;
export const HANDLER_FAULT_REASONS = [
  'handler_throw',
  'denied', 'budget_stopped', 'invalid_args', 'tool_error', 'dispatch_error',
  'call_timeout', 'call_aborted', 'response_too_large', 'reassembly_failed', 'malformed_response',
]         ;
export const MAX_FAULT_CALL_INDEX = 1_000_000;
export const FAULT_TOOL_PATTERN = /^[a-z][a-z0-9_]{0,47}\.[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const FAULT_REJECTION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,47}$/;
export function safeHandlerFault(value         )                           {
  if (typeof value !== 'object' || value === null) return undefined;
  const { reason, callIndex, tool, rejectionCode } = value                                                                                      ;
  if (!(HANDLER_FAULT_REASONS                      ).includes(reason)) return undefined;
  const index =
    typeof callIndex === 'number' && Number.isInteger(callIndex) && callIndex >= 0 && callIndex <= MAX_FAULT_CALL_INDEX
      ? callIndex
      : undefined;
  return {
    reason: reason                      ,
    ...(index !== undefined ? { callIndex: index } : {}),
    ...(typeof tool === 'string' && FAULT_TOOL_PATTERN.test(tool) ? { tool } : {}),
    ...(typeof rejectionCode === 'string' && FAULT_REJECTION_CODE_PATTERN.test(rejectionCode) ? { rejectionCode } : {}),
  };
}
const faultByError = new WeakMap                                                ();
export function tagToolFault                  (err   , fault              , site                    )    {
  faultByError.set(err, { fault, ...(site ? { site } : {}) });
  return err;
}
export function safeHandlerSite(value         )                     {
  return typeof value === 'string' && HANDLER_SITE_PATTERN.test(value) ? value : undefined;
}
export function safeErrorName(value         )                   {
  return (PREVIEW_ERROR_NAMES                      ).includes(value) ? (value                    ) : 'Error';
}
export function handlerSiteFromStack(stack         , handlerPath        )                     {
  if (typeof stack !== 'string' || handlerPath === '') return undefined;
  const marker = `${handlerPath}:`;
  for (const line of stack.split('\n')) {
    const at = line.indexOf(marker);
    if (at < 0) continue;
    const match = /^(\d+):(\d+)\)?\s*$/.exec(line.slice(at + marker.length));
    if (match) return safeHandlerSite(`${HANDLER_FILE_NAME}:${match[1]}:${match[2]}`);
  }
  return undefined;
}
export function currentHandlerSite(handlerPath        )                     {
  return handlerSiteFromStack(new Error().stack, handlerPath);
}
export function describeHandlerThrow(thrown         , handlerPath        )                         {
  let name         ;
  let stack         ;
  try {
    name = (thrown                                                           )?.constructor?.name;
    stack = (thrown                                          )?.stack;
  } catch {
  }
  const tagged = typeof thrown === 'object' && thrown !== null ? faultByError.get(thrown) : undefined;
  const site = handlerSiteFromStack(stack, handlerPath) ?? tagged?.site;
  const fault = tagged?.fault ?? { reason: 'handler_throw'          };
  return { errorName: safeErrorName(name), ...(site ? { site } : {}), fault };
}
export function siteExistsInBundle(site                    , bundleText        )          {
  const safe = safeHandlerSite(site);
  if (!safe) return false;
  const [, line, column] = safe.split(':').map(Number)                             ;
  const text = bundleText.split('\n')[line - 1];
  return text !== undefined && column <= text.length + 1;
}
export function failureLocationFromRunError(errorJson         )                                     {
  const detail = (errorJson                                           )?.detail;
  if (typeof detail !== 'object' || detail === null) return undefined;
  const { errorName, site, faultReason, faultCallIndex, faultTool, faultRejectionCode } = detail                           ;
  if (!(PREVIEW_ERROR_NAMES                      ).includes(errorName)) return undefined;
  const safeSite = safeHandlerSite(site);
  const fault = safeHandlerFault({ reason: faultReason, callIndex: faultCallIndex, tool: faultTool, rejectionCode: faultRejectionCode });
  return {
    errorName: errorName                                       ,
    ...(safeSite ? { site: safeSite } : {}),
    ...(fault ? { fault } : {}),
  };
}
export const TOOL_REJECTION_CODES = ['READ_TOO_LARGE', 'BATCH_TOO_LARGE']         ;
export const READ_TOO_LARGE_CODE = TOOL_REJECTION_CODES[0];
export const BATCH_TOO_LARGE_CODE = TOOL_REJECTION_CODES[1];
export const BUILD_FACT_ID_PATTERN = /^fact:[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const PREVIEW_BASELINE_OUTCOMES = ['failed', 'succeeded', 'diff_unavailable', 'not_dispatched']         ;
export const PREVIEW_TOOL_FAILURE_CLASSES = ['thrown', 'result_error']         ;
export const PREVIEW_FAULT_CODE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
export const MAX_PREVIEW_TOOL_FAULTS = 2;
const REJECTION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,47}$/;
const TOOL_SEGMENT_PATTERN = /^[a-z0-9_.-]{1,48}$/;
export function previewToolErrorClass(failureClass                         , rejectionCode         )         {
  return rejectionCode !== undefined && REJECTION_CODE_PATTERN.test(rejectionCode) ? `${failureClass}:${rejectionCode}` : failureClass;
}
export function parsePreviewToolErrorClass(value                           )                               {
  const [failureClass, rejectionCode, ...rest] = (value ?? '').split(':');
  if (rest.length > 0 || !(PREVIEW_TOOL_FAILURE_CLASSES                     ).includes(failureClass)) return null;
  if (rejectionCode === undefined) return { failureClass: failureClass                            };
  return REJECTION_CODE_PATTERN.test(rejectionCode)
    ? { failureClass: failureClass                           , rejectionCode }
    : null;
}
function faultCode(head        , tool                    , tail         )         {
  const withTool = [head, tool, tail].filter((part) => part !== undefined).join(':');
  if (tool !== undefined && TOOL_SEGMENT_PATTERN.test(tool) && PREVIEW_FAULT_CODE_PATTERN.test(withTool)) return withTool;
  return [head, tail].filter((part) => part !== undefined).join(':');
}
export function previewToolFaults(tool                    , errorClass                       )                              {
  const faults = [{ code: faultCode('tool_error', tool, errorClass.failureClass) }];
  if (errorClass.rejectionCode !== undefined) faults.push({ code: faultCode(errorClass.rejectionCode.toLowerCase(), tool) });
  return faults;
}
export const PREVIEW_ATTEMPT_STATUSES = ['waiting', 'pending', 'pass', 'fail', 'superseded']         ;
export const ALL_LIFECYCLE_STATUSES = [
  'running',
  'retrying',
  'success',
  'degraded',
  'failure',
  'failure_exhausted',
  'timed_out',
  'dispatch_failed',
  'quarantined',
  'unresolved',
  'cancelled',
  'expired',
]         ;
export const RUN_STATUS_CLASSES = {
  running: {
    terminal: false, green: false, failure: false, errorRequired: false, occurrenceFailure: false,
    followUp: 'none', rated: false, keepsResult: false, reply: 'none',
    customer: { display: 'running', isFailure: false, visible: false }, sli: null,
  },
  retrying: {
    terminal: false, green: false, failure: false, errorRequired: false, occurrenceFailure: false,
    followUp: 'none', rated: false, keepsResult: false, reply: 'none',
    customer: { display: 'running', isFailure: false, visible: false }, sli: null,
  },
  success: {
    terminal: true, green: true, failure: false, errorRequired: false, occurrenceFailure: false,
    followUp: 'resolve', rated: true, keepsResult: true, reply: 'handler',
    customer: { display: 'success', isFailure: false, visible: true }, sli: 'success',
  },
  degraded: {
    terminal: true, green: false, failure: false, errorRequired: true, occurrenceFailure: false,
    followUp: 'bump', rated: true, keepsResult: true, reply: 'handler',
    customer: { display: 'degraded', isFailure: false, visible: true }, sli: 'degraded',
  },
  failure: {
    terminal: true, green: false, failure: true, errorRequired: true, occurrenceFailure: true,
    followUp: 'file', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'failed', isFailure: true, visible: true }, sli: 'error',
  },
  failure_exhausted: {
    terminal: true, green: false, failure: true, errorRequired: true, occurrenceFailure: true,
    followUp: 'file', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'failed', isFailure: true, visible: true }, sli: 'error',
  },
  timed_out: {
    terminal: true, green: false, failure: true, errorRequired: true, occurrenceFailure: true,
    followUp: 'file', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'failed', isFailure: true, visible: true }, sli: 'timeout',
  },
  dispatch_failed: {
    terminal: true, green: false, failure: true, errorRequired: true, occurrenceFailure: true,
    followUp: 'file', rated: false, keepsResult: false, reply: 'fallback',
    customer: { display: 'failed', isFailure: true, visible: true }, sli: 'error',
  },
  quarantined: {
    terminal: true, green: false, failure: true, errorRequired: true, occurrenceFailure: true,
    followUp: 'file', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'failed', isFailure: true, visible: true }, sli: 'error',
  },
  unresolved: {
    terminal: true, green: false, failure: false, errorRequired: true, occurrenceFailure: false,
    followUp: 'file', rated: true, keepsResult: false, reply: 'unresolved_notice',
    customer: { display: 'unresolved', isFailure: true, visible: true }, sli: 'error',
  },
  cancelled: {
    terminal: true, green: false, failure: false, errorRequired: false, occurrenceFailure: false,
    followUp: 'none', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'cancelled', isFailure: false, visible: true }, sli: 'error',
  },
  expired: {
    terminal: true, green: false, failure: true, errorRequired: false, occurrenceFailure: false,
    followUp: 'none', rated: true, keepsResult: false, reply: 'fallback',
    customer: { display: 'expired', isFailure: true, visible: false }, sli: 'error',
  },
}                                                              ;
function statusesWhere
 (
  key   ,
  value   ,
)                                      {
  return new Set(
    ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status][key] === value),
  )                                                  ;
}
export const RUN_STATUS_TERMINAL = statusesWhere('terminal', true);
export const RUN_STATUS_FAILURE = statusesWhere('failure', true);
export const RUN_STATUS_ERROR_REQUIRED = statusesWhere('errorRequired', true);
export const RUN_STATUS_OCCURRENCE_FAILURE = statusesWhere('occurrenceFailure', true);
export const RUN_STATUS_RATED = statusesWhere('rated', true);
export const RUN_STATUS_FOLLOW_UP_FILE = new Set(
  ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status].followUp === 'file'),
);
export const RUN_STATUS_FOLLOW_UP_BUMP = new Set(
  ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status].followUp === 'bump'),
);
export const RUN_STATUS_FOLLOW_UP_RESOLVE = new Set(
  ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status].followUp === 'resolve'),
);
export const RUN_STATUS_CUSTOMER_VISIBLE = new Set(
  ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status].customer.visible),
);
export const RUN_STATUS_CUSTOMER_FAILURE = new Set(
  ALL_LIFECYCLE_STATUSES.filter((status) => RUN_STATUS_CLASSES[status].customer.isFailure),
);
export const RUN_STATUS_GREEN = statusesWhere('green', true);
export const PREVIEW_TRIGGER_TYPE = 'preview'         ;
export function isDryRunParams(runParams         )          {
  if (runParams === null || typeof runParams !== 'object' || Array.isArray(runParams)) return false;
  return (runParams                         ).dry_run === true;
}
export const GREEN_RUN_RULES = Object.freeze({
  statuses: Object.freeze([...RUN_STATUS_GREEN]),
  excludedTrigger: PREVIEW_TRIGGER_TYPE,
  requiredEligibility: true,
});
export function isGreenRun(run               )          {
  return GREEN_RUN_RULES.statuses.some(status => status === run.status)
    && run.dry_run !== true
    && run.trigger_type !== GREEN_RUN_RULES.excludedTrigger
    && run.health_eligible === GREEN_RUN_RULES.requiredEligibility;
}
export function greenRunSql(dialect                       , prefix = '')         {
  if (!/^(?:[a-z_][a-z0-9_]*\.)?$/i.test(prefix)) throw new Error('Invalid green column prefix');
  const statuses = GREEN_RUN_RULES.statuses.map(status => "'" + status + "'").join(', ');
  const c = (name        ) => prefix + name;
  return dialect === 'postgres'
    ? `(COALESCE(${c('status')} IN (${statuses}), false) AND ${c('dry_run')} IS NOT TRUE AND ${c('trigger_type')} IS DISTINCT FROM '${GREEN_RUN_RULES.excludedTrigger}' AND ${c('health_eligible')} IS TRUE)`
    : `(COALESCE(${c('status')} IN (${statuses}), 0) AND COALESCE(${c('dry_run')}, 0) != 1 AND COALESCE(${c('trigger_type')}, '') != '${GREEN_RUN_RULES.excludedTrigger}' AND ${c('health_eligible')} = 1)`;
}
export function greenRunPostgrestFilter()         {
  return `and(status.in.(${GREEN_RUN_RULES.statuses.join(',')}),dry_run.not.is.true,or(trigger_type.is.null,trigger_type.neq.${GREEN_RUN_RULES.excludedTrigger}),health_eligible.is.true)`;
}
