# VelaGaugeChart

Generic SVG gauge adapted from the installed Mantine 9.7.0 GaugeChart (MIT).
Import from `@/components/VelaGaugeChart/VelaGaugeChart`, keeping it distinct
from `@mantine/charts`. No Health calculations or chart dependencies.

```tsx
<VelaGaugeChart
  value={42}
  aria-label="Capacity"
  valueFormatter={(value) => `${value}%`}
  markers={[
    { id: 'current', value: 42, color: 'gray.0', label: 'Current', size: 3 },
    { id: 'projected', value: 68, color: 'blue', label: 'Projected', lineStyle: 'dashed' },
  ]}
/>
```

`VelaGaugeChart.story.tsx` includes this example and side-by-side Mantine
comparisons: value, sections, target, semicircle, circle and reverse sweep.
Use Storybook's theme switcher and narrow viewports for visual review.

## Mantine compatibility

Preserves `value`, `min=0`, `max=100`, `size=200`, `thickness=12`,
`startAngle=-120`, `endAngle=120`, `roundCaps=false`, `targetSize=2`,
`target`, `targetColor`, `trackColor`, `filledColor`, `sections`, `label` and
`valueFormatter`. Default colors use Mantine's border, primary-filled and bright
tokens. Hue/shade tokens, custom theme colors, CSS colors and light/dark schemes
resolve through Mantine. Angles start at the top and increase clockwise; sweeps
are limited to ±360°. Full circles use two SVG arcs. No animation is added.

Sections are upper bounds, sorted ascending without changing the input. Bounds
are clamped, duplicate/empty intervals discarded (first duplicate wins), and the
uncovered remainder keeps the track color. Absent or empty sections fill from
`min` to `value`. Round section caps appear at the first/last visible bands only.
Labels and units remain caller-owned. Large custom labels may require a larger
size, as with Mantine's centered foreignObject label.

Mantine's `className`, `style`, Box props and Styles API are supported:
`root`, `track`, `section`, `sectionCap`, `needle` (all markers), `label`.
Theme defaults use `theme.components.VelaGaugeChart` with
`VelaGaugeChart.extend(...)`. The SVG ref is forwarded. CSS variables retain
`--gauge-size` and the internal `--gauge-aspect-ratio`.

## Extensions and deliberate differences

- `markers` requires stable unique nonempty `id` and finite `value`. Optional
  `color`, `label` (accessible name, defaults to id), `size` (stroke width,
  defaults to `targetSize`) and `lineStyle` (`solid` or `dashed`) style each marker.
- The compatibility target renders first, then markers in array order. Later
  markers paint on top, including exact overlaps; no artificial value offsets.
  The id `__target` is reserved while `target` is supplied.
- A linked SVG `desc` exposes all marker names and formatted original values,
  including a note for positions clamped outside the range. Caller
  `aria-describedby` references are preserved. Only the primary value owns
  `aria-valuenow`; its clamped label and meter semantics match Mantine.
  Caller ARIA overrides are supported, including Vela's domain-unit meter scale.
- Unlike Mantine, invalid numeric inputs throw `RangeError`: nonfinite required
  values, bounds, section bounds, marker/target values, angles or widths;
  `min >= max`; nonpositive size/width; `thickness >= size`; or overflowing range
  and angle differences. Missing marker values and duplicate/empty ids also
  reject. Do not pass unknown data as zero: callers should render a neutral
  gauge/label or their own unavailable state. Optional missing target/markers
  produce no markers. Finite out-of-range values/targets/markers/sections clamp
  for drawing, just like Mantine. The default primary label uses the clamped
  value; supply a custom label for raw/domain values if appropriate.
- SVG coordinates are rounded to six decimal places to avoid server/browser
  trigonometric precision differences causing hydration warnings. Mantine's
  unrounded coordinates can differ in their last digits across runtimes.
- `max-width: 100%` allows shrinking inside narrow parents. The viewBox includes
  each marker's stroke extent, including wide flat endpoint markers, which may
  add a little padding compared with Mantine's single-target calculation.
- A non-meter role does not generate meter-only min/max/now attributes; explicit
  caller overrides still take precedence.

Geometry helpers in `geometry.ts` are pure and share the same SVG coordinate
system. Their callers supply validated finite geometry/ranges. Tests compare
paths and viewBoxes against installed Mantine and exercise accessibility, SSR,
section normalization, bounds, overlaps and marker clipping. Mantine-derived
source is covered by the accompanying `LICENSE.Mantine`.
