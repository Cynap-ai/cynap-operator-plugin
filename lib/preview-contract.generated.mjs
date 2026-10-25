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
