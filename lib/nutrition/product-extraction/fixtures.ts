import type { Extraction, ColumnExtraction } from './schema';
export const missing = { value: null, status: 'missing' as const, note: '' };
export const printed = (value: string) => ({
  value,
  status: 'printed' as const,
  note: 'Visible on label',
});
/** Synthetic transcription fixture: Dutch front (Jumbo halfvolle melk) and back nutrition table. */
export function dutchMilk(): Extraction {
  return {
    name: printed('Halfvolle melk'),
    brand: printed('Jumbo'),
    variant: printed('halfvol'),
    description: missing,
    ingredients: printed('MELK'),
    aliases: ['halfvolle melk', 'Halfvolle melk'],
    package: { quantity: printed('1'), unit: 'L' },
    tables: [
      {
        basis: 'per100',
        unit: 'ML',
        servingQuantity: missing,
        note: 'Voedingswaarde per 100 ml',
        values: [
          { nutrient: 'calories', unit: 'kJ', ...printed('197') },
          { nutrient: 'calories', unit: 'kcal', ...printed('47') },
          { nutrient: 'protein', unit: 'g', ...printed('3,5') },
          { nutrient: 'carbohydrates', unit: 'g', ...printed('4,7') },
          { nutrient: 'fat', unit: 'g', ...printed('1,5') },
          { nutrient: 'salt', unit: 'g', ...printed('0,1') },
        ],
      },
    ],
    warnings: [],
  };
}

/** Same synthetic observations in the inference-only physical-column contract. */
export function milkColumns(): ColumnExtraction {
  const data = dutchMilk();
  return {
    ...data,
    tables: data.tables.map(({ basis, servingQuantity, values, ...table }) => {
      const energy = (unit: 'kcal' | 'kJ') => {
        const field = values.find((value) => value.nutrient === 'calories' && value.unit === unit);
        return field ? { value: field.value, status: field.status, note: field.note } : missing;
      };
      const mass = (nutrient: (typeof values)[number]['nutrient']) => {
        const field = values.find((value) => value.nutrient === nutrient);
        return {
          ...(field ? { value: field.value, status: field.status, note: field.note } : missing),
          unit: 'g' as const,
        };
      };
      return {
        ...table,
        referenceQuantity: basis === 'per100' ? printed('100') : servingQuantity,
        values: {
          energyKcal: energy('kcal'),
          energyKj: energy('kJ'),
          fat: mass('fat'),
          saturatedFat: mass('saturatedFat'),
          carbohydrates: mass('carbohydrates'),
          sugars: mass('sugars'),
          fiber: mass('fiber'),
          protein: mass('protein'),
          salt: mass('salt'),
          sodium: mass('sodium'),
        },
      };
    }),
  };
}
