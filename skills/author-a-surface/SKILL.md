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
bundle-relative `path` (empty string is the landing view) and lowercase `view`;
optional `label`, `icon`, `navOrder`, and `title` control navigation and chrome.
`tools.json` requires a `tools` array of at most 64 grants. **An empty array is
valid when the surface calls no tools**; declare every tool the code does call.
Each grant names an app-visible `tool`; mediated writes also need bounded
`automationIds` and `triggerActions`. Use the SDK tool hooks with literal tool
names. The backend validator and builder check both manifests before commit.

## Build findings and fixes

| Finding rule | Fix |
|---|---|
| `raw_post_message` | Use the Surface SDK host bridge; remove direct `postMessage`. |
| `frame_escape`, `global_object_escape`, `dynamic_global_access` | Keep frame globals behind named, permitted member reads; do not reach `parent`, `top`, or `opener`. |
| `eval` | Remove string evaluation, `new Function`, and string timers. |
| `ext_apps_import`, `import_outside_closed_set` | Import only the Surface SDK, React, React DOM, or relative files inside this surface. |
| `require_call`, `dynamic_import` | Use static ES imports; dynamic relative imports must name a literal file. |
| `non_literal_tool_name` | Call an SDK hook with a literal tool name. |
| `tool_hook_escape`, `sdk_reexport`, `sdk_namespace_escape` | Import and call the hook directly in the file; do not re-export, alias away, or pass it around. |
| `csp_not_empty`, `csp_unprovable` | Keep every `_meta.ui.csp` domain list empty and its object shape explicit; fetch through SDK tools. |
| `undeclared_tool`, tool visibility findings | Match every called tool to `tools.json` and choose an app-visible grant. |
| `manifest_schema`, `duplicate_route`, `duplicate_view` | Correct required fields and unique route paths/views. |
| `missing_file`, `disallowed_file`, `file_too_large`, `source_too_large`, `not_utf8` | Restore required files, remove unsupported assets, shrink source, or encode text as UTF-8. |
| `bundle_over_cap` | Reduce inlined assets or imports. |

`surface_lint_failed` carries the source file, line, and rule. Other refusal
codes include `surface_manifest_invalid`, `surface_import_rejected`,
`surface_tool_not_callable`, `surface_csp_not_empty`, and `surface_too_large`.
The builder has a 12-second deadline inside a 29-second commit request.
On `surface_build_timeout`, retry `/cynap-push` **once**. If it repeats, stop
and report the request and findings; repeated identical pushes are not a fix.
On `surface_build_busy`, wait for the other org build to finish before one
retry. On `surface_receipt_invalid`, report the request id.

Run `/cynap-push --dry-run -m "<message>"` for validator feedback, then push.
The platform builds the source before accepting the commit. Run
`/cynap-checks <sha>` and `/cynap-activate <sha>` for owner approval; a
successful push alone does not publish the surface.
