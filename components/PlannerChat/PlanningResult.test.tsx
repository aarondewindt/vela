import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { PlanningResult } from './PlanningResult';
jest.mock('./RecordResult', () => ({ RecordResult: () => <div>Record preview</div> }));
const id = '00000000-0000-4000-8000-000000000001';
it('does not restore obsolete interactive scheduling cards or verbose generation reports', () => {
  const { container } = render(
    <PlanningResult
      value={{
        date: '2030-01-07',
        proposalId: id,
        reply: 'A long allocation report',
        summary: 'Scheduled 200 minutes',
      }}
    />
  );
  expect(container.querySelector('button')).toBeNull();
  expect(
    screen.queryByText(/200 minutes|allocation report|Accept|Apply|Revise/)
  ).not.toBeInTheDocument();
});
it('ignores malformed model output', () => {
  const { container } = render(
    <PlanningResult value={{ html: '<button>Apply</button>', proposalId: 'foreign' }} />
  );
  expect(container.querySelector('button')).toBeNull();
});
it('preserves inventory record approval and ambiguity choices', () => {
  const choose = jest.fn();
  render(
    <PlanningResult
      value={{
        date: '2030-01-07',
        reply: 'Which task?',
        recordProposalId: id,
        matches: [{ id, label: 'Report' }],
      }}
      conversationId={id}
      onChoose={choose}
    />
  );
  expect(screen.getByText('Record preview')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Report' }));
  expect(choose).toHaveBeenCalledWith(id);
});
