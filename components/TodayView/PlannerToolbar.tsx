'use client';

import Link from 'next/link';
import { Button, Group, Menu } from '@mantine/core';
import { IconCheck, IconDots, IconPlus } from '@tabler/icons-react';
import { DraftReview } from './DraftReview';

export function PlannerToolbar({
  date,
  hasDraft,
  canUndo,
  canRedo,
  busy,
  generating,
  accepting,
  onAddTask,
  onGenerate,
  onAutoFill,
  onRebuild,
  onAccept,
  onUndo,
  onRedo,
  onCancel,
}: {
  date: string;
  hasDraft: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  generating: boolean;
  accepting: boolean;
  onAddTask: () => void;
  onGenerate: () => void;
  onAutoFill: () => void;
  onRebuild: () => void;
  onAccept: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
}) {
  return (
    <Group gap="xs">
      <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={onAddTask}>
        Add task
      </Button>
      <Button size="xs" loading={generating} disabled={busy} onClick={onGenerate}>
        {hasDraft ? 'Regenerate' : 'Generate'}
      </Button>
      <DraftReview date={date} />
      {hasDraft && (
        <>
          <Button
            size="xs"
            color="teal"
            leftSection={<IconCheck size={14} />}
            loading={accepting}
            disabled={busy}
            onClick={onAccept}
          >
            Accept draft
          </Button>
          <Button size="xs" variant="default" disabled={!canUndo || busy} onClick={onUndo}>
            Undo
          </Button>
          <Button size="xs" variant="default" disabled={!canRedo || busy} onClick={onRedo}>
            Redo
          </Button>
          <Button size="xs" variant="default" disabled={busy} onClick={onCancel}>
            Cancel draft
          </Button>
        </>
      )}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconDots size={14} />}
            aria-label="More planning actions"
            disabled={busy}
          >
            More
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={onAutoFill}>Auto-fill without AI</Menu.Item>
          <Menu.Item onClick={onRebuild}>Rebuild future schedule…</Menu.Item>
          <Menu.Divider />
          <Menu.Item component={Link} href="/settings/planner">
            Planning settings
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
