/** @jest-environment node */
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
import { redirect } from 'next/navigation';
import NutritionSettingsPage from './page';
it.each([
  [undefined, '/settings/nutrition'],
  ['2026-10-21', '/settings/nutrition?date=2026-10-21'],
  ['invalid', '/settings/nutrition'],
  ['2026-02-30', '/settings/nutrition'],
])(
  'redirects old goals links while preserving valid diary dates (%s)',
  async (date, destination) => {
    await NutritionSettingsPage({ searchParams: Promise.resolve({ date }) });
    expect(redirect).toHaveBeenLastCalledWith(destination);
  }
);
