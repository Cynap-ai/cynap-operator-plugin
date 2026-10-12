---
name: fixture-render
description: Inspect a Surface with /cynap-render on synthetic fixtures before pushing it.
---

# Fixture render

Run `/cynap-render <surfaceId> [--state <name>] [--dir <path>]` from a connected,
pulled working directory. Review the command's refusals, findings and request id.
A Fixture render builds on the platform, writes only local scratch files, and makes
no customer-data calls from its host. Its banner always says nothing was written.

Create or edit `surfaces/<id>/__fixtures__/render.json` using **invented data only**.
Never copy org rows. The command scaffolds it when missing; a renamed template should
copy its sibling `<template>.fixture.json` to that path. The strict shape is:

```json
{
  "context": {"viewer": {"role": "owner", "displayName": "Synthetic reviewer"}, "accent": "175 70% 35%", "locale": "en", "direction": "ltr"},
  "states": {
    "populated": [{"tool": "knowledge_query_data:knowledge_advanced_query", "response": {"data": {"rows": [{"id": "fixture-record", "name": "Invented record"}], "meta": {"total": 1}}}}],
    "empty": [{"tool": "knowledge_query_data:knowledge_advanced_query", "response": {"data": {"rows": [], "meta": {"total": 0}}}}],
    "loading": [{"tool": "knowledge_query_data:knowledge_advanced_query", "response": {"pending": true}}],
    "error": [{"tool": "knowledge_query_data:knowledge_advanced_query", "response": {"error": {"code": "fixture_error", "message": "Invented error"}}}]
  }
}
```

Entries answer in order; the first tool and partial `match` on arguments wins.
Dispatcher grants may use `dispatcher:subTool`. Metric batches answer each read from
its matching entry. Other responses are `{denied:true}`, `{viewer_unavailable:true}`,
or `{write:"success"|"refused"|"failed",message?:string}`. Simulated automation writes
return a local trigger id; its status read reports that same outcome. A write without
an entry logs a synthetic success in the browser console. A refused automation returns
a successful terminal run with zero affected rows (the SDK shows a conflict); a refused
conversation command returns the typed `not_owner` refusal. A read without an entry shows a labelled error;
fix the fixture instead of accepting that screenshot. Viewer display facts default
to the synthetic context. Sort, filters and paging are not simulated: change the
fixture to show those cases. Rows end unless the fixture supplies a next cursor.

Open the printed local URL in a **visible** tab. Inspect the outer document's
`data-render-state`: screenshot only `settled` or `pending-by-fixture`.
Do not screenshot `stalled` (no initialized tool call within 5 seconds), `host-error`
or `protocol-mismatch`. Check the labelled missing-fixture panels even when settled.
The host cannot set URL query state; the SDK falls back to memory. Initial query
values may be appended to the URL: the record-form template needs `&id=fixture-record`;
overview's records route needs `&route=records&group=Sample`. Fixtures answer tool calls per route.

For each of populated, empty, loading and error, open light and dark (`theme=light`
or `theme=dark`), wide and narrow (`width=1280` or `width=375`). Set the browser viewport
to the matching width too. Look at each result and take screenshots with your browser
screenshot tool; keep screenshots outside the working directory. For `work-queue` and
`overview`, give the founder the eight populated screenshots plus the empty/loading/error
renders for review. No pixel-baseline test substitutes for founder sign-off.

Then push and give the Owner the **Surface candidate** URL on real data. A Fixture render
proves sample-data appearance; it does not prove live permission, rate limits or data.
