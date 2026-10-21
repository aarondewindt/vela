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
  'redirects legacy goal links and retains only valid return dates: %s',
  async (date, expected) => {
    await NutritionSettingsPage({ searchParams: Promise.resolve({ date }) });
    expect(redirect).toHaveBeenLastCalledWith(expected);
  }
);
