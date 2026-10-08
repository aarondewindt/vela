export const PALETTE_COLORS = [
  'dark',
  'gray',
  'red',
  'pink',
  'grape',
  'violet',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
] as const;

export type PaletteColor = (typeof PALETTE_COLORS)[number];

export type PaletteColorRole =
  | 'background'
  | 'backgroundHover'
  | 'foreground'
  | 'border'
  | 'accent'
  | 'accentHover';

const roleShades: Record<PaletteColorRole, [light: number, dark: number]> = {
  background: [0, 9],
  backgroundHover: [1, 8],
  foreground: [8, 0],
  border: [3, 6],
  accent: [6, 4],
  accentHover: [7, 3],
};

export function isPaletteColor(value: string): value is PaletteColor {
  return (PALETTE_COLORS as readonly string[]).includes(value);
}

export function getPaletteColorCssValue(value: string, role: PaletteColorRole): string {
  if (!isPaletteColor(value)) {
    return value;
  }

  const [lightShade, darkShade] = roleShades[role];
  return `light-dark(var(--mantine-color-${value}-${lightShade}), var(--mantine-color-${value}-${darkShade}))`;
}
