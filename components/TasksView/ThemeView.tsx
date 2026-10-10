'use client';

import { useUpdateThemeMutation } from '@/lib/planner/query';
import {
  planningCategories,
  planningCategoryLabels,
  type TaskRow,
  type ThemeRow,
} from '@/lib/planner/tasks';
import { PaletteColorInput } from '../PaletteColorInput/PaletteColorInput';
import {
  Property,
  PropertyPanel,
  ReadOnlyValue,
  ROW_HEIGHT,
  TitleField,
} from '../DataView/PropertyPanel';
import { SelectProperty, SwitchProperty, TextProperty } from '../DataView/properties';
import { formatDateTime } from './format';
import { ThemeContentEditor } from './ThemeContentEditor';

type Props = {
  theme: ThemeRow;
  tasks: TaskRow[];
  onClose: () => void;
};

export function ThemeView({ theme, tasks, onClose }: Props) {
  const update = useUpdateThemeMutation();
  const save = (patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate({ id: theme.id, patch });

  const open = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'ARCHIVED').length;

  return (
    <PropertyPanel
      kind="Theme"
      id={theme.id}
      onClose={onClose}
      content={<ThemeContentEditor themeId={theme.id} />}
    >
      <TitleField label="Name" value={theme.name} onSave={(name) => save({ name })} />

      <Property label="Color">
        <PaletteColorInput
          value={theme.color}
          onChange={(color) => save({ color })}
          aria-label="Color"
          placeholder="Empty"
          size="sm"
          inputStyles={{
            border: 'none',
            background: 'transparent',
            height: ROW_HEIGHT,
            minHeight: ROW_HEIGHT,
          }}
        />
      </Property>
      <SelectProperty
        label="Default category"
        value={theme.category}
        data={planningCategories.map((value) => ({ value, label: planningCategoryLabels[value] }))}
        onSave={(category) => save({ category: category as ThemeRow['category'] })}
      />
      <SwitchProperty
        label="Active"
        checked={theme.isActive}
        onSave={(isActive) => save({ isActive })}
      />
      <Property label="Tasks">
        <ReadOnlyValue>
          {open} open · {tasks.length} total
        </ReadOnlyValue>
      </Property>
      <TextProperty label="Brief" value={theme.brief} onSave={(brief) => save({ brief })} />
      <Property label="Created">
        <ReadOnlyValue>{formatDateTime(theme.createdAt)}</ReadOnlyValue>
      </Property>
      <Property label="Updated">
        <ReadOnlyValue>{formatDateTime(theme.updatedAt)}</ReadOnlyValue>
      </Property>
    </PropertyPanel>
  );
}
