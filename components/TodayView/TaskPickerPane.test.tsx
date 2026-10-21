jest.mock('@/lib/trpc/client', () => ({
  trpc: { taskSearch: { retrieve: { useQuery: jest.fn() } } },
}));
jest.mock('../TasksView/TaskCard', () => ({
  TaskCard: ({ task }: { task: { title: string } }) => <span>{task.title}</span>,
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import type { TaskRow } from '@/lib/planner/tasks';
import { TaskPickerPane } from './TaskPickerPane';

const tasks = [
  {
    id: 'one',
    title: 'Clean desk',
    brief: 'tidy',
    tags: ['home'],
    priority: 3,
    size: 2,
    updatedAt: new Date('2030-01-01'),
  },
  {
    id: 'two',
    title: 'Prepare slides',
    tags: [],
    priority: 3,
    size: 2,
    updatedAt: new Date('2030-01-01'),
  },
] as TaskRow[];
const state = {
  data: undefined as { ids: string[]; warnings: string[] } | undefined,
  isFetching: false,
  isError: false,
  refetch: jest.fn(),
};
function setup() {
  render(
    <TaskPickerPane
      tasks={tasks}
      themes={[]}
      date="2030-01-07"
      removeActive={false}
      onTaskDragStart={jest.fn()}
      onTaskDragEnd={jest.fn()}
      onRemoveDrop={jest.fn()}
      onOpenTask={jest.fn()}
    />
  );
  return userEvent.setup();
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(state, { data: undefined, isFetching: false, isError: false });
  (trpc.taskSearch.retrieve.useQuery as jest.Mock).mockReturnValue(state);
});
it('shows semantic matches and an explicit indexing notice after debounce', async () => {
  state.data = { ids: ['two'], warnings: ['Index has pending tasks.'] };
  const user = setup();
  await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'presentation');
  await waitFor(() => expect(screen.getByText('Prepare slides')).toBeInTheDocument());
  expect(screen.getByText('Index has pending tasks.')).toBeInTheDocument();
  expect(screen.queryByText('Clean desk')).not.toBeInTheDocument();
  expect(trpc.taskSearch.retrieve.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ query: 'presentation', semantic: true }),
    expect.anything()
  );
});
it('keeps conventional tag matching and retry available on failure', async () => {
  state.isError = true;
  const user = setup();
  await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'home');
  expect(screen.getByText('Clean desk')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry search' }));
  expect(state.refetch).toHaveBeenCalled();
  await user.click(screen.getByRole('switch', { name: 'Search by meaning too' }));
  expect(trpc.taskSearch.retrieve.useQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ semantic: false }),
    expect.anything()
  );
});
it('reports loading and empty results clearly', async () => {
  state.isFetching = true;
  const user = setup();
  await user.type(screen.getByRole('textbox', { name: 'Search tasks' }), 'unknown');
  expect(screen.getByText('Searching tasks…')).toBeInTheDocument();
  expect(screen.getByText('No matching eligible tasks.')).toBeInTheDocument();
});
