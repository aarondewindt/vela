import { goalChartReferences } from './chart-references';

it('omits unset goals and never manufactures a range for one-sided goals', () => {
  expect(goalChartReferences(null)).toEqual({ referenceLines: [], referenceAreas: [] });
  expect(
    goalChartReferences('25', { kind: 'minimum', preferredTarget: '30', excellent: '40' }, 'Fiber')
  ).toMatchObject({
    referenceLines: [
      { y: 25, label: 'Fiber minimum' },
      { y: 30, label: 'Fiber preferred' },
      { y: 40, label: 'Fiber excellent' },
    ],
    referenceAreas: [],
  });
  expect(goalChartReferences('70', { kind: 'maximum' }).referenceLines).toEqual([
    expect.objectContaining({ y: 70, label: 'Goal maximum', ifOverflow: 'extendDomain' }),
  ]);
});
it('shades inclusive ranges and tolerance bands including negative calorie balance', () => {
  expect(
    goalChartReferences('-400', { kind: 'range', upperBound: '-200', preferredTarget: '-300' })
  ).toMatchObject({
    referenceLines: [{ y: -400 }, { y: -200 }, { y: -300 }],
    referenceAreas: [{ y1: -400, y2: -200, ifOverflow: 'extendDomain' }],
  });
  expect(goalChartReferences('80', { kind: 'target', tolerance: '2' })).toMatchObject({
    referenceLines: [{ y: 80 }],
    referenceAreas: [{ y1: 78, y2: 82 }],
  });
});
