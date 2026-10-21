import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import type { TaskRow } from '@/lib/planner/tasks';
import { useUpdateTaskMutation } from '@/lib/planner/query';
import { TaskRecurrence } from './TaskRecurrence';

jest.mock('@/lib/planner/query', () => ({ useUpdateTaskMutation: jest.fn() }));
const mutate = jest.fn();
const task = {
  id: 'task',
  isRecurring: true,
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  recurrenceTz: 'Europe/Amsterdam',
} as TaskRow;
beforeEach(() => {
  jest.clearAllMocks();
  (useUpdateTaskMutation as jest.Mock).mockReturnValue({ mutate });
});
it('shows existing settings, validates and saves all recurrence fields together', () => {
  render(<TaskRecurrence task={task} />);
  expect(screen.getByRole('switch', { name: 'Recurring task' })).toBeChecked();
  const rule = screen.getByRole('textbox', { name: 'Recurrence rule' });
  expect(rule).toHaveValue(task.recurrenceRule);
  expect(screen.getByRole('textbox', { name: 'Recurrence timezone' })).toHaveValue(
    task.recurrenceTz
  );
  fireEvent.change(rule, { target: { value: 'FREQ=DAILY;COUNT=2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Use FREQ=DAILY');
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(rule, { target: { value: 'FREQ=DAILY;INTERVAL=2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenCalledWith({
    id: task.id,
    patch: {
      recurrence: {
        isRecurring: true,
        recurrenceRule: 'FREQ=DAILY;INTERVAL=2',
        recurrenceTz: 'Europe/Amsterdam',
      },
    },
  });
});
it('can disable recurrence while preserving the rule and shows mutation errors', () => {
  (useUpdateTaskMutation as jest.Mock).mockReturnValue({ mutate, error: new Error('Save failed') });
  render(<TaskRecurrence task={task} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Recurring task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenCalledWith({
    id: task.id,
    patch: {
      recurrence: {
        isRecurring: false,
        recurrenceRule: task.recurrenceRule,
        recurrenceTz: task.recurrenceTz,
      },
    },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
});
it('prevents editing or resubmission while saving', () => {
  (useUpdateTaskMutation as jest.Mock).mockReturnValue({ mutate, isPending: true });
  render(<TaskRecurrence task={task} />);
  expect(screen.getByRole('textbox', { name: 'Recurrence rule' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Recurring task' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).not.toHaveBeenCalled();
});
