jest.mock('./ProductEditor', () => ({
  ProductEditor: ({ initialComponents }: { initialComponents: unknown }) => (
    <div data-testid="ingredients">{JSON.stringify(initialComponents)}</div>
  ),
}));
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { entryFixture } from '@/lib/nutrition/test-fixtures';
import { RecipeFromMealDialog } from './RecipeFromMealDialog';

it('requires selection and transfers only checked foods with logged quantities and serving IDs', async () => {
  const user = userEvent.setup();
  render(
    <RecipeFromMealDialog
      entries={[
        { ...entryFixture, unit: 'SERVING', quantity: '2', servingId: 'serving-id' },
        { ...entryFixture, id: 'other', productName: 'Other food' },
        { ...entryFixture, id: 'deleted', productId: null, productName: 'Deleted food' },
      ]}
      onClose={jest.fn()}
      onSaved={jest.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Review recipe' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /Deleted food/ })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /Peanut butter/ }));
  await user.click(screen.getByRole('button', { name: 'Review recipe' }));
  expect(JSON.parse(screen.getByTestId('ingredients').textContent!)).toEqual([
    {
      childProductId: entryFixture.productId,
      quantity: '2',
      unit: 'SERVING',
      servingId: 'serving-id',
    },
  ]);
});
