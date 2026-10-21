import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test-utils';
import { TaskView } from './TaskView';
import type { TaskRow, ThemeRow } from '@/lib/planner/tasks';

jest.mock('@/lib/planner/query', () => ({
  useUpdateTaskMutation: jest.fn(),
  useDeleteTaskMutation: jest.fn(),
}));
jest.mock('./TaskRecurrenceProperty', () => ({ TaskRecurrenceProperty: () => null }));
jest.mock('./TaskReview', () => ({ TaskReview: () => null }));
jest.mock('./TaskContentEditor', () => ({ TaskContentEditor: () => null }));
jest.mock('../DataView/properties', () => ({
  DateProperty: () => null,
  NumberProperty: () => null,
  SelectProperty: jest.requireActual('../DataView/properties').SelectProperty,
  TagsProperty: () => null,
  TextProperty: () => null,
}));
import { useDeleteTaskMutation, useUpdateTaskMutation } from '@/lib/planner/query';

const task = {
  id: 'task-1',
  title: 'Buy groceries',
  status: 'BACKLOG',
  priority: 2,
  size: 1,
  category: null,
  themeId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as TaskRow;
const mutate = jest.fn();
const reset = jest.fn();
const onClose = jest.fn();
let mutation: {
  mutate: typeof mutate;
  reset: typeof reset;
  isPending: boolean;
  error: Error | null;
};

beforeEach(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: new EventTarget(),
  });
  jest.clearAllMocks();
  (useUpdateTaskMutation as jest.Mock).mockReturnValue({ mutate: jest.fn() });
  mutation = { mutate, reset, isPending: false, error: null };
  (useDeleteTaskMutation as jest.Mock).mockImplementation(() => mutation);
});

async function openConfirmation() {
  fireEvent.click(screen.getByRole('button', { name: 'Task actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete task…' }));
  return screen.findByRole('dialog', { name: 'Delete task?' });
}

it('requires menu selection and confirmation; cancellation preserves the task', async () => {
  render(<TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />);
  expect(screen.queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument();
  await openConfirmation();
  expect(screen.getByRole('dialog')).toHaveTextContent('Buy groceries');
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutate).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('deletes the confirmed task and closes only on success', async () => {
  render(<TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />);
  await openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  expect(mutate).toHaveBeenCalledWith(
    { id: task.id },
    expect.objectContaining({ onSuccess: expect.any(Function) })
  );
  expect(onClose).not.toHaveBeenCalled();
  act(() => mutate.mock.calls[0][1].onSuccess());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps deletion failures visible and allows a retry', async () => {
  const view = render(<TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />);
  await openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  mutation.error = new Error('Could not delete task');
  view.rerender(
    <>
      <TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />
    </>
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Could not delete task');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  expect(mutate).toHaveBeenCalledTimes(2);
});

it('prevents repeat submission and cancellation while deletion is pending', async () => {
  const view = render(<TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />);
  await openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  mutation.isPending = true;
  view.rerender(
    <>
      <TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />
    </>
  );
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('shows the current theme category while preserving inheritance and explicit overrides', async () => {
  const theme = { id: 'theme-1', name: 'Home', category: 'LIFE' } as ThemeRow;
  const update = jest.fn();
  (useUpdateTaskMutation as jest.Mock).mockReturnValue({ mutate: update });
  const view = render(
    <TaskView
      task={{ ...task, themeId: theme.id }}
      themes={[theme]}
      tagSuggestions={[]}
      onClose={onClose}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
    'Use theme default (Life)'
  );
  expect(update).not.toHaveBeenCalled();
  view.rerender(
    <TaskView
      task={{ ...task, themeId: theme.id }}
      themes={[{ ...theme, category: 'REST' }]}
      tagSuggestions={[]}
      onClose={onClose}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
    'Use theme default (Rest)'
  );
  view.rerender(
    <TaskView
      task={{ ...task, themeId: theme.id, category: 'WORK' }}
      themes={[theme]}
      tagSuggestions={[]}
      onClose={onClose}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Work');
  fireEvent.click(screen.getByRole('combobox', { name: 'Category' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Use theme default (Life)' }));
  expect(update).toHaveBeenCalledWith({ id: task.id, patch: { category: null } });
  view.rerender(<TaskView task={task} themes={[]} tagSuggestions={[]} onClose={onClose} />);
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Use theme default');
});
