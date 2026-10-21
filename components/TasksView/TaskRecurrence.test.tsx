import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import type { TaskRow } from '@/lib/planner/tasks';
import { useUpdateTaskMutation } from '@/lib/planner/query';
import { trpc } from '@/lib/trpc/client';
import { TaskRecurrence } from './TaskRecurrence';

jest.mock('@/lib/trpc/client', () => ({
  trpc: { settings: { getPreferences: { useQuery: jest.fn() } } },
}));
jest.mock('@/lib/planner/query', () => ({ useUpdateTaskMutation: jest.fn() }));
const mutate = jest.fn();
const task = {
  id: 'task',
  createdAt: new Date('2026-01-01T23:00:00Z'),
  recurrenceAnchorDate: null,
  isRecurring: true,
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  recurrenceTz: 'Europe/Amsterdam',
} as TaskRow;
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.settings.getPreferences.useQuery as jest.Mock).mockReturnValue({
    data: { timezone: 'Pacific/Auckland' },
  });
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
        recurrenceAnchorDate: '2026-01-01',
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
        recurrenceAnchorDate: '2026-01-01',
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

it('defaults an unset timezone to the user preference without saving until requested', () => {
  render(<TaskRecurrence task={{ ...task, recurrenceTz: null }} />);
  expect(screen.getByRole('textbox', { name: 'Recurrence timezone' })).toHaveValue(
    'Pacific/Auckland'
  );
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      patch: {
        recurrence: {
          isRecurring: true,
          recurrenceAnchorDate: '2026-01-01',
          recurrenceRule: task.recurrenceRule,
          recurrenceTz: 'Pacific/Auckland',
        },
      },
    })
  );
});
it('uses a preference loaded later without overwriting an explicit edit or clear', () => {
  const query = trpc.settings.getPreferences.useQuery as jest.Mock;
  query.mockReturnValue({ isPending: true });
  const view = render(<TaskRecurrence task={{ ...task, recurrenceTz: null }} />);
  expect(screen.getByRole('button', { name: 'Save recurrence' })).toBeDisabled();
  query.mockReturnValue({ data: { timezone: 'Pacific/Auckland' } });
  view.rerender(<TaskRecurrence task={{ ...task, recurrenceTz: null }} />);
  const input = screen.getByRole('textbox', { name: 'Recurrence timezone' });
  expect(input).toHaveValue('Pacific/Auckland');
  fireEvent.change(input, { target: { value: 'America/New_York' } });
  query.mockReturnValue({ data: { timezone: 'Europe/London' } });
  view.rerender(<TaskRecurrence task={{ ...task, recurrenceTz: null }} />);
  expect(input).toHaveValue('America/New_York');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      patch: {
        recurrence: {
          recurrenceAnchorDate: '2026-01-01',
          isRecurring: true,
          recurrenceRule: task.recurrenceRule,
          recurrenceTz: null,
        },
      },
    })
  );
});
it('lets a manual timezone survive preference loading and provides a retry on failure', () => {
  const query = trpc.settings.getPreferences.useQuery as jest.Mock;
  const refetch = jest.fn();
  query.mockReturnValue({ error: new Error('Could not load settings'), refetch });
  render(<TaskRecurrence task={{ ...task, recurrenceTz: null }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load settings');
  fireEvent.click(screen.getByRole('button', { name: 'Retry timezone' }));
  expect(refetch).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('textbox', { name: 'Recurrence timezone' }), {
    target: { value: 'UTC' },
  });
  expect(screen.getByRole('button', { name: 'Save recurrence' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      patch: {
        recurrence: {
          recurrenceAnchorDate: '2026-01-01',
          isRecurring: true,
          recurrenceRule: task.recurrenceRule,
          recurrenceTz: 'UTC',
        },
      },
    })
  );
});

it('shows and edits an explicit anchor independently of task creation and can restore the fallback', () => {
  render(<TaskRecurrence task={{ ...task, recurrenceAnchorDate: new Date('2026-02-02') }} />);
  const anchor = screen.getByLabelText('Recurrence anchor date');
  expect(anchor).toHaveValue('2026-02-02');
  fireEvent.change(anchor, { target: { value: '2026-03-03' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenLastCalledWith({
    id: task.id,
    patch: {
      recurrence: {
        isRecurring: true,
        recurrenceRule: task.recurrenceRule,
        recurrenceTz: task.recurrenceTz,
        recurrenceAnchorDate: '2026-03-03',
      },
    },
  });
  fireEvent.change(anchor, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate).toHaveBeenLastCalledWith({
    id: task.id,
    patch: {
      recurrence: {
        isRecurring: true,
        recurrenceRule: task.recurrenceRule,
        recurrenceTz: task.recurrenceTz,
        recurrenceAnchorDate: null,
      },
    },
  });
});
