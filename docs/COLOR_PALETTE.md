# Color Palette

Vela uses stable Mantine hue tokens for preset colors. Persist the hue name, such as `teal`, rather than a shade-specific hex value or CSS variable. This keeps stored colors independent of the current color scheme and lets components choose an appropriate shade for their role.

The implementation lives in:

- `lib/color-palette.ts`: palette tokens, token validation, and semantic CSS color resolution
- `components/PaletteColorInput/PaletteColorInput.tsx`: the reusable preset-only picker
- `theme.ts`: Mantine palette configuration, including Vela's custom `dark` shades

## Stored Values

`PALETTE_COLORS` is the supported preset list: `dark`, `gray`, `red`, `pink`, `grape`, `violet`, `indigo`, `blue`, `cyan`, `teal`, `green`, `lime`, `yellow`, and `orange`.

Store a palette token as a string. Use `null` for no color; gray is a selectable color, not the no-color value. The existing `Theme.color` string field can store these tokens without a schema migration.

Existing custom hex values remain supported. `getPaletteColorCssValue` returns unrecognized values unchanged, so legacy hex colors keep rendering. The picker displays a legacy hex value and lets the user clear it or replace it with a preset; it does not create new custom colors.

## Picker

Use `PaletteColorInput` for color selection rather than creating a component-specific swatch list:

```tsx
<PaletteColorInput
  value={theme.color}
  onChange={(color) => save({ color })}
  aria-label="Color"
  placeholder="No color"
/>
```

The picker shows each Mantine hue at shade `5`. When a preset is selected, its hue token is sent to `onChange` and shown as the input text; the preview swatch continues to use the configured shade. The clear control calls `onChange(null)`. Input typing, the freeform picker, and the eyedropper are disabled to keep new values within the preset palette.

## Semantic Roles

Use `getPaletteColorCssValue(token, role)` when rendering a token. It returns a `light-dark()` CSS color using Mantine's palette variables, so the same stored token adapts to the active color scheme.

```tsx
{theme.color && <ColorSwatch color={getPaletteColorCssValue(theme.color, 'accent')} size={12} />}
```

Supported roles map to Mantine shade indexes as follows:

| Role | Light scheme | Dark scheme |
| --- | ---: | ---: |
| `background` | 0 | 9 |
| `backgroundHover` | 1 | 8 |
| `foreground` | 8 | 0 |
| `border` | 3 | 6 |
| `accent` | 6 | 4 |
| `accentHover` | 7 | 3 |

These are shade indexes, not fixed hex values. For the `dark` hue they resolve through Vela's configured `theme.colors.dark` shades. Keep presentation choices in the semantic role rather than storing a role or shade in the database. For example, a filled chip can use `background` and `foreground`, while a small marker can use `accent`.