jest.mock('@/lib/planner/query', () => ({ useUpdateThemeMutation: () => ({ mutate: jest.fn() }) }));
jest.mock('./ThemeContentEditor', () => ({ ThemeContentEditor: () => null }));
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import type { ThemeRow } from '@/lib/planner/tasks';
import { ThemeView } from './ThemeView';

beforeAll(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() });
});

it('keeps the full default-category label on one line beside its accessible field', () => {
  const theme = {
    id: 'theme-1',
    name: 'Home',
    category: 'LIFE',
    color: null,
    isActive: true,
    brief: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sortOrder: 0,
  } satisfies ThemeRow;
  render(<ThemeView theme={theme} tasks={[]} onClose={jest.fn()} />);
  expect(screen.getByText('Default category')).toHaveStyle({
    whiteSpace: 'nowrap',
    flexShrink: '0',
  });
  expect(screen.getByRole('combobox', { name: 'Default category' })).toHaveValue('Life');
});
