---
name: author-a-surface
description: Author a customer surface with its route and tool manifests, look at it with /cynap-render before pushing, then build it through the operator commit gate.
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

**The panel lists pages only.** A route with a `label` becomes a row in the App's
nav panel. Give a `label` only to a route that is its own page. A saved view or a
filter of another route's list (Mine, Unassigned, Open) is not a page: give it no
`label` and no `navOrder`, keep its `path`, `view` and `title` so its URL still
resolves, and offer it as an in-page switcher on the list's own page. A `navOrder`
of 100 or more places a row below the panel's divider, in the setup range, so put
settings and configuration pages there. An installed App is its own Area in the
sidebar, and its pages appear under no other Area. Nothing in the build checks this
yet; the rule is yours to keep.
`tools.json` requires a `tools` array of at most 64 grants. **An empty array is
valid when the surface calls no tools**; declare every tool the code does call.
Each grant names an app-visible `tool`; mediated writes also need bounded
`automationIds` and `triggerActions`. Use the SDK tool hooks with literal tool
names. The backend validator and builder check both manifests before commit.

## Imports

<!-- generated:surface-imports — do not edit; run scripts/build-surface-contract.mjs -->
A surface may import only `@cynap/surface-sdk`, `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, and relative files inside its own directory.
<!-- /generated:surface-imports -->

## Design a page

Compare with the portal's own data pages: a Surface should read as a native portal page,
using the same type scale, spacing and controls. Org branding changes theme tokens.

1. Start with one `PageHeader`: title, one-line description and at most one primary action.
   Add only what earns its place, in order: a summary strip (`StatGroup` with 3–5 headline
   numbers, or related `KPI` pieces), `Toolbar` or `FilterBar`, main content, secondary content.
2. Choose a pattern: work queue (filtered table and detail `Sheet`), overview (stats,
   one or two charts and activity), master-detail (`SplitView`), record form (sectioned
   `SurfaceForm` and sticky action bar), or long text review (`Prose`, metadata and actions).
   The excerpts below come from the shipped templates; open the full template for context.
3. Every data region needs populated, empty (`EmptyState` with one next action), loading
   (`Skeleton` matching the final layout), and error (`AlertCard` with a retry) states.
   Treat a denied read as a labelled refusal, never as an empty result. A populated-only page is unfinished.
4. Use one primary button per view. Destructive actions use `variant="destructive"` and
   `useConfirm`. Status is a `Badge` with a semantic `tone` and text, never colour alone.
5. Use `Stack`, `Row`, `Grid` and `Section` gaps and the type scale. Avoid hand-set font
   sizes and pixel margins. Truncate table text with a tooltip; put long text in a `Sheet`
   or `Prose`, never a wide cell.
6. Check at 375 px: `Grid` responsive columns collapse, tables scroll inside their card,
   and the primary action stays reachable. Keep hover, focus-visible, pressed and disabled
   states; use motion tokens and respect reduced motion.
7. Anything clickable is a kit control or an `interactive` `Card` / `Table` with `onSelect`.
   Never put a raw `onClick` on a `div`. The `click_on_non_interactive` guard cannot see
   `onClick` in spread props or a wrapper that attaches it internally; it is not a proof.
8. Before pushing, check all four states, long content, mobile layout and keyboard actions.
   Before pushing, run `/cynap-render` in populated, empty, loading and error states, light
   and dark, wide (1280 px) and narrow (375 px). Follow the `fixture-render` skill: inspect each
   visible render and screenshot only settled markers. Then push and give the Owner the
   Surface candidate URL on real data. Use invented fixture data only; fixtures never push.

<!-- generated:surface-patterns — do not edit; run scripts/build-surface-contract.mjs -->
### work-queue

From `templates/work-queue.template.json`; variables and imports are defined in that template.

```tsx
<Card><CardContent className="tpl-table-scroll">
          {records.state === 'loading' && rows.length === 0 ? <Skeleton primitiveKind="Table" height={320} />
          : records.state === 'error' || records.state === 'denied' ? <Stack id="queue-error" config={{ gap: 16 }}>
              <AlertCard severity="error" title="Records could not be loaded" description="Your work is unchanged." />
              <Button variant="outline" onClick={records.refetch}>Retry</Button>
            </Stack>
          : rows.length === 0 ? <EmptyState title="No matching records" description="Clear the filter to see the queue." action={{ label: 'Clear filter', onClick: () => filterByName('') }} />
          : <Table columns={columns} data={rows} interactive onSelect={(row) => setSelectedId(String(row.id))}
              isRowDisabled={() => records.isPreviousData}
              pagination={{ page: current, pageSize: PAGE_SIZE, total: records.data?.total ?? rows.length }}
              onPageChange={(next) => { setSelectedId(null); setPage(next); }}
              onSortChange={(next) => { setSort(next?.field ?? null); setDirection(next?.direction ?? null); setPage(1); setSelectedId(null); }} />}
        </CardContent></Card>
        <Sheet open={selected !== undefined} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
          <SheetContent className="tpl-detail-scroll" closeLabel="Close record detail">
            <SheetHeader><SheetTitle>{selected ? nameOf(selected) : 'Record'}</SheetTitle>
              <SheetDescription>Review the record without leaving your queue.</SheetDescription></SheetHeader>
            {selected && <Detail record={selected} clear={() => setSelectedId(null)} />}
          </SheetContent>
        </Sheet>
```

### overview

From `templates/overview.template.json`; variables and imports are defined in that template.

```tsx
{metric.state === 'loading' ? <Grid id="overview-loading" config={{ cols: { base: 1, md: 2 }, gap: 24 }}>
        <Skeleton primitiveKind="StatGroup" height={120} /><Skeleton primitiveKind="Chart.Bar" height={240} /><Skeleton primitiveKind="Chart.Line" height={240} />
      </Grid> : metric.state === 'error' || metric.state === 'denied' ? <Stack id="overview-error" config={{ gap: 16 }}>
        <AlertCard severity="error" title="Summary unavailable" description="Try reading the period again." /><Button variant="outline" onClick={metric.refresh}>Retry</Button>
      </Stack> : chartRows.length === 0 ? <EmptyState title="No data in this range" description="Choose another period or refresh." action={{ label: 'Refresh', onClick: metric.refresh }} /> : <>
        <StatGroup items={[
          { label: 'Total', value: chartRows.reduce((sum, row) => sum + row.value, 0) },
          { label: 'Groups', value: chartRows.length },
          { label: 'Largest group', value: Math.max(...chartRows.map((row) => row.value)) },
        ]} />
        <Grid id="overview-charts" config={{ cols: { base: 1, md: 2 }, gap: 24 }}>
          <Section title="By group"><ChartBar data={chartRows} xAxisKey="group" yAxisKeys={['value']} onSegmentClick={(point) => drill(String(point.group ?? ''))} /></Section>
          <Section title="Group profile" description="Groups in the metric's order, not a time series."><ChartLine data={chartRows} xAxisKey="group" yAxisKeys={['value']} /></Section>
        </Grid>
      </>}
      <Section title="Recent activity">
        {activity.state === 'loading' ? <Skeleton primitiveKind="Activity" height={200} />
        : activity.state === 'error' || activity.state === 'denied' ? <Stack id="activity-error" config={{ gap: 16 }}>
          <AlertCard severity="error" title="Activity unavailable" /><Button variant="outline" onClick={activity.refetch}>Retry</Button>
        </Stack> : !activity.data?.length ? <EmptyState title="No recorded activity" description="Refresh after the next record change." action={{ label: 'Refresh', onClick: activity.refetch }} />
        : <Activity items={activity.data} />}
      </Section>
```

### master-detail

From `templates/work-queue.template.json`; variables and imports are defined in that template.

```tsx
<SplitView items={rows} queryKey="selected" renderItem={nameOf}
        renderDetail={(record, { clear, inFilter }) => <Stack id="split-detail" config={{ gap: 16 }}>
          {!inFilter && <Badge tone="warning" label="Not in the current filter" />}
          <Detail record={record} clear={clear} />
        </Stack>}
        empty={<EmptyState title="Choose a record" description="Its notes and actions open here." />} />
```

### record-form

From `templates/record-form.template.json`; variables and imports are defined in that template.

```tsx
<Section title="Record fields">
      {form.state === 'ready' && record.state === 'ready' && record.data ? (
        <div className="tpl-form" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          <SurfaceForm
            key={recordId}
            fields={form.fields}
            initialValues={record.data}
            submitLabel="Save"
            disabled={save.state === 'pending'}
            onSubmit={(values) => void onSave(values)}
          />
        </div>
      ) : form.state === 'error' || form.state === 'denied' || record.state === 'error' || record.state === 'denied' ? (
        <Stack id="record-error" config={{ gap: 16 }}><AlertCard severity="error" title="Record unavailable" /><Button variant="outline" onClick={() => { form.refresh(); record.refetch(); }}>Retry</Button></Stack>
      ) : record.state === 'empty' || form.state === 'empty' ? (
        <EmptyState title="Record not found" action={{ label: 'Back to records', onClick: () => navigate(LIST_PATH) }} />
      ) : (
        <Skeleton primitiveKind="Table" height={160} />
      )}
      </Section>
```

### long-text-review

From `templates/work-queue.template.json`; variables and imports are defined in that template.

```tsx
<Section title="Record notes" description="Long text stays in a reading container.">
        <Badge tone="info" label={String(record.stage ?? 'Unassigned')} />
        <Prose markdown={String(record.notes ?? 'No notes on this record yet.')} />
        <Button variant="outline" onClick={clear}>Back to the queue</Button>
      </Section>
```
<!-- /generated:surface-patterns -->

## Start from a template

The templates under `templates/` each map file paths to file text
(`<name>.template.json`, under `files`). Pick the closest one, write each entry
to its path, and replace every value its `placeholders` list names (the
`REPLACE_WITH_…` constants at the top of each file) with the org's own type,
fields, stages or metric. A template's `supply` list names files you add
yourself, such as the font file. Every template's landing route path is the
placeholder `replace-with-landing-path`: replace it with a lowercase slug of
your own (the `overview` template also uses it in `MOUNT_PATH`). Give the route a `label` that
names the page, never "Home": the portal already has a Home, so a Surface labelled
"Home" reads as "Data > Home". Every template is checked against the current builder; keep the compiled bundle below its size warning line.

A route's `icon` must be a key the host can draw (the portal's icon registry, for
example `mail`, `user-plus`, `file-text`). Any other key draws a lettermark on the
rail, not the icon you named. Pick an icon no platform Area already uses.

Use kit components; the build refuses raw interactive and heading elements and colour
literals. A bare `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` or `<h2>`–`<h6>` is
stripped to unstyled text by the frame's preflight, so use `Button`, `Input`, `Select`,
`Textarea`, `Table` and `Section` (its `title` is the heading). Lay out with `Stack`, `Row`,
`Grid` and `Section`; show loading with `Skeleton`, an empty result with `EmptyState`, an error
with `AlertCard` and a retry action. A hex, `rgb()`, `hsl()` or `oklch()` literal is refused everywhere except the file
that calls `defineSurfaceTheme`; read colours from the theme. Keep colour literals in one theme file. A plain `<div>`, `<span>` or `<svg>` is fine for non-interactive structure.

A change that edits the surface's source must pass these rules. A pure
`/cynap-push --rebuild` of unchanged source reports the same findings as warnings, so a surface
built before the rules still rebuilds onto a new SDK; the first edit then asks it to migrate.

<!-- generated:surface-catalog-index — do not edit; run scripts/build-surface-contract.mjs -->
116 catalog entries; compound families include their named parts. Before using a piece for the first time, open its reference entry.
### layout — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md)
- `Section` — A titled block of the page with an optional eyebrow, description and collapse.
- `Row` — Lays its children out side by side and stacks them on a narrow screen.
- `Col` — A column inside a Row that takes a share of its twelve-column width.
- `Grid` — A grid of equal columns for cards and tiles.
- `Stack` — Stacks its children vertically with one consistent gap.
- `PageHeader` — The page title with a description, a breadcrumb and an actions slot, drawn once per page.
- `Toolbar` — A labelled group of actions that reads as one toolbar to assistive technology.
- `SurfaceApp` — The root every Surface renders under, which connects the page to its host.
- `Card` — A panel with header, content and footer regions; `interactive` makes the whole card one control.
- `Separator` — A thin rule that divides two groups of content.
- `SplitView` — A master-detail layout: a list pane and a detail pane, with the selection kept in the URL.
- `Hero` — A page opening with a title, supporting text and primary actions.
- `Reveal` — Fades its children in on first view, and not at all under reduced motion.
### content — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md)
- `Callout` — An inline info, warning or error message with an optional title.
- `KPI` — One headline number with a label and an optional trend.
- `StatGroup` — A compact row of related numbers that read as one group.
- `Sparkline` — A small trend line beside a title and its latest value.
- `Table` — A data table with sorting, search, pagination, expandable rows and rows that open on click.
- `Activity` — A dated feed of recent events.
- `AlertCard` — A card that flags a condition by severity, with a count and the affected items.
- `Pipeline` — Stage columns with counts, where a click selects a stage.
- `EmptyState` — What to show when there is no data yet, with a next step.
- `ActionList` — Rows of records with the verbs its config declares, run through the host.
- `BigNumber` — One large formatted value with an optional change against a prior value.
- `Scorecard` — Rows of actual against target for a set of people or teams.
- `Skeleton` — A loading placeholder shaped like the piece it stands in for.
- `TextBlock` — A short block of markdown text; long reading text belongs in Prose.
- `Prose` — A reading container for long markdown text, set at a comfortable measure and type scale.
- `ProvenanceFooter` — Says which metric a number came from, how fresh it is and how many rows it used.
### charts — [reference/primitives.md](reference/primitives.md)
- `ChartBar` — A bar chart of one or more series across categories, stacked or horizontal on request.
- `ChartLine` — A line chart of one or more series over an ordered axis, usually time.
- `ChartArea` — A filled line chart that shows volume over an ordered axis.
- `ChartPie` — A pie chart of how a total splits across a few categories.
- `ChartDonut` — A donut chart of how a total splits across a few categories, with a legend.
- `ChartHeatmap` — A grid of cells coloured by value across two dimensions.
- `ChartHistogram` — How often values fall into each range of a numeric field.
- `ChartFunnel` — Stages that narrow from first to last, with the drop between them.
- `ChartTreemap` — Nested rectangles sized by value across a hierarchy.
- `ChartSankey` — Flows between sources and destinations, sized by value.
- `ChartRadar` — One or more groups scored on several axes of the same scale.
- `ChartGauge` — One value against a target on a fixed range.
- `ChartWaterfall` — How a starting value becomes an ending value through gains and losses.
- `Map` — Markers on a map, with a table or list fallback when the map cannot draw.
- `ChartGroupedBar` — Bars grouped by category with one bar per series.
- `ChartPivotMatrix` — A row-by-column matrix of values with optional total and average columns.
- `Legend` — Names the series of a chart beside their colours.
### forms — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md)
- `FilterBar` — A row that holds filter controls and an optional reset.
- `Button` — A button in the platform variants and sizes, for every action a viewer takes.
- `Field` — Wraps one form control with its label, help text and error.
- `Input` — A single-line text input.
- `Textarea` — A multi-line text input.
- `Checkbox` — A box that is checked, unchecked or indeterminate.
- `Switch` — An on-off toggle for a setting that applies at once.
- `Select` — A dropdown that picks one value from a short list.
- `DateRangePicker` — Picks a start and end date from a calendar or a preset.
- `PeriodFilterBar` — A ready-made filter row driven by a list of filter definitions.
- `SurfaceForm` — A whole form drawn from a list of fields, with validation and one submit.
### overlays — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md), [reference/hooks.md](reference/hooks.md)
- `Tooltip` — A short text hint shown when its child is hovered or focused.
- `Dialog` — A modal window for a focused task that needs an answer before the page continues.
- `Sheet` — A panel that slides in from an edge to show detail without leaving the page.
- `Popover` — A small floating panel anchored to the control that opens it.
- `TooltipRoot` — A hand-composed tooltip, for a hint on a control such as an icon button.
- `Toaster` — The place toasts appear, which SurfaceApp already mounts once.
- `toast` — Shows a short message that confirms what just happened.
- `useConfirm` — Asks the viewer to confirm in an in-page dialog before a write.
### navigation — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md)
- `Tabs` — A config-driven tab set that shows one Tab child at a time.
- `Tab` — One labelled panel of a Tabs set.
- `Breadcrumb` — The trail from the top of the app to the current page.
- `TabsRoot` — Hand-composed tabs, for when the panels need their own state or layout.
- `Command` — A searchable list of commands or options, inline or in a dialog.
### identity — [reference/primitives.md](reference/primitives.md), [reference/kit.md](reference/kit.md)
- `Avatar` — A person shown as a picture, or as initials when there is none.
- `Badge` — A status chip that pairs a semantic tone with a label, so colour is never the only signal.
- `Icon` — One icon from the closed platform set, named by a string literal.
- `Image` — A picture from an asset the Surface imports, with required alt text.
- `BrandMark` — The org logo at a fixed size, with an optional dark-theme variant.
### messaging — [reference/kit.md](reference/kit.md), [reference/hooks.md](reference/hooks.md)
- `ChannelBadge` — Names the channel a conversation arrived on.
- `Composer` — The reply box, which offers only templates once the reply window has closed.
- `ContactPanel` — The contact behind a conversation, with edit, merge and consent actions when allowed.
- `ConversationList` — The inbox rows, with keyboard movement and shortcuts.
- `ConversationListItem` — One inbox row, for a list you lay out yourself.
- `FollowUpControl` — Sets or clears a follow-up time, and warns when it falls after the reply window.
- `Message` — One message with its author, parts and delivery state.
- `OwnershipControls` — Claim, assign, release, close and reopen, showing only what the viewer may do.
- `RefusalNotice` — Explains in plain words why the server refused a messaging command.
- `TemplatePicker` — Lists the approved message templates and sends the one the viewer picks.
- `Transcript` — The messages of one conversation, oldest first, with a way to load earlier ones.
- `useContact` — Reads the contact behind one conversation.
- `useConversation` — Reads one conversation: its thread, messages and what the viewer may do.
- `useConversations` — Reads the inbox as pages of conversations that match the filters.
- `useFreshness` — Reports when the host last refreshed the page, without calling a tool.
- `useSavedViews` — Reads the viewer's saved inbox views in their saved order.
### hooks — [reference/hooks.md](reference/hooks.md)
- `useSurfaceApp` — Reads the connection state of the page, to hold content until the host is ready.
- `useHostContext` — Reads what the host says about the frame, such as its locale and display mode.
- `useTool` — Calls one granted tool on demand and classifies the outcome.
- `useMetric` — Reads one saved metric with its provenance.
- `useViewer` — Reads who is looking at the page: display name, role and org name.
- `useQuery` — Reads one granted tool, parses the payload and keeps it cached and fresh.
- `useEntityForm` — Builds form fields for an entity type from its schema.
- `toAdvancedQueryFilter` — Turns filter clauses into the filter argument of an advanced query.
- `useEntityQuery` — Reads a page of records of one entity type, filtered, sorted and searched.
- `parseAsFilters` — A query parser that keeps a list of filter clauses in the URL.
- `useEntityHistory` — Reads the recorded changes of one record, newest first.
- `useMutation` — Runs one mediated write from the viewer's click and reports how it settled.
- `defaultReconcile` — The default reading of a run outcome as applied, conflict or accepted.
- `useQueryState` — Keeps one piece of view state in the URL, so a link or Back restores it.
- `parseAsString` — A query parser for a plain string.
- `parseAsInteger` — A query parser for a whole number, such as a page.
- `parseAsEnum` — A query parser that accepts only one of a fixed list of strings.
- `parseAsIsoDate` — A query parser for a calendar date written as YYYY-MM-DD.
- `parseAsArrayOf` — A query parser for a comma-separated list of another parser.
- `parseAsJson` — A query parser for a small JSON value that your validator accepts.
- `useDownload` — Hands a file to the host to save, from the viewer's click.
- `toCsv` — Renders rows as CSV text for the columns you name.
- `useNavigation` — Moves to another route of the app, or asks the host to open a link.
- `useRoute` — Reads the current route path and query of the page.
### theme — [reference/hooks.md](reference/hooks.md)
- `defineSurfaceTheme` — Declares the theme of a Surface in theme.ts, the one file where colour literals are allowed.
<!-- /generated:surface-catalog-index -->

<!-- generated:surface-icons — do not edit; run scripts/build-surface-contract.mjs -->
`<Icon name="…" />` takes one literal `IconName`: `activity`, `arrow-down`, `arrow-left`, `arrow-right`, `arrow-up`, `arrow-up-right`, `bell`, `bookmark`, `briefcase`, `building-2`, `calendar`, `chart-column`, `chart-line`, `chart-pie`, `check`, `chevron-down`, `chevron-left`, `chevron-right`, `chevron-up`, `circle-alert`, `circle-check`, `circle-help`, `circle-x`, `clock`, `cloud`, `credit-card`, `download`, `external-link`, `eye`, `file`, `file-text`, `flag`, `folder`, `funnel`, `globe`, `heart`, `house`, `image`, `inbox`, `info`, `layers`, `layout-dashboard`, `link`, `lock`, `mail`, `map-pin`, `message-square`, `minus`, `package`, `pencil`, `phone`, `plus`, `refresh-cw`, `search`, `send`, `settings`, `share-2`, `shield-check`, `shopping-cart`, `sparkles`, `star`, `tag`, `target`, `trash-2`, `trending-down`, `trending-up`, `triangle-alert`, `truck`, `upload`, `user`, `users`, `wallet`, `x`, `zap`.

Never pass a variable or conditional name. Branch the whole element: `{busy ? <Icon name="refresh-cw" /> : <Icon name="truck" />}`.
<!-- /generated:surface-icons -->

## What your CSS may do

<!-- generated:surface-css-envelope — do not edit; run scripts/build-surface-contract.mjs -->
Allowed (builder-tested fixtures):
- Grid and flex layout.
- Gap and padding.
- `position: sticky`.
- Media queries.
- Container queries.
- `:hover`, `:focus-visible`, `:active` and `:disabled` states.
- Transitions.
- Borders, radii and shadows through tokens.
- Gradients whose stops are `var(--…)` tokens.
- The `prefers-reduced-motion` query.

Refused outside the theme file (and by the closed import / kit rules):
- An asset that is not a relative file inside the surface. (`import_outside_closed_set`).
- A hex colour. (`color_literal`).
- An `hsl()` or `hsla()` colour. (`color_literal`).
- A named colour. (`color_literal`).
- An `oklch()` or `oklab()` colour. (`color_literal`).
- An `rgb()` or `rgba()` colour. (`color_literal`).
- An import of a package outside the closed set. (`import_outside_closed_set`).
- An `@import` of anything but a relative file inside the surface. (`import_outside_closed_set`).
- A raw interactive or heading element, which the frame strips to unstyled text. The lint table names each one. (`raw_element`).
<!-- /generated:surface-css-envelope -->

The build does not refuse every poor design choice. Restyling kit internals by class name,
fixed pixel widths that break at 375 px, and hand-set font sizes are wrong even when they build.
Author CSS is unlayered and beats every SDK rule: a careless element selector restyles the kit.
Scope layout rules to your own wrappers. Keep colour literals in the theme file and use tokens elsewhere.

## Theme and identity

A Surface reads as a native portal page. Its org theme adjusts tokens. Call
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
| `brand-portal` | branded landing portal | defineSurfaceTheme with fonts.display, Hero, BrandMark, Reveal and Icon over one governed metric. |
| `ops-monitor` | live monitor with export | refreshInterval and refetchOnVisible, Table row selection, and useDownload with toCsv. |
| `overview` | overview with URL drill-down | Period filter, a three-number StatGroup, two charts, recent activity and provenance; drill into a group with URL state. |
| `pipeline-writes` | pipeline with a confirmed write | Stage counts with Pipeline; a confirmed, role-checked advance through one granted automation; toasts on the settled verdict. |
| `record-form` | schema-driven record form | SurfaceForm built by useEntityForm from knowledge_entity_schema (requiredness included); a role-checked, field-scoped save; the record's history with its coverage line; confirm before leaving a dirty form. |
| `rtl-hebrew` | right-to-left Hebrew view | dir="rtl" layout, a pre-subset Latin+Hebrew .woff2 bound through fonts.sans, and metric cards. |
| `themed-ops` | branded operations view | defineSurfaceTheme with fonts, density, motion and its own shadows; ChartHeatmap and ChartGauge. |
| `work-queue` | filtered work queue with detail | Server paging, sort and filters in the URL; interactive rows open a detail Sheet. SplitView and Prose teach master-detail and long-text review. |
<!-- /generated:surface-templates -->

The two write templates also carry their handler under
`automations/handlers/<id>/`. It reads the viewer's role from
`ctx.input.portal_actor`, which the platform stamps from the signed-in session
(a Surface cannot supply it), refuses any role outside `ALLOWED_ROLES`, writes
only the fields it owns, and returns `rowsAffected` so the surface can tell
applied from conflict. Keep the automation id and action equal in `tools.json`,
the surface and the handler.

## Reading entity rows: `json` fields

A schema field with `field_type: "json"` arrives **parsed**. `useEntityQuery`
rows (and every other entity read) carry it as the object or array that was
stored, so read it directly and never `JSON.parse` it:

```tsx
const record = row.record as { decision?: string } | null;
```

Three things can still arrive instead of an object, so narrow before use:

- `null`, when the field is unset.
- a number or a string, when the writer stored a scalar. Only objects and
  arrays round-trip; do not store a bare scalar in a `json` field.
- the stored text itself, when it is not valid JSON.

**A filter cannot reach inside a `json` field.** The filter grammar addresses
fields, not paths. `eq`, `neq`, `in`, `between` and the comparisons on a `json`
field are refused with `KNOWLEDGE_JSON_FIELD_NOT_FILTERABLE`, and `sort` on one
orders by raw text. The rule: **promote any value you filter or sort on to its
own schema field**, written by the same handler that writes the json (see
`author-a-schema-change`), then filter on that field. Filtering rows in the
bundle after the page loads is not a substitute: the matches may sit on a page
the viewer never opens, and the list looks empty.

`is_null` / `not_null` work on a `json` field. `contains` is a raw-text match
against however the writer serialized the value; treat it as a stopgap until
the value is promoted, never as a contract.

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
| `click_on_non_interactive` | yes (warning on `--rebuild`) | Do not put `onClick` on a `div`, `span` or other plain element: use a kit control (`Button`), or `interactive` with `onSelect` on a `Card` or `Table`. Where neither fits, give the element a control `role` (such as `role="button"`), `tabIndex={0}` and a key handler. |
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

A warning (`write_via_use_tool`, `bundle_near_cap`, and `raw_element` / `color_literal` / `click_on_non_interactive` on a
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
