<!-- GENERATED — DO NOT EDIT. Run scripts/build-surface-contract.mjs. -->

# Surface hooks reference

Derived types and signatures come from the SDK catalog. Config schemas describe the config renderer; JSX authors use the React props shown below. Examples assume the named imports from `@cynap/surface-sdk` inside `SurfaceApp`.

## useContact

Reads the contact behind one conversation.

Interactive: no.

### Derived signatures

```ts
useContact(threadId: string | null): UseContactResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `data` | `{ threadId: string; contact: { id: string; displayName: string \| null; email: string \| null; version: number; } \| null; displayName: string; participant: { phoneE164: string \| null; providerUserRef: string \| null; } \| null; currentIdentity…` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready' \| 'refused'` | yes |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `error` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `locked` | `boolean` | yes |
| `isFetching` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `ContactPanel`.

### Author example

```tsx
const contact = useContact('thread_1042');
if (contact.data === null) return <Skeleton primitiveKind="Table" height={120} />;
return <ContactPanel contact={contact.data} />;
```

## useConversation

Reads one conversation: its thread, messages and what the viewer may do.

Interactive: no.

### Derived signatures

```ts
useConversation(threadId: string | null): UseConversationResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `thread` | `{ id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined; lastMes…` | yes |
| `messages` | `readonly { id: string; sequence: number; direction: 'inbound' \| 'outbound'; author: { kind: 'contact' \| 'operator' \| 'automation' \| 'system'; label?: string \| undefined; }; parts: ({ type: 'text'; text: string; } \| { type: 'attachment'; na…` | yes |
| `capabilities` | `{ canRead: boolean; canClaim: boolean; canAssign: boolean; canReturnToBot: boolean; canRelease: boolean; canClose: boolean; canReopen: boolean; canReply: boolean; canTransfer: boolean; canReconcile: boolean; } \| null` | yes |
| `transferTargets` | `{ id: string; label: string; }[]` | yes |
| `hasEarlier` | `boolean` | yes |
| `loadingEarlier` | `boolean` | yes |
| `earlierError` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `loadEarlier` | `() => void` | yes |
| `error` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready' \| 'refused'` | yes |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `locked` | `boolean` | yes |
| `isFetching` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Transcript`, `Composer`, `OwnershipControls`.

### Author example

```tsx
const conversation = useConversation('thread_1042');
return (
  <Transcript
    messages={conversation.messages}
    loading={conversation.state === 'loading'}
    hasEarlier={conversation.hasEarlier}
    onLoadEarlier={conversation.loadEarlier}
  />
);
```

## useConversations

Reads the inbox as pages of conversations that match the filters.

Interactive: no.

### Derived signatures

```ts
useConversations(filters?: ConversationListFilters): UseConversationsResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `threads` | `readonly { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined…` | yes |
| `hasMore` | `boolean` | yes |
| `loadingMore` | `boolean` | yes |
| `moreError` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `loadMore` | `() => void` | yes |
| `error` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready' \| 'refused'` | yes |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `locked` | `boolean` | yes |
| `isFetching` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `ConversationList`.

### Author example

```tsx
const inbox = useConversations({ state: 'open', owner: 'mine' });
const [selectedId, setSelectedId] = useState<string | null>(null);
return (
  <ConversationList
    threads={inbox.threads}
    selectedId={selectedId}
    loading={inbox.state === 'loading'}
    error={inbox.error}
    hasMore={inbox.hasMore}
    loadingMore={inbox.loadingMore}
    onLoadMore={inbox.loadMore}
    onSelect={(thread) => setSelectedId(thread.id)}
  />
);
```

## useFreshness

Reports when the host last refreshed the page, without calling a tool.

Interactive: no.

### Derived signatures

```ts
useFreshness(): Freshness
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `tick` | `number` | yes |
| `refreshedAt` | `number \| null` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
const { refreshedAt } = useFreshness();
return <TextBlock markdown={refreshedAt === null ? 'Not refreshed yet.' : 'Up to date.'} />;
```

## useSavedViews

Reads the viewer's saved inbox views in their saved order.

Interactive: no.

### Derived signatures

```ts
useSavedViews(): UseSavedViewsResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `data` | `readonly { id: string; name: string; filters: { state?: 'open' \| 'closed' \| 'all' \| undefined; owner?: 'all' \| 'bot' \| 'human' \| 'unassigned' \| 'mine' \| undefined; channel?: string \| undefined; search?: string \| undefined; }; columns: ('st…` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready' \| 'refused'` | yes |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `error` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | yes |
| `locked` | `boolean` | yes |
| `isFetching` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConversations`.

### Author example

```tsx
const views = useSavedViews();
return (
  <TabsRoot defaultValue="all">
    <TabsList>
      <TabsTrigger value="all">All</TabsTrigger>
      {(views.data ?? []).map((view) => (
        <TabsTrigger key={view.id} value={view.id}>
          {view.name}
        </TabsTrigger>
      ))}
    </TabsList>
  </TabsRoot>
);
```

## useSurfaceApp

Reads the connection state of the page, to hold content until the host is ready.

Interactive: no.

### Derived signatures

```ts
useSurfaceApp(): Readonly<{ client: SurfaceAppClient | null; state: SurfaceAppState; hostContext: McpUiHostContext | undefined; routeInput: { route: string; view: string; params: Record<string, string>; query: Record<string, string>; } | null; queryClient: QueryClient | null; }>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `client` | `SurfaceAppClient \| null` | yes |
| `state` | `'connecting' \| 'failed' \| 'ready'` | yes |
| `hostContext` | `McpUiHostContext \| undefined` | yes |
| `routeInput` | `{ route: string; view: string; params: Record<string, string>; query: Record<string, string>; } \| null` | yes |
| `queryClient` | `QueryClient \| null` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `SurfaceApp`.

### Author example

```tsx
const { state } = useSurfaceApp();
if (state === 'connecting') return <Skeleton primitiveKind="Table" height={160} />;
if (state === 'failed') return <Callout id="not-connected" config={{ severity: 'error', message: 'This page could not connect.' }} />;
return <TextBlock markdown="Connected." />;
```

## useHostContext

Reads what the host says about the frame, such as its locale and display mode.

Interactive: no.

### Derived signatures

```ts
useHostContext(): McpUiHostContext | undefined
```

### Author example

```tsx
const host = useHostContext();
return <TextBlock markdown={'Locale: ' + (host?.locale ?? 'unknown')} />;
```

## useTool

Calls one granted tool on demand and classifies the outcome.

Interactive: no.

### Derived signatures

```ts
useTool<T = unknown>(name: string): UseToolResult<T>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `call` | `(args?: Record<string, unknown> \| undefined) => Promise<ToolCallOutcome<T>>` | yes |
| `pending` | `boolean` | yes |
| `last` | `ToolCallOutcome<T> \| null` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
const lookup = useTool<{ name: string }>('knowledge_query');
return (
  <Button variant="outline" disabled={lookup.pending} onClick={() => void lookup.call({ entity_id: 'order_1042' })}>
    {lookup.last?.status === 'ok' ? lookup.last.data.name : 'Look up order'}
  </Button>
);
```

## useMetric

Reads one saved metric with its provenance.

Interactive: no.

### Derived signatures

```ts
useMetric(name: string, params?: MetricParams, options?: { refreshInterval?: number | undefined; }): UseMetricResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `data` | `MetricData \| null` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'loading' \| 'ready'` | yes |
| `provenance` | `MetricProvenance \| null` | yes |
| `denial` | `'surface_gesture_required' \| 'surface_stale' \| 'surface_tool_denied' \| 'surface_transport_error' \| null` | yes |
| `refresh` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `KPI`, `ChartBar`, `ProvenanceFooter`.

### Author example

```tsx
const orders = useMetric('weekly_orders', { grain: 'week' });
if (orders.state === 'loading') return <Skeleton primitiveKind="KPI" height={96} />;
return <KPI label="Orders this week" value={Number(orders.data?.rows[0]?.value ?? 0)} />;
```

## useViewer

Reads who is looking at the page: display name, role and org name.

Interactive: no.

### Derived signatures

```ts
useViewer(): { readonly viewer: { viewerDisplayName: string; viewerRole: 'owner' | 'viewer' | 'admin' | 'member'; orgDisplayName: string; } | null; readonly state: ViewerState; }
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `viewer` | `{ viewerDisplayName: string; viewerRole: 'owner' \| 'viewer' \| 'admin' \| 'member'; orgDisplayName: string; } \| null` | yes |
| `state` | `'loading' \| 'ready' \| 'unavailable'` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
const { viewer } = useViewer();
return <Hero title={viewer === null ? 'Welcome' : 'Welcome, ' + viewer.viewerDisplayName} />;
```

## useQuery

Reads one granted tool, parses the payload and keeps it cached and fresh.

Interactive: no.

### Derived signatures

```ts
useQuery<T>(tool: string, args: Readonly<Record<string, SurfaceJsonValue | undefined>>, options: UseQueryOptions<T>): UseQueryResult<T>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `data` | `T \| null` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready'` | yes |
| `denial` | `'surface_gesture_required' \| 'surface_stale' \| 'surface_tool_denied' \| 'surface_transport_error' \| null` | yes |
| `isFetching` | `boolean` | yes |
| `isStale` | `boolean` | yes |
| `isPreviousData` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Table`, `EmptyState`, `Skeleton`.

### Author example

```tsx
const orders = useQuery(
  'knowledge_query_data',
  { tool: 'knowledge_advanced_query', params: { entity_type: 'order', limit: 50 } },
  { parse: (payload) => (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : null) }
);
if (orders.state === 'error') return <Callout id="orders-error" config={{ severity: 'error', message: 'Orders could not be loaded.' }} />;
return <Table columns={[{ accessorKey: 'name', header: 'Order' }]} data={orders.data} isLoading={orders.state === 'loading'} />;
```

## useEntityForm

Builds form fields for an entity type from its schema.

Interactive: no.

### Derived signatures

```ts
useEntityForm(entityType: string, options: { readonly fields: readonly string[]; }): UseEntityFormResult
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready'` | yes |
| `fields` | `readonly SurfaceFormField[]` | yes |
| `omitted` | `readonly { readonly name: string; readonly reason: 'not_in_schema' \| 'json' \| 'no_options'; }[]` | yes |
| `denial` | `'surface_gesture_required' \| 'surface_stale' \| 'surface_tool_denied' \| 'surface_transport_error' \| null` | yes |
| `refresh` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `SurfaceForm`, `useMutation`.

### Author example

```tsx
const form = useEntityForm('order', { fields: ['status', 'note'] });
if (form.state !== 'ready') return <Skeleton primitiveKind="Table" height={160} />;
return <SurfaceForm fields={form.fields} submitLabel="Save" onSubmit={() => toast('Saved.', { tone: 'success' })} />;
```

## toAdvancedQueryFilter

Turns filter clauses into the filter argument of an advanced query.

Interactive: no.

### Derived signatures

```ts
toAdvancedQueryFilter(clauses: readonly FilterClause[]): Record<string, unknown>
```

Composes with: `parseAsFilters`, `useQuery`.

### Author example

```tsx
const [filters] = useQueryState('filters', parseAsFilters);
const orders = useQuery(
  'knowledge_query_data',
  { tool: 'knowledge_advanced_query', params: { entity_type: 'order', filter: JSON.stringify(toAdvancedQueryFilter(filters ?? [])) } },
  { parse: (payload) => (Array.isArray(payload) ? (payload as Record<string, unknown>[]) : null) }
);
return <Table columns={[{ accessorKey: 'name', header: 'Order' }]} data={orders.data} />;
```

## useEntityQuery

Reads a page of records of one entity type, filtered, sorted and searched.

Interactive: no.

### Derived signatures

```ts
useEntityQuery(entityType: string, spec: EntityQuerySpec, options?: Omit<UseQueryOptions<EntityQueryData>, 'parse'>): EntityQueryResult
```

Composes with: `Table`, `FilterBar`, `parseAsFilters`.

### Author example

```tsx
const [filters] = useQueryState('filters', parseAsFilters);
const orders = useEntityQuery('order', { filters: filters ?? [], sort: { field: 'created_at', direction: 'desc' }, pageSize: 25 });
return (
  <Table
    columns={[
      { accessorKey: 'name', header: 'Order' },
      { accessorKey: 'status', header: 'Status' },
    ]}
    data={orders.data?.rows ?? null}
    isLoading={orders.state === 'loading'}
  />
);
```

## parseAsFilters

A query parser that keeps a list of filter clauses in the URL.

Interactive: no.

### Derived signatures

```ts
parseAsFilters: QueryParser<readonly FilterClause[]>
```

Composes with: `useQueryState`, `useEntityQuery`.

### Author example

```tsx
const [filters] = useQueryState('filters', parseAsFilters);
const orders = useEntityQuery('order', { filters: filters ?? [], sort: { field: 'created_at', direction: 'desc' }, pageSize: 25 });
return (
  <Table
    columns={[
      { accessorKey: 'name', header: 'Order' },
      { accessorKey: 'status', header: 'Status' },
    ]}
    data={orders.data?.rows ?? null}
    isLoading={orders.state === 'loading'}
  />
);
```

## useEntityHistory

Reads the recorded changes of one record, newest first.

Interactive: no.

### Derived signatures

```ts
useEntityHistory(entityType: string, entityId: string, options?: { readonly limit?: number | undefined; }): UseQueryResult<EntityHistoryData>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `data` | `EntityHistoryData \| null` | yes |
| `state` | `'denied' \| 'empty' \| 'error' \| 'idle' \| 'loading' \| 'ready'` | yes |
| `denial` | `'surface_gesture_required' \| 'surface_stale' \| 'surface_tool_denied' \| 'surface_transport_error' \| null` | yes |
| `isFetching` | `boolean` | yes |
| `isStale` | `boolean` | yes |
| `isPreviousData` | `boolean` | yes |
| `refetch` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
const history = useEntityHistory('order', 'order_1042', { limit: 20 });
return (
  <Table
    columns={[
      { accessorKey: 'action', header: 'Action' },
      { accessorKey: 'timestamp', header: 'When' },
    ]}
    data={history.data ? history.data.items.map((item) => ({ action: item.action, timestamp: item.timestamp })) : null}
    isLoading={history.state === 'loading'}
  />
);
```

## useMutation

Runs one mediated write from the viewer's click and reports how it settled.

Interactive: no.

### Derived signatures

```ts
useMutation<TVars extends Record<string, SurfaceJsonValue>, TData = unknown>(tool: string, options?: UseMutationOptions<TData>): UseMutationResult<TVars, TData>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `mutate` | `(variables: TVars) => Promise<MutationState>` | yes |
| `state` | `'accepted' \| 'applied' \| 'conflict' \| 'denied' \| 'error' \| 'failed' \| 'idle' \| 'pending' \| 'refused' \| 'unknown'` | yes |
| `variables` | `TVars \| null` | yes |
| `data` | `TData \| null` | yes |
| `denial` | `'surface_gesture_required' \| 'surface_stale' \| 'surface_tool_denied' \| 'surface_transport_error' \| null` | yes |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `reset` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConfirm`, `toast`, `Button`.

### Author example

```tsx
const confirm = useConfirm();
const archive = useMutation('automation_run_manual', { invalidates: ['knowledge_'] });
async function onArchive() {
  if (!(await confirm({ title: 'Archive this order?', body: 'It leaves the open list.', confirmLabel: 'Archive', tone: 'danger' }))) return;
  const verdict = await archive.mutate({ automation_id: 'orders-archive', trigger_data: { action: 'archive', record_id: 'order_1042' } });
  toast(verdict === 'applied' ? 'Archived.' : 'The order was not archived.', { tone: verdict === 'applied' ? 'success' : 'error' });
}
return (
  <Button variant="destructive" disabled={archive.state === 'pending'} onClick={() => void onArchive()}>
    Archive
  </Button>
);
```

## defaultReconcile

The default reading of a run outcome as applied, conflict or accepted.

Interactive: no.

### Derived signatures

```ts
defaultReconcile(outcome: { status: string; rowsAffected: number | null; }): { verdict: 'applied' | 'conflict' | 'accepted'; data: null; }
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `verdict` | `'accepted' \| 'applied' \| 'conflict'` | yes |
| `data` | `null` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useMutation`.

### Author example

```tsx
const { verdict } = defaultReconcile({ status: 'completed', rowsAffected: 1 });
return <TextBlock markdown={'This run settles as ' + verdict + '.'} />;
```

## useQueryState

Keeps one piece of view state in the URL, so a link or Back restores it.

Interactive: no.

### Derived signatures

```ts
useQueryState<T>(key: string, parser: QueryParser<T>, options?: UseQueryStateOptions<T>): readonly [T | null, Setter<T>]
```

Composes with: `parseAsString`, `parseAsEnum`, `FilterBar`.

### Author example

```tsx
const [status, setStatus] = useQueryState('status', parseAsEnum(['open', 'closed'] as const));
return (
  <TabsRoot value={status ?? 'open'} onValueChange={(next) => setStatus(next === 'closed' ? 'closed' : 'open')}>
    <TabsList>
      <TabsTrigger value="open">Open</TabsTrigger>
      <TabsTrigger value="closed">Closed</TabsTrigger>
    </TabsList>
  </TabsRoot>
);
```

## parseAsString

A query parser for a plain string.

Interactive: no.

### Derived signatures

```ts
parseAsString: QueryParser<string>
```

Composes with: `useQueryState`.

### Author example

```tsx
const [search, setSearch] = useQueryState('q', parseAsString);
return <Input aria-label="Search" value={search ?? ''} onChange={(event) => setSearch(event.target.value)} />;
```

## parseAsInteger

A query parser for a whole number, such as a page.

Interactive: no.

### Derived signatures

```ts
parseAsInteger: QueryParser<number>
```

Composes with: `useQueryState`.

### Author example

```tsx
const [page, setPage] = useQueryState('page', parseAsInteger);
return (
  <Button variant="outline" onClick={() => setPage((page ?? 1) + 1)}>
    Next page
  </Button>
);
```

## parseAsEnum

A query parser that accepts only one of a fixed list of strings.

Interactive: no.

### Derived signatures

```ts
parseAsEnum<const V extends readonly string[]>(values: V): QueryParser<V[number]>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `parse` | `(raw: string) => V[number] \| null` | yes |
| `serialize` | `(value: V[number]) => string` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useQueryState`.

### Author example

```tsx
const [status, setStatus] = useQueryState('status', parseAsEnum(['open', 'closed'] as const));
return (
  <TabsRoot value={status ?? 'open'} onValueChange={(next) => setStatus(next === 'closed' ? 'closed' : 'open')}>
    <TabsList>
      <TabsTrigger value="open">Open</TabsTrigger>
      <TabsTrigger value="closed">Closed</TabsTrigger>
    </TabsList>
  </TabsRoot>
);
```

## parseAsIsoDate

A query parser for a calendar date written as YYYY-MM-DD.

Interactive: no.

### Derived signatures

```ts
parseAsIsoDate: QueryParser<string>
```

Composes with: `useQueryState`.

### Author example

```tsx
const [from, setFrom] = useQueryState('from', parseAsIsoDate);
return <Input type="date" aria-label="From" value={from ?? ''} onChange={(event) => setFrom(event.target.value)} />;
```

## parseAsArrayOf

A query parser for a comma-separated list of another parser.

Interactive: no.

### Derived signatures

```ts
parseAsArrayOf<T>(item: QueryParser<T>, separator?: ','): QueryParser<readonly T[]>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `parse` | `(raw: string) => readonly T[] \| null` | yes |
| `serialize` | `(value: readonly T[]) => string` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useQueryState`.

### Author example

```tsx
const [tags, setTags] = useQueryState('tags', parseAsArrayOf(parseAsString));
return (
  <Button variant="outline" onClick={() => setTags([...(tags ?? []), 'urgent'])}>
    {'Tags: ' + (tags ?? []).join(', ')}
  </Button>
);
```

## parseAsJson

A query parser for a small JSON value that your validator accepts.

Interactive: no.

### Derived signatures

```ts
parseAsJson<T>(validate: (value: unknown) => T | null, options?: { maxLength?: number | undefined; }): QueryParser<T>
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `parse` | `(raw: string) => T \| null` | yes |
| `serialize` | `(value: T) => string` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useQueryState`.

### Author example

```tsx
const [sort, setSort] = useQueryState(
  'sort',
  parseAsJson((value) => (typeof value === 'object' && value !== null && 'field' in value ? (value as { field: string }) : null))
);
return (
  <Button variant="outline" onClick={() => setSort({ field: 'created_at' })}>
    {'Sorted by ' + (sort?.field ?? 'default')}
  </Button>
);
```

## defineSurfaceTheme

Declares the theme of a Surface in theme.ts, the one file where colour literals are allowed.

Interactive: no.

### Derived signatures

```ts
defineSurfaceTheme(theme: SurfaceTheme): SurfaceTheme
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `light` | `Partial<Readonly<Record<'--color-background-primary' \| '--color-background-secondary' \| '--color-background-tertiary' \| '--color-text-primary' \| '--color-text-secondary' \| '--color-text-tertiary' \| '--color-text-ghost' \| '--color-text-dang…` | yes |
| `dark` | `Partial<Readonly<Record<'--color-background-primary' \| '--color-background-secondary' \| '--color-background-tertiary' \| '--color-text-primary' \| '--color-text-secondary' \| '--color-text-tertiary' \| '--color-text-ghost' \| '--color-text-dang…` | yes |
| `fonts` | `Partial<Readonly<Record<'display' \| 'sans' \| 'mono', string>>>` | no |
| `density` | `'comfortable' \| 'compact' \| 'spacious'` | no |
| `motion` | `'expressive' \| 'none' \| 'subtle'` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `SurfaceApp`.

### Author example

```tsx
const theme = defineSurfaceTheme({
  density: 'compact',
  motion: 'subtle',
  light: { '--color-ring-primary': '#2a9d8f', '--border-radius-md': '10px' },
  dark: { '--color-ring-primary': '#4cc9b0', '--border-radius-md': '10px' },
});
return (
  <SurfaceApp info={{ name: 'orders', version: '1.0.0' }} theme={theme}>
    <PageHeader title="Orders" />
  </SurfaceApp>
);
```

## useDownload

Hands a file to the host to save, from the viewer's click.

Interactive: no.

### Derived signatures

```ts
useDownload(): (file: SurfaceDownloadFile) => Promise<DownloadOutcome>
```

Composes with: `toCsv`, `Button`.

### Author example

```tsx
const download = useDownload();
const rows = [
  { customer: 'Acme', total: 1200 },
  { customer: 'Globex', total: 860 },
];
return (
  <Button
    variant="outline"
    onClick={() => void download({ filename: 'orders.csv', mimeType: 'text/csv', text: toCsv(rows, ['customer', 'total']) })}
  >
    Download CSV
  </Button>
);
```

## toCsv

Renders rows as CSV text for the columns you name.

Interactive: no.

### Derived signatures

```ts
toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string
```

Composes with: `useDownload`.

### Author example

```tsx
const download = useDownload();
const rows = [
  { customer: 'Acme', total: 1200 },
  { customer: 'Globex', total: 860 },
];
return (
  <Button
    variant="outline"
    onClick={() => void download({ filename: 'orders.csv', mimeType: 'text/csv', text: toCsv(rows, ['customer', 'total']) })}
  >
    Download CSV
  </Button>
);
```

## useNavigation

Moves to another route of the app, or asks the host to open a link.

Interactive: no.

### Derived signatures

```ts
useNavigation(): SurfaceNavigation
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `openLink` | `(url: string) => void` | yes |
| `navigate` | `(route: string) => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Button`, `Breadcrumb`.

### Author example

```tsx
const { navigate } = useNavigation();
return (
  <Button variant="outline" onClick={() => navigate('/orders')}>
    Back to orders
  </Button>
);
```

## useRoute

Reads the current route path and query of the page.

Interactive: no.

### Derived signatures

```ts
useRoute(): SurfaceRoute
```

### Return fields

| Prop | Derived type | Required |
|---|---|---|
| `path` | `string` | yes |
| `query` | `Readonly<Record<string, string>>` | yes |
| `setQuery` | `(next: Readonly<Record<string, string \| undefined>>, options?: { readonly history?: 'push' \| 'replace' \| undefined; } \| undefined) => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
const route = useRoute();
return <TextBlock markdown={'You are on ' + route.path + '.'} />;
```

## toast

Shows a short message that confirms what just happened.

Interactive: no.

### Derived signatures

```ts
toast(message: string, options?: ToastOptions): void
```

Composes with: `useMutation`.

### Author example

```tsx
<Button onClick={() => toast('Order saved.', { description: 'The customer was notified.', tone: 'success' })}>
  Save
</Button>
```

## useConfirm

Asks the viewer to confirm in an in-page dialog before a write.

Interactive: no.

### Derived signatures

```ts
useConfirm(): Confirm
```

Composes with: `useMutation`, `Button`.

### Author example

```tsx
const confirm = useConfirm();
const archive = useMutation('automation_run_manual', { invalidates: ['knowledge_'] });
async function onArchive() {
  if (!(await confirm({ title: 'Archive this order?', body: 'It leaves the open list.', confirmLabel: 'Archive', tone: 'danger' }))) return;
  const verdict = await archive.mutate({ automation_id: 'orders-archive', trigger_data: { action: 'archive', record_id: 'order_1042' } });
  toast(verdict === 'applied' ? 'Archived.' : 'The order was not archived.', { tone: verdict === 'applied' ? 'success' : 'error' });
}
return (
  <Button variant="destructive" disabled={archive.state === 'pending'} onClick={() => void onArchive()}>
    Archive
  </Button>
);
```
