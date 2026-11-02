/** Opt-in two-model local-image diagnostic. Never writes Product/conversation records. */
import { prepareModelImage } from '../lib/attachments/model-image';
import { readFile } from 'node:fs/promises';
import { AiError } from '../lib/ai';
import { runProductExtractionPipeline } from '../lib/nutrition/product-extraction/pipeline';

async function main() {
  const [visionModel, textModel, ...paths] = process.argv.slice(2);
  if (!visionModel || !textModel || !paths.length || paths.length > 8) {
    throw new Error('Provide separate vision/text models and 1–8 local photographs.');
  }
  const photographOccurrences = paths.map((_path, index) => `diagnostic-photo-${index + 1}`);
  const content = await Promise.all(
    paths.map(async (path) => {
      const extension = path.split('.').at(-1)?.toLowerCase();
      const mediaType =
        extension === 'png'
          ? 'image/png'
          : extension === 'webp'
            ? 'image/webp'
            : extension === 'jpg' || extension === 'jpeg'
              ? 'image/jpeg'
              : null;
      if (!mediaType) {
        throw new Error('Unsupported test image format.');
      }
      const prepared = await prepareModelImage(await readFile(path), mediaType);
      return {
        type: 'file' as const,
        data: new Uint8Array(prepared.bytes),
        mediaType: prepared.mediaType,
      };
    })
  );
  const suggestion = await runProductExtractionPipeline({
    messages: [{ role: 'user', content }],
    photographOccurrences,
    selections: {
      transcription: { provider: 'ollama', modelId: visionModel },
      interpretation: { provider: 'ollama', modelId: textModel },
    },
    // Explicit local diagnostics may print source content. Normal application logs never do.
    saveCheckpoint: async (checkpoint) => {
      process.stdout.write(`${JSON.stringify({ checkpoint })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify(suggestion, null, 2)}\n`);
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof AiError
      ? `${error.code}: ${error.message}\n`
      : 'Product extraction check failed. Usage: yarn tsx --conditions=react-server scripts/verify-product-extraction.ts <vision-model> <text-model> <front.jpg> <back.jpg> [...photos]\n'
  );
  process.exitCode = 1;
});
