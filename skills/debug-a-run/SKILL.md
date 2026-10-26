---
name: debug-a-run
description: Diagnose why an automation run failed, using only the read tools an operator seat holds. Use when a run did not finish, ended failed, or a browser job with an `org:<id>` provider did not log in.
---

# debug-a-run — Find Out Why a Run Failed

You need the `workspace:read-ops` scope (or a higher one that includes it).
Work through the steps in order and stop at the first one that answers the
question. Every value you read here is a closed code or a counter: free text
from the customer's systems is withheld, so never ask the human to paste it.

## 0. Check workspace health and MCP calls

Call `workspace_health` first. For MCP call diagnostics, member operators (tiers 1–2)
may then call `mcp_call_query` with `since`, `tool`, `outcome`, `correlation_id` or
`preview_attempt_id`. Follow `next_cursor` with the same filters. Read the coverage
header: no plane means unknown, an empty page does not prove no calls, and worker
successes are approximate hourly counters excluded from this read. Each read and
refusal is journaled. External operators (tier 3) get `ledger_read_not_admitted`;
use the existing preview status projection instead.

## 1. Find the failing runs — `runs_query`

Call `runs_query` with a `since` bound (and `automation_id` when you know it).
Read each failing automation's failure count and, for a failed run, its
`error_signature` and `error_detail_json`.

- `error_signature` is a short class. A value of the form
  `SESSION_MISSING:<reason>` means a browser job with an `org:<id>` provider
  could not get a session. Go straight to step 4 with `<reason>`.
- `error_detail_json` carries `reason`, `actor`, `provider` and `elapsed_ms`
  for that class. `actor` says who has to act.

## 2. Read the run's journal — `journal_query`

Call `journal_query` for the run's own journal rows (use `journal_describe`
first if you do not know the row kinds). Look at the order of events and where
they stop: a run that never reached its handler fails differently from one that
failed inside it.

## 3. Read the run's evidence — `run_evidence_get`

Call `run_evidence_get` with the run's log id. Read the run status, the
effective runtime budget, the handler hash the run was dispatched with, and the
error class. The handler hash can differ from your current config, so compare
it with the commit you expect before blaming the code.

## 4. Turn the reason into the next step

| Reason | Who acts | What to do next |
|---|---|---|
| `descriptor_not_pushed` | you | Push `integrations/providers/<id>.json`. |
| `descriptor_not_activated` | the Owner | The Owner activates the commit that adds the descriptor. |
| `not_enrolled` | the Owner | The Owner enrolls the login in Integrations. |
| `descriptor_digest_mismatch` | the Owner | The descriptor changed since enrollment. The Owner re-enrolls. |
| `connection_not_connected` | the Owner | The Owner reconnects it in Integrations. |
| `login_failed` | you | The selectors or `requestedOrigins` did not complete a login. Fix the descriptor. |
| `lease_timeout` | retry | Another run held the login lease too long. Run the job again. |
| `login_timeout` | Cynap | The login engine ran past its wait. Report it to Cynap; do not retry in a loop. |
| `unknown` | Cynap | Report it to Cynap. Never assume an Owner action. |

### Customer AI admission

For a `customer_ai` failure, read the persisted `reason`, `actor` and `next_step`.
Call `customer_ai_readiness_get` to check its current route state. Follow the
returned actor; for an Owner action, hand off `owner_page`. BYOK remains unchecked.
The table below is parity-tested against the SDK's closed admission vocabulary.

<!-- customer-ai-admission:start -->
| Reason | Who acts | What to do next |
|---|---|---|
| `admitted` | none | no action is required. |
| `not_applicable_byok` | none | unchecked: runtime pays with the org’s key. |
| `funding_incomplete` | owner | the Owner completes native funding setup in Customer AI settings. |
| `route_not_in_org_config` | operator | the Operator declares a route in the org’s Customer AI config. |
| `operator_run_native_spend` | operator | test with /cynap-test on your own key, or ask the Owner to run it. |
| `invalid_request` | operator | the Operator fixes the request schema or bounds. |
| `model_not_allowed` | operator | the Operator adds the model to allowedModels in config/ai.json. |
| `route_not_activated` | platform | the platform activates the qualified route. |
| `route_unqualified` | platform | the platform qualifies the route and checks its model policy. |
| `budget_disabled` | platform | the platform checks its budget policy. |
| `period_limit` | retry | retry after the period window. |
| `operation_limit` | retry | retry after the operation window. |
| `daily_limit` | retry | retry after the daily window. |
| `window_limit` | retry | retry after the call window. |
| `credits_exhausted` | owner | the Owner reviews Billing; top-ups and optional auto-recharge require an active paid subscription. |
| `billing_unhealthy` | owner | the Owner resolves the billing issue. |
| `org_fenced` | platform | the platform checks the org admission fence. |
| `provider_unavailable` | platform | the platform checks the provider limit or binding. |
| `platform_gateway_exhausted` | platform | the platform restores gateway capacity. |
| `own_provider_exhausted` | owner | the Owner tops up their provider account. |
| `semantically_unusable` | operator | the Operator checks the output contract before starting a new logical call. |
| `replay` | none | return the stored result without dispatching again. |
| `RESULT_UNAVAILABLE` | operator | the Operator handles the unavailable result without redispatching this logical call. |
| `IDEMPOTENCY_CONFLICT` | operator | use a new dedupe_key for changed content, or send the original request. |
| `call_in_doubt` | platform | the platform reconciles the existing call without dispatching it again. |
| `dedupe_cancelled` | operator | handle the stored cancellation without redispatching this logical call. |
| `dedupe_claim_fenced` | platform | resolve the same key again; never dispatch using the fenced logical call id. |
| `dedupe_in_flight` | retry | retry with the same key after a delay. |
| `dedupe_terminal_failure` | operator | handle the failure; a new key can re-spend. |
| `dedupe_unavailable` | platform | retry with the same key later. |
| `dedupe_not_enabled` | operator | call without dedupe_key; keyed calls are not enabled for this org. |
| `deadline_expired` | operator | the Operator starts a new logical call with a valid deadline if work is still required. |
| `period_changed` | operator | the Operator starts a new logical call bound to the current period. |
| `committed_authority_changed` | operator | the Operator resolves the current committed authority before starting a new logical call. |
| `preview_authority_changed` | operator | the Operator obtains fresh preview authority before starting a new logical call. |
| `execution_sealed` | operator | the Operator starts a new execution if more work is required. |
| `model_unpriced` | platform | the platform supplies a qualified price row before admitting the model. |
| `route_not_qualified` | platform | the platform qualifies the route and its admitted upstream. |
| `projection_incomplete` | platform | the platform restores complete financial evidence before admission. |
| `budget_exhausted` | owner | the Owner reviews spend and the live allowance; unresolved liability remains reserved. |
| `authority_changed` | operator | the Operator resolves fresh authority before starting a new logical call. |
| `owner_suspended` | owner | the Owner reviews the suspension before enabling new calls. |
| `credential_changed` | owner | the Owner restores the intended credential before starting a new logical call. |
| `adapter_unavailable` | platform | the platform restores the qualified adapter before a new logical call. |
| `request_incompatible` | operator | the Operator fixes message, tool or schema compatibility before a new logical call. |
| `dispatch_admission_refused` | platform | the platform checks the dispatch admission fence before a new logical call. |
| `provider_rejected` | platform | the platform checks the provider rejection without redispatching this logical call. |
| `provider_failed` | platform | the platform checks the provider failure without redispatching this logical call. |
| `org_not_found` | platform | the platform checks the organization identity and erasure state. |
| `projection_drift` | platform | the platform reconciles and repairs the projection before reopening admission. |
| `expiry_incomplete` | platform | the platform drains due reservation expiry before admission. |
| `drift_evidence_changed` | platform | the platform reads fresh projection evidence before attempting to fence. |
| `policy_not_enabled` | platform | the platform checks the current policy state. |
| `expiry_pending` | platform | the platform drains due reservation expiry before repairing the projection. |
| `outstanding_financial_admission` | platform | the platform drains outstanding financial admissions before completing erasure. |
| `provider_identity_missing` | platform | the platform reconciles the provider identity before finalizing the call. |
| `erasure` | platform | continue the frozen erasure operation. |
| `operator` | operator | inspect the operation before starting a new logical call. |
| `removed` | platform | no action is required. |
| `unknown` | platform | the platform investigates the admission signal. |
<!-- customer-ai-admission:end -->

`model_not_allowed` correction: when the refused model is a class keyword such as `fast`, do not add the
keyword to `allowedModels` (push refuses that too). Change the handler to an exact id that
`config/ai.json` lists. Push now refuses both cases before a run, naming the handler and line.

Use the reason returned by the platform; table order does not select admission. A reason
whose actor is the Owner is an expected state, not a fault: tell the Owner
exactly what to do and stop.

## 5. Queued work, read separately

Queued work is its own step. It reads the queue state of a run that has not
started yet. That read is pending: until it ships, treat "no run row exists" as
"not started" and say so, instead of guessing at queue state.

## Do not

- Do not call `automation_runs_list` for this. Use the diagnosis path above.
- Do not retry a run whose actor is the Owner or Cynap.
