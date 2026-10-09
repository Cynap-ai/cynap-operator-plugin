// GENERATED — DO NOT EDIT. Rebuild with the plugin package's build-surface-contract script.
// The surface build contract: the closed import set, the surface refusal codes (meaning, hint,
// retryability), the workspace and activation refusal docs (with actor) and the build finding rules.

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
    "meaning": "the surface imports a module, or its CSS references a file, outside the allowed set",
    "hint": "Import only @cynap/surface-sdk, react, react-dom, or relative files inside the surface; in CSS, reference a file inside the surface with a relative url(./file).",
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

export const WORKSPACE_REFUSAL_DOCS = Object.freeze({
  "validation_failed": {
    "meaning": "the changeset failed validation",
    "hint": "Fix the files named in the validation errors, then push again.",
    "retryable": false,
    "actor": "operator"
  },
  "path_class_forbidden": {
    "meaning": "a path in the changeset belongs to a class this seat may not write",
    "hint": "Remove the listed paths from the commit. Owner-class files change through the Owner, not an operator seat.",
    "retryable": false,
    "actor": "operator"
  },
  "owner_field_from_operator_seat": {
    "meaning": "the commit edits an Owner-class field file",
    "hint": "Revert that file in the commit. The Owner changes it.",
    "retryable": false,
    "actor": "operator"
  },
  "kind_not_activatable": {
    "meaning": "the commit holds a file kind that rides its own entrance, not the workspace commit",
    "hint": "Remove the listed paths from the commit and use the entrance named for their kind.",
    "retryable": false,
    "actor": "operator"
  },
  "parent_mismatch": {
    "meaning": "the commit was built on a head that has since moved",
    "hint": "Run /cynap-pull, then re-run /cynap-push.",
    "retryable": false,
    "actor": "operator"
  },
  "chain_full": {
    "meaning": "too many unactivated commits are already waiting in the chain",
    "hint": "Activate or discard the waiting commits, then push again.",
    "retryable": false,
    "actor": "operator"
  },
  "workspace_writes_frozen": {
    "meaning": "workspace writes are frozen for this org",
    "hint": "Nothing is wrong with your commit. Wait for the freeze to lift, then retry.",
    "retryable": true,
    "actor": "platform"
  },
  "signer_unavailable": {
    "meaning": "the platform could not sign the commit",
    "hint": "Re-run once; if it repeats, report the request id to Cynap.",
    "retryable": true,
    "actor": "platform"
  },
  "storage_unavailable": {
    "meaning": "the platform could not reach workspace storage",
    "hint": "Re-run once; if it repeats, report the request id to Cynap.",
    "retryable": true,
    "actor": "platform"
  },
  "storage_conflict": {
    "meaning": "a concurrent write won the storage race",
    "hint": "Re-run the command once.",
    "retryable": true,
    "actor": "platform"
  },
  "post_commit_quarantined": {
    "meaning": "the commit was stored, then quarantined by a post-commit check",
    "hint": "Do not retry. Report the request id to Cynap.",
    "retryable": false,
    "actor": "platform"
  },
  "commit_spans_irreversible_effects": {
    "meaning": "a handler change does not pair one source with its matching config",
    "hint": "Commit a handler source with its config in the commit or base tree; delete a source only when it has no config.",
    "retryable": false,
    "actor": "operator"
  },
  "gate_change_not_alone": {
    "meaning": "a change to an existing checks suite was committed together with other files",
    "hint": "Commit the checks-suite change alone, then push the other files separately.",
    "retryable": false,
    "actor": "operator"
  },
  "checks_uncovered_path": {
    "meaning": "a changed path is not covered by any checks suite",
    "hint": "Add or extend a checks suite so it covers the listed paths, in its own commit.",
    "retryable": false,
    "actor": "operator"
  },
  "checks_tree_indeterminate": {
    "meaning": "the tree could not be read well enough to decide check coverage",
    "hint": "Run /cynap-pull and push again; if it repeats, report the request id to Cynap.",
    "retryable": false,
    "actor": "operator"
  },
  "schema_change_not_admitted": {
    "meaning": "the schema change is not one this entrance admits",
    "hint": "Read the listed schema deltas and change the schema file to an admitted change.",
    "retryable": false,
    "actor": "operator"
  },
  "schema_no_op": {
    "meaning": "the schema change changes nothing",
    "hint": "Drop the schema file from the commit, or make the change you meant.",
    "retryable": false,
    "actor": "operator"
  },
  "preview_input_missing": {
    "meaning": "a webhook-triggered handler was pushed without its synthetic preview input",
    "hint": "Add the handler preview input file next to its config, then push again.",
    "retryable": false,
    "actor": "operator"
  },
  "activation_paused": {
    "meaning": "activations are paused platform-wide",
    "hint": "Nothing is wrong with your commit. Check /cynap-status and retry once the pause lifts.",
    "retryable": true,
    "actor": "platform"
  },
  "activation_in_progress": {
    "meaning": "another schema effect holds this org's lease",
    "hint": "Wait for the running activation to finish, then retry.",
    "retryable": true,
    "actor": "platform"
  },
  "activation_incomplete": {
    "meaning": "an earlier activation did not finish",
    "hint": "Resume the earlier activation with /cynap-activate before activating anything newer.",
    "retryable": false,
    "actor": "operator"
  },
  "executor_fenced": {
    "meaning": "a newer activation executor took over this run",
    "hint": "Check /cynap-status, then retry once if the commit is not live.",
    "retryable": true,
    "actor": "platform"
  },
  "schema_not_ready": {
    "meaning": "the schema effect is not ready to be published",
    "hint": "Check /cynap-status and retry; if it repeats, report the request id to Cynap.",
    "retryable": true,
    "actor": "platform"
  },
  "schema_state_diverged": {
    "meaning": "the live schema no longer matches the state the activation was planned against",
    "hint": "Run /cynap-pull, review the schema change against the live state, and commit again.",
    "retryable": false,
    "actor": "operator"
  },
  "schema_plan_changed": {
    "meaning": "the schema plan changed since the Owner consented to it",
    "hint": "The Owner reviews the current plan and consents again.",
    "retryable": false,
    "actor": "owner"
  },
  "schema_live_column_conflict": {
    "meaning": "a declared column already exists live in a shape that cannot be adopted",
    "hint": "Rename the declared column or match the live shape, then commit again.",
    "retryable": false,
    "actor": "operator"
  },
  "schema_apply_budget_exceeded": {
    "meaning": "the schema change is larger than one activation may apply",
    "hint": "Split the schema change into smaller commits.",
    "retryable": false,
    "actor": "operator"
  },
  "handler_unproven": {
    "meaning": "no passing preview stands for the handler, or the approval carries no preview binding",
    "hint": "Run /cynap-preview for the automation at this commit, then ask the Owner to approve again.",
    "retryable": false,
    "actor": "operator"
  },
  "preview_binding_mismatch": {
    "meaning": "the passing preview is not the one the Owner approved",
    "hint": "The Owner opens the approval for this commit again so it binds the current pass, then activate.",
    "retryable": false,
    "actor": "owner"
  },
  "preview_ack_required": {
    "meaning": "the preview needs per-effect acknowledgement from the Owner",
    "hint": "The Owner reviews and acknowledges every required effect before approving.",
    "retryable": false,
    "actor": "owner"
  },
  "preview_ack_limit_exceeded": {
    "meaning": "the preview exceeds the approval limit of 10,000 effects",
    "hint": "Reduce the candidate effects and run a new preview.",
    "retryable": false,
    "actor": "operator"
  },
  "handler_base_moved": {
    "meaning": "the handler's base changed since it was approved",
    "hint": "Run /cynap-pull, preview the handler again, and ask the Owner to approve the new commit.",
    "retryable": false,
    "actor": "operator"
  },
  "bundle_hash_mismatch": {
    "meaning": "the built handler bundle is not the one that was approved",
    "hint": "Push the handler again and ask the Owner to approve the new commit.",
    "retryable": false,
    "actor": "operator"
  },
  "solution_not_entitled": {
    "meaning": "the commit writes wiring owned by a Solution this org is not entitled to",
    "hint": "Remove that wiring from the commit. Entitlement is granted by Cynap, never by a file in the tree.",
    "retryable": false,
    "actor": "platform"
  },
  "code_execution_unavailable": {
    "meaning": "code execution is not available to this org right now",
    "hint": "Retry later; if it repeats, report the request id to Cynap.",
    "retryable": true,
    "actor": "platform"
  },
  "approval_mismatch": {
    "meaning": "the Owner approval does not match the config being deployed",
    "hint": "The Owner approves the current commit again.",
    "retryable": false,
    "actor": "owner"
  },
  "host_not_connected": {
    "meaning": "a host the handler declares has no connected integration",
    "hint": "The Owner connects that integration in Integrations, then activate again.",
    "retryable": false,
    "actor": "owner"
  },
  "host_shape_invalid": {
    "meaning": "a declared host is not a valid host entry",
    "hint": "Fix the host entry named in the detail then push again.",
    "retryable": false,
    "actor": "operator"
  },
  "capability_not_granted": {
    "meaning": "a capability the handler needs is not granted to this org",
    "hint": "Ask Cynap to grant the capability, or remove its use from the handler.",
    "retryable": false,
    "actor": "platform"
  },
  "run_trust_unreadable": {
    "meaning": "the run-trust decision could not be read",
    "hint": "Retry once; if it repeats, report the request id to Cynap.",
    "retryable": true,
    "actor": "platform"
  },
  "handler_effect_absent": {
    "meaning": "the reconciler released an activation whose handler effect never landed",
    "hint": "Push the handler again; report the request id to Cynap if it repeats.",
    "retryable": false,
    "actor": "platform"
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
    "fix": "Give every `defineSurfaceTheme` token a literal value of its key class (a colour, a px/rem length, a family name, an integer `100`–`900` weight or a shadow); bind `fonts` only to a static `import x from './font.woff2'`, and `density`/`motion` only to a listed literal."
  },
  "icon_name_unknown": {
    "severity": "refusal",
    "fix": "Give `<Icon>` a string-literal `name` from the IconName list, never a variable, prop, map lookup or conditional; to vary the icon branch the whole element (`{busy ? <Icon name=\"refresh-cw\" /> : <Icon name=\"truck\" />}`); do not pass `Icon` around or spread its props."
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
  "bounds_on_conversation_command": {
    "severity": "refusal",
    "fix": "Declare a conversation command without `automationIds`/`triggerActions`: it is not an automation grant."
  },
  "conversation_command_undeclared_args": {
    "severity": "refusal",
    "fix": "This conversation command has no declared argument keys in the app-visible projection; regenerate the projection (`pnpm codegen:app-visible-tools`)."
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
    "fix": "Keep only code, the two manifests and image/font assets in the surface directory; data belongs in the org database and automation handlers belong under automations/handlers/<id>/ at the workdir root, never inside surfaces/<id>/."
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
