/** @jest-environment node */
import { goalProgressScale } from './progress';

it('marks the target at 90% initially and keeps the fill proportional to the amount', () => {
  const scale = goalProgressScale('50', '100', { kind: 'target' })!;
  expect(scale.target).toBeCloseTo(90);
  expect(scale.fill).toBeCloseTo(45);
  expect(scale.color).toBe('orange');
});
it('expands the scale with an overage while keeping the target visible', () => {
  const initial = goalProgressScale('100', '100', { kind: 'minimum' })!;
  const over = goalProgressScale('200', '100', { kind: 'minimum' })!;
  expect(over.maximum).toBeGreaterThan(initial.maximum);
  expect(over.fill).toBeCloseTo(95);
  expect(over.target).toBeCloseTo(47.5);
  expect(over.target).toBeLessThan(over.fill);
  expect(over.color).toBe('green');
});
it.each([
  ['minimum', '50', 'red'],
  ['minimum', '100', 'green'],
  ['minimum', '200', 'green'],
  ['maximum', '0', 'teal'],
  ['maximum', '50', 'teal'],
  ['maximum', '100', 'teal'],
  ['maximum', '101', 'red'],
  ['target', '99', 'orange'],
  ['target', '100', 'teal'],
  ['target', '101', 'red'],
] as const)('colors %s goals at %s using their semantics', (kind, value, color) => {
  expect(goalProgressScale(value, '100', { kind })?.color).toBe(color);
});
it('positions inclusive range and tolerance bounds on the same scale', () => {
  const range = goalProgressScale('110', '100', { kind: 'range', upperBound: '120' })!;
  expect(range.lower).toBeCloseTo(75);
  expect(range.upper).toBeCloseTo(90);
  expect(range.color).toBe('teal');
  expect(goalProgressScale('120', '100', { kind: 'range', upperBound: '120' })?.color).toBe('teal');
  expect(goalProgressScale('121', '100', { kind: 'range', upperBound: '120' })?.color).toBe('red');
  expect(goalProgressScale('105', '100', { kind: 'target', tolerance: '5' })?.color).toBe('teal');
});
it('does not invent percentage progress for unset, zero, signed or invalid amounts', () => {
  expect(goalProgressScale('0', null, { kind: 'minimum' })).toBeNull();
  expect(goalProgressScale('0', '0', { kind: 'target' })).toBeNull();
  expect(goalProgressScale('-300', '-400', { kind: 'target' })).toBeNull();
  expect(goalProgressScale('NaN', '100', { kind: 'minimum' })).toBeNull();
});

it('scales and marks all minimum milestones while allowing unlimited successful overage', () => {
  const options = { kind: 'minimum' as const, preferredTarget: '150', excellent: '180' };
  const initial = goalProgressScale('100', '100', options)!;
  expect(initial.lower).toBeCloseTo(50);
  expect(initial.target).toBeCloseTo(75);
  expect(initial.excellent).toBeCloseTo(90);
  expect(initial.color).toBe('orange');
  const over = goalProgressScale('500', '100', options)!;
  expect(over.fill).toBeCloseTo(95);
  expect(over.color).toBe('cyan');
  expect(over.excellent).toBeLessThan(over.fill);
  expect(goalProgressScale(null, '25', options)).toBeNull();
});
it('marks the preferred target separately from the range bounds', () => {
  const scale = goalProgressScale('60', '50', {
    kind: 'range',
    preferredTarget: '60',
    upperBound: '70',
  })!;
  expect(scale.lower).toBeLessThan(scale.target);
  expect(scale.upper).toBeGreaterThan(scale.target);
});
