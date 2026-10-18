jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    nutrition: {
      previewNevoImport: { useMutation: jest.fn() },
      applyNevoImport: { useMutation: jest.fn() },
    },
  },
}));
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import { trpc } from '@/lib/trpc/client';
import { NevoImporter } from './NevoImporter';
const summary = {
  version: 'NEVO-Online 2025 9.0',
  total: 1,
  create: 1,
  update: 0,
  unchanged: 0,
  protectedEdits: 0,
  conversionConflicts: 0,
  retained: 0,
  archived: 0,
  skipped: [],
  planHash: 'a'.repeat(64),
  samples: [
    {
      code: '1',
      name: 'Potatoes raw',
      dutchName: 'Aardappelen rauw',
      calories: '88',
      referenceUnit: 'G',
    },
  ],
};
const preview = { mutateAsync: jest.fn(), reset: jest.fn(), isPending: false, error: null };
const apply = { mutateAsync: jest.fn(), reset: jest.fn(), isPending: false, error: null };
beforeEach(() => {
  jest.clearAllMocks();
  preview.mutateAsync.mockResolvedValue(summary);
  apply.mutateAsync.mockResolvedValue(summary);
  (trpc.nutrition.previewNevoImport.useMutation as jest.Mock).mockReturnValue(preview);
  (trpc.nutrition.applyNevoImport.useMutation as jest.Mock).mockReturnValue(apply);
});
function csvFile(text = 'CSV fixture') {
  const file = new File([text], 'NEVO-fixture.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}
it('previews English/Dutch names before importing and submits the reviewed file/hash', async () => {
  const user = userEvent.setup(),
    onImported = jest.fn();
  const { container } = render(<NevoImporter onClose={jest.fn()} onImported={onImported} />);
  await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, csvFile());
  await user.click(screen.getByRole('button', { name: 'Preview NEVO import' }));
  await screen.findByText('Potatoes raw');
  expect(screen.getByText('Dutch alias: Aardappelen rauw')).toBeInTheDocument();
  expect(apply.mutateAsync).not.toHaveBeenCalled();
  expect(preview.mutateAsync).toHaveBeenCalledWith({ csv: 'CSV fixture', overwriteEdited: false });
  await user.click(screen.getByRole('button', { name: 'Import NEVO foods' }));
  await waitFor(() => expect(onImported).toHaveBeenCalled());
  expect(apply.mutateAsync).toHaveBeenCalledWith({
    csv: 'CSV fixture',
    overwriteEdited: false,
    planHash: summary.planHash,
  });
  expect(screen.getByText('NEVO import complete')).toBeInTheDocument();
});
it('requires a new preview after the manual-edit policy changes', async () => {
  const user = userEvent.setup();
  const { container } = render(<NevoImporter onClose={jest.fn()} onImported={jest.fn()} />);
  await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, csvFile());
  await user.click(screen.getByRole('button', { name: 'Preview NEVO import' }));
  await screen.findByText('Potatoes raw');
  await user.click(
    screen.getByRole('checkbox', { name: 'Update imported fields of manually edited NEVO foods' })
  );
  expect(screen.queryByRole('button', { name: 'Import NEVO foods' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Preview NEVO import' }));
  await waitFor(() =>
    expect(preview.mutateAsync).toHaveBeenLastCalledWith({
      csv: 'CSV fixture',
      overwriteEdited: true,
    })
  );
});
it('keeps malformed-file errors visible and never offers to import them', async () => {
  const user = userEvent.setup();
  preview.mutateAsync.mockRejectedValueOnce(new Error('Row 2: PROT is missing.'));
  const { container } = render(<NevoImporter onClose={jest.fn()} onImported={jest.fn()} />);
  await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, csvFile());
  await user.click(screen.getByRole('button', { name: 'Preview NEVO import' }));
  await screen.findByText('Row 2: PROT is missing.');
  expect(screen.queryByRole('button', { name: 'Import NEVO foods' })).not.toBeInTheDocument();
  expect(apply.mutateAsync).not.toHaveBeenCalled();
});
