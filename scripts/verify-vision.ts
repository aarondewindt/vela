/** Opt-in provider smoke test; photos remain local and no application data is written. */
import { readFile } from 'node:fs/promises';
import { generateText, streamText, type FilePart } from 'ai';
import { resolveChatModel, validateModelSelection } from '../lib/ai/ollama';
import { AiError } from '../lib/ai/errors';

async function main() {
  const [modelId, textOnlyModelId, front, nutrition] = process.argv.slice(2);
  if (!modelId || !textOnlyModelId || !front || !nutrition) {
    throw new Error(
      'Usage: yarn tsx --conditions=react-server scripts/verify-vision.ts <vision-model> <text-only-model> <front.jpg> <nutrition.jpg>'
    );
  }
  // Catch reversed model arguments before sending any photographs for inference.
  await validateModelSelection({ provider: 'ollama', modelId }, ['chat', 'vision']);
  const images: FilePart[] = await Promise.all(
    [front, nutrition].map(async (path) => ({
      type: 'file' as const,
      mediaType: 'image/jpeg',
      data: new Uint8Array(await readFile(path)),
    }))
  );
  const messages = [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: 'Deze twee foto’s tonen de voorkant en voedingstabel van hetzelfde Nederlandse supermarktproduct. Lees de productnaam en de energie per 100 g of 100 ml. Vermeld de eenheid. Zeg onbekend als iets onleesbaar is; verzin geen waarden.',
        },
        ...images,
      ],
    },
  ];

  const unsupported = await resolveChatModel({ provider: 'ollama', modelId: textOnlyModelId });
  try {
    await generateText({ model: unsupported, messages, maxRetries: 0 });
    throw new Error('Text-only model unexpectedly accepted images.');
  } catch (error) {
    if (!(error instanceof AiError) || error.code !== 'MODEL_NOT_SUPPORTED') {
      throw error;
    }
    process.stdout.write('PASS: text-only model rejected images.\n');
  }
  const model = await resolveChatModel({ provider: 'ollama', modelId });
  const options = { model, messages, maxRetries: 0, maxOutputTokens: 512, timeout: 120_000 };
  const result = await generateText(options);
  if (!result.text.trim()) {
    throw new Error('Vision generation returned no text.');
  }
  process.stdout.write(`Generation (compare manually with both labels): ${result.text}\n`);
  const streamed = await streamText(options).text;
  if (!streamed.trim()) {
    throw new Error('Vision streaming returned no text.');
  }
  process.stdout.write(`Streaming (compare manually with both labels): ${streamed}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof AiError) {
    process.stderr.write(`Vision smoke test failed [${error.code}]: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(
    'Vision smoke test failed. Usage: <vision-model> <text-only-model> <front.jpg> <nutrition.jpg>. Check capabilities, provider availability and paths.\n'
  );
  process.exitCode = 1;
});
