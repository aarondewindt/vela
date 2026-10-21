// Render the supplied cells without the table library's persisted layout/measurement hooks.
jest.mock('mantine-datatable', () => ({
  useDataTableColumns: ({ columns }: { columns: unknown[] }) => ({ effectiveColumns: columns }),
  DataTable: ({
    records,
    columns,
  }: {
    records: TaskRow[];
    columns: DataTableColumn<TaskRow>[];
  }) => (
    <table>
      <tbody>
        {records.map((record, index) => (
          <tr key={record.id}>
            {columns.map((column) => (
              <td key={column.accessor}>{column.render?.(record, index)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import type { DataTableColumn } from 'mantine-datatable';
import type { TaskRow } from '@/lib/planner/tasks';
import { TaskGroup } from './TaskGroup';

it('keeps the full title accessible and exposes its tooltip on keyboard focus', async () => {
  const title = 'A very long task title '.repeat(15);
  const task = {
    id: 'task-1',
    title,
    status: 'BACKLOG',
    estimatedMinutes: null,
    dueDate: null,
  } as TaskRow;
  render(
    <TaskGroup
      group={{ key: 'all', label: 'All tasks', rows: [task] }}
      theme={null}
      canAdd={false}
      expanded
      visibleProperties={[]}
      defs={[]}
      themes={[]}
      selectedTaskId={null}
      isFirst
      isLast
      onToggle={jest.fn()}
      onAdd={jest.fn()}
      onSelectTask={jest.fn()}
      onSelectTheme={jest.fn()}
      onMove={jest.fn()}
    />
  );
  const text = await screen.findByText(title.trim());
  expect(text).toHaveAttribute('tabindex', '0');
  expect(text).toHaveAttribute('data-truncate', 'end');
  fireEvent.focus(text);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(title.trim());
});
