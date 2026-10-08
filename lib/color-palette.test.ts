import { getPaletteColorCssValue, isPaletteColor, PALETTE_COLORS } from './color-palette';

describe('color palette', () => {
  it('includes Mantine neutral and chromatic palette tokens', () => {
    expect(PALETTE_COLORS).toEqual([
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
    ]);
  });

  it('resolves semantic roles to scheme-aware Mantine shades', () => {
    expect(getPaletteColorCssValue('teal', 'background')).toBe(
      'light-dark(var(--mantine-color-teal-0), var(--mantine-color-teal-9))'
    );
    expect(getPaletteColorCssValue('teal', 'accent')).toBe(
      'light-dark(var(--mantine-color-teal-6), var(--mantine-color-teal-4))'
    );
  });

  it('leaves legacy custom colors intact', () => {
    expect(isPaletteColor('#123456')).toBe(false);
    expect(getPaletteColorCssValue('#123456', 'accent')).toBe('#123456');
  });
});
