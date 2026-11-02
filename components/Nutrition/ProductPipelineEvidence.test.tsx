import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils';
import type { ProductSuggestion } from '@/lib/nutrition/product-extraction/schema';
import { ProductPipelineEvidence } from './ProductPipelineEvidence';

it('keeps original source precision and photo links separate from explicit corrections', async () => {
  const user = userEvent.setup();
  const photoId = '45f6af99-9a30-4638-b05f-fb826b970379';
  const stage = {
    stage: 'transcription',
    selection: { provider: 'ollama' as const, modelId: 'original-vision' },
    promptVersion: 'v1',
    schemaVersion: 'v1',
    startedAt: '2026-10-27T20:00:00Z',
    durationMs: 1500,
    timeoutMs: 240000,
    maxOutputTokens: 4096,
    attempts: 1,
    status: 'completed' as const,
  };
  const pipeline: NonNullable<ProductSuggestion['pipeline']> = {
    version: 'nutrition-two-stage-v1',
    evidence: {
      version: 1,
      photographs: [
        {
          id: photoId,
          text: [],
          tables: [
            {
              id: 'table',
              caption: 'Voedingswaarde',
              columns: [{ id: 'column', text: 'per 100 g', uncertain: false }],
              rows: [
                {
                  id: 'row',
                  label: { id: 'label', text: 'Eiwitten', uncertain: false },
                  cells: [{ id: 'cell', columnId: 'column', text: '3,50 g', uncertain: false }],
                },
              ],
            },
          ],
        },
      ],
      warnings: [],
    },
    interpretation: {
      identity: {
        name: null,
        brand: null,
        variant: null,
        description: null,
        ingredients: null,
        aliases: [],
      },
      package: { quantity: null, unit: null },
      columns: [],
      corrections: [],
      problems: [],
    },
    corrections: [{ id: 'correction', messageId: 'user-message', text: 'The brand is My brand.' }],
    provenance: {
      protein: [{ cellId: 'cell', photographId: photoId, numberIndex: 0 }],
      brand: [{ correctionId: 'correction', messageId: 'user-message', numberIndex: null }],
    },
    diagnostics: {
      transcription: { ...stage, reused: true },
      interpretation: {
        ...stage,
        stage: 'interpretation',
        selection: { provider: 'ollama', modelId: 'original-interpreter' },
      },
      normalization: { durationMs: 1, status: 'completed', validationFailures: [] },
      totalDurationMs: 1600,
    },
  };
  render(<ProductPipelineEvidence pipeline={pipeline} />);
  expect(screen.getByText(/original-vision/)).toHaveTextContent('original-interpreter');
  expect(screen.getByText(/Reused transcription/)).toBeVisible();
  await user.click(screen.getByText('Photograph sources and user corrections'));
  expect(screen.getByText('User correction: The brand is My brand.')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Photograph 1' })[0]).toHaveAttribute(
    'href',
    `/api/attachments/${photoId}`
  );
  await user.click(screen.getByText('Original photograph transcription'));
  const original = screen.getByText('Original photograph transcription').closest('details')!;
  expect(within(original).getByText('3,50 g')).toBeVisible();
  expect(within(original).queryByText(/My brand/)).not.toBeInTheDocument();
});
