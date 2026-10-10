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
push may touch only one surface directory. Do not bundle customer data files.

<!-- generated:surface-assets — do not edit; run scripts/build-surface-contract.mjs -->
A surface directory holds `routes.json`, `tools.json`, code (`.tsx`, `.ts`, `.css`) and assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.woff2`). Every other file is refused. Assets are inlined into the bundle: import them statically, or reference them from CSS with a relative `url(./file)`. The directory holds only the surface's own files (index.tsx, routes.json, tools.json, theme.ts, styles.css, relative modules, image/font assets): automation handlers live under `automations/handlers/<id>/` at the workdir root, never inside `surfaces/<id>/`.
<!-- /generated:surface-assets -->

The source cap is 256 KiB per file and
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

The templates under `templates/` each map file paths to file text
(`<name>.template.json`, under `files`). Pick the closest one, write each entry
to its path, and replace every value its `placeholders` list names (the
`REPLACE_WITH_…` constants at the top of each file) with the org's own type,
fields, stages or metric. A template's `supply` list names files you add
yourself, such as the font file. Every template's landing route path is the
placeholder `replace-with-landing-path`: replace it with a lowercase slug of
your own (the `analytics` template also uses it in `MOUNT_PATH`). Give the route a `label` that
names the page, never "Home": the portal already has a Home, so a Surface labelled
"Home" reads as "Data > Home". Every
template builds clean, under the size warning line, on the current builder.

Use kit components; the build refuses raw interactive and heading elements and colour
literals. A bare `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` or `<h2>`–`<h6>` is
stripped to unstyled text by the frame's preflight, so use `Button`, `Input`, `Select`,
`Textarea`, `Table` and `Section` (its `title` is the heading). Lay out with `Stack`, `Row`,
`Grid` and `Section`; show loading with `Skeleton`, an empty result with `EmptyState`, an error
with `Callout`. A hex, `rgb()`, `hsl()` or `oklch()` literal is refused everywhere except the file
that calls `defineSurfaceTheme`; read colours from the theme. Your own CSS is for layout only
(display, gap, padding, alignment). A plain `<div>`, `<span>` or `<svg>` is fine.

A change that edits the surface's source must pass these rules. A pure
`/cynap-push --rebuild` of unchanged source reports the same findings as warnings, so a surface
built before the rules still rebuilds onto a new SDK; the first edit then asks it to migrate.

<!-- generated:surface-kit — do not edit; run scripts/build-surface-contract.mjs -->
Draw with kit components, never raw elements. The form, feedback, action and identity kit that `@cynap/surface-sdk` exports is: `Button`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `Separator`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `Popover`, `PopoverTrigger`, `PopoverContent`, `TabsRoot`, `TabsList`, `TabsTrigger`, `TabsContent`, `TooltipRoot`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`, `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `DateRangePicker`, `PeriodFilterBar`, `ProvenanceFooter`, `SurfaceForm`, `Toaster`, `toast`, `useConfirm`, `Badge`, `Avatar`, `Icon`, `Image`, `BrandMark`, `Hero`, `Reveal`. The layout, content and chart primitives come from the same import.

`<Icon name="…" />` takes one literal `IconName`: `activity`, `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up`, `arrow-up-right`, `bell`, `bookmark`, `briefcase`, `building-2`, `calendar`, `chart-column`, `chart-line`, `chart-pie`, `check`, `chevron-down`, `chevron-left`, `chevron-right`, `chevron-up`, `circle-alert`, `circle-check`, `circle-help`, `circle-x`, `clock`, `cloud`, `credit-card`, `download`, `external-link`, `eye`, `file`, `file-text`, `flag`, `folder`, `funnel`, `globe`, `heart`, `house`, `image`, `inbox`, `info`, `layers`, `layout-dashboard`, `link`, `lock`, `mail`, `map-pin`, `message-square`, `minus`, `package`, `pencil`, `phone`, `plus`, `refresh-cw`, `search`, `send`, `settings`, `share-2`, `shield-check`, `shopping-cart`, `sparkles`, `star`, `tag`, `target`, `trash-2`, `trending-down`, `trending-up`, `triangle-alert`, `truck`, `upload`, `user`, `users`, `wallet`, `x`, `zap`.

`name` must be a string literal at the call site: never a variable, prop, map lookup or conditional (`name={busy ? "refresh-cw" : "truck"}` and `name={icon}` are refused). To vary the icon, branch the whole element: `{busy ? <Icon name="refresh-cw" /> : <Icon name="truck" />}`.
<!-- /generated:surface-kit -->

## Theme and identity

A surface looks like the org's own app through its theme, not through CSS. Call
`defineSurfaceTheme` once, in one file (the only file allowed colour literals), with literal
`light` and `dark` token objects and, optionally, the fields below. Pass the result to
`<SurfaceApp theme={theme}>`. A key you leave out keeps the host's value or the SDK default.

<!-- generated:surface-theme-keys — do not edit; run scripts/build-surface-contract.mjs -->
| Key | Value | Set by |
|---|---|---|
| `--color-background-primary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-background-secondary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-background-tertiary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-primary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-secondary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-tertiary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-ghost` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-danger` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-success` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-text-warning` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-border-primary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-border-secondary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--color-ring-primary` | a hex, `rgb()`, `hsl()` or `oklch()` colour | host, or your theme |
| `--border-radius-sm` | a `px` or `rem` length | host, or your theme |
| `--border-radius-md` | a `px` or `rem` length | host, or your theme |
| `--border-radius-lg` | a `px` or `rem` length | host, or your theme |
| `--border-radius-xl` | a `px` or `rem` length | host, or your theme |
| `--border-radius-full` | a `px` or `rem` length | host, or your theme |
| `--font-sans` | a family name | host, or your theme |
| `--font-mono` | a family name | host, or your theme |
| `--font-display` | a family name | your theme only |
| `--shadow-xs` | up to 3 layers of `[inset] <len> <len> [<len> [<len>]] <colour>` (a length or `0`) | your theme only |
| `--shadow-sm` | up to 3 layers of `[inset] <len> <len> [<len> [<len>]] <colour>` (a length or `0`) | your theme only |
| `--shadow-md` | up to 3 layers of `[inset] <len> <len> [<len> [<len>]] <colour>` (a length or `0`) | your theme only |
| `--shadow-lg` | up to 3 layers of `[inset] <len> <len> [<len> [<len>]] <colour>` (a length or `0`) | your theme only |
| `--shadow-xl` | up to 3 layers of `[inset] <len> <len> [<len> [<len>]] <colour>` (a length or `0`) | your theme only |
| `--font-weight-normal` | an integer `100`–`900` | your theme only |
| `--font-weight-medium` | an integer `100`–`900` | your theme only |
| `--font-weight-semibold` | an integer `100`–`900` | your theme only |
| `--font-weight-bold` | an integer `100`–`900` | your theme only |
| `--chart-1` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-2` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-3` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-4` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-5` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-6` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-7` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
| `--chart-8` | a hex, `rgb()`, `hsl()` or `oklch()` colour | your theme only |
<!-- /generated:surface-theme-keys -->

<!-- generated:surface-theme-fields — do not edit; run scripts/build-surface-contract.mjs -->
- `fonts`: { `sans` → `--font-sans`, `mono` → `--font-mono`, `display` → `--font-display` }. Each value is the default binding of a static `import brand from './brand.woff2'` of a file in the surface; the SDK registers it with the FontFace API under its own family name and sets the key. Do not write `@font-face`.
- `density`: `compact`, `comfortable`, `spacious`. Spacing for `Hero` and the metric primitives.
- `motion`: `none`, `subtle`, `expressive`. Sets only the platform timing variables; under reduced motion every duration is `0s`.
<!-- /generated:surface-theme-fields -->

For a brand surface, combine `fonts.display` with `Hero` (a `PageFrame` variant with a display
headline), `BrandMark` (an image import sized by the type scale, with an optional `darkSrc`),
`Reveal` (an entrance that respects reduced motion) and `Icon`. `Image` and `BrandMark` take only
a static image import.

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

<!-- generated:surface-templates — do not edit; run scripts/build-surface-contract.mjs -->
| Template | Archetype | Uses |
|---|---|---|
| `analytics` | metric with drill-down | useMetric over a DateRangePicker range, a drill-down to a records view through URL state, and the ProvenanceFooter. |
| `brand-portal` | branded landing portal | defineSurfaceTheme with fonts.display, Hero, BrandMark, Reveal and Icon over one governed metric. |
| `ops-monitor` | live monitor with export | refreshInterval and refetchOnVisible, Table row selection, and useDownload with toCsv. |
| `pipeline-writes` | pipeline with a confirmed write | Stage counts with Pipeline; a confirmed, role-checked advance through one granted automation; toasts on the settled verdict. |
| `record-form` | schema-driven record form | SurfaceForm built by useEntityForm from knowledge_entity_schema (requiredness included); a role-checked, field-scoped save; the record's history with its coverage line; confirm before leaving a dirty form. |
| `record-table` | server-paged record table | The root Table with server paging and sort; page and sort in the URL; keepPrevious while the next page loads. |
| `rtl-hebrew` | right-to-left Hebrew view | dir="rtl" layout, a pre-subset Latin+Hebrew .woff2 bound through fonts.sans, and metric cards. |
| `themed-ops` | branded operations view | defineSurfaceTheme with fonts, density, motion and its own shadows; ChartHeatmap and ChartGauge. |
<!-- /generated:surface-templates -->

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
| `theme_value_unbounded` | yes | Give every `defineSurfaceTheme` token a literal value of its key class (a colour, a px/rem length, a family name, an integer `100`–`900` weight or a shadow); bind `fonts` only to a static `import x from './font.woff2'`, and `density`/`motion` only to a listed literal. |
| `messaging_message_primitive` | yes | A surface that grants `conversation_read_thread` must draw messages with `Message` or `Transcript` from `@cynap/surface-sdk`: import one and render it as an element. |
| `icon_name_unknown` | yes | Give `<Icon>` a string-literal `name` from the IconName list, never a variable, prop, map lookup or conditional; to vary the icon branch the whole element (`{busy ? <Icon name="refresh-cw" /> : <Icon name="truck" />}`); do not pass `Icon` around or spread its props. |
| `raw_element` | yes (warning on `--rebuild`) | Use the kit component instead of the raw element: `Button`, `Input`/`Checkbox`/`Switch`, `Select`, `Textarea`, `Table`, or `Section` for a heading. |
| `color_literal` | yes (warning on `--rebuild`) | Remove hex, `rgb()`, `hsl()` and `oklch()` literals: use a kit component, or declare the colour once in the file that calls `defineSurfaceTheme` and read it as a theme variable. |
| `undeclared_tool` | yes | Declare every tool the surface calls in `tools.json`, including `automation_run_status` for a `useMutation` on an automation (a conversation command settles inline and needs none). |
| `query_on_write_tool` | yes | Call a mediated write with `useMutation`, never `useQuery`. |
| `mutation_on_read_tool` | yes | Read with `useQuery`; `useMutation` takes only a mediated write. |
| `write_via_use_tool` | no (warning) | Prefer `useMutation` for a mediated write: it polls the run and settles from its terminal status. |
| `tool_not_app_visible` | yes | Declare only app-visible tools in `tools.json`. |
| `sub_tool_not_readable` | yes | Grant a query-data dispatcher only read sub-tools. |
| `unbounded_mediated_write` | yes | Bound a mediated write with `automationIds` and `triggerActions`. |
| `direct_write_not_admissible` | yes | A surface may not declare a direct write; use a bounded mediated write. |
| `bounds_on_non_mediated_tool` | yes | Put `automationIds`/`triggerActions` only on a mediated write. |
| `bounds_on_conversation_command` | yes | Declare a conversation command without `automationIds`/`triggerActions`: it is not an automation grant. |
| `conversation_command_undeclared_args` | yes | This conversation command has no declared argument keys in the app-visible projection; regenerate the projection (`pnpm codegen:app-visible-tools`). |
| `duplicate_tool` | yes | Declare each tool once in `tools.json`. |
| `manifest_schema` | yes | Correct the manifest to its schema; unknown keys are refused. |
| `duplicate_route` | yes | Give every route a unique `path`. |
| `duplicate_view` | yes | Give every route a unique `view`. |
| `duplicate_path` | yes | Remove the duplicated source path. |
| `missing_file` | yes | Restore `index.tsx`, `routes.json` and `tools.json`. |
| `disallowed_file` | yes | Keep only code, the two manifests and image/font assets in the surface directory; data belongs in the org database and automation handlers belong under automations/handlers/<id>/ at the workdir root, never inside surfaces/<id>/. |
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

A warning (`write_via_use_tool`, `bundle_near_cap`, and `raw_element` / `color_literal` on a
`--rebuild`) does not block the build; `/cynap-push` prints it under the commit line. A refusal
prints one `file:line:column: message [rule]` per finding, naming the kit component to use.

## Conversations: the Messaging primitives

A surface that shows conversations composes the SDK's Messaging primitives (`ConversationList`,
`Transcript`, `Message`, `Composer`, `OwnershipControls`, `ContactPanel`, `FollowUpControl`,
`TemplatePicker`, `ChannelBadge`) and never draws its own inbox.

- Read through the hooks. Each one is bound to one tool, which you declare in `tools.json`:
  `useConversations` → `conversation_list_threads`, `useConversation` → `conversation_read_thread`,
  `useContact` → `conversation_contact_read`, `useSavedViews` → `conversation_saved_view_list`.
  `useFreshness` calls no tool.
- Write with `useMutation('<conversation command>')`. A conversation command settles inline, so it
  needs no `automation_run_status` in `tools.json`, and it takes no `automationIds`/`triggerActions`.
  Pass the hook's `refusal` to the component that shows it.
- `messaging_message_primitive`: a surface that grants `conversation_read_thread` must render its
  messages with `Message` or `Transcript`, imported from `@cynap/surface-sdk`. Otherwise the build
  is refused.

## Refusal codes

<!-- generated:surface-refusals — do not edit; run scripts/build-surface-contract.mjs -->
| Code | Meaning | Fix | Retryable |
|---|---|---|---|
| `surface_build_failed` | the surface build failed | Read the findings: an esbuild finding is your source; otherwise the builder was unavailable, so re-run /cynap-push once and report the request id if it repeats. | no |
| `surface_lint_failed` | the surface source uses a construct surfaces may not use | Talk to the host only through @cynap/surface-sdk hooks (no postMessage, parent/top/opener, eval or ext-apps), and draw with kit components: no raw button/input/select/textarea/table/h2–h6 and no colour literals. | no |
| `surface_import_rejected` | the surface imports a module, or its CSS references a file, outside the allowed set | Import only @cynap/surface-sdk, react, react-dom, or relative files inside the surface; in CSS, reference a file inside the surface with a relative url(./file). | no |
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
