// Geometry adapted from Mantine GaugeChart (MIT); see LICENSE.Mantine.
// SVG does not need sub-micropixel precision. Native trig can differ across JS runtimes.
export const svgCoordinate = (value: number) => Number(value.toFixed(6));

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: svgCoordinate(cx + r * Math.cos(rad)), y: svgCoordinate(cy + r * Math.sin(rad)) };
}

export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
) {
  const delta = endAngle - startAngle;
  const sweep = delta >= 0 ? 1 : 0;
  const start = polarToCartesian(cx, cy, r, startAngle);

  // A single arc command cannot express a full circle – its endpoints would be identical
  // and nothing would be rendered, so it is split into two half-circle arcs.
  if (Math.abs(delta) >= 360) {
    const mid = polarToCartesian(cx, cy, r, startAngle + (delta >= 0 ? 180 : -180));
    return `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${sweep} ${mid.x} ${mid.y} A ${r} ${r} 0 0 ${sweep} ${start.x} ${start.y}`;
  }

  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = Math.abs(delta) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

export function valueToAngle(
  value: number,
  min: number,
  max: number,
  startAngle: number,
  endAngle: number
) {
  if (max === min) {
    return startAngle;
  }
  const clamped = Math.max(min, Math.min(max, value));
  return startAngle + ((clamped - min) / (max - min)) * (endAngle - startAngle);
}

export function isAngleInArc(angle: number, start: number, end: number) {
  const delta = end - start;

  if (Math.abs(delta) >= 360) {
    return true;
  }

  // Distance from the start angle measured along the direction the arc sweeps,
  // so that descending ranges (endAngle < startAngle) are handled the same way.
  const distance = delta >= 0 ? angle - start : start - angle;
  return ((distance % 360) + 360) % 360 <= Math.abs(delta);
}

export function getArcBoundingBox(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  padding: number,
  labelReserve: number
) {
  const startPt = polarToCartesian(cx, cy, r, startAngle);
  const endPt = polarToCartesian(cx, cy, r, endAngle);

  let minX = Math.min(startPt.x, endPt.x, cx - labelReserve);
  let maxX = Math.max(startPt.x, endPt.x, cx + labelReserve);
  let minY = Math.min(startPt.y, endPt.y, cy - labelReserve);
  let maxY = Math.max(startPt.y, endPt.y, cy + labelReserve);

  const cardinals = [
    { angle: 0, x: cx, y: cy - r },
    { angle: 90, x: cx + r, y: cy },
    { angle: 180, x: cx, y: cy + r },
    { angle: 270, x: cx - r, y: cy },
  ];

  for (const cardinal of cardinals) {
    if (isAngleInArc(cardinal.angle, startAngle, endAngle)) {
      minX = Math.min(minX, cardinal.x);
      maxX = Math.max(maxX, cardinal.x);
      minY = Math.min(minY, cardinal.y);
      maxY = Math.max(maxY, cardinal.y);
    }
  }

  return {
    x: svgCoordinate(minX - padding),
    y: svgCoordinate(minY - padding),
    width: svgCoordinate(maxX - minX + padding * 2),
    height: svgCoordinate(maxY - minY + padding * 2),
  };
}

/** Radial marker endpoints; shares the arc's polar coordinate convention. */
export function getMarkerLine(cx: number, cy: number, r: number, thickness: number, angle: number) {
  return {
    inner: polarToCartesian(cx, cy, r - thickness * 0.75, angle),
    outer: polarToCartesian(cx, cy, r + thickness * 0.75, angle),
  };
}

export function normalizeSections<T extends { value: number }>(
  sections: readonly T[],
  min: number,
  max: number
) {
  let previous = min;
  return [...sections]
    .sort((a, b) => a.value - b.value)
    .flatMap((section) => {
      const value = Math.max(min, Math.min(max, section.value));
      if (value <= previous) {
        return [];
      }
      const result = { ...section, start: previous, value };
      previous = value;
      return [result];
    });
}

export function requireFinite(name: string, value: number) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`VelaGaugeChart: ${name} must be finite`);
  }
}
