import {
  assignSourceIdentifiers,
  type SourceEvidence,
  type SourceTranscription,
} from '@/lib/ai/source-evidence';
import type { NutritionInterpretation } from './pipeline-schema';

/** Bilingual, multi-column label transcription used by deterministic pipeline tests. */
export function milkSource(language: 'nl' | 'en' = 'nl'): SourceEvidence {
  const labels =
    language === 'nl'
      ? ['Energie', 'Vetten', 'Koolhydraten', 'Eiwitten']
      : ['Energy', 'Fat', 'Carbohydrates', 'Protein'];
  const amounts = [
    ['195 kJ / 47 kcal', '390 kJ / 94 kcal', '5 %'],
    ['1,5 g', '3,0 g', '4 %'],
    ['4,7 g', '9,4 g', '4 %'],
    ['3,5 g', '7,0 g', '14 %'],
  ];
  return {
    version: 1,
    photographs: [
      {
        id: 'front',
        text: [
          { id: 'front-name', text: 'Halfvolle melk', uncertain: false },
          { id: 'front-brand', text: 'Jumbo', uncertain: false },
          { id: 'front-net', text: '1 L', uncertain: false },
        ],
        tables: [],
      },
      {
        id: 'back',
        text: [{ id: 'back-ingredients', text: 'Ingrediënten: halfvolle melk.', uncertain: false }],
        tables: [
          {
            id: 'back-table',
            caption: 'Nutrition',
            columns: [
              { id: 'back-100', text: 'per 100 ml', uncertain: false },
              { id: 'back-serving', text: 'per portie (200 ml)', uncertain: false },
              { id: 'back-ri', text: 'RI*', uncertain: false },
            ],
            rows: labels.map((label, row) => ({
              id: `back-row-${row}`,
              label: { id: `back-label-${row}`, text: label, uncertain: false },
              cells: ['back-100', 'back-serving', 'back-ri'].map((columnId, column) => ({
                id: `back-cell-${row}-${column}`,
                columnId,
                text: amounts[row][column],
                uncertain: false,
              })),
            })),
          },
        ],
      },
    ],
    warnings: [],
  };
}
export function milkInterpretation(): NutritionInterpretation {
  return {
    identity: {
      name: 'front-name',
      brand: 'front-brand',
      variant: null,
      description: null,
      ingredients: 'back-ingredients',
      aliases: [],
    },
    package: { quantity: { cellId: 'front-net', numberIndex: 0 }, unit: 'L' },
    columns: ['back-100', 'back-serving', 'back-ri'].map((columnId, column) => ({
      columnId,
      reference: column === 2 ? null : { cellId: columnId, numberIndex: 0 },
      unit: column === 2 ? '%' : 'ML',
      values: [
        ...(column === 2
          ? []
          : [
              {
                nutrient: 'calories' as const,
                amount: { cellId: `back-cell-0-${column}`, numberIndex: 0 },
                unit: 'kJ' as const,
                note: '',
              },
            ]),
        {
          nutrient: 'calories' as const,
          amount: { cellId: `back-cell-0-${column}`, numberIndex: column === 2 ? 0 : 1 },
          unit: column === 2 ? ('%' as const) : ('kcal' as const),
          note: '',
        },
        ...(['fat', 'carbohydrates', 'protein'] as const).map((nutrient, row) => ({
          nutrient,
          amount: { cellId: `back-cell-${row + 1}-${column}`, numberIndex: 0 },
          unit: column === 2 ? ('%' as const) : ('g' as const),
          note: '',
        })),
      ],
      note: '',
    })),
    corrections: [],
    problems: [],
  };
}

export function milkTranscription(): SourceTranscription {
  const source = milkSource();
  const reading = ({ text, uncertain }: { text: string; uncertain: boolean }) => ({
    text,
    uncertain,
  });
  return {
    version: 1,
    warnings: source.warnings,
    photographs: source.photographs.map((photo) => ({
      id: photo.id,
      text: photo.text.map(reading),
      tables: photo.tables.map((table) => ({
        caption: table.caption,
        columns: table.columns.map(reading),
        rows: table.rows.map((row) => ({
          label: reading(row.label),
          cells: table.columns.map((column) =>
            reading(row.cells.find((cell) => cell.columnId === column.id)!)
          ),
        })),
      })),
    })),
  };
}

export const compactMilkSource = () =>
  assignSourceIdentifiers(milkTranscription(), ['front', 'back']);

export function compactMilkInterpretation(): NutritionInterpretation {
  const source = milkSource();
  const canonical = compactMilkSource();
  const aliases = new Map<string, string>();
  source.photographs.forEach((photo, pi) => {
    photo.text.forEach((text, ti) => aliases.set(text.id, canonical.photographs[pi].text[ti].id));
    photo.tables.forEach((table, ti) => {
      const target = canonical.photographs[pi].tables[ti];
      table.columns.forEach((column, ci) => aliases.set(column.id, target.columns[ci].id));
      table.rows.forEach((row, ri) =>
        row.cells.forEach((cell, ci) => aliases.set(cell.id, target.rows[ri].cells[ci].id))
      );
    });
  });
  return JSON.parse(
    JSON.stringify(milkInterpretation(), (_key, value: unknown) =>
      typeof value === 'string' ? (aliases.get(value) ?? value) : value
    )
  );
}
