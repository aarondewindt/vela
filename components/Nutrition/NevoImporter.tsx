'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FileInput,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { maxNevoFileBytes } from '@/lib/nutrition/nevo-schema';
import type { NevoImportPreview } from '@/lib/nutrition/nevo';
import { NevoAttribution } from './NevoAttribution';

function ImportSummary({ value }: { value: NevoImportPreview }) {
  return (
    <Stack gap="sm">
      <Text fw={600}>
        {value.version} · {value.total.toLocaleString('en-US')} foods
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {[
          [value.create, 'New foods'],
          [value.update, 'Updates'],
          [value.unchanged, 'Unchanged'],
          [value.protectedEdits, 'Edited foods protected'],
        ].map(([count, label]) => (
          <div key={label}>
            <Text fw={700} size="lg">
              {Number(count).toLocaleString('en-US')}
            </Text>
            <Text size="sm" c="dimmed">
              {label}
            </Text>
          </div>
        ))}
      </SimpleGrid>
      {value.conversionConflicts > 0 && (
        <Alert color="yellow">
          {value.conversionConflicts} foods will be skipped because their existing serving
          conversions are incompatible. Resolve those foods manually before updating them.
        </Alert>
      )}
      {value.retained > 0 && (
        <Text size="sm">
          {value.retained} previously imported foods are absent from this file and will be kept.
        </Text>
      )}
      {value.archived > 0 && (
        <Text size="sm">{value.archived} matching archived foods will remain archived.</Text>
      )}
      {value.skipped.length > 0 && (
        <div>
          <Text size="sm" fw={600}>
            Skipped foods (first {value.skipped.length})
          </Text>
          {value.skipped.map((food) => (
            <Text size="sm" key={food.code} style={{ overflowWrap: 'anywhere' }}>
              {food.code} · {food.name}: {food.reason}
            </Text>
          ))}
        </div>
      )}
      <Title order={4}>Sample imported names</Title>
      {value.samples.map((food) => (
        <Paper key={food.code} withBorder p="sm" radius="sm">
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
            {food.name}
          </Text>
          <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
            Dutch alias: {food.dutchName}
          </Text>
          <Text size="xs" c="dimmed">
            NEVO {food.code} · {food.calories} kcal per 100 {food.referenceUnit.toLowerCase()}
          </Text>
        </Paper>
      ))}
      <NevoAttribution sources={[{ name: 'NEVO', version: value.version }]} />
    </Stack>
  );
}

export function NevoImporter({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [overwriteEdited, setOverwriteEdited] = useState(false);
  const [preview, setPreview] = useState<{ csv: string; summary: NevoImportPreview } | null>(null);
  const [result, setResult] = useState<NevoImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inspect = trpc.nutrition.previewNevoImport.useMutation({ retry: false, gcTime: 0 });
  const apply = trpc.nutrition.applyNevoImport.useMutation({ retry: false, gcTime: 0 });
  const busy = reading || inspect.isPending || apply.isPending;
  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    inspect.reset();
    apply.reset();
  };
  return (
    <Modal
      opened
      onClose={onClose}
      title="Upload or update NEVO"
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <Stack>
        <Text size="sm">
          Upload the original NEVO CSV export. English names become the primary food names; Dutch
          names and supplied synonyms become searchable aliases.
        </Text>
        <FileInput
          label="NEVO CSV file"
          description="UTF-8, pipe-delimited CSV · Maximum 5 MB"
          placeholder="Choose a NEVO CSV file"
          accept=".csv,text/csv"
          value={file}
          disabled={busy}
          clearable
          onChange={(next) => {
            reset();
            setFile(next);
          }}
        />
        <Checkbox
          label="Update imported fields of manually edited NEVO foods"
          checked={overwriteEdited}
          disabled={busy}
          onChange={(event) => {
            reset();
            setOverwriteEdited(event.currentTarget.checked);
          }}
        />
        <Text size="xs" c="dimmed">
          By default, manual edits are protected. Updates match NEVO codes and keep your serving
          definitions, density and archive choices. Other products and saved diary entries are
          preserved.
        </Text>
        <Group>
          <Button
            variant="light"
            disabled={!file || busy}
            loading={reading || inspect.isPending}
            onClick={async () => {
              if (!file || busy) {
                return;
              }
              reset();
              if (!file.size || file.size > maxNevoFileBytes) {
                setError('Choose a nonempty NEVO CSV file of at most 5 MB.');
                return;
              }
              setReading(true);
              try {
                const csv = await file.text();
                const summary = await inspect.mutateAsync({ csv, overwriteEdited });
                setPreview({ csv, summary });
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'The file could not be read. Choose it again and retry.'
                );
              } finally {
                setReading(false);
              }
            }}
          >
            Preview NEVO import
          </Button>
        </Group>
        {error && (
          <Alert color="red" title="Could not prepare import">
            {error}
          </Alert>
        )}
        {apply.error && (
          <Alert color="red" title="Import did not complete">
            {apply.error.message} Preview again before retrying.
          </Alert>
        )}
        {result && (
          <Alert color="teal" title="NEVO import complete">
            Created {result.create.toLocaleString('en-US')} foods and updated{' '}
            {result.update.toLocaleString('en-US')}. {result.unchanged.toLocaleString('en-US')} were
            unchanged; {result.protectedEdits.toLocaleString('en-US')} edited foods were protected.
          </Alert>
        )}
        {preview && (
          <>
            <ImportSummary value={preview.summary} />
            {preview.summary.create + preview.summary.update === 0 && (
              <Text size="sm">There are no changes to import with these settings.</Text>
            )}
            <Text size="sm">
              Importing applies all listed additions and updates to your food catalog. Nutrition
              values retain their original per-100-g or per-100-ml reference.
            </Text>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {preview && (
            <Button
              loading={apply.isPending}
              disabled={busy || preview.summary.create + preview.summary.update === 0}
              onClick={async () => {
                if (busy) {
                  return;
                }
                try {
                  const imported = await apply.mutateAsync({
                    csv: preview.csv,
                    overwriteEdited,
                    planHash: preview.summary.planHash,
                  });
                  setResult(imported);
                  setPreview(null);
                  await onImported();
                } catch {
                  /* Preserve the reviewed upload; the mutation error is displayed above. */
                }
              }}
            >
              Import NEVO foods
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
