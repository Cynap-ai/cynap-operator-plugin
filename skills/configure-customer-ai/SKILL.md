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

| Funding | Who pays the provider | Cynap inference charge | Other charges |
|---|---|---|---|
| **Native** | Cynap pays the qualified provider route. | Measured usable inference is deducted from org credits. A reservation can remain pending while provider usage is reconciled. | Ordinary runtime charges still apply. |
| **BYOK** | The customer pays the provider directly with its stored credential. | No Cynap inference debit. | Ordinary runtime charges still apply. |

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

## Providers and current availability

- **Vercel AI Gateway** is the intended native default.
- **OpenRouter** is an optional qualified route, not an automatic substitute.
- Native routes remain unavailable until platform policy marks the exact
  provider × operation × model route qualified. Handle the typed unavailable
  result and tell the user that enablement is a platform qualification step.
- Existing approved direct-provider endpoints can remain BYOK transports;
  they do not become native endpoints because they appear in workspace config.

Do not run a paid probe or enable a native route while authoring customer
config.

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
