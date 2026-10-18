jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: jest.fn(),
    nutrition: {
      editDraft: { useMutation: jest.fn() },
      discardDraft: { useMutation: jest.fn() },
      confirmDraft: { useMutation: jest.fn() },
    },
  },
}));
jest.mock('./DraftItemEditor', () => ({ DraftItemEditor: () => null }));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { entryFixture } from '@/lib/nutrition/test-fixtures';
import type { MealDraft } from '@/lib/nutrition/drafts';
import { MealDraftReview } from './MealDraftReview';
const fixture: MealDraft = {
  id: '00000000-0000-4000-8000-000000000099',
  title: 'Synthetic meal',
  date: '2026-10-18',
  mealCategory: 'LUNCH',
  status: 'DRAFT',
  revision: 4,
  selection: { provider: 'ollama', modelId: 'chat' },
  override: { provider: 'ollama', modelId: 'chat' },
  generating: false,
  questions: [],
  confirmedEntryIds: [],
  turns: [],
  items: [
    {
      id: entryFixture.id,
      query: 'PB',
      quantity: '30',
      unit: 'g',
      snapshot: entryFixture.snapshot,
      input: { quantity: '30', unit: 'G' },
      candidates: [],
      issue: null,
      calculation: {
        unitLabel: 'g',
        resolvedQuantity: '30',
        referenceUnit: 'G',
        estimated: false,
        nutrients: entryFixture.nutrients,
      },
    },
  ],
  unresolved: 0,
  totals: { ...entryFixture.nutrients, knownFiber: '0', fiberIncomplete: true },
};
const confirm = { mutate: jest.fn(), isPending: false, error: null };
const edit = { mutate: jest.fn(), isPending: false, error: null };
const props = {
  onSaved: jest.fn(),
  onClosed: jest.fn(),
  onConfirmed: jest.fn(),
  onNotice: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  (trpc.nutrition.confirmDraft.useMutation as jest.Mock).mockReturnValue(confirm);
  (trpc.nutrition.editDraft.useMutation as jest.Mock).mockReturnValue(edit);
  (trpc.nutrition.discardDraft.useMutation as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
    error: null,
  });
});
it('requires explicit confirmation and acknowledgement of interpretation questions', async () => {
  const user = userEvent.setup();
  render(
    <MealDraftReview draft={{ ...fixture, questions: ['Check the target date.'] }} {...props} />
  );
  const button = screen.getByRole('button', { name: 'Confirm and log meal' });
  expect(confirm.mutate).not.toHaveBeenCalled();
  expect(button).toBeDisabled();
  await user.click(
    screen.getByRole('checkbox', { name: 'I reviewed these questions and the draft is correct' })
  );
  await user.click(button);
  expect(confirm.mutate).toHaveBeenCalledWith({
    id: fixture.id,
    revision: 4,
    acknowledgeQuestions: true,
  });
});
it('blocks confirmation for unresolved foods and keeps manual additions in the draft', async () => {
  const user = userEvent.setup();
  render(
    <MealDraftReview
      draft={{
        ...fixture,
        unresolved: 1,
        items: [
          {
            ...fixture.items[0],
            query: 'Unknown food',
            snapshot: null,
            input: null,
            calculation: null,
            issue: 'Choose a food product.',
          },
        ],
      }}
      {...props}
    />
  );
  expect(screen.getByRole('button', { name: 'Confirm and log meal' })).toBeDisabled();
  expect(screen.getByText('Choose a food product.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add food to draft' }));
  expect(edit.mutate).toHaveBeenCalledWith({
    id: fixture.id,
    revision: 4,
    change: { type: 'add', query: 'New food' },
  });
  expect(confirm.mutate).not.toHaveBeenCalled();
});
it('requires saving a changed date before confirmation', async () => {
  const user = userEvent.setup();
  render(<MealDraftReview draft={fixture} {...props} />);
  const date = screen.getByLabelText('Draft date');
  await user.clear(date);
  await user.type(date, '2026-10-17');
  expect(screen.getByRole('button', { name: 'Confirm and log meal' })).toBeDisabled();
});
it('shows when related-food suggestions have fallen back to text search', () => {
  const notice =
    'Related-food search is unavailable. Showing name, alias, brand and description matches.';
  render(
    <MealDraftReview
      draft={{
        ...fixture,
        unresolved: 1,
        items: [
          {
            ...fixture.items[0],
            snapshot: null,
            input: null,
            calculation: null,
            issue: 'Choose a food product.',
            searchNotice: notice,
          },
        ],
      }}
      {...props}
    />
  );
  expect(screen.getByText(notice)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm and log meal' })).toBeDisabled();
});
