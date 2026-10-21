import { darkPalette } from './theme';

const luminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const s = parseInt(v, 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
it('maintains ordered text hierarchy and normal-text contrast on dark surfaces', () => {
  expect(luminance(darkPalette[0])).toBeGreaterThan(luminance(darkPalette[1]));
  expect(luminance(darkPalette[1])).toBeGreaterThan(luminance(darkPalette[2]));
  for (const foreground of darkPalette.slice(0, 3)) {
    for (const background of darkPalette.slice(5)) {
      expect(
        (luminance(foreground) + 0.05) / (luminance(background) + 0.05)
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
