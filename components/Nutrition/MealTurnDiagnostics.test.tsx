import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { MealTurnDiagnostics } from './MealTurnDiagnostics';
const turn = {
  id: 'message',
  userText: 'Bread',
  assistantText: null,
  status: 'FAILED' as const,
  error: 'Interpretation failed',
  provider: 'ollama',
  modelId: 'qwen3:8b',
  diagnostics: { rawResponse: '{bad json', errors: [{ name: 'Error', message: 'Invalid JSON' }] },
};
it('shows saved raw output and errors only when expanded', async () => {
  const user = userEvent.setup();
  render(<MealTurnDiagnostics turn={turn} />);
  expect(screen.queryByText(/bad json/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show debug details' }));
  expect(screen.getByText(/bad json/)).toHaveTextContent('Invalid JSON');
  expect(screen.getByRole('button', { name: 'Hide debug details' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await user.click(screen.getByRole('button', { name: 'Hide debug details' }));
  expect(screen.queryByText(/bad json/)).not.toBeInTheDocument();
});
it('explains missing diagnostics for older or interrupted attempts', async () => {
  const user = userEvent.setup();
  render(<MealTurnDiagnostics turn={{ ...turn, diagnostics: null }} />);
  await user.click(screen.getByRole('button', { name: 'Show debug details' }));
  expect(screen.getByText(/No model diagnostics were captured/)).toBeInTheDocument();
  expect(screen.getByText(/Interpretation failed/)).toBeInTheDocument();
});
