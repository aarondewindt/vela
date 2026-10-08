'use client';

import {
  ActionIcon,
  ColorInput,
  ColorSwatch,
  Group,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { isPaletteColor, PALETTE_COLORS } from '@/lib/color-palette';

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  inputStyles?: CSSProperties;
  'aria-label'?: string;
  placeholder?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export function PaletteColorInput({
  value,
  onChange,
  inputStyles,
  'aria-label': ariaLabel = 'Color',
  placeholder,
  size = 'sm',
}: Props) {
  const theme = useMantineTheme();
  const [inputValue, setInputValue] = useState(value ?? '');
  const swatches = PALETTE_COLORS.map((color) => theme.colors[color][5]);
  const previewColor = isPaletteColor(inputValue) ? theme.colors[inputValue][5] : inputValue;

  useEffect(() => {
    setInputValue(value ?? '');
  }, [value]);

  const handleChangeEnd = (nextValue: string) => {
    const selected = PALETTE_COLORS.find(
      (color) => theme.colors[color][5].toLowerCase() === nextValue.toLowerCase()
    );
    if (selected) {
      setInputValue(selected);
      onChange(selected);
    }
  };

  const clearColor = () => {
    setInputValue('');
    onChange(null);
  };

  return (
    <Group gap={4} wrap="nowrap" style={{ width: '100%' }}>
      <ColorInput
        value={inputValue}
        onChange={setInputValue}
        onChangeEnd={handleChangeEnd}
        aria-label={ariaLabel}
        placeholder={placeholder}
        leftSection={previewColor ? <ColorSwatch color={previewColor} size={14} /> : undefined}
        leftSectionPointerEvents="none"
        size={size}
        swatches={swatches}
        swatchesPerRow={7}
        withPicker={false}
        withPreview={false}
        disallowInput
        fixOnBlur={false}
        withEyeDropper={false}
        style={{ flex: 1, minWidth: 0 }}
        styles={{ input: inputStyles }}
      />
      <Tooltip label="No color">
        <ActionIcon
          aria-label="No color"
          title="No color"
          variant="subtle"
          color="gray"
          size={size}
          disabled={!value}
          onClick={clearColor}
        >
          <IconX size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
