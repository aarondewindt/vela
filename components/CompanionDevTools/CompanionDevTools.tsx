'use client';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { trpc } from '@/lib/trpc/client';
import { useAuth } from '@/hooks/auth';
import type { HistoryFilter } from '@/lib/companion/schema';

const when = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleString() : 'unavailable';
function JsonViewer({ value }: { value: unknown }) {
  const [feedback, setFeedback] = useState('');
  const json = JSON.stringify(value, null, 2);
  return (
    <Stack>
      <Group>
        <Button
          variant="light"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(json);
              setFeedback('Copied private diagnostics.');
            } catch {
              setFeedback('Clipboard unavailable. Use Download JSON.');
            }
          }}
        >
          Copy JSON
        </Button>
        <Button
          variant="light"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'vela-private-diagnostics.json';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download JSON
        </Button>
        <Text size="sm">{feedback}</Text>
      </Group>
      <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {json}
      </Code>
    </Stack>
  );
}
export function CompanionDevTools() {
  const { session } = useAuth();
  const enabled = Boolean(session.data?.user);
  const [tab, setTab] = useState('ingestion');
  const [deviceId, setDevice] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursors, setCursors] = useState<NonNullable<HistoryFilter['cursor']>[]>([]);
  const [uploadCursors, setUploadCursors] = useState<string[]>([]);
  const [selection, setSelection] = useState<{ kind: 'event' | 'upload'; id: string } | null>(null);
  const invalidRange = Boolean(from && to && from > to);
  const devices = trpc.companion.devices.useQuery(undefined, { enabled });
  const filter: HistoryFilter = {
    kind: tab === 'attempt' ? 'attempt' : 'ingestion',
    deviceId: deviceId ?? undefined,
    trigger: (trigger as HistoryFilter['trigger']) ?? undefined,
    status: (status as HistoryFilter['status']) ?? undefined,
    source: (source as HistoryFilter['source']) ?? undefined,
    from: from || undefined,
    to: to || undefined,
    limit: 25,
    cursor: cursors.at(-1),
  };
  const events = trpc.companion.events.useQuery(filter, {
    enabled: enabled && tab !== 'uploads' && !invalidRange,
  });
  const uploads = trpc.companion.uploads.useQuery(
    {
      deviceId: deviceId ?? undefined,
      limit: 25,
      cursor: uploadCursors.at(-1),
      from: from || undefined,
      to: to || undefined,
    },
    { enabled: enabled && tab === 'uploads' && !invalidRange }
  );
  const detail = trpc.companion.event.useQuery(
    { id: selection?.id ?? '' },
    { enabled: enabled && selection?.kind === 'event' }
  );
  const upload = trpc.companion.upload.useQuery(
    { id: selection?.id ?? '' },
    { enabled: enabled && selection?.kind === 'upload' }
  );
  const reset = () => {
    setCursors([]);
    setUploadCursors([]);
  };
  const loading = tab === 'uploads' ? uploads.isLoading : events.isLoading;
  const error = tab === 'uploads' ? uploads.error : events.error;
  const detailData = selection?.kind === 'upload' ? upload.data : detail.data;
  const detailError = selection?.kind === 'upload' ? upload.error : detail.error;
  const refresh = () => {
    void devices.refetch();
    if (tab === 'uploads') {
      void uploads.refetch();
    } else {
      void events.refetch();
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Companion App diagnostics</Title>
        <Button onClick={refresh}>Refresh</Button>
      </Group>
      <Text c="dimmed">
        Private diagnostics retained for 30 days. Server requests show what Vela received. Device
        attempts appear only after an explicit debug upload; reported status is never live phone
        status.
      </Text>
      {devices.isLoading && <Loader aria-label="Loading devices" />}
      {devices.error && <Alert color="red">{devices.error.message}</Alert>}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {devices.data?.map((d) => (
          <Paper key={d.id} withBorder p="md">
            <Text fw={600}>
              {d.name}
              {d.revokedAt ? ' (revoked)' : ''}
            </Text>
            <Text size="sm">
              Last reported: {d.lastReported?.status ?? 'unknown'} ·{' '}
              {when(d.lastReported?.occurredAt)}
            </Text>
            <Text size="sm">Last reported success: {when(d.lastReportedSuccess?.occurredAt)}</Text>
            <Text size="sm">
              App: {d.lastUpload?.appVersion ?? 'unknown'} · uploaded{' '}
              {when(d.lastUpload?.receivedAt)}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <ScrollArea type="auto">
        <SegmentedControl
          value={tab}
          onChange={(value) => {
            setTab(value);
            setTrigger(null);
            setStatus(null);
            reset();
          }}
          data={[
            { value: 'ingestion', label: 'Server requests' },
            { value: 'attempt', label: 'Uploaded device attempts' },
            { value: 'uploads', label: 'Diagnostic uploads' },
          ]}
        />
      </ScrollArea>
      <SimpleGrid cols={{ base: 1, sm: 3, lg: 6 }}>
        <Select
          label="Device"
          placeholder="All devices"
          clearable
          value={deviceId}
          onChange={(v) => {
            setDevice(v);
            reset();
          }}
          data={devices.data?.map((d) => ({ value: d.id, label: d.name })) ?? []}
        />
        <Select
          label="Trigger"
          placeholder="All triggers"
          clearable
          disabled={tab === 'uploads'}
          value={trigger}
          onChange={(v) => {
            setTrigger(v);
            reset();
          }}
          data={['manual', 'automatic', 'unknown']}
        />
        <Select
          label="Status"
          placeholder="All statuses"
          clearable
          disabled={tab === 'uploads'}
          value={status}
          onChange={(v) => {
            setStatus(v);
            reset();
          }}
          data={
            tab === 'ingestion'
              ? ['received', 'success', 'failed']
              : [
                  'running',
                  'success',
                  'no_data',
                  'partial',
                  'failed',
                  'cancelled',
                  'paused',
                  'interrupted',
                ]
          }
        />
        <Select
          label="Source"
          placeholder="All sources"
          clearable
          disabled={tab === 'uploads'}
          value={source}
          onChange={(v) => {
            setSource(v);
            reset();
          }}
          data={[
            { value: 'samsung_health', label: 'Samsung Health' },
            { value: 'unknown', label: 'Unknown (unparsed request)' },
          ]}
        />
        <TextInput
          label="From (UTC date)"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.currentTarget.value);
            reset();
          }}
        />
        <TextInput
          label="Through (UTC date)"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.currentTarget.value);
            reset();
          }}
        />
      </SimpleGrid>
      {invalidRange && <Alert color="red">Choose an ordered date range.</Alert>}
      <Text size="sm" c="dimmed">
        {tab === 'ingestion'
          ? 'Each authenticated HTTP ingestion request, including rejected payloads. A received entry without an outcome may indicate an interrupted server request. Older clients have unknown triggers.'
          : tab === 'attempt'
            ? 'Device-reported history at upload time. Repeated snapshots may include the same attempt; compare attempt IDs. Offline and SDK failures are visible here only after upload.'
            : 'Explicit snapshots sent from Android, including the current read report when available. Filters use upload time; attempt filters are on the device attempts tab.'}
      </Text>
      {loading && <Loader aria-label="Loading diagnostics" />}
      {error && (
        <Alert color="red">
          {error.message}
          <Button onClick={refresh} variant="subtle">
            Retry
          </Button>
        </Alert>
      )}
      {!invalidRange &&
        !loading &&
        !error &&
        (tab === 'uploads' ? (
          <>
            {!uploads.data?.items.length && <Text>No diagnostic uploads match these filters.</Text>}
            <ScrollArea>
              <Table miw={650}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Uploaded</Table.Th>
                    <Table.Th>Device</Table.Th>
                    <Table.Th>App</Table.Th>
                    <Table.Th>Attempts</Table.Th>
                    <Table.Th>Inspect</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {uploads.data?.items.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{when(r.receivedAt)}</Table.Td>
                      <Table.Td>{r.device.name}</Table.Td>
                      <Table.Td>{r.appVersion}</Table.Td>
                      <Table.Td>{r._count.events}</Table.Td>
                      <Table.Td>
                        <Button
                          variant="subtle"
                          onClick={() => setSelection({ kind: 'upload', id: r.id })}
                        >
                          Details
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group>
              <Button
                disabled={!uploadCursors.length}
                onClick={() => setUploadCursors((v) => v.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                disabled={!uploads.data?.next}
                onClick={() => setUploadCursors((v) => [...v, uploads.data!.next!])}
              >
                Next
              </Button>
            </Group>
          </>
        ) : (
          <>
            {!events.data?.items.length && (
              <Text>
                No {tab === 'ingestion' ? 'server requests' : 'uploaded device attempts'} match
                these filters.
              </Text>
            )}
            <ScrollArea>
              <Table miw={1100}>
                <Table.Thead>
                  <Table.Tr>
                    {[
                      'When',
                      'Device / trigger',
                      'Status',
                      'Measurements / metrics',
                      'Date span',
                      'Duration',
                      'Retry / replay',
                      'Inspect',
                    ].map((h) => (
                      <Table.Th key={h}>{h}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {events.data?.items.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{when(r.occurredAt)}</Table.Td>
                      <Table.Td>
                        {r.device.name}
                        <Text size="xs">{r.trigger}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={
                            r.status === 'failed' ? 'red' : r.status === 'success' ? 'teal' : 'gray'
                          }
                        >
                          {r.status}
                        </Badge>
                        {r.errorCategory && <Text size="xs">{r.errorCategory}</Text>}
                      </Table.Td>
                      <Table.Td>
                        {r.count ?? 'unavailable'} · {r.metrics.join(', ') || 'unavailable'}
                      </Table.Td>
                      <Table.Td>
                        {r.dateFrom ?? '?'} – {r.dateTo ?? '?'}
                      </Table.Td>
                      <Table.Td>
                        {r.durationMs == null ? 'unavailable' : `${r.durationMs} ms`}
                      </Table.Td>
                      <Table.Td>
                        {r.retry ?? 'unknown'} / {r.replay == null ? 'unknown' : String(r.replay)}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="subtle"
                          onClick={() => setSelection({ kind: 'event', id: r.id })}
                        >
                          Details
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group>
              <Button disabled={!cursors.length} onClick={() => setCursors((v) => v.slice(0, -1))}>
                Previous
              </Button>
              <Button
                disabled={!events.data?.next}
                onClick={() => setCursors((v) => [...v, events.data!.next!])}
              >
                Next
              </Button>
            </Group>
          </>
        ))}
      <Drawer
        opened={Boolean(selection)}
        onClose={() => setSelection(null)}
        title="Private diagnostic details"
        size="xl"
      >
        <Stack>
          <Text size="sm">
            May contain private health values, units, dates and query diagnostics. Copy and download
            only to trusted storage.
          </Text>
          {detailError && <Alert color="red">{detailError.message}</Alert>}
          {!detailData && !detailError && <Loader />}
          {selection?.kind === 'event' && detail.data && (
            <>
              <Text>
                Attempt ID: {detail.data.attemptId ?? 'unavailable'} · Batch ID:{' '}
                {detail.data.batchId ?? 'unavailable'}
              </Text>
              {detail.data.uploadId && (
                <Button
                  variant="light"
                  onClick={() => setSelection({ kind: 'upload', id: detail.data!.uploadId! })}
                >
                  Open uploaded snapshot
                </Button>
              )}
              <Text fw={600}>Related records (up to 50)</Text>
              {detail.data.related.length ? (
                detail.data.related.map((r) => (
                  <Button
                    key={r.id}
                    variant="subtle"
                    onClick={() => setSelection({ kind: 'event', id: r.id })}
                  >
                    {r.kind} · {r.status} · {when(r.receivedAt)}
                  </Button>
                ))
              ) : (
                <Text size="sm">No correlated records received.</Text>
              )}
            </>
          )}
          {selection?.kind === 'upload' && upload.data && (
            <>
              <Text fw={600}>Reported attempts</Text>
              {upload.data.events.map((r) => (
                <Button
                  key={r.id}
                  variant="subtle"
                  onClick={() => setSelection({ kind: 'event', id: r.id })}
                >
                  {r.trigger} · {r.status} · {when(r.occurredAt)}
                </Button>
              ))}
            </>
          )}
          {detailData && <JsonViewer key={selection?.id} value={detailData} />}
        </Stack>
      </Drawer>
    </Stack>
  );
}
