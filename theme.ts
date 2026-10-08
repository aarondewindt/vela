'use client';

import { createTheme } from '@mantine/core';

export const darkPalette = [
  '#EDEEF0', // 0 - primary text
  '#AFB3BA', // 1 - secondary text
  '#777B84', // 2 - dimmed text
  '#696E77', // 3 - placeholder / disabled text
  '#43484E', // 4 - borders
  '#2E3135', // 5 - hover surface
  '#212225', // 6 - component/card surface
  '#18191B', // 7 - app background
  '#111113', // 8 - deeper surface
  '#0C0C0E', // 9 - deepest background
] as const;

export const theme = createTheme({
  colors: {
    dark: [...darkPalette],
  },
});
