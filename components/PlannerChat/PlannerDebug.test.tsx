import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test-utils';
import { PlannerDebug } from './PlannerDebug';
const debug = {
  omittedEvents: 1,
  events: [
    {
      id: '1',
      at: '2030-01-07T10:00:00Z',
      elapsedMs: 1200,
      kind: 'tool-input',
      label: 'Call generateDayPlan',
      details: '{"guidance":"Work on Vela for an hour"}',
    },
    {
      id: '2',
      at: '2030-01-07T10:00:01Z',
      elapsedMs: 2200,
      kind: 'tool-error',
      label: 'Tool failed',
      details: 'Scheduler model unavailable',
    },
  ],
};
it('offers a collapsed per-response inspector with tool arguments, failures and elapsed time', async () => {
  render(<PlannerDebug value={debug} />);
  const button = screen.getByRole('button', { name: 'Planner debug · 2 events' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(screen.getByText(/Work on Vela for an hour/)).toBeVisible());
  expect(screen.getByText('Scheduler model unavailable')).toBeVisible();
  expect(screen.getByText('+1.2s')).toBeInTheDocument();
  expect(screen.getByText(/1 earlier events omitted/)).toBeVisible();
});
it('renders diagnostics as text and ignores malformed results', async () => {
  render(
    <PlannerDebug
      value={{
        ...debug,
        events: [{ ...debug.events[0], details: '<img src=x onerror=alert(1)>' }],
      }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Planner debug/ }));
  await waitFor(() => expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible());
  expect(document.querySelector('img')).toBeNull();
});
