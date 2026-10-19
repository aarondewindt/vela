/** @jest-environment node */
import { normalizeMetric, calorieBalance, inspectMetric } from './normalization';
import { goalSchema, mappingSchema, manualMetricSchema } from './schema';
const state = {
  entity_id: 'sensor.health',
  state: '80000',
  attributes: { unit_of_measurement: 'g' },
  last_changed: '2026-01-10T23:30:00Z',
  last_updated: '2026-01-10T23:45:00Z',
};
it('normalizes body metrics and preserves sensor time provenance across local midnight', () => {
  expect(normalizeMetric('WEIGHT', state, 'Europe/Amsterdam')).toMatchObject({
    value: '80.000000',
    date: '2026-01-11',
    timestampBasis: 'sensor_state',
    observedAt: new Date(state.last_changed),
  });
  expect(
    normalizeMetric(
      'LEAN_MASS',
      { ...state, state: '150', attributes: { unit_of_measurement: 'lb' } },
      'UTC'
    )?.value
  ).toBe('68.038855');
});
it('converts sleep and calories and rejects unavailable, invalid units and impossible values', () => {
  expect(
    normalizeMetric(
      'SLEEP',
      { ...state, state: '480', attributes: { unit_of_measurement: 'min' } },
      'UTC'
    )?.value
  ).toBe('8.000000');
  expect(
    normalizeMetric(
      'TOTAL_CALORIES',
      { ...state, state: '4184', attributes: { unit_of_measurement: 'kJ' } },
      'UTC'
    )?.value
  ).toBe('1000.000000');
  for (const value of ['unavailable', 'unknown', '', 'Infinity', 'NaN', '0x12', '-1', '101']) {
    expect(
      normalizeMetric(
        'BODY_FAT',
        { ...state, state: value, attributes: { unit_of_measurement: '%' } },
        'UTC'
      )
    ).toBeNull();
  }
  expect(
    normalizeMetric(
      'TOTAL_CALORIES',
      { ...state, state: '1500', attributes: { unit_of_measurement: 'kcal/day' } },
      'UTC'
    )
  ).toBeNull();
});
it('updates cumulative daily totals under a stable daily identity and uses the sensor update day', () => {
  const original = normalizeMetric(
    'TOTAL_CALORIES',
    { ...state, state: '1200', attributes: { unit_of_measurement: 'kcal' } },
    'UTC'
  )!;
  const corrected = normalizeMetric(
    'TOTAL_CALORIES',
    {
      ...state,
      state: '1100',
      attributes: { unit_of_measurement: 'kcal' },
      last_updated: '2026-01-10T23:50:00Z',
    },
    'UTC'
  )!;
  expect(original.sourceKey).toBe(corrected.sourceKey);
  expect(corrected.observedAt).toEqual(new Date('2026-01-10T23:50:00Z'));
  expect(
    normalizeMetric(
      'TOTAL_CALORIES',
      {
        ...state,
        state: '0',
        attributes: { unit_of_measurement: 'kcal' },
        last_updated: '2026-01-11T00:00:01Z',
      },
      'UTC'
    )?.sourceKey
  ).not.toBe(original.sourceKey);
});
it('keeps equal-valued body readings stable on attribute updates and handles DST dates', () => {
  const before = normalizeMetric('WEIGHT', state, 'UTC');
  expect(
    normalizeMetric('WEIGHT', { ...state, last_updated: '2026-01-11T00:00:00Z' }, 'UTC')?.sourceKey
  ).toBe(before?.sourceKey);
  expect(
    normalizeMetric(
      'SLEEP',
      {
        ...state,
        state: '8',
        attributes: { unit_of_measurement: 'h' },
        last_changed: '2026-03-29T01:30:00Z',
      },
      'Europe/Amsterdam'
    )?.date
  ).toBe('2026-03-29');
});
it('calculates signed balance against an explicit goal without treating missing data as zero', () => {
  expect(calorieBalance(2100, 2500, -300)).toEqual({ balance: -400, differenceFromGoal: -100 });
  expect(calorieBalance(2800, 2500, 200)).toEqual({ balance: 300, differenceFromGoal: 100 });
  expect(calorieBalance(null, 2500, -300)).toEqual({ balance: null, differenceFromGoal: null });
  expect(calorieBalance(0, 0, 0)).toEqual({ balance: 0, differenceFromGoal: 0 });
});
it('accepts maintenance and no goal, and rejects duplicate sensor mappings and invalid manual readings', () => {
  for (const calorieBalance of [null, -300, 0, 200]) {
    expect(goalSchema.safeParse({ version: 0, calorieBalance }).success).toBe(true);
  }
  expect(
    mappingSchema.safeParse([
      { metric: 'WEIGHT', entityId: 'sensor.a' },
      { metric: 'BODY_FAT', entityId: 'sensor.a' },
    ]).success
  ).toBe(false);
  expect(
    manualMetricSchema.safeParse({
      requestId: '5dd42a7f-0e61-4912-b284-14ec6096b248',
      metric: 'SLEEP',
      date: '2026-01-10',
      value: 25,
    }).success
  ).toBe(false);
});

it('explains unavailable, nonnumeric, unsupported, range and timestamp failures', () => {
  const inspect = (changes: Partial<typeof state>) =>
    inspectMetric('WEIGHT', { ...state, ...changes }, 'UTC');
  expect(inspect({ state: 'unavailable' }).issue).toContain('unavailable');
  expect(inspect({ state: 'unknown' }).issue).toContain('unknown');
  expect(inspect({ state: 'none' }).issue).toContain('not a numeric');
  expect(inspect({ attributes: { unit_of_measurement: 'stones' } }).issue).toContain(
    'Expected g, kg, lb or lbs'
  );
  expect(inspect({ state: '-1' }).issue).toContain('outside the accepted range');
  expect(inspect({ last_changed: 'invalid' }).issue).toContain('timestamp');
  expect(inspect({ last_changed: new Date(Date.now() + 600000).toISOString() }).issue).toContain(
    'future'
  );
});
