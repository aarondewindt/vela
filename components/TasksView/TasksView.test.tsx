jest.mock('@/lib/trpc/client', () => ({
  trpc: { taskSearch: { related: { useQuery: jest.fn() } } },
}));
jest.mock('@/lib/planner/query', () => ({
  useTasksQuery: jest.fn(),
  useThemesQuery: () => ({ data: [] }),
  useViewsQuery: () => ({ data: [] }),
  useCreateTaskMutation: () => ({}),
  useCreateThemeMutation: () => ({}),
  useReorderThemesMutation: () => ({}),
  useCreateViewMutation: () => ({}),
  useUpdateViewMutation: () => ({}),
  useDeleteViewMutation: () => ({}),
}));
jest.mock('../DataView/ViewToolbar', () => ({ ViewToolbar: () => null }));
jest.mock('./TaskView', () => ({ TaskView: () => null }));
jest.mock('./ThemeView', () => ({ ThemeView: () => null }));
jest.mock('./TaskGroup', () => ({
  TaskGroup: ({ group }: { group: { rows: { id: string; title: string }[] } }) => (
    <div>
      {group.rows.map((task) => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  ),
}));
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { useTasksQuery } from '@/lib/planner/query';
import { useTasksViewStore } from '@/store/tasks_view_store';
import { TasksView } from './TasksView';

beforeEach(() => {
  jest.clearAllMocks();
  useTasksViewStore.setState({
    search: 'housework',
    activeViewId: 'builtin:all',
    draft: null,
    selection: null,
  });
  (useTasksQuery as jest.Mock).mockReturnValue({
    data: [
      { id: 'text', title: 'Housework list', status: 'BACKLOG', tags: [], themeId: null },
      { id: 'related', title: 'Clean the kitchen', status: 'BACKLOG', tags: [], themeId: null },
      {
        id: 'archived',
        title: 'Vacuum old apartment',
        status: 'ARCHIVED',
        tags: [],
        themeId: null,
      },
    ],
  });
  (trpc.taskSearch.related.useQuery as jest.Mock).mockReturnValue({
    data: { ids: ['related', 'archived'], notice: null },
  });
});
it('includes semantic matches by default while preserving view filters and opting out', async () => {
  render(<TasksView />);
  expect(trpc.taskSearch.related.useQuery).toHaveBeenLastCalledWith(
    { query: 'housework', limit: 50 },
    expect.objectContaining({ enabled: true })
  );
  expect(screen.getByText('Housework list')).toBeInTheDocument();
  expect(screen.getByText('Clean the kitchen')).toBeInTheDocument();
  expect(screen.queryByText('Vacuum old apartment')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('switch', { name: 'Include related tasks' }));
  expect(screen.queryByText('Clean the kitchen')).not.toBeInTheDocument();
  expect(screen.getByText('Housework list')).toBeInTheDocument();
});
it('keeps text matches on model failures and avoids stale query results or empty-query inference', () => {
  const related = trpc.taskSearch.related.useQuery as jest.Mock;
  related.mockReturnValue({
    data: { ids: [], notice: 'Semantic search is unavailable. Showing text matches.' },
  });
  render(<TasksView />);
  expect(screen.getByRole('alert')).toHaveTextContent('Showing text matches');
  expect(screen.getByText('Housework list')).toBeInTheDocument();
  related.mockReturnValue({ data: { ids: ['related'], notice: null } });
  act(() => useTasksViewStore.setState({ search: 'unmatched new query' }));
  expect(screen.queryByText('Clean the kitchen')).not.toBeInTheDocument();
  act(() => useTasksViewStore.setState({ search: '' }));
  expect(related).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ enabled: false })
  );
});
