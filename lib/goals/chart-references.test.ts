import { goalChartReferences } from './chart-references';

it('omits unset goals and never manufactures a range for one-sided goals', () => {
  expect(goalChartReferences(null)).toEqual({ referenceLines: [], referenceAreas: [] });
  expect(
    goalChartReferences('25', { kind: 'minimum', preferredTarget: '30', excellent: '40' })
  ).toMatchObject({
    referenceLines: [
      { y: 25, color: 'yellow.6' },
      { y: 30, color: 'green.6' },
      { y: 40, color: 'lime.6' },
    ],
    referenceAreas: [],
  });
  expect(goalChartReferences('70', { kind: 'maximum' }).referenceLines).toEqual([
    expect.objectContaining({ y: 70, color: 'red.6', ifOverflow: 'extendDomain' }),
  ]);
});
it('shades inclusive ranges and tolerance bands including negative calorie balance', () => {
  expect(
    goalChartReferences('-400', { kind: 'range', upperBound: '-200', preferredTarget: '-300' })
  ).toMatchObject({
    referenceLines: [
      { y: -400, color: 'yellow.6' },
      { y: -200, color: 'red.6' },
      { y: -300, color: 'green.6' },
    ],
    referenceAreas: [{ y1: -400, y2: -200, color: 'green.6', ifOverflow: 'extendDomain' }],
  });
  expect(goalChartReferences('80', { kind: 'target', tolerance: '2' })).toMatchObject({
    referenceLines: [{ y: 80, color: 'green.6' }],
    referenceAreas: [{ y1: 78, y2: 82, color: 'green.6' }],
  });
});

it('keeps references unlabeled and uses hues separate from Nutrition and Health observations', () => {
  const references = [
    goalChartReferences('80'),
    goalChartReferences('80', { kind: 'range', upperBound: '85', preferredTarget: '82' }),
    goalChartReferences('25', { kind: 'minimum', preferredTarget: '30', excellent: '40' }),
    goalChartReferences('20', { kind: 'maximum' }),
  ];
  const dataHues = ['teal', 'blue', 'orange', 'grape', 'cyan', 'indigo'];
  for (const reference of references) {
    for (const geometry of [...reference.referenceLines!, ...reference.referenceAreas!]) {
      expect(geometry).not.toHaveProperty('label');
      expect(dataHues).not.toContain(String(geometry.color).split('.')[0]);
    }
  }
});
