import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { RecordReview } from './RecordReview';

const preview = {
  entity: 'task' as const,
  action: 'delete' as const,
  id: 'id',
  baseHash: 'hash',
  before: { title: 'Report', status: 'BACKLOG' },
  patch: {},
  warnings: ['Deleting occurrences cannot be undone.'],
};

it('requires explicit confirmation before deleting an inventory record', async () => {
  const user = userEvent.setup();
  const accept = jest.fn();
  render(<RecordReview preview={preview} accepted={false} active busy={false} accept={accept} />);
  expect(screen.getByText('delete task: Report')).toBeVisible();
  expect(screen.getByText(preview.warnings[0])).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(accept).toHaveBeenCalledWith(true);
});

it('keeps record previews read-only after they are superseded', () => {
  render(
    <RecordReview
      preview={{ ...preview, action: 'update', patch: { title: 'Revised report' } }}
      accepted={false}
      active={false}
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByText('Title: Report → Revised report')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('shows acceptance receipts instead of another acceptance action', () => {
  render(
    <RecordReview
      preview={{ ...preview, action: 'create', before: null, patch: { title: 'Report' } }}
      accepted
      active={false}
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Changes accepted.');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('uses readable field labels and resolved relationship names', () => {
  render(
    <RecordReview
      preview={{
        ...preview,
        action: 'update',
        before: { title: 'Report', themeId: null },
        patch: { themeId: 'theme-id', estimatedMinutes: 45 },
        references: { 'theme-id': 'Home projects' },
      }}
      accepted={false}
      active
      busy={false}
      accept={jest.fn()}
    />
  );
  expect(screen.getByText('Theme: Clear / inherit → Home projects')).toBeVisible();
  expect(screen.getByText('Estimate (minutes): Clear / inherit → 45')).toBeVisible();
});
