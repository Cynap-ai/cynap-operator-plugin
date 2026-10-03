// GENERATED — DO NOT EDIT. Rebuild with the plugin package's build-surface-contract script.
// The surface build contract: the closed import set, the surface refusal codes (meaning, hint,
// retryability) and the build finding rules.

export const SURFACE_IMPORT_CLOSED_SET = Object.freeze([
  "@cynap/surface-sdk",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client"
]);

export const SURFACE_REFUSAL_DOCS = Object.freeze({
  "surface_build_failed": {
    "meaning": "the surface build failed",
    "hint": "Read the findings: an esbuild finding is your source; otherwise the builder was unavailable, so re-run /cynap-push once and report the request id if it repeats.",
    "retryable": false
  },
  "surface_lint_failed": {
    "meaning": "the surface source uses a construct surfaces may not use",
    "hint": "Talk to the host only through @cynap/surface-sdk hooks (no postMessage, parent/top/opener, eval or ext-apps), and draw with kit components: no raw button/input/select/textarea/table/h2–h6 and no colour literals.",
    "retryable": false
  },
  "surface_import_rejected": {
    "meaning": "the surface imports a module outside the allowed set",
    "hint": "Import only @cynap/surface-sdk, react, react-dom, or relative files inside the surface.",
    "retryable": false
  },
  "surface_manifest_invalid": {
    "meaning": "the surface directory, routes.json or tools.json is invalid",
    "hint": "Keep index.tsx, routes.json and tools.json in the surface directory, and match both manifests to their schemas (unknown keys are refused).",
    "retryable": false
  },
  "surface_tool_not_callable": {
    "meaning": "the surface calls a tool it may not call",
    "hint": "Declare every tool the surface calls in tools.json, only app-visible tools, and use useQuery for reads and useMutation for mediated writes.",
    "retryable": false
  },
  "surface_csp_not_empty": {
    "meaning": "a _meta.ui.csp domain list is not empty",
    "hint": "Leave every _meta.ui.csp domain list empty; fetch data through SDK tools instead.",
    "retryable": false
  },
  "surface_too_large": {
    "meaning": "the built surface bundle is over its size cap",
    "hint": "Shrink the bundle: drop large inlined assets or unused imports.",
    "retryable": false
  },
  "surface_too_many": {
    "meaning": "this push touches more than one surface",
    "hint": "Push one surface per commit: split the change so it touches a single surfaces/<id>/ directory.",
    "retryable": false
  },
  "surface_receipt_invalid": {
    "meaning": "the platform could not verify the build",
    "hint": "The platform could not verify this build. Nothing was stored; report the request id to Cynap.",
    "retryable": false
  },
  "surface_build_busy": {
    "meaning": "another surface build for this org is running",
    "hint": "Another build for this org is running. Re-run /cynap-push in a few seconds.",
    "retryable": true
  },
  "surface_build_timeout": {
    "meaning": "the surface build did not fit in this request",
    "hint": "The build did not fit in this request. Re-run /cynap-push once; if it repeats, shrink the surface.",
    "retryable": true
  }
});

export const SURFACE_LINT_RULES = Object.freeze({
  "raw_post_message": {
    "severity": "refusal",
    "fix": "Use the Surface SDK host bridge; remove direct `postMessage`."
  },
  "frame_escape": {
    "severity": "refusal",
    "fix": "Do not reach `parent`, `top`, `opener` or another frame."
  },
  "global_object_escape": {
    "severity": "refusal",
    "fix": "Read frame globals only through a named, permitted member."
  },
  "dynamic_global_access": {
    "severity": "refusal",
    "fix": "Replace the computed member of a global object with a named one."
  },
  "eval": {
    "severity": "refusal",
    "fix": "Remove string evaluation, `new Function`, and string timers."
  },
  "ext_apps_import": {
    "severity": "refusal",
    "fix": "Import the Surface SDK, never the ext-apps package directly."
  },
  "import_outside_closed_set": {
    "severity": "refusal",
    "fix": "Import only the Surface SDK, React, React DOM, or relative files inside this surface."
  },
  "require_call": {
    "severity": "refusal",
    "fix": "Use static ES imports."
  },
  "dynamic_import": {
    "severity": "refusal",
    "fix": "Import statically; a dynamic relative import must name a literal file."
  },
  "non_literal_tool_name": {
    "severity": "refusal",
    "fix": "Call an SDK tool hook with a literal tool name."
  },
  "tool_hook_escape": {
    "severity": "refusal",
    "fix": "Import and call the hook directly in the file; do not alias it away or pass it around."
  },
  "sdk_reexport": {
    "severity": "refusal",
    "fix": "Do not re-export Surface SDK tool hooks; import them where you call them."
  },
  "sdk_namespace_escape": {
    "severity": "refusal",
    "fix": "Read a namespace import only as `ns.member`."
  },
  "csp_not_empty": {
    "severity": "refusal",
    "fix": "Keep every `_meta.ui.csp` domain list empty; fetch through SDK tools."
  },
  "csp_unprovable": {
    "severity": "refusal",
    "fix": "Write `_meta.ui` as an explicit object literal, without spread or shorthand."
  },
  "surface_page_heading": {
    "severity": "refusal",
    "fix": "Remove the page-level `<h1>`; the host header owns the page title. Name a record or section with `<h2>` or below."
  },
  "query_state_key_invalid": {
    "severity": "refusal",
    "fix": "Name a `useQueryState` key with a literal matching `^[a-z][a-zA-Z0-9_]{0,39}$`."
  },
  "theme_value_unbounded": {
    "severity": "refusal",
    "fix": "Give every `defineSurfaceTheme` token a literal value of its key class: a hex or functional colour, a px/rem length, or a font family name."
  },
  "raw_element": {
    "severity": "refusal",
    "rebuild": "warning",
    "fix": "Use the kit component instead of the raw element: `Button`, `Input`/`Checkbox`/`Switch`, `Select`, `Textarea`, `Table`, or `Section` for a heading."
  },
  "color_literal": {
    "severity": "refusal",
    "rebuild": "warning",
    "fix": "Remove hex, `rgb()`, `hsl()` and `oklch()` literals: use a kit component, or declare the colour once in the file that calls `defineSurfaceTheme` and read it as a theme variable."
  },
  "undeclared_tool": {
    "severity": "refusal",
    "fix": "Declare every tool the surface calls in `tools.json`, including `automation_run_status` for a `useMutation`."
  },
  "query_on_write_tool": {
    "severity": "refusal",
    "fix": "Call a mediated write with `useMutation`, never `useQuery`."
  },
  "mutation_on_read_tool": {
    "severity": "refusal",
    "fix": "Read with `useQuery`; `useMutation` takes only a mediated write."
  },
  "write_via_use_tool": {
    "severity": "warning",
    "fix": "Prefer `useMutation` for a mediated write: it polls the run and settles from its terminal status."
  },
  "tool_not_app_visible": {
    "severity": "refusal",
    "fix": "Declare only app-visible tools in `tools.json`."
  },
  "sub_tool_not_readable": {
    "severity": "refusal",
    "fix": "Grant a query-data dispatcher only read sub-tools."
  },
  "unbounded_mediated_write": {
    "severity": "refusal",
    "fix": "Bound a mediated write with `automationIds` and `triggerActions`."
  },
  "direct_write_not_admissible": {
    "severity": "refusal",
    "fix": "A surface may not declare a direct write; use a bounded mediated write."
  },
  "bounds_on_non_mediated_tool": {
    "severity": "refusal",
    "fix": "Put `automationIds`/`triggerActions` only on a mediated write."
  },
  "duplicate_tool": {
    "severity": "refusal",
    "fix": "Declare each tool once in `tools.json`."
  },
  "manifest_schema": {
    "severity": "refusal",
    "fix": "Correct the manifest to its schema; unknown keys are refused."
  },
  "duplicate_route": {
    "severity": "refusal",
    "fix": "Give every route a unique `path`."
  },
  "duplicate_view": {
    "severity": "refusal",
    "fix": "Give every route a unique `view`."
  },
  "duplicate_path": {
    "severity": "refusal",
    "fix": "Remove the duplicated source path."
  },
  "missing_file": {
    "severity": "refusal",
    "fix": "Restore `index.tsx`, `routes.json` and `tools.json`."
  },
  "disallowed_file": {
    "severity": "refusal",
    "fix": "Keep only code, the two manifests and image/font assets; data belongs in the org database."
  },
  "file_too_large": {
    "severity": "refusal",
    "fix": "Shrink the file under the per-file cap."
  },
  "source_too_large": {
    "severity": "refusal",
    "fix": "Shrink the surface source under the 768 KiB total."
  },
  "not_utf8": {
    "severity": "refusal",
    "fix": "Encode source text as UTF-8."
  },
  "esbuild": {
    "severity": "refusal",
    "fix": "Fix the compile error at the reported file and line."
  },
  "esbuild_stalled": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push` once; report the request id if it repeats."
  },
  "bundle_over_cap": {
    "severity": "refusal",
    "fix": "Reduce inlined assets or imports."
  },
  "bundle_near_cap": {
    "severity": "warning",
    "fix": "The bundle is over 85% of its cap; trim assets or imports before it refuses."
  },
  "signing_key_unpinned": {
    "severity": "refusal",
    "fix": "Report the request id to Cynap; the builder could not sign."
  },
  "too_many_surfaces": {
    "severity": "refusal",
    "fix": "Push one surface directory per commit."
  },
  "surface_id": {
    "severity": "refusal",
    "fix": "Name the surface directory with a lowercase slug of 2–40 characters."
  },
  "source_unreadable": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push`; report the request id if it repeats."
  },
  "surface_not_found": {
    "severity": "refusal",
    "fix": "Rebuild only a surface that exists."
  },
  "receipt_invalid": {
    "severity": "refusal",
    "fix": "Report the request id to Cynap."
  },
  "lease_unavailable": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push` once."
  },
  "build_in_progress": {
    "severity": "refusal",
    "fix": "Wait for the other build for this org, then re-run once."
  },
  "builder_throttled": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push` in a few seconds."
  },
  "builder_timeout": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push` once; if it repeats, shrink the surface."
  },
  "builder_unavailable": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push` once; report the request id if it repeats."
  },
  "deadline": {
    "severity": "refusal",
    "fix": "Re-run `/cynap-push`; the request had too little time left to build."
  }
});
