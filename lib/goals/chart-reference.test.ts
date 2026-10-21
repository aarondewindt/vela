/** @jest-environment node */
import { goalChartReferences } from './chart-reference';

it('leaves charts without configured bounds alone', () => {
  expect(goalChartReferences(null, { kind: 'target' })).toEqual({
    referenceAreas: [],
    referenceLines: [],
  });
});
it('shades a signed range and marks its bounds and preferred target', () => {
  const refs = goalChartReferences('-400', {
    kind: 'range',
    upperBound: '-200',
    preferredTarget: '-300',
  });
  expect(refs.referenceAreas).toEqual([
    expect.objectContaining({ y1: -400, y2: -200, ifOverflow: 'extendDomain' }),
  ]);
  expect(refs.referenceLines.map((line) => line.y)).toEqual([-400, -200, -300]);
});
it('shows zero targets as a line and tolerance goals as a band', () => {
  expect(goalChartReferences('0', { kind: 'target' })).toMatchObject({
    referenceAreas: [],
    referenceLines: [{ y: 0 }],
  });
  expect(goalChartReferences('0', { kind: 'target', tolerance: '100' }).referenceAreas).toEqual([
    expect.objectContaining({ y1: -100, y2: 100 }),
  ]);
});
it.each(['minimum', 'maximum'] as const)(
  'shades the open-ended desired side of %s goals without inventing an opposite bound',
  (kind) => {
    const refs = goalChartReferences('-300', { kind });
    expect(refs.referenceAreas[0]).toMatchObject(
      kind === 'minimum' ? { y1: -300, y2: undefined } : { y1: undefined, y2: -300 }
    );
    expect(refs.referenceLines.map((line) => line.y)).toEqual([-300]);
  }
);
