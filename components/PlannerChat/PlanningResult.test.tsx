import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { PlanningResult } from './PlanningResult';

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
