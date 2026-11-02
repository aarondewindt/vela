import 'server-only';
import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';
import type { AiModelSelection } from '@/lib/ai/capabilities';
import type { GenerationDiagnostics } from '@/lib/ai/diagnostics';
import { AiStageError } from '@/lib/ai/stages';
import { generateSourceEvidence, interpretSourceEvidence } from '@/lib/ai/evidence';
import { validatePhotographSources } from '@/lib/ai/source-evidence';
import {
  extractionPipelineVersion,
  transcriptionPromptVersion,
  interpretationPromptVersion,
  transcriptionSchemaVersion,
  interpretationSchemaVersion,
  nutritionInterpretationSchemaForEvidence,
  transcriptionCheckpointSchema,
  type UserCorrection,
} from './pipeline-schema';
import {
  transcriptionInstructions,
  interpretationInstructions,
  interpretationPrompt,
} from './transcription';
import { normalizeInterpretedEvidence } from './interpretation';
import { productSuggestionSchema } from './schema';

export function transcriptionFingerprint(photographIds: string[], selection: AiModelSelection) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        photographs: [...new Set(photographIds)].sort(),
        selection,
        pipeline: extractionPipelineVersion,
        prompt: transcriptionPromptVersion,
        schema: transcriptionSchemaVersion,
      })
    )
    .digest('hex');
}

/** Authorized bytes enter only vision; validated, independently persisted evidence enters interpretation. */
export async function runProductExtractionPipeline(input: {
  messages: ModelMessage[];
  photographOccurrences: string[];
  selections: { transcription: AiModelSelection; interpretation: AiModelSelection };
  corrections?: UserCorrection[];
  checkpoint?: unknown;
  saveCheckpoint?: (value: unknown) => Promise<void>;
  rereadImages?: boolean;
  signal?: AbortSignal;
  onGenerationDiagnostics?: (stage: string, details: GenerationDiagnostics) => void;
}) {
  const started = Date.now();
  const corrections = input.corrections ?? [];
  // Snapshot selections before either asynchronous stage. Settings changes never alter an active turn.
  const selections = {
    transcription: { ...input.selections.transcription },
    interpretation: { ...input.selections.interpretation },
  };
  const photographIds = [...new Set(input.photographOccurrences)];
  const inputFingerprint = transcriptionFingerprint(photographIds, selections.transcription);
  const candidate = transcriptionCheckpointSchema.safeParse(input.checkpoint);
  const reusable =
    !input.rereadImages &&
    candidate.success &&
    candidate.data.inputFingerprint === inputFingerprint &&
    candidate.data.transcription.status === 'completed';
  let currentCheckpoint: Record<string, unknown> = {
    pipeline: extractionPipelineVersion,
    inputFingerprint,
  };
  try {
    const transcription = reusable
      ? {
          output: validatePhotographSources(candidate.data.evidence, photographIds),
          diagnostics: { ...candidate.data.transcription, reused: true },
        }
      : await generateSourceEvidence({
          stage: 'transcription',
          label: 'Vision transcription',
          selection: selections.transcription,
          promptVersion: transcriptionPromptVersion,
          schemaVersion: transcriptionSchemaVersion,
          system: transcriptionInstructions,
          messages: input.messages,
          photographOccurrences: input.photographOccurrences,
          signal: input.signal,
          timeoutMs: 240_000,
          maxOutputTokens: 12_288,
          onGenerationDiagnostics: (details) =>
            input.onGenerationDiagnostics?.('transcription', details),
        });
    input.signal?.throwIfAborted();
    // Persist before the second model runs. A provider/validation failure must not discard successful OCR.
    currentCheckpoint = transcriptionCheckpointSchema.parse({
      pipeline: extractionPipelineVersion,
      inputFingerprint,
      evidence: transcription.output,
      transcription: transcription.diagnostics,
    });
    await input.saveCheckpoint?.(currentCheckpoint);
    const interpretation = await interpretSourceEvidence({
      stage: 'interpretation',
      label: 'Text interpretation',
      selection: selections.interpretation,
      schema: nutritionInterpretationSchemaForEvidence(transcription.output, corrections),
      promptVersion: interpretationPromptVersion,
      schemaVersion: interpretationSchemaVersion,
      system: interpretationInstructions,
      evidence: transcription.output,
      serialize: (evidence) => interpretationPrompt(evidence, corrections),
      signal: input.signal,
      timeoutMs: 180_000,
      maxOutputTokens: 8192,
      onGenerationDiagnostics: (details) =>
        input.onGenerationDiagnostics?.('interpretation', details),
      validate: (value) => {
        // Validate semantic references AND the deterministic adapter before accepting stage output.
        normalizeInterpretedEvidence(transcription.output, value, corrections);
        return value;
      },
    });
    input.signal?.throwIfAborted();
    const normalizationStarted = Date.now();
    const { suggestion, provenance } = normalizeInterpretedEvidence(
      transcription.output,
      interpretation.output,
      corrections
    );
    return productSuggestionSchema.parse({
      ...suggestion,
      pipeline: {
        version: extractionPipelineVersion,
        evidence: transcription.output,
        interpretation: interpretation.output,
        corrections,
        diagnostics: {
          transcription: transcription.diagnostics,
          interpretation: interpretation.diagnostics,
          normalization: {
            durationMs: Date.now() - normalizationStarted,
            status: 'completed',
            validationFailures: Object.entries(suggestion.nutrition).flatMap(([field, value]) =>
              value.status === 'uncertain' ? [`${field}: ${value.note}`] : []
            ),
          },
          totalDurationMs: Date.now() - started,
        },
        provenance,
      },
    });
  } catch (error) {
    if (error instanceof AiStageError) {
      await input.saveCheckpoint?.({
        ...currentCheckpoint,
        lastFailure: { stage: error.stage, message: error.message, diagnostics: error.diagnostics },
      });
    }
    throw error;
  }
}
