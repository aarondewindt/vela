import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { ReplanningControls } from './ReplanningControls';

const id = '00000000-0000-4000-8000-000000000001';
const context = {
  timezone: 'UTC',
  baseHash: 'a'.repeat(64),
  candidates: [],
  blocks: [
    {
      id,
      title: 'Active work',
      startsAt: '2030-01-07T09:00:00Z',
      status: 'IN_PROGRESS',
      adjustable: true,
    },
  ],
};
it('preselects inspected work, keeps task completion explicit and only creates a preview', async () => {
  const submit = jest.fn();
  render(
    <ReplanningControls
      date="2030-01-07"
      context={context}
      busy={false}
      submit={submit}
      preset={{ action: 'finish', blockId: id }}
    />
  );
  expect(screen.getByRole('combobox', { name: 'Work to adjust' })).toHaveValue(
    'Active work · IN_PROGRESS'
  );
  const complete = screen.getByRole('checkbox', { name: /Also complete the task/ });
  expect(complete).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('Actual finish time'), { target: { value: '09:20' } });
  fireEvent.change(screen.getByLabelText('Reason for replanning'), {
    target: { value: 'Finished this segment' },
  });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Preview remaining day' }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'finish',
      blockId: id,
      endTime: '09:20',
      completeTask: false,
      pullForward: false,
    })
  );
  await userEvent.setup().click(complete);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Preview remaining day' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ completeTask: true }));
});
it('offers deterministic replanning with a visible optional pull-forward preference', async () => {
  const submit = jest.fn();
  render(<ReplanningControls date="2030-01-07" context={context} busy={false} submit={submit} />);
  fireEvent.change(screen.getByLabelText('Reason for replanning'), {
    target: { value: 'Availability changed' },
  });
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('checkbox', { name: 'Bring flexible work forward into free time' })
  );
  await user.click(screen.getByRole('button', { name: 'Preview remaining day' }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'replan',
      blockId: undefined,
      pullForward: true,
      completeTask: false,
    })
  );
});
it('retries unresolved requests with the same ID and allows a fresh preview after success', async () => {
  const submit = jest.fn();
  const first = '00000000-0000-4000-8000-000000000002';
  const second = '00000000-0000-4000-8000-000000000003';
  const uuid = jest
    .spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second);
  const controls = (savedId?: string, busy = false) => (
    <>
      <ReplanningControls
        date="2030-01-07"
        context={context}
        busy={busy}
        submit={submit}
        savedId={savedId}
      />
    </>
  );
  try {
    const view = render(controls('previous'));
    fireEvent.change(screen.getByLabelText('Reason for replanning'), {
      target: { value: 'Availability changed' },
    });
    const user = userEvent.setup();
    const preview = () => user.click(screen.getByRole('button', { name: 'Preview remaining day' }));
    await preview();
    view.rerender(controls(undefined, true));
    view.rerender(controls());
    await preview();
    expect(submit.mock.calls.map(([input]) => input.requestId)).toEqual([first, first]);
    view.rerender(controls('saved'));
    await preview();
    view.rerender(controls(undefined, true));
    view.rerender(controls());
    await preview();
    expect(submit.mock.calls.map(([input]) => input.requestId)).toEqual([
      first,
      first,
      second,
      second,
    ]);
  } finally {
    uuid.mockRestore();
  }
});
