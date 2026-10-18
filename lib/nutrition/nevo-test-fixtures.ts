const headings = {
  version: 'NEVO-versie/NEVO-version',
  code: 'NEVO-code',
  name: 'Engelse naam/Food name',
  dutchName: 'Voedingsmiddelnaam/Dutch food name',
  quantity: 'Hoeveelheid/Quantity',
  calories: 'ENERCC (kcal)',
  protein: 'PROT (g)',
  carbohydrates: 'CHO (g)',
  fat: 'FAT (g)',
  fiber: 'FIBT (g)',
  synonyms: 'Synoniem',
  group: 'Food group',
  notes: 'Opmerking',
};
export const nevoRowFixture = {
  version: 'NEVO-Online 2025 9.0',
  code: '1',
  name: 'Synthetic potatoes raw',
  dutchName: 'Synthetische aardappelen rauw',
  quantity: 'per 100g',
  calories: '88',
  protein: '2',
  carbohydrates: '19',
  fat: '0',
  fiber: '1,8',
  synonyms: 'Aardappel fixture',
  group: 'Potatoes and tubers',
  notes: '',
};
export function nevoCsvFixture(rows: Partial<typeof nevoRowFixture>[] = [{}]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const keys = Object.keys(headings) as (keyof typeof headings)[];
  return [
    keys.map((key) => quote(headings[key])).join('|'),
    ...rows.map((row) => keys.map((key) => quote({ ...nevoRowFixture, ...row }[key])).join('|')),
  ].join('\r\n');
}
