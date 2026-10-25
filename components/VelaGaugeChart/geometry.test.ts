import {
  describeArc,
  getArcBoundingBox,
  getMarkerLine,
  isAngleInArc,
  normalizeSections,
  polarToCartesian,
  valueToAngle,
} from './geometry';

it('uses top-zero clockwise polar coordinates and radial marker endpoints', () => {
  expect(polarToCartesian(100, 100, 90, 0)).toEqual({ x: 100, y: 10 });
  expect(polarToCartesian(100, 100, 90, 90)).toEqual({ x: 190, y: 100 });
  expect(getMarkerLine(100, 100, 90, 20, 90)).toEqual({
    inner: { x: 175, y: 100 },
    outer: { x: 205, y: 100 },
  });
});

it.each([
  [-90, 90],
  [120, -120],
  [0, 360],
  [0, -360],
])('maps and clamps values across sweep %s → %s', (start, end) => {
  expect(valueToAngle(-200, -100, 100, start, end)).toBe(start);
  expect(valueToAngle(0, -100, 100, start, end)).toBe((start + end) / 2);
  expect(valueToAngle(200, -100, 100, start, end)).toBe(end);
});

it('splits full circles and chooses large arc and sweep flags', () => {
  expect(describeArc(0, 0, 90, 0, 360).match(/ A /g)).toHaveLength(2);
  expect(describeArc(0, 0, 90, 0, -360)).toContain('A 90 90 0 0 0');
  expect(describeArc(0, 0, 90, 0, 240)).toContain('A 90 90 0 1 1');
  expect(describeArc(0, 0, 90, 0, -240)).toContain('A 90 90 0 1 0');
  expect(describeArc(0, 0, 90, 0, 0)).toContain('A 90 90 0 0 1');
});

it('includes crossed cardinal points in either direction and across zero', () => {
  expect(isAngleInArc(0, 300, 420)).toBe(true);
  expect(isAngleInArc(0, 60, -60)).toBe(true);
  expect(isAngleInArc(180, 60, -60)).toBe(false);
  expect(isAngleInArc(90, 0, -360)).toBe(true);
  expect(getArcBoundingBox(100, 100, 90, -90, 90, 10, 20)).toEqual({
    x: 0,
    y: 0,
    width: 200,
    height: 130,
  });
  expect(getArcBoundingBox(100, 100, 90, 0, -360, 10, 20)).toEqual({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
});

it('sorts, clamps and drops duplicate/empty section intervals without mutating input', () => {
  const sections = [{ value: 200 }, { value: 50 }, { value: -10 }, { value: 50 }];
  expect(normalizeSections(sections, 0, 100)).toEqual([
    { start: 0, value: 50 },
    { start: 50, value: 100 },
  ]);
  expect(sections[0].value).toBe(200);
  expect(normalizeSections([], 0, 100)).toEqual([]);
});

it('rounds native trig results to stable SVG precision for server/client hydration', () => {
  expect(polarToCartesian(100, 100, 94, -24)).toEqual({ x: 61.766756, y: 14.126727 });
});
