---
name: author-a-surface
description: Author a customer surface with its route and tool manifests, then build it through the operator commit gate.
---

# author-a-surface — Surface authoring

Read `platform-invariants` and the workspace capability matrix in
`choose-the-right-mode` first. Pull the accepted org tree before editing.

## Layout and manifests

```
surfaces/<id>/index.tsx
surfaces/<id>/routes.json
surfaces/<id>/tools.json
```

The id is a lowercase slug, 2–40 characters, starting with a letter. One
push may touch only one surface directory. Alongside the three required files,
the directory may hold `.ts`, `.tsx`, `.css`, and approved image/font assets;
do not bundle customer data files. The source cap is 256 KiB per file and
768 KiB in total. The built HTML cap is 2 MiB.

Both manifests require `version: 1` and reject unknown fields. `routes.json`
requires **1–64** routes with unique `path` and `view`. Each route has a
bundle-relative `path` and lowercase `view`; optional `label`, `icon`,
`navOrder`, and `title` control navigation and chrome. **Give every route a
non-empty path.** An org Surface mounts under `data` beside the Default Surface,
which already owns the empty path, `query` and `entities/:id`; reusing one is
refused as `surface_route_collision`.
`tools.json` requires a `tools` array of at most 64 grants. **An empty array is
valid when the surface calls no tools**; declare every tool the code does call.
Each grant names an app-visible `tool`; mediated writes also need bounded
`automationIds` and `triggerActions`. Use the SDK tool hooks with literal tool
names. The backend validator and builder check both manifests before commit.

## Imports

<!-- generated:surface-imports — do not edit; run scripts/build-surface-contract.mjs -->
A surface may import only `@cynap/surface-sdk`, `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, and relative files inside its own directory.
<!-- /generated:surface-imports -->

## Start from a template

Six templates under `templates/` each map file paths to file text
(`<name>.template.json`, under `files`). Pick the closest one, write each entry
to its path, and replace every value its `placeholders` list names (the
`REPLACE_WITH_…` constants at the top of each file) with the org's own type,
fields, stages or metric. A template's `supply` list names files you add
yourself, such as the font file. Every template's landing route path is the
placeholder `replace-with-landing-path`: replace it with a lowercase slug of
your own (the `analytics` template also uses it in `MOUNT_PATH`). Every
template builds clean, under the size warning line, on the current builder.

Read shapes the templates rely on:

- A grouped `useMetric` row is `{label, value}`. The group's value is `label`,
  never a key named after the dimension; a two-dimension metric labels each row
  `"<a> / <b>"`.
- Stage counts come from `knowledge_query_data` → `knowledge_aggregate` with
  `group_by` set to the stage field (`{group, count}` rows).
  `knowledge_pipeline_summary` returns no stages unless the entity type has a
  schema `pipeline` declaration.
- `knowledge_query` by id returns `{entities: [entity], relations}`; read
  `entities[0]`, whose fields may sit under `properties`.
- Every `Chart*` primitive renders with recharts (`ChartGauge` and `ChartHeatmap` are engine-free), so mixing
  chart types adds no second engine to the 2 MiB bundle cap.

| Template | Use it for |
|---|---|
| `pipeline-writes` | A pipeline board whose cards move stage through a bounded mediated write (`useMutation`, `useConfirm`, `toast`). |
| `record-table` | A large table with server paging and sort, its state in the URL (`useQuery` with `keepPrevious`, `useQueryState`). |
| `analytics` | Metrics with a date range and a drill-down to the table (`useMetric`, `DateRangePicker`). |
| `record-form` | A form built from the entity schema, with a dirty-form guard (`SurfaceForm`, `useConfirm`). |
| `themed-ops` | A distinctly themed dense ops view (`defineSurfaceTheme`, an inlined `.woff2` font, heatmap, gauge). |
| `ops-monitor` | A live view: polling, CSV export, cross-view refresh, row selection (`refreshInterval`, `useDownload`, `toCsv`). |

The two write templates also carry their handler under
`automations/handlers/<id>/`. It reads the viewer's role from
`ctx.input.portal_actor`, which the platform stamps from the signed-in session
(a Surface cannot supply it), refuses any role outside `ALLOWED_ROLES`, writes
only the fields it owns, and returns `rowsAffected` so the surface can tell
applied from conflict. Keep the automation id and action equal in `tools.json`,
the surface and the handler.

## Build findings and fixes

<!-- generated:surface-lint-rules — do not edit; run scripts/build-surface-contract.mjs -->
| Finding rule | Blocks the build | Fix |
|---|---|---|
| `raw_post_message` | yes | Use the Surface SDK host bridge; remove direct `postMessage`. |
| `frame_escape` | yes | Do not reach `parent`, `top`, `opener` or another frame. |
| `global_object_escape` | yes | Read frame globals only through a named, permitted member. |
| `dynamic_global_access` | yes | Replace the computed member of a global object with a named one. |
| `eval` | yes | Remove string evaluation, `new Function`, and string timers. |
| `ext_apps_import` | yes | Import the Surface SDK, never the ext-apps package directly. |
| `import_outside_closed_set` | yes | Import only the Surface SDK, React, React DOM, or relative files inside this surface. |
| `require_call` | yes | Use static ES imports. |
| `dynamic_import` | yes | Import statically; a dynamic relative import must name a literal file. |
| `non_literal_tool_name` | yes | Call an SDK tool hook with a literal tool name. |
| `tool_hook_escape` | yes | Import and call the hook directly in the file; do not alias it away or pass it around. |
| `sdk_reexport` | yes | Do not re-export Surface SDK tool hooks; import them where you call them. |
| `sdk_namespace_escape` | yes | Read a namespace import only as `ns.member`. |
| `csp_not_empty` | yes | Keep every `_meta.ui.csp` domain list empty; fetch through SDK tools. |
| `csp_unprovable` | yes | Write `_meta.ui` as an explicit object literal, without spread or shorthand. |
| `surface_page_heading` | yes | Remove the page-level `<h1>`; the host header owns the page title. Name a record or section with `<h2>` or below. |
| `query_state_key_invalid` | yes | Name a `useQueryState` key with a literal matching `^[a-z][a-zA-Z0-9_]{0,39}$`. |
| `theme_value_unbounded` | yes | Give every `defineSurfaceTheme` token a literal value of its key class: a hex or functional colour, a px/rem length, or a font family name. |
| `color_literal` | no (warning) | Move colour literals into the file that calls `defineSurfaceTheme`, and read them as theme variables elsewhere. |
| `undeclared_tool` | yes | Declare every tool the surface calls in `tools.json`, including `automation_run_status` for a `useMutation`. |
| `query_on_write_tool` | yes | Call a mediated write with `useMutation`, never `useQuery`. |
| `mutation_on_read_tool` | yes | Read with `useQuery`; `useMutation` takes only a mediated write. |
| `write_via_use_tool` | no (warning) | Prefer `useMutation` for a mediated write: it polls the run and settles from its terminal status. |
| `tool_not_app_visible` | yes | Declare only app-visible tools in `tools.json`. |
| `sub_tool_not_readable` | yes | Grant a query-data dispatcher only read sub-tools. |
| `unbounded_mediated_write` | yes | Bound a mediated write with `automationIds` and `triggerActions`. |
| `direct_write_not_admissible` | yes | A surface may not declare a direct write; use a bounded mediated write. |
| `bounds_on_non_mediated_tool` | yes | Put `automationIds`/`triggerActions` only on a mediated write. |
| `duplicate_tool` | yes | Declare each tool once in `tools.json`. |
| `manifest_schema` | yes | Correct the manifest to its schema; unknown keys are refused. |
| `duplicate_route` | yes | Give every route a unique `path`. |
| `duplicate_view` | yes | Give every route a unique `view`. |
| `duplicate_path` | yes | Remove the duplicated source path. |
| `missing_file` | yes | Restore `index.tsx`, `routes.json` and `tools.json`. |
| `disallowed_file` | yes | Keep only code, the two manifests and image/font assets; data belongs in the org database. |
| `file_too_large` | yes | Shrink the file under the per-file cap. |
| `source_too_large` | yes | Shrink the surface source under the 768 KiB total. |
| `not_utf8` | yes | Encode source text as UTF-8. |
| `esbuild` | yes | Fix the compile error at the reported file and line. |
| `esbuild_stalled` | yes | Re-run `/cynap-push` once; report the request id if it repeats. |
| `bundle_over_cap` | yes | Reduce inlined assets or imports. |
| `bundle_near_cap` | no (warning) | The bundle is over 85% of its cap; trim assets or imports before it refuses. |
| `signing_key_unpinned` | yes | Report the request id to Cynap; the builder could not sign. |
| `too_many_surfaces` | yes | Push one surface directory per commit. |
| `surface_id` | yes | Name the surface directory with a lowercase slug of 2–40 characters. |
| `source_unreadable` | yes | Re-run `/cynap-push`; report the request id if it repeats. |
| `surface_not_found` | yes | Rebuild only a surface that exists. |
| `receipt_invalid` | yes | Report the request id to Cynap. |
| `lease_unavailable` | yes | Re-run `/cynap-push` once. |
| `build_in_progress` | yes | Wait for the other build for this org, then re-run once. |
| `builder_throttled` | yes | Re-run `/cynap-push` in a few seconds. |
| `builder_timeout` | yes | Re-run `/cynap-push` once; if it repeats, shrink the surface. |
| `builder_unavailable` | yes | Re-run `/cynap-push` once; report the request id if it repeats. |
| `deadline` | yes | Re-run `/cynap-push`; the request had too little time left to build. |
<!-- /generated:surface-lint-rules -->

A warning (`color_literal`, `write_via_use_tool`, `bundle_near_cap`) does not
block the build; `/cynap-push` prints it under the commit line.

## Refusal codes

<!-- generated:surface-refusals — do not edit; run scripts/build-surface-contract.mjs -->
| Code | Meaning | Fix | Retryable |
|---|---|---|---|
| `surface_build_failed` | the surface build failed | Read the findings: an esbuild finding is your source; otherwise the builder was unavailable, so re-run /cynap-push once and report the request id if it repeats. | no |
| `surface_lint_failed` | the surface source uses a construct surfaces may not use | Talk to the host only through @cynap/surface-sdk hooks; no postMessage, parent/top/opener, eval or ext-apps. | no |
| `surface_import_rejected` | the surface imports a module outside the allowed set | Import only @cynap/surface-sdk, react, react-dom, or relative files inside the surface. | no |
| `surface_manifest_invalid` | the surface directory, routes.json or tools.json is invalid | Keep index.tsx, routes.json and tools.json in the surface directory, and match both manifests to their schemas (unknown keys are refused). | no |
| `surface_tool_not_callable` | the surface calls a tool it may not call | Declare every tool the surface calls in tools.json, only app-visible tools, and use useQuery for reads and useMutation for mediated writes. | no |
| `surface_csp_not_empty` | a _meta.ui.csp domain list is not empty | Leave every _meta.ui.csp domain list empty; fetch data through SDK tools instead. | no |
| `surface_too_large` | the built surface bundle is over its size cap | Shrink the bundle: drop large inlined assets or unused imports. | no |
| `surface_too_many` | this push touches more than one surface | Push one surface per commit: split the change so it touches a single surfaces/<id>/ directory. | no |
| `surface_receipt_invalid` | the platform could not verify the build | The platform could not verify this build. Nothing was stored; report the request id to Cynap. | no |
| `surface_build_busy` | another surface build for this org is running | Another build for this org is running. Re-run /cynap-push in a few seconds. | once |
| `surface_build_timeout` | the surface build did not fit in this request | The build did not fit in this request. Re-run /cynap-push once; if it repeats, shrink the surface. | once |

Retryable: `surface_build_busy`, `surface_build_timeout`. On one of these, retry `/cynap-push` once; if it repeats, stop and report the request id and the findings. Every other code needs a change to the source or the manifests: repeating an identical push is not a fix.
<!-- /generated:surface-refusals -->

The builder has a 12-second deadline inside a 29-second commit request.

Run `/cynap-push --dry-run -m "<message>"` for validator feedback, then push.
The platform builds the source before accepting the commit, and `/cynap-push`
prints a `candidate:` URL per built surface: open it as the Owner or an Admin to
see the committed-but-unapproved view (read tools only). Run
`/cynap-checks <sha>` and then `/cynap-activate <sha>` (the owner's step-up is the approval; do not ask in chat first); a
successful push alone does not publish the surface.
