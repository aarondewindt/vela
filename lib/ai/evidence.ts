import 'server-only';
import type { ModelMessage } from 'ai';
import type { z } from 'zod';
import { generateStructuredStage } from './stages';
import {
  sourceEvidenceSchema,
  sourceTranscriptionSchemaForPhotographs,
  assignSourceIdentifiers,
  type SourceTranscription,
  type SourceEvidence,
} from './source-evidence';

/** Label only server-authorized image bytes. Original user prose never becomes visual evidence. */
export function labelSourcePhotographs(
  messages: ModelMessage[],
  photographOccurrences: string[]
): ModelMessage[] {
  let imageIndex = 0;
  const labeled = messages
    .map((message) => {
      if (message.role !== 'user' || typeof message.content === 'string') {
        return null;
      }
      const content = message.content.flatMap((part) => {
        if (
          (part.type === 'file' && part.mediaType.startsWith('image/')) ||
          part.type === 'image'
        ) {
          const id = photographOccurrences[imageIndex++];
          if (!id) {
            throw new Error('Authorized photograph references do not match model images.');
          }
          return [{ type: 'text' as const, text: `Source photograph ID: ${id}` }, part];
        }
        return [];
      });
      return content.length ? ({ ...message, content } as ModelMessage) : null;
    })
    .filter((message): message is ModelMessage => message !== null);
  if (imageIndex !== photographOccurrences.length || !imageIndex) {
    throw new Error('Authorized photograph references do not match model images.');
  }
  return labeled;
}

type StageOptions<T> = Omit<
  Parameters<typeof generateStructuredStage<T>>[0],
  'capabilities' | 'messages' | 'schema' | 'prompt' | 'validate'
>;

/** Reusable vision-to-source stage. Authorization is the caller's responsibility before bytes enter here. */
export async function generateSourceEvidence(
  input: StageOptions<SourceEvidence> & {
    messages: ModelMessage[];
    photographOccurrences: string[];
  }
) {
  const { messages, photographOccurrences, ...stage } = input;
  const result = await generateStructuredStage<SourceTranscription>({
    ...stage,
    capabilities: ['chat', 'vision'],
    schema: sourceTranscriptionSchemaForPhotographs(photographOccurrences),
    messages: labelSourcePhotographs(messages, photographOccurrences),
    validate: (evidence) => {
      assignSourceIdentifiers(evidence, photographOccurrences);
      return evidence;
    },
  });
  return { ...result, output: assignSourceIdentifiers(result.output, photographOccurrences) };
}

/** Reusable text-only interpretation stage; its model never receives photographs or storage paths. */
export async function interpretSourceEvidence<T>(
  input: StageOptions<T> & {
    evidence: SourceEvidence;
    schema: z.ZodType<T>;
    context?: unknown;
    serialize?: (evidence: SourceEvidence) => string;
    validate?: (output: T) => T;
  }
) {
  const { evidence, context, serialize, ...stage } = input;
  const validated = sourceEvidenceSchema.parse(evidence);
  return generateStructuredStage({
    ...stage,
    capabilities: ['chat'],
    prompt: serialize ? serialize(validated) : JSON.stringify({ evidence: validated, context }),
  });
}
