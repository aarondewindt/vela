'use client';

// Adapted from Mantine GaugeChart (MIT); see LICENSE.Mantine.
import { useId } from 'react';
import {
  describeArc,
  getArcBoundingBox,
  getMarkerLine,
  normalizeSections,
  requireFinite,
  valueToAngle,
} from './geometry';
import {
  Box,
  BoxProps,
  createVarsResolver,
  ElementProps,
  factory,
  Factory,
  getThemeColor,
  MantineColor,
  rem,
  StylesApiProps,
  useMantineTheme,
  useProps,
  useStyles,
} from '@mantine/core';
import classes from './VelaGaugeChart.module.css';

export interface VelaGaugeChartMarker {
  /** Stable, unique key. Array order controls painting: later markers are on top. */
  id: string;
  value: number;
  color?: MantineColor;
  /** Accessible name; defaults to id. */
  label?: string;
  /** Stroke width in SVG units, defaults to targetSize (2). */
  size?: number;
  lineStyle?: 'solid' | 'dashed';
}

export interface VelaGaugeChartSection {
  /** Upper bound value for this section */
  value: number;

  /** Color of the section */
  color: MantineColor;
}

export type VelaGaugeChartStylesNames =
  | 'root'
  | 'track'
  | 'section'
  | 'sectionCap'
  | 'needle'
  | 'label';

export type VelaGaugeChartCssVariables = {
  root: '--gauge-size';
};

export interface VelaGaugeChartProps
  extends
    BoxProps,
    StylesApiProps<VelaGaugeChartFactory>,
    ElementProps<'svg', 'display' | 'opacity' | 'viewBox' | 'width' | 'height' | 'target'> {
  /** Current value to display. Fills the arc from `min` up to `value`, unless `sections` is set – then the arc is colored by thresholds and the value is displayed only in the center label. */
  value: number;

  /** Independent radial markers, painted after the compatibility target. */
  markers?: readonly VelaGaugeChartMarker[];

  /** Minimum value of the gauge, @default 0 */
  min?: number;

  /** Maximum value of the gauge, @default 100 */
  max?: number;

  /** Value marked on the arc with a line marker, use to display a goal or the current value of a gauge with `sections` */
  target?: number;

  /** Threshold sections of the gauge arc, each section is filled from the previous section upper bound to its own `value`. If set, the arc is not filled based on `value`. */
  sections?: VelaGaugeChartSection[];

  /** Arc thickness in px, @default 12 */
  thickness?: number;

  /** Chart size (width and height), @default 200 */
  size?: number;

  /** Start angle in degrees, @default -120 */
  startAngle?: number;

  /** End angle in degrees, @default 120 */
  endAngle?: number;

  /** Label displayed in the center of the gauge */
  label?: React.ReactNode;

  /** Value formatter for default label, @default (v) => String(v) */
  valueFormatter?: (value: number) => string;

  /** Color of the gauge track (unfilled portion) */
  trackColor?: MantineColor;

  /** Color of the filled arc when sections are not provided */
  filledColor?: MantineColor;

  /** Color of the target marker */
  targetColor?: MantineColor;

  /** Thickness of the target marker, @default 2 */
  targetSize?: number;

  /** Whether to round arc endpoints. With `sections`, only the outer ends of the first and last sections are rounded. @default false */
  roundCaps?: boolean;
}

export type VelaGaugeChartFactory = Factory<{
  props: VelaGaugeChartProps;
  ref: SVGSVGElement;
  stylesNames: VelaGaugeChartStylesNames;
  vars: VelaGaugeChartCssVariables;
}>;

const defaultProps = {
  min: 0,
  max: 100,
  thickness: 12,
  size: 200,
  startAngle: -120,
  endAngle: 120,
  roundCaps: false,
  targetSize: 2,
} satisfies Partial<VelaGaugeChartProps>;

const varsResolver = createVarsResolver<VelaGaugeChartFactory>((_theme, { size }) => ({
  root: {
    '--gauge-size': rem(size),
  },
}));

export const VelaGaugeChart = factory<VelaGaugeChartFactory>((_props) => {
  const props = useProps('VelaGaugeChart', defaultProps, _props);
  const {
    ref,
    classNames,
    className,
    style,
    styles,
    unstyled,
    vars,
    attributes,
    value,
    min,
    max,
    target,
    markers = [],
    sections,
    thickness,
    size,
    startAngle,
    endAngle,
    label,
    valueFormatter,
    trackColor,
    filledColor,
    targetColor,
    targetSize,
    roundCaps,
    variant,
    ...others
  } = props;

  const descriptionId = useId();
  const theme = useMantineTheme();
  const resolvedMarkers = [
    ...(target == null
      ? []
      : [{ id: '__target', value: target, color: targetColor, size: targetSize, label: 'Target' }]),
    ...markers,
  ];
  for (const [name, number] of Object.entries({
    value,
    min: min!,
    max: max!,
    size: size!,
    thickness: thickness!,
    startAngle: startAngle!,
    endAngle: endAngle!,
    targetSize: targetSize!,
  })) {
    requireFinite(name, number);
  }
  if (
    min! >= max! ||
    !Number.isFinite(max! - min!) ||
    size! <= 0 ||
    thickness! <= 0 ||
    thickness! >= size! ||
    targetSize! <= 0 ||
    !Number.isFinite(endAngle! - startAngle!)
  ) {
    throw new RangeError(
      'VelaGaugeChart: require min < max, size > thickness > 0 and targetSize > 0 with finite spans'
    );
  }
  const ids = new Set<string>();
  for (const marker of resolvedMarkers) {
    requireFinite('marker value', marker.value);
    requireFinite('marker size', marker.size ?? targetSize!);
    if (!marker.id || ids.has(marker.id) || (marker.size ?? targetSize!) <= 0) {
      throw new RangeError(
        'VelaGaugeChart: markers require unique nonempty ids and positive sizes'
      );
    }
    ids.add(marker.id);
  }
  sections?.forEach((section) => requireFinite('section value', section.value));

  const getStyles = useStyles<VelaGaugeChartFactory>({
    name: 'VelaGaugeChart',
    classes,
    props,
    className,
    style,
    classNames,
    styles,
    unstyled,
    attributes,
    vars,
    varsResolver,
  });

  const svgSize = size!;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const r = (svgSize - thickness!) / 2;
  const strokeLinecap = roundCaps ? 'round' : 'butt';
  // Include radial extent and stroke width, including thick flat endpoint markers.
  const strokePadding = resolvedMarkers.reduce(
    (padding, marker) =>
      Math.max(
        padding,
        roundCaps
          ? thickness! * 0.75 + (marker.size ?? targetSize!) / 2
          : Math.hypot(r + thickness! * 0.75, (marker.size ?? targetSize!) / 2) - r
      ),
    thickness! / 2
  );

  // A gauge cannot span more than a full turn – a larger range would wrap the arc onto
  // itself and make later sections overwrite earlier ones.
  const span = endAngle! - startAngle!;
  const resolvedEndAngle = startAngle! + Math.max(-360, Math.min(360, span));

  const labelReserve = Math.max(thickness!, svgSize * 0.11);
  const bbox = getArcBoundingBox(
    cx,
    cy,
    r,
    startAngle!,
    resolvedEndAngle,
    strokePadding,
    labelReserve
  );

  const resolvedTrackColor = trackColor
    ? getThemeColor(trackColor, theme)
    : 'var(--mantine-color-default-border)';

  const trackPath = describeArc(cx, cy, r, startAngle!, resolvedEndAngle);

  const sectionElements =
    sections && sections.length > 0 ? (
      (() => {
        const sortedSections = normalizeSections(sections, min!, max!);
        const direction = resolvedEndAngle >= startAngle! ? 1 : -1;
        let prevAngle = startAngle!;

        const resolvedSections = sortedSections.map((section) => {
          const sectionEndAngle = valueToAngle(
            section.value,
            min!,
            max!,
            startAngle!,
            resolvedEndAngle
          );
          if ((sectionEndAngle - prevAngle) * direction <= 0) {
            return null;
          }
          const path = describeArc(cx, cy, r, prevAngle, sectionEndAngle);
          prevAngle = sectionEndAngle;
          return { path, color: getThemeColor(section.color, theme) };
        });

        const visibleSections = resolvedSections.filter((section) => section !== null);

        const capSections =
          roundCaps && visibleSections.length > 0
            ? visibleSections.length === 1
              ? [visibleSections[0]]
              : [visibleSections[0], visibleSections[visibleSections.length - 1]]
            : [];

        return (
          <>
            {capSections.map((section, index) => (
              <path
                key={index}
                {...getStyles('sectionCap')}
                d={section.path}
                fill="none"
                stroke={section.color}
                strokeWidth={thickness}
                strokeLinecap="round"
              />
            ))}
            {resolvedSections.map((section, index) =>
              section ? (
                <path
                  key={index}
                  {...getStyles('section')}
                  d={section.path}
                  fill="none"
                  stroke={section.color}
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                />
              ) : null
            )}
          </>
        );
      })()
    ) : (
      <path
        {...getStyles('section')}
        d={describeArc(
          cx,
          cy,
          r,
          startAngle!,
          valueToAngle(value, min!, max!, startAngle!, resolvedEndAngle)
        )}
        fill="none"
        stroke={
          filledColor ? getThemeColor(filledColor, theme) : 'var(--mantine-primary-color-filled)'
        }
        strokeWidth={thickness}
        strokeLinecap={strokeLinecap}
      />
    );

  const markerElements = resolvedMarkers.map((marker) => {
    const angle = valueToAngle(marker.value, min!, max!, startAngle!, resolvedEndAngle);
    const { inner, outer } = getMarkerLine(cx, cy, r, thickness!, angle);
    const width = marker.size ?? targetSize!;
    return (
      <line
        key={marker.id}
        {...getStyles('needle')}
        data-marker-id={marker.id}
        aria-hidden="true"
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={marker.color ? getThemeColor(marker.color, theme) : 'var(--mantine-color-bright)'}
        strokeWidth={width}
        strokeDasharray={marker.lineStyle === 'dashed' ? `${width * 2} ${width}` : undefined}
        strokeLinecap={strokeLinecap}
      />
    );
  });

  const formatValue = valueFormatter || ((v: number) => String(v));

  // The arc is drawn from the clamped value, and `aria-valuetext` is defined as the
  // human-readable equivalent of `aria-valuenow` – reporting the raw value in either the
  // default label or `aria-valuetext` would contradict both the arc and `aria-valuenow`.
  const clampedValue = Math.max(min!, Math.min(max!, value));
  const formattedValue = formatValue(clampedValue);
  const labelContent = label !== undefined ? label : formattedValue;

  // A meter with no accessible name is announced as "meter" and nothing else, so there is
  // always a name. A string `label` names the metric ("CPU usage") and is used unless an
  // explicit `aria-label` is given; the generic fallback covers the rest. The default label
  // is the formatted value, which would only repeat `aria-valuetext`.
  const ariaLabel =
    others['aria-labelledby'] !== undefined
      ? undefined
      : (others['aria-label'] ?? (typeof label === 'string' ? label : undefined) ?? 'Gauge');

  return (
    <Box
      component="svg"
      ref={ref}
      viewBox={`${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`}
      __vars={{ '--gauge-aspect-ratio': `${bbox.width} / ${bbox.height}` }}
      {...getStyles('root')}
      variant={variant}
      role="meter"
      aria-label={ariaLabel}
      aria-valuenow={others.role && others.role !== 'meter' ? undefined : clampedValue}
      aria-valuemin={others.role && others.role !== 'meter' ? undefined : min}
      aria-valuemax={others.role && others.role !== 'meter' ? undefined : max}
      aria-valuetext={formattedValue}
      {...others}
      aria-describedby={
        [others['aria-describedby'], resolvedMarkers.length ? descriptionId : undefined]
          .filter(Boolean)
          .join(' ') || undefined
      }
    >
      {resolvedMarkers.length > 0 && (
        <desc id={descriptionId}>
          {resolvedMarkers
            .map(
              (marker) =>
                `${marker.label ?? marker.id}: ${formatValue(marker.value)}${marker.value < min! || marker.value > max! ? ' (position clamped to range)' : ''}`
            )
            .join('; ')}
        </desc>
      )}
      <path
        {...getStyles('track')}
        d={trackPath}
        fill="none"
        stroke={resolvedTrackColor}
        strokeWidth={thickness}
        strokeLinecap={strokeLinecap}
      />

      {sectionElements}
      {markerElements}

      <foreignObject x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height}>
        <div
          {...getStyles('label', {
            style: {
              transform: `translate(${cx - bbox.x - bbox.width / 2}px, ${cy - bbox.y - bbox.height / 2}px)`,
            },
          })}
        >
          {labelContent}
        </div>
      </foreignObject>
    </Box>
  );
});

VelaGaugeChart.displayName = 'Vela/VelaGaugeChart';
VelaGaugeChart.classes = classes;
VelaGaugeChart.varsResolver = varsResolver;
