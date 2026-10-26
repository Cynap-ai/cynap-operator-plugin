<!-- GENERATED — DO NOT EDIT. Run scripts/build-surface-contract.mjs. -->

# Surface primitives reference

Derived types and signatures come from the SDK catalog. Config schemas describe the config renderer; JSX authors use the React props shown below. Examples assume the named imports from `@cynap/surface-sdk` inside `SurfaceApp`.

## Section

A titled block of the page with an optional eyebrow, description and collapse.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "eyebrow": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "collapsible": {
      "type": "boolean"
    },
    "columns": {
      "type": "integer",
      "minimum": 1,
      "maximum": 12
    },
    "gap": {
      "type": "integer",
      "minimum": 0,
      "maximum": 96
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `SectionConfig` | no |
| `id` | `string` | no |
| `children` | `ReactNode` | no |
| `className` | `string` | no |
| `title` | `string` | no |
| `eyebrow` | `string` | no |
| `description` | `string` | no |
| `collapsible` | `boolean` | no |
| `defaultOpen` | `boolean` | no |
| `columns` | `number` | no |
| `gap` | `number` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Row`, `Grid`, `Table`.

### Author example

```tsx
<Section title="Open orders" description="Orders that still need a decision.">
  <Callout id="orders-note" config={{ severity: 'info', message: 'Orders refresh every minute.' }} />
</Section>
```

## Row

Lays its children out side by side and stacks them on a narrow screen.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "gap": {
      "type": "number"
    },
    "align": {
      "type": "string",
      "enum": [
        "start",
        "center",
        "end"
      ]
    },
    "wrap": {
      "type": "boolean"
    },
    "cols": {
      "type": "integer",
      "minimum": 1,
      "maximum": 12
    },
    "min_card_width": {
      "type": "integer",
      "minimum": 120,
      "maximum": 640
    },
    "responsive": {
      "type": "object",
      "properties": {
        "stack_below": {
          "type": "string",
          "enum": [
            "sm",
            "md",
            "lg",
            "xl"
          ]
        },
        "scroll_horizontal": {
          "type": "string",
          "enum": [
            "sm",
            "md",
            "lg",
            "xl"
          ]
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ gap?: number \| undefined; align?: 'center' \| 'start' \| 'end' \| undefined; wrap?: boolean \| undefined; cols?: number \| undefined; min_card_width?: number \| undefined; responsive?: { stack_below?: 'sm' \| 'md' \| 'lg' \| 'xl' \| undefined; scr…` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Col`, `KPI`, `Card`.

### Author example

```tsx
<Row id="summary" config={{ gap: 16 }}>
  <KPI label="Open orders" value={128} />
  <KPI label="Overdue" value={7} />
</Row>
```

## Col

A column inside a Row that takes a share of its twelve-column width.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "span": {
      "type": "integer",
      "minimum": 1,
      "maximum": 12
    },
    "gap": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ span?: number \| undefined; gap?: number \| undefined; }` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Row`.

### Author example

```tsx
<Row id="detail" config={{ gap: 16 }}>
  <Col id="detail-main" config={{ span: 8 }}>
    <TextBlock markdown="The main content." />
  </Col>
  <Col id="detail-side" config={{ span: 4 }}>
    <TextBlock markdown="The side content." />
  </Col>
</Row>
```

## Grid

A grid of equal columns for cards and tiles.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cols": {
      "anyOf": [
        {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        {
          "type": "object",
          "properties": {
            "base": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            },
            "sm": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            },
            "md": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            },
            "lg": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            },
            "xl": {
              "type": "integer",
              "minimum": 1,
              "maximum": 12
            }
          },
          "additionalProperties": false
        }
      ]
    },
    "gap": {
      "type": "number"
    },
    "row_gap": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ cols?: number \| { base?: number \| undefined; sm?: number \| undefined; md?: number \| undefined; lg?: number \| undefined; xl?: number \| undefined; } \| undefined; gap?: number \| undefined; row_gap?: number \| undefined; }` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `KPI`, `Card`.

### Author example

```tsx
<Grid id="tiles" config={{ cols: { base: 1, sm: 2, lg: 3 }, gap: 16 }}>
  <KPI label="New" value={12} />
  <KPI label="In progress" value={30} />
  <KPI label="Done" value={86} />
</Grid>
```

## Stack

Stacks its children vertically with one consistent gap.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "gap": {
      "type": "number"
    },
    "align": {
      "type": "string",
      "enum": [
        "start",
        "center",
        "end",
        "stretch"
      ]
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ gap?: number \| undefined; align?: 'center' \| 'start' \| 'end' \| 'stretch' \| undefined; }` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Section`, `PageHeader`.

### Author example

```tsx
<Stack id="page" config={{ gap: 24 }}>
  <PageHeader title="Orders" />
  <TextBlock markdown="Everything that needs attention today." />
</Stack>
```

## Tabs

A config-driven tab set that shows one Tab child at a time.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "default_tab": {
      "type": "string"
    },
    "variant": {
      "type": "string",
      "enum": [
        "line",
        "pill",
        "card"
      ]
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"tabs_only"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ default_tab?: string \| undefined; variant?: 'line' \| 'pill' \| 'card' \| undefined; }` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Tab`.

### Author example

```tsx
<Tabs id="order-views" config={{ default_tab: 'open', variant: 'line' }}>
  <Tab id="open" config={{ label: 'Open' }}>
    <TextBlock markdown="Orders that still need a decision." />
  </Tab>
  <Tab id="closed" config={{ label: 'Closed' }}>
    <TextBlock markdown="Orders that are done." />
  </Tab>
</Tabs>
```

## Tab

One labelled panel of a Tabs set.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "label": {
      "type": "string"
    },
    "icon": {
      "type": "string"
    }
  },
  "required": [
    "label"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ label: string; icon?: string \| undefined; }` | yes |
| `children` | `ReactNode` | no |
| `id` | `string` | yes |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Tabs`.

### Author example

```tsx
<Tabs id="order-views" config={{ default_tab: 'open', variant: 'line' }}>
  <Tab id="open" config={{ label: 'Open' }}>
    <TextBlock markdown="Orders that still need a decision." />
  </Tab>
  <Tab id="closed" config={{ label: 'Closed' }}>
    <TextBlock markdown="Orders that are done." />
  </Tab>
</Tabs>
```

## Callout

An inline info, warning or error message with an optional title.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "message": {
      "type": "string"
    },
    "severity": {
      "type": "string",
      "enum": [
        "info",
        "warning",
        "error"
      ]
    },
    "title": {
      "type": "string"
    },
    "dismissible": {
      "type": "boolean"
    }
  },
  "required": [
    "message",
    "severity"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ message: string; severity: 'error' \| 'warning' \| 'info'; title?: string \| undefined; dismissible?: boolean \| undefined; }` | yes |
| `id` | `string` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Callout
  id="sync-delayed"
  config={{ severity: 'warning', title: 'Sync delayed', message: 'The last sync finished two hours ago.' }}
/>
```

## KPI

One headline number with a label and an optional trend.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "subtitle": {
      "type": "string"
    },
    "format": {
      "type": "string",
      "enum": [
        "number",
        "currency_pence",
        "percent",
        "duration",
        "date"
      ]
    },
    "precision": {
      "type": "integer",
      "minimum": 0,
      "maximum": 10
    },
    "icon": {
      "type": "string"
    },
    "delta": {
      "type": "object",
      "properties": {
        "direction": {
          "type": "string",
          "enum": [
            "positive_good",
            "negative_good",
            "inverse"
          ]
        },
        "vs_metric": {
          "type": "string"
        }
      },
      "required": [
        "direction"
      ]
    },
    "trend": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "sparkline",
            "bar_mini"
          ]
        },
        "metric": {
          "type": "string"
        }
      },
      "required": [
        "mode",
        "metric"
      ]
    },
    "tooltip": {
      "type": "string"
    },
    "click_action": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "navigate"
            },
            "path": {
              "type": "string"
            }
          },
          "required": [
            "type",
            "path"
          ]
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "open"
            },
            "modal_id": {
              "type": "string"
            }
          },
          "required": [
            "type",
            "modal_id"
          ]
        }
      ]
    }
  },
  "required": [
    "title"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["scalar","grouped_scalar"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `value` | `string \| number` | yes |
| `label` | `string` | yes |
| `trend` | `{ value: number; direction: 'flat' \| 'up' \| 'down'; }` | no |
| `icon` | `ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>` | no |
| `className` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `{ message: string; name?: string \| undefined; } \| null` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Row`, `Grid`, `useMetric`.

### Author example

```tsx
<KPI label="Open orders" value={128} trend={{ value: 12, direction: 'up' }} />
```

## StatGroup

A compact row of related numbers that read as one group.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "columns": {
      "type": "integer",
      "minimum": 1,
      "maximum": 6
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["scalar"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `items` | `{ value: string \| number; label: string; trend?: { value: number; direction: 'flat' \| 'up' \| 'down'; } \| undefined; sparklineData?: number[] \| undefined; }[]` | no |
| `stats` | `{ value: string \| number; label: string; trend?: 'up' \| 'down' \| 'stable' \| undefined; delta?: string \| number \| undefined; sparklineData?: number[] \| undefined; }[]` | no |
| `stages` | `{ name?: string \| undefined; stage?: string \| undefined; value?: number \| undefined; count?: number \| undefined; }[]` | no |
| `data` | `NormalizedResponse` | no |
| `normalizedConfig` | `{ labelColumn: string; valueColumn: string; timeDelta?: TimeDeltaResult \| undefined; }` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `onRetry` | `(() => void)` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<StatGroup
  items={[
    { label: 'Open', value: 128 },
    { label: 'Overdue', value: 7 },
    { label: 'Closed this week', value: 41 },
  ]}
/>
```

## Sparkline

A small trend line beside a title and its latest value.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "color": {
      "type": "string"
    },
    "height": {
      "type": "number"
    },
    "show_area": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["timeseries"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `number[]` | yes |
| `color` | `string` | no |
| `showDelta` | `boolean` | no |
| `className` | `string` | no |
| `title` | `string` | no |
| `value` | `string \| number` | no |
| `trend` | `SparklineTrend` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Sparkline title="Orders this week" value={128} data={[12, 18, 14, 22, 19, 25, 18]} />
```

## ChartBar

A bar chart of one or more series across categories, stacked or horizontal on request.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "x_key": {
      "type": "string"
    },
    "y_key": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "stacked": {
      "type": "boolean"
    },
    "horizontal": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical","timeseries"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `Record<string, unknown>[] \| NormalizedResponse \| null` | yes |
| `xAxisKey` | `string` | yes |
| `yAxisKeys` | `string[]` | yes |
| `stacked` | `boolean` | no |
| `horizontal` | `boolean` | no |
| `maxItems` | `number` | no |
| `onSegmentClick` | `((dataPoint: Record<string, unknown>) => void)` | no |
| `height` | `number` | no |
| `className` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `normalizedConfig` | `{ xAxisColumn: string; yAxisColumns: string[]; }` | no |
| `xAxisLabel` | `string` | no |
| `yAxisLabel` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Section`, `useQuery`.

### Author example

```tsx
<ChartBar
  data={[
    { month: 'Jan', orders: 40 },
    { month: 'Feb', orders: 52 },
    { month: 'Mar', orders: 47 },
  ]}
  xAxisKey="month"
  yAxisKeys={['orders']}
/>
```

## ChartLine

A line chart of one or more series over an ordered axis, usually time.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "x_key": {
      "type": "string"
    },
    "y_key": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "smooth": {
      "type": "boolean"
    },
    "show_dots": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["timeseries"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `Record<string, unknown>[] \| NormalizedResponse \| null` | yes |
| `xAxisKey` | `string` | yes |
| `yAxisKeys` | `string[]` | yes |
| `onSegmentClick` | `((dataPoint: Record<string, unknown>) => void)` | no |
| `height` | `number` | no |
| `className` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `normalizedConfig` | `{ xAxisColumn: string; yAxisColumns: string[]; }` | no |
| `xAxisLabel` | `string` | no |
| `yAxisLabel` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Section`, `useQuery`.

### Author example

```tsx
<ChartLine
  data={[
    { week: 'W1', revenue: 4200 },
    { week: 'W2', revenue: 5100 },
    { week: 'W3', revenue: 4800 },
  ]}
  xAxisKey="week"
  yAxisKeys={['revenue']}
/>
```

## ChartArea

A filled line chart that shows volume over an ordered axis.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "x_key": {
      "type": "string"
    },
    "y_key": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "fill_opacity": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "stacked": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["timeseries"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `Record<string, unknown>[] \| null` | yes |
| `xAxisKey` | `string` | yes |
| `yAxisKeys` | `string[]` | yes |
| `onSegmentClick` | `((dataPoint: Record<string, unknown>) => void)` | no |
| `height` | `number` | no |
| `className` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartArea
  data={[
    { week: 'W1', visits: 310 },
    { week: 'W2', visits: 420 },
    { week: 'W3', visits: 390 },
  ]}
  xAxisKey="week"
  yAxisKeys={['visits']}
/>
```

## ChartPie

A pie chart of how a total splits across a few categories.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "name_key": {
      "type": "string"
    },
    "value_key": {
      "type": "string"
    },
    "show_legend": {
      "type": "boolean"
    },
    "innerRadius": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["distribution"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `Record<string, unknown>[] \| NormalizedResponse \| null` | yes |
| `nameKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `donut` | `boolean` | no |
| `maxItems` | `number` | no |
| `onSegmentClick` | `((dataPoint: Record<string, unknown>) => void)` | no |
| `height` | `number` | no |
| `className` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `normalizedConfig` | `{ nameColumn: string; valueColumn: string; }` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartPie
  data={[
    { status: 'Paid', count: 86 },
    { status: 'Open', count: 30 },
    { status: 'Overdue', count: 7 },
  ]}
  nameKey="status"
  valueKey="count"
/>
```

## ChartDonut

A donut chart of how a total splits across a few categories, with a legend.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "name_key": {
      "type": "string"
    },
    "value_key": {
      "type": "string"
    },
    "show_legend": {
      "type": "boolean"
    },
    "innerRadius": {
      "type": "number"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["distribution"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `{ title?: string \| undefined; name_key?: string \| undefined; value_key?: string \| undefined; show_legend?: boolean \| undefined; innerRadius?: number \| undefined; }` | yes |
| `data` | `unknown` | yes |
| `id` | `string` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartDonut
  id="orders-by-status"
  config={{ title: 'Orders by status', name_key: 'status', value_key: 'count' }}
  data={[
    { status: 'Paid', count: 86 },
    { status: 'Open', count: 30 },
  ]}
/>
```

## Table

A data table with sorting, search, pagination, expandable rows and rows that open on click.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "columns": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "sortable": {
            "type": "boolean"
          },
          "format": {
            "type": "string"
          }
        },
        "required": [
          "key"
        ]
      }
    },
    "page_size": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "searchable": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["table"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `columns` | `ColumnDef<T>[]` | yes |
| `data` | `T[] \| null` | yes |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `onRetry` | `(() => void)` | no |
| `pagination` | `{ page: number; pageSize: number; total: number; }` | no |
| `onPageChange` | `((page: number) => void)` | no |
| `onSortChange` | `((sort: { field: string; direction: 'desc' \| 'asc'; } \| null) => void)` | no |
| `searchValue` | `string` | no |
| `onSearchChange` | `((value: string) => void)` | no |
| `renderExpandedRow` | `((row: T) => ReactNode)` | no |
| `className` | `string` | no |
| `normalizedData` | `NormalizedResponse` | no |
| `stageColors` | `Record<string, string>` | no |
| `virtualized` | `boolean` | no |
| `maxHeight` | `number` | no |
| `estimateRowHeight` | `number` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
| `selection` | `DataTableSelection<T>` | no |
| `csvExport` | `DataTableCsvExport` | no |
| `interactive` | `boolean` | no |
| `onSelect` | `((row: T) => void)` | no |
| `isRowDisabled` | `((row: T) => boolean)` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Section`, `FilterBar`, `EmptyState`, `useEntityQuery`.

### Author example

```tsx
<Table
  columns={[
    { accessorKey: 'customer', header: 'Customer' },
    { accessorKey: 'total', header: 'Total' },
  ]}
  data={[
    { customer: 'Acme', total: 1200 },
    { customer: 'Globex', total: 860 },
  ]}
  interactive
  onSelect={(order) => toast(`Opened ${order.customer}.`)}
/>
```

## Activity

A dated feed of recent events.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "max_items": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "show_timestamp": {
      "type": "boolean"
    },
    "entity_types": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["activity","feed"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `items` | `ActivityItem[]` | no |
| `title` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `className` | `string` | no |
| `data` | `NormalizedResponse \| null` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Activity title="Recent activity" items={[]} />
```

## AlertCard

A card that flags a condition by severity, with a count and the affected items.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "max_items": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50
    },
    "severity_filter": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "info",
          "warning",
          "error",
          "critical"
        ]
      }
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["alerts"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `severity` | `string` | yes |
| `title` | `string` | yes |
| `description` | `string` | no |
| `items` | `{ id?: string \| undefined; label?: string \| undefined; detail?: string \| undefined; entity_id?: string \| undefined; entity_name?: string \| undefined; current_stage?: string \| undefined; days_in_stage?: number \| undefined; }[]` | no |
| `count` | `number` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `className` | `string` | no |
| `data` | `NormalizedResponse \| null` | no |
| `normalizedConfig` | `{ threshold?: number \| undefined; }` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<AlertCard severity="warning" title="Overdue invoices" description="7 invoices are past their due date." count={7} />
```

## Pipeline

Stage columns with counts, where a click selects a stage.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "entity_type": {
      "type": "string"
    },
    "show_counts": {
      "type": "boolean"
    },
    "show_values": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["stages","pipeline"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `stages` | `PipelineStage[]` | yes |
| `onStageClick` | `((stage: PipelineStage) => void)` | no |
| `activeStage` | `string` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `className` | `string` | no |
| `normalizedData` | `NormalizedResponse` | no |
| `normalizedConfig` | `{ stageColumn: string; countColumn: string; }` | no |
| `variant` | `'default' \| 'flow'` | no |
| `conversionRates` | `Record<string, number>` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Table`, `useQuery`.

### Author example

```tsx
const [active, setActive] = useState<string | undefined>(undefined);
return (
  <Pipeline
    stages={[
      { name: 'New', count: 12, color: 'var(--color-ring-primary)' },
      { name: 'Quoted', count: 8, color: 'var(--color-ring-primary)' },
      { name: 'Won', count: 5, color: 'var(--color-ring-primary)' },
    ]}
    activeStage={active}
    onStageClick={(stage) => setActive(stage.name)}
  />
);
```

## FilterBar

A row that holds filter controls and an optional reset.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "filters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "type": {
            "type": "string",
            "enum": [
              "date_range",
              "select",
              "search",
              "boolean"
            ]
          },
          "options": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "key"
        ]
      }
    },
    "compact": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `children` | `ReactNode` | yes |
| `onReset` | `(() => void)` | no |
| `className` | `string` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Input`, `Select`, `DateRangePicker`, `useQueryState`.

### Author example

```tsx
<FilterBar onReset={() => undefined}>
  <Input aria-label="Search orders" placeholder="Search orders" />
</FilterBar>
```

## EmptyState

What to show when there is no data yet, with a next step.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "icon": {
      "type": "string"
    },
    "action_label": {
      "type": "string"
    },
    "action_path": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `icon` | `ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>` | no |
| `title` | `string` | no |
| `description` | `string` | no |
| `action` | `EmptyStateAction` | no |
| `secondaryAction` | `EmptyStateAction` | no |
| `hint` | `string` | no |
| `variant` | `'card' \| 'page'` | no |
| `className` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<EmptyState
  title="No orders yet"
  description="Orders appear here once a customer places one."
  action={{ label: 'Refresh', onClick: () => undefined }}
/>
```

## ActionList

Rows of records with the verbs its config declares, run through the host.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 300
    },
    "row_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "columns": {
      "minItems": 1,
      "maxItems": 12,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 64
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "format": {
            "default": "text",
            "type": "string",
            "enum": [
              "text",
              "date",
              "currency_pence",
              "badge",
              "link"
            ]
          },
          "tones": {
            "type": "object",
            "propertyNames": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "additionalProperties": {
              "type": "string",
              "enum": [
                "neutral",
                "info",
                "success",
                "warning",
                "danger"
              ]
            }
          },
          "link_label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "align": {
            "type": "string",
            "enum": [
              "start",
              "end"
            ]
          }
        },
        "required": [
          "key"
        ],
        "additionalProperties": false
      }
    },
    "item_noun": {
      "type": "string",
      "minLength": 1,
      "maxLength": 30
    },
    "total_key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "empty_text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "actions": {
      "minItems": 1,
      "maxItems": 6,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_-]{0,63}$"
          },
          "label": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "automation_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "trigger_data": {
            "default": {}
          },
          "inputs": {
            "minItems": 1,
            "maxItems": 8,
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "key": {
                      "type": "string",
                      "pattern": "^[a-z][a-z0-9_]{0,63}$"
                    },
                    "label": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80
                    },
                    "type": {
                      "type": "string",
                      "enum": [
                        "text",
                        "textarea"
                      ]
                    },
                    "required": {
                      "default": false,
                      "type": "boolean"
                    },
                    "placeholder": {
                      "type": "string",
                      "maxLength": 200
                    },
                    "max_length": {
                      "default": 200,
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 4096
                    }
                  },
                  "required": [
                    "key",
                    "label",
                    "type"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "key": {
                      "type": "string",
                      "pattern": "^[a-z][a-z0-9_]{0,63}$"
                    },
                    "label": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80
                    },
                    "type": {
                      "type": "string",
                      "const": "select"
                    },
                    "required": {
                      "default": false,
                      "type": "boolean"
                    },
                    "options": {
                      "minItems": 1,
                      "maxItems": 20,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "value": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 200
                          },
                          "label": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 80
                          }
                        },
                        "required": [
                          "value",
                          "label"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "required": [
                    "key",
                    "label",
                    "type",
                    "options"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "confirm": {
            "type": "string",
            "minLength": 1,
            "maxLength": 400
          },
          "tone": {
            "default": "neutral",
            "type": "string",
            "enum": [
              "primary",
              "neutral",
              "danger"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "automation_id"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "row_key",
    "actions"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["table"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `config` | `Record<string, unknown>` | yes |
| `id` | `string` | yes |
| `orgSlug` | `string` | yes |
| `normalizedData` | `NormalizedResponse \| null` | no |
| `isLoading` | `boolean` | no |
| `error` | `Error \| null` | no |
| `onRefresh` | `(() => void)` | no |
| `sourceMetricName` | `string` | no |
| `dataAsOf` | `string \| null` | no |
| `sampleN` | `number \| null` | no |
| `sourceKind` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ActionList
  id="open-invoices"
  orgSlug="acme"
  config={{
    title: 'Open invoices',
    row_key: 'invoice_id',
    item_noun: 'invoice',
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'due_date', label: 'Due', format: 'date' },
    ],
  }}
/>
```

## ChartHeatmap

A grid of cells coloured by value across two dimensions.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "xAxisKey": {
      "type": "string",
      "minLength": 1
    },
    "yAxisKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "colorScale": {
      "default": "sequential",
      "type": "string",
      "enum": [
        "sequential",
        "diverging"
      ]
    },
    "emptyCellTreatment": {
      "default": "null",
      "type": "string",
      "enum": [
        "zero",
        "null",
        "skip"
      ]
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "xAxisKey",
    "yAxisKey",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `xAxisKey` | `string` | yes |
| `yAxisKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `colorScale` | `'diverging' \| 'sequential'` | no |
| `emptyCellTreatment` | `'null' \| 'skip' \| 'zero'` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartHeatmap
  title="Calls by day and hour"
  data={[
    { day: 'Mon', hour: '09', calls: 4 },
    { day: 'Mon', hour: '10', calls: 9 },
    { day: 'Tue', hour: '09', calls: 6 },
  ]}
  xAxisKey="hour"
  yAxisKey="day"
  valueKey="calls"
/>
```

## ChartHistogram

How often values fall into each range of a numeric field.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "bucketing": {
      "default": "auto",
      "anyOf": [
        {
          "type": "string",
          "const": "auto"
        },
        {
          "type": "string",
          "const": "fixed"
        },
        {
          "type": "object",
          "properties": {
            "edges": {
              "minItems": 2,
              "type": "array",
              "items": {
                "type": "number"
              }
            }
          },
          "required": [
            "edges"
          ]
        }
      ]
    },
    "bucketCount": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "normalized": {
      "default": false,
      "type": "boolean"
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["distribution"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `bucketing` | `'auto' \| 'fixed' \| { edges: number[]; }` | no |
| `bucketCount` | `number` | no |
| `normalized` | `boolean` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartHistogram
  title="Call length in minutes"
  data={[{ minutes: 2 }, { minutes: 4 }, { minutes: 5 }, { minutes: 9 }]}
  valueKey="minutes"
/>
```

## ChartFunnel

Stages that narrow from first to last, with the drop between them.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "stageKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "orientation": {
      "default": "vertical",
      "type": "string",
      "enum": [
        "vertical",
        "horizontal"
      ]
    },
    "showDropOffPct": {
      "default": false,
      "type": "boolean"
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "stageKey",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["stages","pipeline"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `stageKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `orientation` | `'horizontal' \| 'vertical'` | no |
| `showDropOffPct` | `boolean` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartFunnel
  title="Lead funnel"
  data={[
    { stage: 'Leads', count: 400 },
    { stage: 'Quoted', count: 120 },
    { stage: 'Won', count: 45 },
  ]}
  stageKey="stage"
  valueKey="count"
/>
```

## ChartTreemap

Nested rectangles sized by value across a hierarchy.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "hierarchyKeys": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "colorBy": {
      "type": "string"
    },
    "labelMinSize": {
      "default": 20,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "hierarchyKeys",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `hierarchyKeys` | `string[]` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `colorBy` | `string` | no |
| `labelMinSize` | `number` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartTreemap
  title="Revenue by region and city"
  data={[
    { region: 'North', city: 'Leeds', revenue: 4200 },
    { region: 'North', city: 'York', revenue: 1800 },
    { region: 'South', city: 'Bristol', revenue: 3100 },
  ]}
  hierarchyKeys={['region', 'city']}
  valueKey="revenue"
/>
```

## ChartSankey

Flows between sources and destinations, sized by value.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sourceKey": {
      "type": "string",
      "minLength": 1
    },
    "targetKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "nodeAlignment": {
      "default": "justify",
      "type": "string",
      "enum": [
        "left",
        "right",
        "center",
        "justify"
      ]
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "edges": {
      "default": [],
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": {
            "type": "string",
            "minLength": 1
          },
          "target": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "source",
          "target"
        ]
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "sourceKey",
    "targetKey",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `sourceKey` | `string` | yes |
| `targetKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `nodeAlignment` | `'center' \| 'justify' \| 'left' \| 'right'` | no |
| `edges` | `{ source: string; target: string; }[]` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartSankey
  title="Where leads go"
  data={[
    { source: 'Website', destination: 'Quoted', count: 80 },
    { source: 'Referral', destination: 'Quoted', count: 40 },
    { source: 'Quoted', destination: 'Won', count: 45 },
  ]}
  sourceKey="source"
  targetKey="destination"
  valueKey="count"
/>
```

## ChartRadar

One or more groups scored on several axes of the same scale.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "axesKeys": {
      "minItems": 3,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "groupKey": {
      "type": "string"
    },
    "rangeMax": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "axesKeys",
    "valueKey",
    "rangeMax",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["grouped_scalar"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `axesKeys` | `string[]` | yes |
| `valueKey` | `string` | yes |
| `rangeMax` | `number` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `groupKey` | `string` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartRadar
  title="Service scores"
  data={[{ quality: 82, speed: 64, satisfaction: 90 }]}
  axesKeys={['quality', 'speed', 'satisfaction']}
  valueKey="score"
  rangeMax={100}
/>
```

## ChartGauge

One value against a target on a fixed range.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "targetValue": {
      "type": "number"
    },
    "min": {
      "type": "number"
    },
    "max": {
      "type": "number"
    },
    "thresholds": {
      "default": [],
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "at": {
            "type": "number"
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-f]{6}$"
          },
          "label": {
            "type": "string",
            "minLength": 1
          },
          "icon": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "at",
          "color",
          "label",
          "icon"
        ],
        "additionalProperties": false
      }
    },
    "statusRedundancy": {
      "default": "icon+label",
      "type": "string",
      "const": "icon+label"
    },
    "data": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 300,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 300,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "valueKey",
    "targetValue",
    "min",
    "max",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["scalar"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `valueKey` | `string` | yes |
| `targetValue` | `number` | yes |
| `min` | `number` | yes |
| `max` | `number` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `thresholds` | `{ at: number; color: string; label: string; icon: string; }[]` | no |
| `statusRedundancy` | `'icon+label'` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartGauge title="Collection rate" data={[{ rate: 82 }]} valueKey="rate" targetValue={90} min={0} max={100} />
```

## ChartWaterfall

How a starting value becomes an ending value through gains and losses.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "categoryKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "isTotalKey": {
      "type": "string"
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "categoryKey",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `categoryKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `isTotalKey` | `string` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartWaterfall
  title="Revenue bridge"
  data={[
    { step: 'Last month', amount: 4200 },
    { step: 'New customers', amount: 900 },
    { step: 'Churn', amount: -300 },
  ]}
  categoryKey="step"
  valueKey="amount"
/>
```

## BigNumber

One large formatted value with an optional change against a prior value.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "priorValueKey": {
      "type": "string",
      "minLength": 1
    },
    "format": {
      "type": "string",
      "enum": [
        "number",
        "currency",
        "percent"
      ]
    },
    "delta": {
      "default": "none",
      "type": "string",
      "enum": [
        "percent",
        "absolute",
        "none"
      ]
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "sparklineSlot": {},
    "currency": {
      "type": "string"
    },
    "unit": {
      "type": "string"
    }
  },
  "required": [
    "valueKey",
    "format",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["scalar"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `valueKey` | `string` | yes |
| `format` | `'currency' \| 'number' \| 'percent'` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `priorValueKey` | `string` | no |
| `delta` | `'absolute' \| 'none' \| 'percent'` | no |
| `sparklineSlot` | `ReactNode` | no |
| `currency` | `string` | no |
| `unit` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<BigNumber data={[{ revenue: 48200, prior: 45100 }]} valueKey="revenue" priorValueKey="prior" format="currency" currency="GBP" delta="percent" />
```

## Scorecard

Rows of actual against target for a set of people or teams.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "rowsKey": {
      "type": "string",
      "minLength": 1
    },
    "labelKey": {
      "type": "string",
      "minLength": 1
    },
    "targetKey": {
      "type": "string",
      "minLength": 1
    },
    "actualKey": {
      "type": "string",
      "minLength": 1
    },
    "format": {
      "type": "string",
      "enum": [
        "number",
        "currency",
        "percent"
      ]
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    }
  },
  "required": [
    "rowsKey",
    "labelKey",
    "targetKey",
    "actualKey",
    "format",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["table"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `rowsKey` | `string` | yes |
| `labelKey` | `string` | yes |
| `targetKey` | `string` | yes |
| `actualKey` | `string` | yes |
| `format` | `'currency' \| 'number' \| 'percent'` | yes |
| `data` | `Record<string, unknown>[]` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Scorecard
  data={[
    { clinician: 'Dana', target: 40, actual: 44 },
    { clinician: 'Noa', target: 40, actual: 31 },
  ]}
  rowsKey="clinician"
  labelKey="clinician"
  targetKey="target"
  actualKey="actual"
  format="number"
/>
```

## Map

Markers on a map, with a table or list fallback when the map cannot draw.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "latKey": {
      "type": "string",
      "minLength": 1
    },
    "lngKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "labelKey": {
      "type": "string",
      "minLength": 1
    },
    "colorScale": {
      "default": "sequential",
      "type": "string",
      "enum": [
        "sequential",
        "diverging",
        "categorical"
      ]
    },
    "clustering": {
      "default": false,
      "type": "boolean"
    },
    "fallback": {
      "default": "list",
      "type": "string",
      "enum": [
        "list",
        "table",
        "none"
      ]
    },
    "tileUrl": {
      "default": "/api/maptiles/{z}/{x}/{y}.png",
      "type": "string"
    },
    "a11y": {
      "default": {
        "keyboard": true,
        "reducedMotion": true,
        "focusableMarkers": true
      },
      "type": "object",
      "properties": {
        "keyboard": {
          "default": true,
          "type": "boolean"
        },
        "reducedMotion": {
          "default": true,
          "type": "boolean"
        },
        "focusableMarkers": {
          "default": true,
          "type": "boolean"
        }
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    },
    "degraded": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "data",
    "latKey",
    "lngKey"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["geo_points"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `data` | `Record<string, unknown>[]` | yes |
| `latKey` | `string` | yes |
| `lngKey` | `string` | yes |
| `valueKey` | `string` | no |
| `labelKey` | `string` | no |
| `colorScale` | `'categorical' \| 'diverging' \| 'sequential'` | no |
| `clustering` | `boolean` | no |
| `fallback` | `'list' \| 'none' \| 'table'` | no |
| `tileUrl` | `string` | no |
| `a11y` | `{ keyboard?: boolean \| undefined; reducedMotion?: boolean \| undefined; focusableMarkers?: boolean \| undefined; }` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
| `degraded` | `boolean` | no |
| `onMarkerActivate` | `((marker: MapMarker) => void)` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Map
  title="Orders by city"
  data={[
    { city: 'Leeds', lat: 53.8, lng: -1.55, orders: 40 },
    { city: 'Bristol', lat: 51.45, lng: -2.59, orders: 22 },
  ]}
  latKey="lat"
  lngKey="lng"
  valueKey="orders"
  labelKey="city"
  fallback="table"
/>
```

## ChartGroupedBar

Bars grouped by category with one bar per series.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "x_key": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "horizontal": {
      "type": "boolean"
    },
    "stacked": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["category_series","categorical"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `seriesRows` | `readonly ChartSeriesRow[]` | yes |
| `seriesKeys` | `readonly string[]` | yes |
| `state` | `'empty' \| 'error' \| 'loading' \| 'ready' \| 'stale'` | yes |
| `height` | `number` | no |
| `ariaLabel` | `string` | no |
| `format` | `'count' \| 'currency' \| 'duration_days' \| 'percent'` | no |
| `unit` | `string` | no |
| `currency` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartGroupedBar seriesRows={[]} seriesKeys={['booked', 'attended']} state="empty" ariaLabel="Appointments by week" />
```

## ChartPivotMatrix

A row-by-column matrix of values with optional total and average columns.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "rowKey": {
      "type": "string",
      "minLength": 1
    },
    "colKey": {
      "type": "string",
      "minLength": 1
    },
    "valueKey": {
      "type": "string",
      "minLength": 1
    },
    "data": {
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      }
    },
    "summaryColumns": {
      "default": [],
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "total",
          "average",
          "yoy"
        ]
      }
    },
    "fiscalYearStartMonth": {
      "default": 1,
      "type": "integer",
      "minimum": 1,
      "maximum": 12
    },
    "rowOrder": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "width": {
      "default": 600,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "height": {
      "default": 400,
      "type": "number",
      "exclusiveMinimum": 0
    },
    "title": {
      "default": "",
      "type": "string"
    }
  },
  "required": [
    "rowKey",
    "colKey",
    "valueKey",
    "data"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":true,"shape":["matrix"]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `rowKey` | `string` | yes |
| `colKey` | `string` | yes |
| `valueKey` | `string` | yes |
| `data` | `Record<string, unknown>[]` | yes |
| `summaryColumns` | `('total' \| 'average' \| 'yoy')[]` | no |
| `fiscalYearStartMonth` | `number` | no |
| `rowOrder` | `string[]` | no |
| `width` | `number` | no |
| `height` | `number` | no |
| `title` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<ChartPivotMatrix
  title="Revenue by clinician and month"
  data={[
    { clinician: 'Dana', month: '2026-01', revenue: 4200 },
    { clinician: 'Dana', month: '2026-02', revenue: 3900 },
    { clinician: 'Noa', month: '2026-01', revenue: 3100 },
  ]}
  rowKey="clinician"
  colKey="month"
  valueKey="revenue"
  summaryColumns={['total']}
/>
```

## Avatar

A person shown as a picture, or as initials when there is none.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "src": {
      "type": "string",
      "format": "uri"
    },
    "size": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `name` | `string` | yes |
| `src` | `string` | no |
| `size` | `number` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Avatar name="Dana Levi" size={32} />
```

## Badge

A status chip that pairs a semantic tone with a label, so colour is never the only signal.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "minLength": 1
    },
    "tone": {
      "type": "string",
      "enum": [
        "neutral",
        "success",
        "warning",
        "danger",
        "info"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "neutral",
        "success",
        "warning",
        "danger",
        "info"
      ]
    },
    "icon": {
      "type": "string",
      "minLength": 1
    },
    "color": {
      "type": "string",
      "pattern": "^#[0-9a-f]{6}$"
    }
  },
  "required": [
    "label"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `label` | `string` | yes |
| `tone` | `'danger' \| 'info' \| 'neutral' \| 'success' \| 'warning'` | no |
| `status` | `'danger' \| 'info' \| 'neutral' \| 'success' \| 'warning'` | no |
| `icon` | `string` | no |
| `color` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Badge tone="success" label="Paid" />
```

## Breadcrumb

The trail from the top of the app to the current page.

Interactive: yes.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "items": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": {
            "type": "string"
          },
          "href": {
            "type": "string"
          }
        },
        "required": [
          "label"
        ]
      }
    }
  },
  "required": [
    "items"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `items` | `{ label: string; href?: string \| undefined; }[]` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Breadcrumb items={[{ label: 'Orders', href: '/orders' }, { label: 'Order 1042' }]} />
```

## Legend

Names the series of a chart beside their colours.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "series": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": {
            "type": "string",
            "minLength": 1
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-f]{6}$"
          }
        },
        "required": [
          "label",
          "color"
        ]
      }
    }
  },
  "required": [
    "series"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `series` | `{ label: string; color: string; }[]` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Legend
  series={[
    { label: 'Paid', color: 'var(--chart-1)' },
    { label: 'Open', color: 'var(--chart-2)' },
  ]}
/>
```

## PageHeader

The page title with a description, a breadcrumb and an actions slot, drawn once per page.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string",
      "minLength": 1
    },
    "breadcrumb": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": {
            "type": "string"
          },
          "href": {
            "type": "string"
          }
        },
        "required": [
          "label"
        ]
      }
    },
    "density": {
      "type": "string",
      "enum": [
        "compact",
        "comfortable",
        "spacious"
      ]
    },
    "labels": {
      "type": "object",
      "properties": {
        "breadcrumb": {
          "type": "string",
          "minLength": 1
        },
        "density": {
          "type": "string",
          "minLength": 1
        },
        "compact": {
          "type": "string",
          "minLength": 1
        },
        "comfortable": {
          "type": "string",
          "minLength": 1
        },
        "spacious": {
          "type": "string",
          "minLength": 1
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "title"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `title` | `string` | yes |
| `description` | `string` | no |
| `breadcrumb` | `{ label: string; href?: string \| undefined; }[]` | no |
| `density` | `'comfortable' \| 'compact' \| 'spacious'` | no |
| `labels` | `{ breadcrumb?: string \| undefined; density?: string \| undefined; compact?: string \| undefined; comfortable?: string \| undefined; spacious?: string \| undefined; }` | no |
| `actions` | `ReactNode` | no |
| `onDensityChange` | `((d: 'compact' \| 'comfortable' \| 'spacious') => void)` | no |
Children: not accepted. Standard DOM props: not accepted.

Composes with: `Stack`, `Toolbar`, `Button`.

### Author example

```tsx
<PageHeader
  title="Orders"
  description="Every open order, newest first."
  breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Orders' }]}
  actions={<Button size="sm">New order</Button>}
/>
```

## Skeleton

A loading placeholder shaped like the piece it stands in for.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "primitiveKind": {
      "type": "string",
      "minLength": 1
    },
    "height": {
      "type": [
        "number",
        "string"
      ]
    },
    "label": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "primitiveKind"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `primitiveKind` | `string` | yes |
| `height` | `string \| number` | no |
| `label` | `string` | no |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Skeleton primitiveKind="Table" height={160} />
```

## TextBlock

A short block of markdown text; long reading text belongs in Prose.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "markdown": {
      "type": "string"
    }
  },
  "required": [
    "markdown"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"none"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `markdown` | `string` | yes |
Children: not accepted. Standard DOM props: not accepted.

### Author example

```tsx
<TextBlock markdown="Orders sync from the shop **every hour**." />
```

## Toolbar

A labelled group of actions that reads as one toolbar to assistive technology.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "label"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"any"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `label` | `string` | yes |
| `children` | `ReactNode` | no |
Children: accepted. Standard DOM props: not accepted.

Composes with: `Button`.

### Author example

```tsx
<Toolbar label="Order actions">
  <Button size="sm" variant="outline">Export</Button>
</Toolbar>
```

## Tooltip

A short text hint shown when its child is hovered or focused.

Interactive: no.

### Config fields, types and bounds (JSON Schema)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "content"
  ],
  "additionalProperties": false
}
```

Children rule: `{"kind":"single"}`. Data requirement: `{"required":false,"shape":[]}`.

### React props

| Prop | Derived type | Required |
|---|---|---|
| `content` | `string` | yes |
| `children` | `ReactNode` | yes |
Children: accepted. Standard DOM props: not accepted.

### Author example

```tsx
<Tooltip content="Last synced an hour ago">
  <span>Synced</span>
</Tooltip>
```
