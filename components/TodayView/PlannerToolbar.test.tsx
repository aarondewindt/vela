import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { render } from '@/test-utils';
import { PlannerToolbar } from './PlannerToolbar';

jest.mock('./DraftReview', () => ({
  DraftReview: () => <button type="button">Review schedule</button>,
}));

function renderToolbar(
  hasDraft = false,
  patch: Partial<ComponentProps<typeof PlannerToolbar>> = {}
) {
  const props: ComponentProps<typeof PlannerToolbar> = {
    date: '2030-01-07',
    hasDraft,
    canUndo: hasDraft,
    canRedo: false,
    busy: false,
    generating: false,
    accepting: false,
    onAddTask: jest.fn(),
    onGenerate: jest.fn(),
    onAutoFill: jest.fn(),
    onRebuild: jest.fn(),
    onAccept: jest.fn(),
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onCancel: jest.fn(),
    ...patch,
  };
  render(<PlannerToolbar {...props} />);
  return props;
}

it('shows one primary generation action and no draft controls without a draft', () => {
  const props = renderToolbar();
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  expect(props.onGenerate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Review schedule' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Accept draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel draft' })).not.toBeInTheDocument();
});

it('shows the complete draft lifecycle and disables unavailable history actions', () => {
  renderToolbar(true);
  expect(screen.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Accept draft' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel draft' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
});

it('keeps deterministic fill, explicit rebuild and settings discoverable in one menu', async () => {
  const user = userEvent.setup();
  const props = renderToolbar(true);
  await user.click(screen.getByRole('button', { name: 'More planning actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Auto-fill without AI' }));
  expect(props.onAutoFill).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole('button', { name: 'More planning actions' }));
  expect(screen.getByRole('menuitem', { name: 'Planning settings' })).toHaveAttribute(
    'href',
    '/settings/planner'
  );
  await user.click(screen.getByRole('menuitem', { name: 'Rebuild future schedule…' }));
  expect(props.onRebuild).toHaveBeenCalledTimes(1);
});
