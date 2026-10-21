jest.mock('@prisma/client/runtime/client', () =>
  jest.requireActual('@prisma/client/runtime/index-browser')
);
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { nutritionGoalProgress, sumNutrition } from '@/lib/nutrition/calculations';
import { DailyNutritionSummary } from './DailyNutritionSummary';

it('shows minimum and maximum success, and range failure with marked progress bars', () => {
  const totals = sumNutrition([
    { calories: '2300', protein: '180', carbohydrates: '250', fat: '50', fiber: null },
  ]);
  const goals = {
    version: 1,
    calories: '2000',
    protein: '160',
    carbohydrates: null,
    fat: '70',
    semantics: {
      calories: { kind: 'range' as const, upperBound: '2200' },
      protein: { kind: 'minimum' as const },
      fat: { kind: 'maximum' as const },
    },
  };
  render(
    <DailyNutritionSummary
      day={{
        date: '2026-01-01',
        entries: [],
        totals,
        goals,
        progress: nutritionGoalProgress(totals, goals),
      }}
    />
  );
  expect(screen.getAllByText('Within goal')).toHaveLength(2);
  expect(screen.getByText('Above goal')).toBeInTheDocument();
  expect(screen.getByText('No goal set')).toBeInTheDocument();
  expect(screen.getByText('At least 160 g')).toBeInTheDocument();
  expect(screen.getByText('At most 70 g')).toBeInTheDocument();
  expect(screen.getByText('2000 to 2200 kcal')).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
});
