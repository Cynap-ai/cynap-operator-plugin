<!-- GENERATED — DO NOT EDIT. Run scripts/build-surface-contract.mjs. -->

# Surface kit reference

Derived types and signatures come from the SDK catalog. Config schemas describe the config renderer; JSX authors use the React props shown below. Examples assume the named imports from `@cynap/surface-sdk` inside `SurfaceApp`.

## SurfaceApp

The root every Surface renders under, which connects the page to its host.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `info` | `Readonly<{ name: string; version: string; }>` | yes |
| `children` | `ReactNode` | yes |
| `theme` | `SurfaceTheme` | no |
| `createClient` | `((info: Readonly<{ name: string; version: string; }>) => SurfaceAppClient)` | no |
| `errorTarget` | `Pick<Window, 'addEventListener' \| 'removeEventListener'>` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `defineSurfaceTheme`.

### Author example

```tsx
<SurfaceApp info={{ name: 'orders', version: '1.0.0' }}>
  <PageHeader title="Orders" />
</SurfaceApp>
```

## Button

A button in the platform variants and sizes, for every action a viewer takes.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `size` | `'default' \| 'icon' \| 'icon-lg' \| 'icon-sm' \| 'icon-xs' \| 'lg' \| 'sm' \| 'xs' \| null` | no |
| `variant` | `'default' \| 'destructive' \| 'ghost' \| 'link' \| 'outline' \| 'secondary' \| null` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Icon`, `useMutation`, `useConfirm`.

### Author example

```tsx
<Button variant="outline" size="sm" onClick={() => toast('Exported.', { tone: 'success' })}>
  Export
</Button>
```

## Card

A panel with header, content and footer regions; `interactive` makes the whole card one control.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `interactive` | `boolean` | no |
| `onSelect` | `(() => void)` | no |
| `disabled` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### CardHeader

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### CardTitle

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### CardDescription

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### CardContent

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### CardFooter

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

Composes with: `Grid`, `Button`.

### Author example

```tsx
<Card>
  <CardHeader>
    <CardTitle>Order 1042</CardTitle>
    <CardDescription>Placed on 3 March by Acme.</CardDescription>
  </CardHeader>
  <CardContent>Three items, ready to ship.</CardContent>
  <CardFooter>
    <Button size="sm">Mark shipped</Button>
  </CardFooter>
</Card>
```

## Separator

A thin rule that divides two groups of content.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `orientation` | `'horizontal' \| 'vertical'` | no |
| `decorative` | `boolean` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### Author example

```tsx
<Separator />
```

## Field

Wraps one form control with its label, help text and error.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `orientation` | `'horizontal' \| 'responsive' \| 'vertical' \| null` | no |
Children: accepted. Standard DOM props: accepted.

### FieldLabel

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### FieldDescription

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### FieldError

| Prop | Derived type | Required |
|---|---|---|
| `errors` | `({ message?: string \| undefined; } \| undefined)[]` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`.

### Author example

```tsx
<Field>
  <FieldLabel htmlFor="customer-email">Email</FieldLabel>
  <Input id="customer-email" type="email" placeholder="name@example.com" />
  <FieldDescription>Receipts are sent here.</FieldDescription>
  <FieldError errors={[{ message: 'Enter a valid email address.' }]} />
</Field>
```

## Input

A single-line text input.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

Composes with: `Field`, `FilterBar`.

### Author example

```tsx
const [search, setSearch] = useState('');
return <Input aria-label="Search orders" placeholder="Search orders" value={search} onChange={(event) => setSearch(event.target.value)} />;
```

## Textarea

A multi-line text input.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

Composes with: `Field`.

### Author example

```tsx
<Textarea aria-label="Note" placeholder="Add a note for the team" rows={4} />
```

## Checkbox

A box that is checked, unchecked or indeterminate.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `defaultChecked` | `'indeterminate' \| boolean` | no |
| `asChild` | `boolean` | no |
| `checked` | `'indeterminate' \| boolean` | no |
| `required` | `boolean` | no |
| `onCheckedChange` | `((checked: CheckedState) => void)` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Field`.

### Author example

```tsx
const [urgent, setUrgent] = useState(false);
return <Checkbox aria-label="Urgent" checked={urgent} onCheckedChange={(checked) => setUrgent(checked === true)} />;
```

## Switch

An on-off toggle for a setting that applies at once.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `checked` | `boolean` | no |
| `defaultChecked` | `boolean` | no |
| `required` | `boolean` | no |
| `onCheckedChange` | `((checked: boolean) => void)` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Field`.

### Author example

```tsx
const [enabled, setEnabled] = useState(true);
return <Switch aria-label="Send reminders" checked={enabled} onCheckedChange={setEnabled} />;
```

## Select

A dropdown that picks one value from a short list.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `dir` | `'ltr' \| 'rtl'` | no |
| `name` | `string` | no |
| `autoComplete` | `string` | no |
| `disabled` | `boolean` | no |
| `required` | `boolean` | no |
| `form` | `string` | no |
| `value` | `string` | no |
| `defaultValue` | `string` | no |
| `onValueChange` | `((value: string) => void)` | no |
Children: accepted. Standard DOM props: not accepted.

### SelectTrigger

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
| `size` | `'default' \| 'sm'` | no |
Children: accepted. Standard DOM props: accepted.

### SelectValue

| Prop | Derived type | Required |
|---|---|---|
| `placeholder` | `ReactNode` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### SelectContent

| Prop | Derived type | Required |
|---|---|---|
| `onCloseAutoFocus` | `((event: Event) => void)` | no |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | no |
| `onPointerDownOutside` | `((event: PointerDownOutsideEvent) => void)` | no |
| `position` | `'item-aligned' \| 'popper'` | no |
| `asChild` | `boolean` | no |
| `align` | `'center' \| 'end' \| 'start'` | no |
| `side` | `'bottom' \| 'left' \| 'right' \| 'top'` | no |
| `sideOffset` | `number` | no |
| `alignOffset` | `number` | no |
| `arrowPadding` | `number` | no |
| `avoidCollisions` | `boolean` | no |
| `collisionBoundary` | `Boundary \| Boundary[]` | no |
| `collisionPadding` | `number \| Partial<Record<'left' \| 'right' \| 'top' \| 'bottom', number>>` | no |
| `sticky` | `'always' \| 'partial'` | no |
| `hideWhenDetached` | `boolean` | no |
| `updatePositionStrategy` | `'always' \| 'optimized'` | no |
Children: accepted. Standard DOM props: accepted.

### SelectItem

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string` | yes |
| `disabled` | `boolean` | no |
| `textValue` | `string` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Field`, `FilterBar`.

### Author example

```tsx
const [status, setStatus] = useState('open');
return (
  <Select value={status} onValueChange={setStatus}>
    <SelectTrigger aria-label="Status">
      <SelectValue placeholder="Status" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="open">Open</SelectItem>
      <SelectItem value="closed">Closed</SelectItem>
    </SelectContent>
  </Select>
);
```

## Dialog

A modal window for a focused task that needs an answer before the page continues.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `modal` | `boolean` | no |
Children: accepted. Standard DOM props: not accepted.

### DialogTrigger

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### DialogClose

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### DialogContent

| Prop | Derived type | Required |
|---|---|---|
| `forceMount` | `true` | no |
| `asChild` | `boolean` | no |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | no |
| `onPointerDownOutside` | `((event: PointerDownOutsideEvent) => void)` | no |
| `onFocusOutside` | `((event: FocusOutsideEvent) => void)` | no |
| `onInteractOutside` | `((event: PointerDownOutsideEvent \| FocusOutsideEvent) => void)` | no |
| `onOpenAutoFocus` | `((event: Event) => void)` | no |
| `onCloseAutoFocus` | `((event: Event) => void)` | no |
| `showCloseButton` | `boolean` | no |
| `closeLabel` | `string` | no |
Children: accepted. Standard DOM props: accepted.

### DialogHeader

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### DialogTitle

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### DialogDescription

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### DialogFooter

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

Composes with: `Button`, `useConfirm`.

### Author example

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Add a note</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Add a note</DialogTitle>
      <DialogDescription>The note is visible to your team.</DialogDescription>
    </DialogHeader>
    <Textarea aria-label="Note" />
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button>Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Sheet

A panel that slides in from an edge to show detail without leaving the page.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `modal` | `boolean` | no |
Children: accepted. Standard DOM props: not accepted.

### SheetTrigger

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### SheetClose

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### SheetContent

| Prop | Derived type | Required |
|---|---|---|
| `forceMount` | `true` | no |
| `asChild` | `boolean` | no |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | no |
| `onPointerDownOutside` | `((event: PointerDownOutsideEvent) => void)` | no |
| `onFocusOutside` | `((event: FocusOutsideEvent) => void)` | no |
| `onInteractOutside` | `((event: PointerDownOutsideEvent \| FocusOutsideEvent) => void)` | no |
| `onOpenAutoFocus` | `((event: Event) => void)` | no |
| `onCloseAutoFocus` | `((event: Event) => void)` | no |
| `side` | `'bottom' \| 'left' \| 'right' \| 'top'` | no |
| `closeLabel` | `string` | no |
| `portalContainer` | `HTMLElement \| null` | no |
Children: accepted. Standard DOM props: accepted.

### SheetHeader

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

### SheetTitle

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### SheetDescription

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### SheetFooter

| Prop | Derived type | Required |
|---|---|---|
Children: accepted. Standard DOM props: accepted.

Composes with: `Button`, `Table`.

### Author example

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">View order</Button>
  </SheetTrigger>
  <SheetContent side="right">
    <SheetHeader>
      <SheetTitle>Order 1042</SheetTitle>
      <SheetDescription>Placed on 3 March by Acme.</SheetDescription>
    </SheetHeader>
    <SheetFooter>
      <SheetClose asChild>
        <Button variant="outline">Close</Button>
      </SheetClose>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

## Popover

A small floating panel anchored to the control that opens it.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `modal` | `boolean` | no |
Children: accepted. Standard DOM props: not accepted.

### PopoverTrigger

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### PopoverContent

| Prop | Derived type | Required |
|---|---|---|
| `forceMount` | `true` | no |
| `asChild` | `boolean` | no |
| `align` | `'center' \| 'end' \| 'start'` | no |
| `side` | `'bottom' \| 'left' \| 'right' \| 'top'` | no |
| `sideOffset` | `number` | no |
| `alignOffset` | `number` | no |
| `arrowPadding` | `number` | no |
| `avoidCollisions` | `boolean` | no |
| `collisionBoundary` | `Boundary \| Boundary[]` | no |
| `collisionPadding` | `number \| Partial<Record<'left' \| 'right' \| 'top' \| 'bottom', number>>` | no |
| `sticky` | `'always' \| 'partial'` | no |
| `hideWhenDetached` | `boolean` | no |
| `updatePositionStrategy` | `'always' \| 'optimized'` | no |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | no |
| `onPointerDownOutside` | `((event: PointerDownOutsideEvent) => void)` | no |
| `onFocusOutside` | `((event: FocusOutsideEvent) => void)` | no |
| `onInteractOutside` | `((event: PointerDownOutsideEvent \| FocusOutsideEvent) => void)` | no |
| `onOpenAutoFocus` | `((event: Event) => void)` | no |
| `onCloseAutoFocus` | `((event: Event) => void)` | no |
| `portalled` | `boolean` | no |
| `motion` | `'fade' \| 'slide'` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Button`.

### Author example

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Filters</Button>
  </PopoverTrigger>
  <PopoverContent align="start">
    <Input aria-label="Customer" placeholder="Customer" />
  </PopoverContent>
</Popover>
```

## SplitView

A master-detail layout: a list pane and a detail pane, with the selection kept in the URL.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `items` | `readonly T[]` | yes |
| `renderItem` | `(item: T, state: { readonly selected: boolean; }) => ReactNode` | yes |
| `renderDetail` | `(item: T, state: SplitViewDetailState) => ReactNode` | yes |
| `empty` | `ReactNode` | yes |
| `queryKey` | `string` | no |
| `isLoading` | `boolean` | no |
| `loading` | `ReactNode` | no |
| `labels` | `SplitViewLabels` | no |
| `className` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Card`, `EmptyState`, `FilterBar`, `useQueryState`.

### Author example

```tsx
<SplitView
  items={[
    { id: '1042', customer: 'Acme', total: '£120' },
    { id: '1043', customer: 'Birch & Co', total: '£80' },
  ]}
  queryKey="order"
  renderItem={(order) => order.customer}
  renderDetail={(order, { clear }) => (
    <Card>
      <CardHeader>
        <CardTitle>Order {order.id}</CardTitle>
        <CardDescription>{order.customer}, {order.total}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm" variant="outline" onClick={clear}>
          Back to the list
        </Button>
      </CardFooter>
    </Card>
  )}
  empty={<EmptyState title="Pick an order" description="Its detail opens here." />}
/>
```

## Prose

A reading container for long markdown text, set at a comfortable measure and type scale.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `markdown` | `string` | yes |
| `variant` | `'default' \| 'quote'` | no |
| `className` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Card`, `TextBlock`, `SplitView`.

### Author example

```tsx
<Prose
  markdown={'## Proposal\n\nWe will deliver the first phase by **3 March**.\n\n- Discovery\n- Build\n\n> Agreed with the client on the call.'}
/>
```

## TabsRoot

Hand-composed tabs, for when the panels need their own state or layout.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string` | no |
| `defaultValue` | `string` | no |
| `onValueChange` | `((value: string) => void)` | no |
| `orientation` | `'horizontal' \| 'vertical'` | no |
| `dir` | `'ltr' \| 'rtl'` | no |
| `activationMode` | `'automatic' \| 'manual'` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### TabsList

| Prop | Derived type | Required |
|---|---|---|
| `loop` | `boolean` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### TabsTrigger

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string` | yes |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### TabsContent

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string` | yes |
| `forceMount` | `true` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### Author example

```tsx
<TabsRoot defaultValue="open">
  <TabsList>
    <TabsTrigger value="open">Open</TabsTrigger>
    <TabsTrigger value="closed">Closed</TabsTrigger>
  </TabsList>
  <TabsContent value="open">Orders that still need a decision.</TabsContent>
  <TabsContent value="closed">Orders that are done.</TabsContent>
</TabsRoot>
```

## TooltipRoot

A hand-composed tooltip, for a hint on a control such as an icon button.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `delayDuration` | `number` | no |
| `disableHoverableContent` | `boolean` | no |
Children: accepted. Standard DOM props: not accepted.

### TooltipTrigger

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### TooltipContent

| Prop | Derived type | Required |
|---|---|---|
| `forceMount` | `true` | no |
| `aria-label` | `string` | no |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | no |
| `onPointerDownOutside` | `((event: PointerDownOutsideEvent) => void)` | no |
| `asChild` | `boolean` | no |
| `align` | `'center' \| 'end' \| 'start'` | no |
| `side` | `'bottom' \| 'left' \| 'right' \| 'top'` | no |
| `sideOffset` | `number` | no |
| `alignOffset` | `number` | no |
| `arrowPadding` | `number` | no |
| `avoidCollisions` | `boolean` | no |
| `collisionBoundary` | `Boundary \| Boundary[]` | no |
| `collisionPadding` | `number \| Partial<Record<'left' \| 'right' \| 'top' \| 'bottom', number>>` | no |
| `sticky` | `'always' \| 'partial'` | no |
| `hideWhenDetached` | `boolean` | no |
| `updatePositionStrategy` | `'always' \| 'optimized'` | no |
Children: accepted. Standard DOM props: accepted.

### TooltipProvider

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | yes |
| `delayDuration` | `number` | no |
| `skipDelayDuration` | `number` | no |
| `disableHoverableContent` | `boolean` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Button`, `Icon`.

### Author example

```tsx
<TooltipProvider>
  <TooltipRoot>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Refresh">
        <Icon name="refresh-cw" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Refresh</TooltipContent>
  </TooltipRoot>
</TooltipProvider>
```

## Command

A searchable list of commands or options, inline or in a dialog.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `defaultValue` | `string \| (readonly string[] & string)` | no |
| `asChild` | `boolean` | no |
| `label` | `string` | no |
| `shouldFilter` | `boolean` | no |
| `filter` | `CommandFilter` | no |
| `value` | `string` | no |
| `onValueChange` | `((value: string) => void)` | no |
| `loop` | `boolean` | no |
| `disablePointerSelection` | `boolean` | no |
| `vimBindings` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### CommandDialog

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `open` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `onOpenChange` | `((open: boolean) => void)` | no |
| `modal` | `boolean` | no |
| `title` | `string` | no |
| `description` | `string` | no |
| `className` | `string` | no |
| `showCloseButton` | `boolean` | no |
| `onCloseAutoFocus` | `((event: Event) => void)` | no |
Children: accepted. Standard DOM props: not accepted.

### CommandInput

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
| `value` | `string` | no |
| `onValueChange` | `((search: string) => void)` | no |
Children: accepted. Standard DOM props: accepted.

### CommandList

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `asChild` | `boolean` | no |
| `label` | `string` | no |
Children: accepted. Standard DOM props: accepted.

### CommandEmpty

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `asChild` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### CommandGroup

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `asChild` | `boolean` | no |
| `heading` | `ReactNode` | no |
| `value` | `string` | no |
| `forceMount` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### CommandItem

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | no |
| `asChild` | `boolean` | no |
| `disabled` | `boolean` | no |
| `onSelect` | `((value: string) => void)` | no |
| `value` | `string` | no |
| `keywords` | `string[]` | no |
| `forceMount` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### CommandSeparator

| Prop | Derived type | Required |
|---|---|---|
| `asChild` | `boolean` | no |
| `alwaysRender` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

### Author example

```tsx
<Command label="Jump to a customer">
  <CommandInput placeholder="Search customers" />
  <CommandList>
    <CommandEmpty>No customer found.</CommandEmpty>
    <CommandGroup heading="Customers">
      <CommandItem onSelect={() => toast('Opened Acme.')}>Acme</CommandItem>
      <CommandItem onSelect={() => toast('Opened Globex.')}>Globex</CommandItem>
    </CommandGroup>
  </CommandList>
</Command>
```

## DateRangePicker

Picks a start and end date from a calendar or a preset.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `value` | `{ from: Date \| undefined; to: Date \| undefined; }` | no |
| `onChange` | `(range: { from: Date \| undefined; to: Date \| undefined; }) => void` | yes |
| `presets` | `{ label: string; from: Date; to: Date; }[]` | no |
| `className` | `string` | no |
| `labels` | `{ placeholder?: string \| undefined; presets?: string \| undefined; }` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `FilterBar`, `useQueryState`.

### Author example

```tsx
const [range, setRange] = useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined });
return <DateRangePicker value={range} onChange={setRange} />;
```

## PeriodFilterBar

A ready-made filter row driven by a list of filter definitions.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `filters` | `FilterSchema[]` | yes |
| `pageTitle` | `string` | no |
| `labels` | `PeriodFilterBarLabels` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<PeriodFilterBar pageTitle="Orders" filters={[]} />
```

## ProvenanceFooter

Says which metric a number came from, how fresh it is and how many rows it used.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `metricName` | `string` | yes |
| `dataAsOf` | `string \| null` | yes |
| `sampleN` | `number \| null` | yes |
| `sourceKind` | `string` | no |
| `labels` | `ProvenanceFooterLabels` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useMetric`.

### Author example

```tsx
<ProvenanceFooter metricName="weekly_orders" dataAsOf="2026-03-03T09:00:00Z" sampleN={128} />
```

## SurfaceForm

A whole form drawn from a list of fields, with validation and one submit.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `fields` | `readonly SurfaceFormField[]` | yes |
| `initialValues` | `Readonly<Record<string, SurfaceFormValue>>` | no |
| `submitLabel` | `string` | no |
| `onSubmit` | `(values: Readonly<Record<string, SurfaceFormValue>>) => void` | yes |
| `disabled` | `boolean` | no |
| `children` | `ReactNode` | no |
| `aria-label` | `string` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `useEntityForm`, `useMutation`.

### Author example

```tsx
<SurfaceForm
  fields={[
    { name: 'customer', label: 'Customer', kind: 'text', required: true },
    { name: 'quantity', label: 'Quantity', kind: 'number', min: 1, integer: true },
  ]}
  initialValues={{ customer: 'Acme', quantity: 1 }}
  submitLabel="Save"
  onSubmit={(values) => toast('Saved ' + String(values.customer) + '.', { tone: 'success' })}
/>
```

## Toaster

The place toasts appear, which SurfaceApp already mounts once.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `position` | `'bottom-right' \| 'top-right'` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `toast`.

### Author example

```tsx
<Toaster position="bottom-right" />
```

## Icon

One icon from the closed platform set, named by a string literal.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `name` | `'activity' \| 'arrow-down' \| 'arrow-left' \| 'arrow-right' \| 'arrow-up' \| 'arrow-up-right' \| 'bell' \| 'bookmark' \| 'briefcase' \| 'building-2' \| 'calendar' \| 'chart-column' \| 'chart-line' \| 'chart-pie' \| 'check' \| 'chevron-down' \| 'chevron-le…` | yes |
| `label` | `string` | no |
| `size` | `string \| number` | no |
| `absoluteStrokeWidth` | `boolean` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `Button`.

### Author example

```tsx
<Icon name="activity" label="Activity" />
```

## Image

A picture from an asset the Surface imports, with required alt text.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `src` | `string` | yes |
| `alt` | `string` | yes |
Children: accepted. Standard DOM props: accepted.

### Author example

```tsx
<Image src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="The shop front" />
```

## BrandMark

The org logo at a fixed size, with an optional dark-theme variant.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `src` | `string` | yes |
| `darkSrc` | `string` | no |
| `alt` | `string` | yes |
| `size` | `'lg' \| 'md' \| 'sm' \| 'xl'` | no |
Children: not accepted. Standard DOM props: accepted.

Composes with: `Hero`.

### Author example

```tsx
<BrandMark src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Acme" size="md" />
```

## Hero

A page opening with a title, supporting text and primary actions.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `title` | `ReactNode` | yes |
| `eyebrow` | `ReactNode` | no |
| `description` | `ReactNode` | no |
| `mark` | `ReactNode` | no |
| `actions` | `ReactNode` | no |
| `children` | `ReactNode` | no |
| `width` | `'narrow' \| 'standard' \| 'wide'` | no |
Children: accepted. Standard DOM props: accepted.

Composes with: `BrandMark`, `Button`.

### Author example

```tsx
<Hero
  eyebrow="Acme"
  title="Welcome back"
  description="Everything that needs your attention today."
  actions={<Button>New order</Button>}
/>
```

## Reveal

Fades its children in on first view, and not at all under reduced motion.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `delay` | `number` | no |
Children: accepted. Standard DOM props: accepted.

### Author example

```tsx
<Reveal delay={100}>
  <KPI label="Open orders" value={128} />
</Reveal>
```

## ChannelBadge

Names the channel a conversation arrived on.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `channel` | `string` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChannelBadge channel="whatsapp" />
```

## Composer

The reply box, which offers only templates once the reply window has closed.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string` | yes |
| `onChange` | `(value: string) => void` | yes |
| `onSubmit` | `() => void` | yes |
| `capabilities` | `{ canRead: boolean; canClaim: boolean; canAssign: boolean; canReturnToBot: boolean; canRelease: boolean; canClose: boolean; canReopen: boolean; canReply: boolean; canTransfer: boolean; canReconcile: boolean; } \| null` | yes |
| `replyWindow` | `'closed' \| 'open' \| 'unknown'` | no |
| `pending` | `boolean` | no |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | no |
| `outcomeUnknown` | `boolean` | no |
| `templatePicker` | `ReactNode` | no |
| `inputRef` | `Ref<HTMLTextAreaElement>` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConversation`, `useMutation`, `TemplatePicker`.

### Author example

```tsx
const conversation = useConversation('thread_1042');
const [draft, setDraft] = useState('');
const send = useMutation<{ threadId: string; text: string }>('conversation_enqueue_reply', { invalidates: ['conversation_'] });
if (conversation.capabilities === null) return <Skeleton primitiveKind="Table" height={80} />;
return (
  <Composer
    value={draft}
    onChange={setDraft}
    capabilities={conversation.capabilities}
    pending={send.state === 'pending'}
    refusal={send.refusal}
    outcomeUnknown={send.state === 'unknown'}
    onSubmit={() => void send.mutate({ threadId: 'thread_1042', text: draft })}
  />
);
```

## ContactPanel

The contact behind a conversation, with edit, merge and consent actions when allowed.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `contact` | `{ threadId: string; contact: { id: string; displayName: string \| null; email: string \| null; version: number; } \| null; displayName: string; participant: { phoneE164: string \| null; providerUserRef: string \| null; } \| null; currentIdentity…` | yes |
| `conversations` | `readonly { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined…` | no |
| `onSelectConversation` | `((thread: { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefine…` | no |
| `mergeCandidates` | `readonly { id: string; displayName: string \| null; email: string \| null; version: number; }[]` | no |
| `pending` | `boolean` | no |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | no |
| `outcomeUnknown` | `boolean` | no |
| `onEdit` | `((edit: { displayName: string \| null; email: string \| null; }) => void)` | no |
| `onMerge` | `((request: Readonly<{ sourceContactId: string; targetContactId: string; expectedSourceVersion: number; expectedTargetVersion: number; fieldChoices: Readonly<{ displayName: 'source' \| 'target'; email: 'source' \| 'target'; }>; }>) => void)` | no |
| `onRecordConsent` | `((request: Readonly<{ identityId: string; purpose: 'utility' \| 'marketing' \| 'authentication'; state: 'granted' \| 'revoked'; }>) => void)` | no |
| `children` | `ReactNode` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `useContact`.

### Author example

```tsx
const contact = useContact('thread_1042');
if (contact.data === null) return <Skeleton primitiveKind="Table" height={120} />;
return <ContactPanel contact={contact.data} />;
```

## ConversationList

The inbox rows, with keyboard movement and shortcuts.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `threads` | `readonly { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined…` | yes |
| `selectedId` | `string \| null` | yes |
| `loading` | `boolean` | no |
| `error` | `Readonly<{ kind: ErrorKind; message: string; }> \| null` | no |
| `emptyText` | `string` | no |
| `hasMore` | `boolean` | no |
| `loadingMore` | `boolean` | no |
| `attention` | `Readonly<Record<string, readonly { eventId: string; threadId: string; kind: 'new_conversation' \| 'new_message' \| 'closed_new_message' \| 'handoff_requested' \| 'assigned' \| 'member_released'; reasonCode: string \| null; count: number; latestA…` | no |
| `extras` | `Readonly<Record<string, Readonly<{ contactVerified?: boolean \| undefined; windowState?: ReplyWindowState \| undefined; followUpDueAt?: string \| null \| undefined; }>>>` | no |
| `now` | `number` | no |
| `onSelect` | `(thread: { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined…` | yes |
| `onLoadMore` | `(() => void)` | no |
| `onShortcut` | `((shortcut: 'claim' \| 'close' \| 'reply', thread: { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string…` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConversations`, `ConversationListItem`.

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

## ConversationListItem

One inbox row, for a list you lay out yourself.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `thread` | `{ id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined; lastMes…` | yes |
| `selected` | `boolean` | no |
| `notices` | `readonly { eventId: string; threadId: string; kind: 'new_conversation' \| 'new_message' \| 'closed_new_message' \| 'handoff_requested' \| 'assigned' \| 'member_released'; reasonCode: string \| null; count: number; latestAt: string; }[]` | no |
| `contactVerified` | `boolean` | no |
| `windowState` | `'closed' \| 'open' \| 'unknown'` | no |
| `followUpDueAt` | `string \| null` | no |
| `now` | `number` | no |
| `onSelect` | `(thread: { id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined…` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `ConversationList`.

### Author example

```tsx
const inbox = useConversations();
const first = inbox.threads[0];
if (first === undefined) return <EmptyState title="No conversations" />;
return <ConversationListItem thread={first} onSelect={() => undefined} />;
```

## FollowUpControl

Sets or clears a follow-up time, and warns when it falls after the reply window.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `dueAt` | `string \| null` | yes |
| `windowClosesAt` | `string \| null` | no |
| `canEdit` | `boolean` | no |
| `pending` | `boolean` | no |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | no |
| `outcomeUnknown` | `boolean` | no |
| `onSet` | `(dueAtIso: string) => void` | yes |
| `onClear` | `() => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useMutation`.

### Author example

```tsx
const [dueAt, setDueAt] = useState<string | null>(null);
return <FollowUpControl dueAt={dueAt} canEdit onSet={setDueAt} onClear={() => setDueAt(null)} />;
```

## Message

One message with its author, parts and delivery state.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `message` | `{ id: string; sequence: number; direction: 'inbound' \| 'outbound'; author: { kind: 'contact' \| 'operator' \| 'automation' \| 'system'; label?: string \| undefined; }; parts: ({ type: 'text'; text: string; } \| { type: 'attachment'; name: strin…` | yes |
| `contactVerified` | `boolean` | no |
| `canReconcile` | `boolean` | no |
| `reconcilePending` | `boolean` | no |
| `onReconcile` | `((message: { id: string; sequence: number; direction: 'inbound' \| 'outbound'; author: { kind: 'contact' \| 'operator' \| 'automation' \| 'system'; label?: string \| undefined; }; parts: ({ type: 'text'; text: string; } \| { type: 'attachment'; …` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Transcript`.

### Author example

```tsx
const conversation = useConversation('thread_1042');
const first = conversation.messages[0];
if (first === undefined) return <EmptyState title="No messages yet" />;
return <Message message={first} />;
```

## OwnershipControls

Claim, assign, release, close and reopen, showing only what the viewer may do.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `thread` | `{ id: string; version: number; title: string; channel: string; lifecycle: 'open' \| 'closed'; ownerMode: 'unassigned' \| 'bot_owned' \| 'human_owned'; unreadCount: number; lastMessageAt: string; ownerLabel?: string \| null \| undefined; lastMes…` | yes |
| `capabilities` | `{ canRead: boolean; canClaim: boolean; canAssign: boolean; canReturnToBot: boolean; canRelease: boolean; canClose: boolean; canReopen: boolean; canReply: boolean; canTransfer: boolean; canReconcile: boolean; }` | yes |
| `transferTargets` | `readonly Readonly<{ id: string; label: string; }>[]` | no |
| `pending` | `boolean` | no |
| `refusal` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | no |
| `outcomeUnknown` | `boolean` | no |
| `onAction` | `(action: OwnershipAction) => void` | yes |
| `onTarget` | `(action: TargetedOwnershipAction, targetOwnerRef: string) => void` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConversation`, `useMutation`.

### Author example

```tsx
const conversation = useConversation('thread_1042');
const transition = useMutation('conversation_transition_ownership', { invalidates: ['conversation_'] });
const { thread, capabilities } = conversation;
if (thread === null || capabilities === null) return <Skeleton primitiveKind="Table" height={40} />;
return (
  <OwnershipControls
    thread={thread}
    capabilities={capabilities}
    transferTargets={conversation.transferTargets}
    pending={transition.state === 'pending'}
    refusal={transition.refusal}
    outcomeUnknown={transition.state === 'unknown'}
    onAction={(action) =>
      void transition.mutate({ threadId: thread.id, action, expectedVersion: thread.version, idempotencyKey: crypto.randomUUID() })
    }
    onTarget={(action, targetOwnerRef) =>
      void transition.mutate({ threadId: thread.id, action, targetOwnerRef, expectedVersion: thread.version, idempotencyKey: crypto.randomUUID() })
    }
  />
);
```

## RefusalNotice

Explains in plain words why the server refused a messaging command.

Interactive: no.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `reason` | `'consent_missing' \| 'forbidden' \| 'invalid_state' \| 'not_entitled' \| 'not_found' \| 'not_owner' \| 'stale_version' \| 'unavailable' \| 'window_closed' \| null` | yes |
| `unknown` | `boolean` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<RefusalNotice reason="window_closed" />
```

## TemplatePicker

Lists the approved message templates and sends the one the viewer picks.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `templates` | `readonly { id: string; name: string; version: number; language: string; category: 'UTILITY' \| 'MARKETING' \| 'AUTHENTICATION'; status: 'disabled' \| 'draft' \| 'pending' \| 'approved' \| 'rejected' \| 'paused' \| 'deleted'; supported: boolean; ma…` | yes |
| `pending` | `boolean` | no |
| `sendBlockedReason` | `string \| null` | no |
| `onSend` | `(template: { id: string; name: string; version: number; language: string; category: 'UTILITY' \| 'MARKETING' \| 'AUTHENTICATION'; status: 'disabled' \| 'draft' \| 'pending' \| 'approved' \| 'rejected' \| 'paused' \| 'deleted'; supported: boolean; …` | yes |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Composer`, `useMutation`.

### Author example

```tsx
<TemplatePicker templates={[]} onSend={(template) => toast('Sending ' + template.name + '.')} />
```

## Transcript

The messages of one conversation, oldest first, with a way to load earlier ones.

Interactive: yes.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `messages` | `readonly { id: string; sequence: number; direction: 'inbound' \| 'outbound'; author: { kind: 'contact' \| 'operator' \| 'automation' \| 'system'; label?: string \| undefined; }; parts: ({ type: 'text'; text: string; } \| { type: 'attachment'; na…` | yes |
| `loading` | `boolean` | no |
| `hasEarlier` | `boolean` | no |
| `onLoadEarlier` | `(() => void)` | no |
| `contactVerified` | `boolean` | no |
| `canReconcile` | `boolean` | no |
| `reconcilePending` | `boolean` | no |
| `onReconcile` | `((message: { id: string; sequence: number; direction: 'inbound' \| 'outbound'; author: { kind: 'contact' \| 'operator' \| 'automation' \| 'system'; label?: string \| undefined; }; parts: ({ type: 'text'; text: string; } \| { type: 'attachment'; …` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `useConversation`, `Message`.

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
