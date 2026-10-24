import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { PlanningResult } from './PlanningResult';

jest.mock('./RecordResult', () => ({ RecordResult: () => <div>Record preview</div> }));
jest.mock('../PlanningProposals/PlanningProposals', () => ({
  ProposalWorkspace: ({ date, initialProposalId, onRevise }: any) => (
    <div>
      <span>
        Saved preview {date} {initialProposalId}
      </span>
      <button type="button" onClick={onRevise}>
        Revise
      </button>
    </div>
  ),
}));
jest.mock('../PlanningProposals/PlanReview', () => ({
  PlanReview: () => <div>Structured review</div>,
}));
const value = {
  date: '2030-01-07',
  proposalId: '00000000-0000-4000-8000-000000000001',
  reply: 'Preview only',
};
it('renders the existing proposal controls with a stable result reference and supports revision', () => {
  const revise = jest.fn();
  render(<PlanningResult value={value} onRevise={revise} />);
  expect(screen.getByText(/Saved preview 2030-01-07/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Revise'));
  expect(revise).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Hide preview'));
  expect(screen.queryByText(/Saved preview/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Review proposal'));
  expect(screen.getByText(/Saved preview/)).toBeInTheDocument();
});
it('ignores malformed model output instead of rendering arbitrary interactive content', () => {
  const { container } = render(
    <PlanningResult value={{ html: '<button>Apply</button>', proposalId: 'foreign' }} />
  );
  expect(container.querySelector('button')).toBeNull();
  expect(screen.queryByText('Apply')).not.toBeInTheDocument();
});

it('keeps the card heading concise while detailed allocation results remain in the proposal', () => {
  render(
    <PlanningResult
      value={{
        ...value,
        summary: 'Planned 216 task minutes across 2 tasks.',
        reply:
          'Planned 216 task minutes across 2 tasks.\nWork on Vela: 60 minutes scheduled.\nSoLocos: 96 minutes scheduled.',
      }}
    />
  );
  expect(
    screen.getByText('2030-01-07 · Planned 216 task minutes across 2 tasks.')
  ).toBeInTheDocument();
  expect(screen.queryByText(/Work on Vela/)).not.toBeInTheDocument();
  expect(screen.getByText(/Saved preview/)).toBeInTheDocument();
});
it('shows the first line for older saved generation results without a separate summary', () => {
  render(
    <PlanningResult value={{ ...value, reply: 'Planned 216 minutes.\nTask allocation details' }} />
  );
  expect(screen.getByText('2030-01-07 · Planned 216 minutes.')).toBeInTheDocument();
  expect(screen.queryByText(/Task allocation details/)).not.toBeInTheDocument();
});

it('restores record preview references and presents ambiguous records as explicit choices', () => {
  const choose = jest.fn();
  render(
    <PlanningResult
      value={{
        date: value.date,
        reply: 'Which task?',
        recordProposalId: value.proposalId,
        matches: [{ id: value.proposalId, label: 'Report' }],
      }}
      conversationId={value.proposalId}
      onChoose={choose}
    />
  );
  expect(screen.getByText('Record preview')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Use this record'));
  expect(choose).toHaveBeenCalledWith(value.proposalId);
});
