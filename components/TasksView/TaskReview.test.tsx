import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { TaskReview } from './TaskReview';

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      taskReviews: { latest: { invalidate: jest.fn() } },
      planner: { listTasks: { invalidate: jest.fn() }, getDayData: { invalidate: jest.fn() } },
    }),
    taskReviews: {
      latest: { useQuery: jest.fn() },
      generate: { useMutation: jest.fn() },
      accept: { useMutation: jest.fn() },
    },
  },
}));
import { trpc } from '@/lib/trpc/client';
const generate = jest.fn();
const accept = jest.fn();
const document = {
  summary: 'Needs a defined outcome.',
  recordedFacts: ['Backlog task.'],
  inferredContext: ['Scope unclear.'],
  missingInformation: ['Completion criteria.'],
  nextSteps: ['Define done.'],
  blockers: [],
  priority: { value: 2, explanation: 'Upcoming deadline.' },
  size: { value: null, explanation: 'Unknown scope.' },
  estimatedMinutes: { value: 60, explanation: 'Provisional total estimate.' },
  firstStep: { value: 'Draft criteria.', explanation: 'Clarify scope.' },
  focus: { value: 2, explanation: 'Scope needs clarification.' },
  dueDateRisk: { value: 'unknown', explanation: 'Insufficient information.' },
};
let review: Record<string, unknown> | null;
beforeEach(() => {
  jest.clearAllMocks();
  review = {
    id: 'review',
    document,
    modelId: 'model',
    createdAt: new Date(),
    acceptedAt: null,
    acceptedFields: [],
    outdated: false,
  };
  (trpc.taskReviews.latest.useQuery as jest.Mock).mockImplementation(() => ({ data: review }));
  (trpc.taskReviews.generate.useMutation as jest.Mock).mockReturnValue({ mutate: generate });
  (trpc.taskReviews.accept.useMutation as jest.Mock).mockReturnValue({ mutate: accept });
});
it('distinguishes evidence and interpretations and applies only explicit selections', () => {
  render(<TaskReview taskId="task" />);
  expect(screen.getByText('Recorded facts')).toBeInTheDocument();
  expect(screen.getByText('Inferred context')).toBeInTheDocument();
  expect(screen.getByText('Missing information')).toBeInTheDocument();
  expect(screen.getByText('Focus: 2/5')).toBeInTheDocument();
  expect(screen.getByText('Focus scale')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply selected suggestions' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Size: Unknown' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Priority: P2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
  expect(accept).toHaveBeenCalledWith({ id: 'review', fields: ['priority'] });
});
it('allows regeneration but blocks applying outdated reviews', () => {
  review!.outdated = true;
  render(<TaskReview taskId="task" />);
  expect(screen.getByText(/Outdated review/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Priority: P2' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate task review' }));
  expect(generate).toHaveBeenCalledWith({ taskId: 'task' });
  expect(accept).not.toHaveBeenCalled();
});
it('starts without a review and displays generation failures', () => {
  review = null;
  (trpc.taskReviews.generate.useMutation as jest.Mock).mockReturnValue({
    mutate: generate,
    error: new Error('Model unavailable'),
  });
  render(<TaskReview taskId="task" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review task' }));
  expect(generate).toHaveBeenCalledWith({ taskId: 'task' });
  expect(screen.getByRole('alert')).toHaveTextContent('Model unavailable');
});

it('shows readable Theme, Category, Brief and Tags suggestions and submits only selected changes', () => {
  const themeId = '00000000-0000-4000-8000-000000000003';
  review!.document = {
    ...document,
    themeId: { value: themeId, explanation: 'Project matches.' },
    category: { value: 'LIFE', explanation: 'Personal project.' },
    brief: { value: 'Prepare the report.', explanation: 'Recorded outcome.' },
    tags: { value: ['writing', 'review'], explanation: 'Task topics.' },
  };
  render(<TaskReview taskId="task" themes={[{ id: themeId, name: 'Reports' }]} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Theme: Reports' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Category: Life' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Brief: Prepare the report.' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tags: writing, review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected suggestions' }));
  expect(accept).toHaveBeenCalledWith({
    id: 'review',
    fields: ['themeId', 'category', 'brief', 'tags'],
  });
});
it('labels clear and inherit suggestions explicitly', () => {
  review!.document = {
    ...document,
    themeId: { value: 'NONE', explanation: 'No theme needed.' },
    category: { value: 'INHERIT', explanation: 'Inherit category.' },
    brief: { value: '', explanation: 'Clear stale brief.' },
    tags: { value: [], explanation: 'Clear stale tags.' },
  };
  render(<TaskReview taskId="task" />);
  for (const name of [
    'Theme: No theme',
    'Category: Use theme default',
    'Brief: Clear brief',
    'Tags: No tags',
  ]) {
    expect(screen.getByRole('checkbox', { name })).toBeEnabled();
  }
});
