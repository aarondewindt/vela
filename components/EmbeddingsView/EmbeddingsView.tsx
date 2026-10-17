'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { maxEmbeddingTextLength } from '@/lib/ai-dev/schema';
import { trpc } from '@/lib/trpc/client';
import classes from './EmbeddingsView.module.css';

export function EmbeddingsView() {
  const models = trpc.aiDev.listEmbeddingModels.useQuery(undefined, { retry: false });
  const generate = trpc.aiDev.generateEmbedding.useMutation({ retry: false, gcTime: 0 });
  const compare = trpc.aiDev.compareEmbeddings.useMutation({ retry: false, gcTime: 0 });
  const [modelId, setModelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const busy = generate.isPending || compare.isPending;
  const selection = modelId ? { provider: 'ollama' as const, modelId } : null;
  const ready = Boolean(
    selection && !models.error && models.data?.some((model) => model.id === modelId)
  );

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>Embeddings</Title>
          <Text c="dimmed" mt={4}>
            Inspect vectors and compare text using an installed embedding model. Results are
            temporary and are not saved.
          </Text>
        </div>
        {models.isPending && (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading embedding models…</Text>
          </Group>
        )}
        {models.error && (
          <Alert color="red" title="Could not load models">
            {models.error.message}
          </Alert>
        )}
        {models.isSuccess && models.data.length === 0 && (
          <Alert color="yellow">
            No embedding models are installed in Ollama. Install one, then refresh.
          </Alert>
        )}
        <Group align="flex-end">
          <Select
            className={classes.modelPicker}
            label="Embedding model"
            placeholder="Choose an embedding model"
            searchable
            allowDeselect={false}
            data={models.data?.map((model) => ({ value: model.id, label: model.id })) ?? []}
            value={modelId}
            onChange={(value) => {
              setModelId(value);
              generate.reset();
              compare.reset();
            }}
            disabled={models.isPending || Boolean(models.error) || busy}
          />
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            loading={models.isFetching}
            disabled={busy}
            onClick={() => void models.refetch()}
          >
            Refresh models
          </Button>
        </Group>
        <Paper withBorder p="md" radius="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && selection && text.trim() && !busy) {
                generate.mutate({ selection, text });
              }
            }}
          >
            <Stack>
              <Title order={3}>Generate an embedding</Title>
              <Textarea
                label="Text to embed"
                description="Text is sent as entered, without added instructions or prefixes."
                minRows={3}
                maxLength={maxEmbeddingTextLength}
                value={text}
                disabled={busy}
                onChange={(event) => {
                  setText(event.currentTarget.value);
                  generate.reset();
                }}
              />
              <Group>
                <Button
                  type="submit"
                  loading={generate.isPending}
                  disabled={!ready || !text.trim() || busy}
                >
                  Generate embedding
                </Button>
              </Group>
              {generate.isPending && <Text role="status">Generating embedding…</Text>}
              {generate.error && (
                <Alert color="red" title="Could not generate embedding">
                  {generate.error.message}
                </Alert>
              )}
              {generate.data && !generate.isPending && !generate.error && (
                <Stack gap="xs" role="status" aria-label="Embedding result">
                  <Text size="sm" c="dimmed">
                    {generate.data.selection.provider} · {generate.data.selection.modelId}
                  </Text>
                  <VectorPreview {...generate.data} />
                </Stack>
              )}
            </Stack>
          </form>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && selection && textA.trim() && textB.trim() && !busy) {
                compare.mutate({ selection, textA, textB });
              }
            }}
          >
            <Stack>
              <div>
                <Title order={3}>Compare two texts</Title>
                <Text size="sm" c="dimmed">
                  Both texts use the selected model. Cosine similarity ranges from −1 to 1; higher
                  values mean more aligned vectors. This is not a probability.
                </Text>
              </div>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Textarea
                  label="Text A"
                  minRows={3}
                  maxLength={maxEmbeddingTextLength}
                  value={textA}
                  disabled={busy}
                  onChange={(event) => {
                    setTextA(event.currentTarget.value);
                    compare.reset();
                  }}
                />
                <Textarea
                  label="Text B"
                  minRows={3}
                  maxLength={maxEmbeddingTextLength}
                  value={textB}
                  disabled={busy}
                  onChange={(event) => {
                    setTextB(event.currentTarget.value);
                    compare.reset();
                  }}
                />
              </SimpleGrid>
              <Group>
                <Button
                  type="submit"
                  loading={compare.isPending}
                  disabled={!ready || !textA.trim() || !textB.trim() || busy}
                >
                  Compare texts
                </Button>
              </Group>
              {compare.isPending && <Text role="status">Comparing texts…</Text>}
              {compare.error && (
                <Alert color="red" title="Could not compare texts">
                  {compare.error.message}
                </Alert>
              )}
              {compare.data && !compare.isPending && !compare.error && (
                <Stack gap="sm" role="status" aria-label="Comparison result">
                  <Text fw={600}>Cosine similarity: {compare.data.similarity.toFixed(6)}</Text>
                  <Text size="sm" c="dimmed">
                    {compare.data.selection.provider} · {compare.data.selection.modelId}
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <VectorPreview label="Text A" {...compare.data.first} />
                    <VectorPreview label="Text B" {...compare.data.second} />
                  </SimpleGrid>
                </Stack>
              )}
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Container>
  );
}

function VectorPreview({
  label,
  dimensions,
  preview,
}: {
  label?: string;
  dimensions: number;
  preview: number[];
}) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {label ? `${label} · ` : ''}
        {dimensions.toLocaleString('en-US')} dimensions
      </Text>
      <Text size="xs" c="dimmed">
        Vector preview · first {preview.length} of {dimensions.toLocaleString('en-US')} values
      </Text>
      <Code block className={classes.vector}>
        [{preview.map((value) => value.toFixed(6)).join(', ')}
        {dimensions > preview.length ? ', …' : ''}]
      </Code>
    </Stack>
  );
}
