import { calorieBalanceGaugeScale as scale, type GaugeScaleInput } from './gauge-scale';

const goal = { goalMin: -500, goalMax: -100, goalPreferred: -200 };
const calculate = (balance: number) => scale({ ...goal, balance })!;

it('centers an asymmetric preferred goal with a 20% band', () => {
  const result = calculate(-200);
  expect(result).toMatchObject({
    min: -1200,
    max: 800,
    span: 2000,
    goalStart: 35,
    target: 50,
  });
  expect(result.goalEnd).toBeCloseTo(55);
});

it.each([-500, -100, -200, 0, -1100, 700])(
  'keeps the default domain for %s, including margin equality',
  (balance) => {
    const result = calculate(balance);
    expect(result.min).toBe(-1200);
    expect(result.span).toBe(2000);
    expect(result.target).toBeCloseTo(((balance + 1200) / 2000) * 100);
  }
);

it.each([
  [701, -1199, 95],
  [1200, -700, 95],
  [1300, -600, 95],
  [-1101, -1201, 5],
  [-1800, -1900, 5],
  [-1900, -2000, 5],
])(
  'translates without expanding for %s, including the last feasible translation',
  (balance, min, target) => {
    expect(calculate(balance)).toMatchObject({ min, span: 2000 });
    expect(calculate(balance).target).toBeCloseTo(target);
  }
);

it.each([-100000, -1901, 1301, 100000])(
  'expands minimally for %s with both margins preserved',
  (balance) => {
    const result = calculate(balance);
    const low = Math.min(goal.goalMin, balance);
    const high = Math.max(goal.goalMax, balance);
    expect(result.span).toBeCloseTo((high - low) / 0.9);
    expect((low - result.min) / result.span).toBeCloseTo(0.05);
    expect((high - result.min) / result.span).toBeCloseTo(0.95);
    expect(result.goalEnd - result.goalStart).toBeLessThan(20);
  }
);

it.each([-500, -100])('supports preferred at a range endpoint (%s)', (goalPreferred) => {
  const result = scale({ ...goal, goalPreferred, balance: goalPreferred })!;
  expect(result.target).toBeCloseTo(50);
  expect(result.goalEnd - result.goalStart).toBeCloseTo(20);
});

it('preserves geometry across sign changes and fractional boundary rounding', () => {
  for (const offset of [-2000, 0, 2000]) {
    for (const balance of [-0.9500000001, -0.95, 0.85, 0.8500000001, 100]) {
      const result = scale({
        goalMin: offset - 0.3,
        goalMax: offset + 0.1,
        goalPreferred: offset,
        balance: offset + balance,
      })!;
      for (const position of [result.goalStart, result.goalEnd, result.target]) {
        expect(position).toBeGreaterThanOrEqual(5);
        expect(position).toBeLessThanOrEqual(95);
      }
      expect(result.span).toBeGreaterThanOrEqual(2 - 1e-12);
    }
  }
});

it.each([
  { goalMin: null },
  { goalMax: null },
  { goalPreferred: null },
  { balance: null },
  { goalMin: NaN },
  { goalMax: Infinity },
  { goalPreferred: -Infinity },
  { balance: NaN },
  { goalMin: -100 },
  { goalMin: 0 },
  { goalPreferred: -501 },
  { goalPreferred: -99 },
  { goalMin: -Number.MAX_VALUE, goalMax: Number.MAX_VALUE },
])('rejects unavailable, invalid, degenerate or overflowing inputs: %j', (override) => {
  expect(scale({ ...goal, balance: 0, ...override } as GaugeScaleInput)).toBeNull();
});
