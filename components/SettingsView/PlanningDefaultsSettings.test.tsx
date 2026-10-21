jest.mock('@/lib/planner/query', () => ({
  useGeneratorSettingsQuery: jest.fn(),
  useSaveGeneratorSettingsMutation: jest.fn(),
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { useGeneratorSettingsQuery, useSaveGeneratorSettingsMutation } from '@/lib/planner/query';
import { DEFAULT_GENERATOR_OPTIONS } from '@/lib/planner/scheduling';
import { PlanningDefaultsSettings } from './PlanningDefaultsSettings';
const mutate = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (useGeneratorSettingsQuery as jest.Mock).mockReturnValue({
    data: { ...DEFAULT_GENERATOR_OPTIONS, workSessionMinutes: 90 },
  });
  (useSaveGeneratorSettingsMutation as jest.Mock).mockReturnValue({ mutate });
});
it('loads saved defaults, keeps invalid minute steps from saving, and uses the existing mutation', async () => {
  const user = userEvent.setup();
  render(<PlanningDefaultsSettings />);
  const work = screen.getByRole('textbox', { name: 'Work session target' });
  expect(work).toHaveValue('90 min');
  await user.clear(work);
  await user.type(work, '91');
  expect(screen.getByRole('button', { name: 'Save as default' })).toBeDisabled();
  expect(mutate).not.toHaveBeenCalled();
  await user.clear(work);
  await user.type(work, '120');
  await user.click(screen.getByRole('button', { name: 'Save as default' }));
  expect(mutate).toHaveBeenCalledWith({ ...DEFAULT_GENERATOR_OPTIONS, workSessionMinutes: 120 });
});
