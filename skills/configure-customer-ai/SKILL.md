---
name: configure-customer-ai
description: Use when an org automation, operation, Actor, flow, or code-execution handler needs text generation, structured extraction, classification, or a JEV evaluation.
---

# configure-customer-ai — Customer AI boundary

Customer AI has one platform-owned execution and accounting boundary. Before
authoring a call, explain the funding choice and confirm that the requested
model and operation are available. Do not promise that a configured route is
enabled.

## Explain funding before the user chooses

Read the generated Customer AI paragraph in base context part 5 for payers,
preview spend and current native qualification before selecting a funding mode.

There is **no automatic fallback** between native and BYOK. A provider or
funding failure stays a typed failure; never switch payer to make the call
succeed.

Only a current authenticated human with org billing permission and an audited
confirmation may change funding. An Actor, service token, automation,
operation, prompt, or workspace config cannot select or change the payer.

## What workspace config may declare

`config/ai.json` is intent only. It may narrow execution with exact qualified
model references, per-task defaults, and per-call/per-run/per-period ceilings.
The platform intersects that intent with the qualified catalog, the persisted
funding record, entitlements, and mandatory ceilings.

Config and callers must never supply provider credentials, native provider
endpoints, funding mode, prices, reservation amounts, debit authority, or a
fallback provider list. Keep secrets out of config, prompts, logs, tool
results, and persisted customer AI results. A native model reference is a
catalog identifier, not permission to set `baseURL`.

## Readiness and local testing

Before preview, read the org's admission verdict with `customer_ai_readiness_get`.
Act on the verdict's actor; when the actor is `owner`, hand the Owner `owner_page`.
Test locally with synthetic inputs: `/cynap-test` uses fixtures; `/cynap-dev-ai` records
only your own key reference, and `/cynap-test --real-ai` opts in to real
calls through the trusted parent. Developer provider denials stay local.
Read base context part 5 for the preview carve-out. Do not enable a native route
while authoring config.

## JEV is evaluate-only

JEV is a decision/classification model. Use it only for `evaluate` with the
declared choice or score questions. It remains unavailable until both its SDK
and provider route are qualified. Never substitute a generic chat model for
JEV semantics, and never treat a returned probability as business
authorization. Customer config owns the questions, labels, thresholds, and
business interpretation; the platform validates capability and shape.

## Request identity and upgrades

Native execution requires customer AI protocol 1 and a stable request identity
created once outside transport retries. Legacy keyless bundles remain BYOK-only.
If native execution returns `SDK_UPGRADE_REQUIRED`, rebuild with the current
SDK/runtime instead of retrying, changing providers, or falling back to BYOK.

Use this boundary for every AI-capable entrance: flows, deterministic `llm`
steps, `ctx.tools.llm` from code execution, operations, and Actors. The platform
owns admission, credentials, routing, holds, usage reconciliation, and debit;
the workspace owns business intent.
