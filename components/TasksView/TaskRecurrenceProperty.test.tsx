import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test-utils';
import type { TaskRow } from '@/lib/planner/tasks';
import { useUpdateTaskMutation } from '@/lib/planner/query';
import { TaskRecurrenceProperty } from './TaskRecurrenceProperty';

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    settings: { getPreferences: { useQuery: () => ({ data: { timezone: 'Europe/Amsterdam' } }) } },
  },
}));
jest.mock('@/lib/planner/query', () => ({ useUpdateTaskMutation: jest.fn() }));
const task = {
  id: 'task-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  isRecurring: true,
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE',
  recurrenceTz: 'Europe/Amsterdam',
} as TaskRow;
const mutate = jest.fn();
let mutation: { mutate: typeof mutate; isPending: boolean; error: Error | null };
beforeEach(() => {
  jest.clearAllMocks();
  mutation = { mutate, isPending: false, error: null };
  (useUpdateTaskMutation as jest.Mock).mockImplementation(() => mutation);
});

it('shows only a short saved summary and opens the settings on request', async () => {
  render(<TaskRecurrenceProperty task={task} />);
  expect(screen.getByText('Weekly · Mon, Wed')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Recurrence rule' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit recurrence' }));
  expect(await screen.findByRole('dialog', { name: 'Recurrence settings' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Recurrence rule' })).toHaveValue(task.recurrenceRule);
  expect(mutate).not.toHaveBeenCalled();
});

it('leaves disabled recurrence blank, discards canceled edits and can enable it', async () => {
  render(<TaskRecurrenceProperty task={{ ...task, isRecurring: false }} />);
  expect(screen.queryByText('Weekly · Mon, Wed')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit recurrence' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Recurring task' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Recurrence rule' }), {
    target: { value: 'FREQ=DAILY' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit recurrence' }));
  expect(screen.getByRole('switch', { name: 'Recurring task' })).not.toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Recurrence rule' })).toHaveValue(task.recurrenceRule);
  fireEvent.click(screen.getByRole('switch', { name: 'Recurring task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate.mock.calls[0][0].patch.recurrence.isRecurring).toBe(true);
});

it('keeps failures open and locks cancellation during save, closing only on success', async () => {
  const view = render(<TaskRecurrenceProperty task={task} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit recurrence' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Recurring task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  expect(mutate.mock.calls[0][0].patch.recurrence.isRecurring).toBe(false);
  mutation.isPending = true;
  view.rerender(
    <>
      <TaskRecurrenceProperty task={task} />
    </>
  );
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  mutation.isPending = false;
  mutation.error = new Error('Could not save recurrence');
  view.rerender(
    <>
      <TaskRecurrenceProperty task={task} />
    </>
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save recurrence');
  fireEvent.click(screen.getByRole('button', { name: 'Save recurrence' }));
  // The task list can refresh before the mutation's completion callback runs.
  view.rerender(
    <>
      <TaskRecurrenceProperty
        task={{ ...task, updatedAt: new Date('2026-01-02'), isRecurring: false }}
      />
    </>
  );
  act(() => mutate.mock.calls[1][1].onSuccess());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Weekly · Mon, Wed')).not.toBeInTheDocument();
});
