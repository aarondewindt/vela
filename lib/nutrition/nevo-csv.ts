import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { maxNevoFileBytes, maxNevoRows } from './nevo-schema';
import { productInputSchema, decimalSchema, type ProductInput } from './schema';
import { normalizeProductText } from './normalization';

export class NevoImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NevoImportError';
  }
}

const columns = {
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
} as const;
export type NevoRow = { code: string; product: ProductInput; original: Record<string, string> };

/** NEVO's pipe-delimited CSV, including quoted fields, escaped quotes and embedded newlines. */
function records(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closedQuote = false;
  const fail = () => {
    throw new NevoImportError(`Row ${rows.length + 1}: invalid CSV quoting.`);
  };
  const endField = () => {
    row.push(field.trim());
    field = '';
    closedQuote = false;
  };
  const endRow = () => {
    endField();
    if (row.some(Boolean)) {
      rows.push(row);
    }
    row = [];
    if (rows.length > maxNevoRows + 1) {
      throw new NevoImportError(`Upload at most ${maxNevoRows.toLocaleString('en-US')} foods.`);
    }
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
    } else if (character === '|') {
      endField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') {
        index++;
      }
      endRow();
    } else if (closedQuote) {
      if (character !== ' ' && character !== '\t') {
        fail();
      }
    } else if (character === '"') {
      if (field.length) {
        fail();
      }
      quoted = true;
    } else {
      field += character;
    }
    if (field.length > 8192 || row.length > 300) {
      throw new NevoImportError(`Row ${rows.length + 1}: a CSV field or row is too large.`);
    }
  }
  if (quoted) {
    fail();
  }
  if (field.length || closedQuote || row.length) {
    endRow();
  }
  return rows;
}

export function parseNevoCsv(csv: string) {
  if (!csv.trim() || Buffer.byteLength(csv, 'utf8') > maxNevoFileBytes) {
    throw new NevoImportError('Choose a nonempty NEVO CSV file of at most 5 MB.');
  }
  if (csv.includes('\0') || csv.includes('\ufffd')) {
    throw new NevoImportError(
      'The CSV contains invalid text. Save it as UTF-8 and upload it again.'
    );
  }
  const [header, ...data] = records(csv.replace(/^\uFEFF/, ''));
  if (!header || !data.length) {
    throw new NevoImportError('The CSV must contain a header and at least one food.');
  }
  if (new Set(header).size !== header.length) {
    throw new NevoImportError('The CSV contains duplicate column headings.');
  }
  const index = new Map(header.map((name, position) => [name, position]));
  for (const name of Object.values(columns)) {
    if (!index.has(name)) {
      throw new NevoImportError(
        `Missing NEVO column: ${name}. Use the original pipe-delimited CSV export.`
      );
    }
  }
  const rows: NevoRow[] = [],
    errors: string[] = [],
    codes = new Set<string>();
  let version: string | null = null;
  let totalErrors = 0;
  for (const [position, cells] of data.entries()) {
    const line = position + 2;
    try {
      if (cells.length !== header.length) {
        throw new Error(`expected ${header.length} columns, found ${cells.length}.`);
      }
      const value = (column: string) => (index.has(column) ? cells[index.get(column)!] : '');
      const label = value(columns.version);
      if (!/^NEVO(?:-Online)?\s+\d{4}\s+\d+(?:\.\d+){0,3}$/i.test(label) || label.length > 120) {
        throw new Error('the NEVO release label is missing or unsupported.');
      }
      if (version && version !== label) {
        throw new Error('all foods must belong to the same NEVO release.');
      }
      version = label;
      const rawCode = value(columns.code);
      if (!/^\d{1,12}$/.test(rawCode) || !/[1-9]/.test(rawCode)) {
        throw new Error('NEVO-code must be a positive integer.');
      }
      const code = BigInt(rawCode).toString();
      if (codes.has(code)) {
        throw new Error(`duplicate NEVO-code ${code}.`);
      }
      codes.add(code);
      const name = value(columns.name),
        dutch = value(columns.dutchName);
      if (!name || !dutch) {
        throw new Error('both the English and Dutch food names are required.');
      }
      const reference = /^per\s+100\s*(g|ml)$/i.exec(value(columns.quantity));
      if (!reference) {
        throw new Error('the nutrition reference must be per 100g or per 100ml.');
      }
      const number = (column: string, optional = false) => {
        const raw = value(column);
        if (!raw && optional) {
          return null;
        }
        const parsed = decimalSchema.safeParse(raw.replace(',', '.'));
        if (!parsed.success) {
          throw new Error(
            `${column} must contain a nonnegative decimal${optional ? ' or be blank' : ''}.`
          );
        }
        return parsed.data;
      };
      const aliases = [
        ...new Map(
          [dutch, value('Synoniem')]
            .filter(Boolean)
            .map((alias) => [normalizeProductText(alias), alias])
        ).values(),
      ];
      const description =
        [
          value('Food group') && `Food group: ${value('Food group')}`,
          value('Opmerking') && `Notes (Dutch): ${value('Opmerking')}`,
          value('Bevat sporen van/Contains traces of') &&
            `Contains traces of: ${value('Bevat sporen van/Contains traces of')}`,
          value('Is verrijkt met/Is fortified with') &&
            `Fortified with: ${value('Is verrijkt met/Is fortified with')}`,
        ]
          .filter(Boolean)
          .join('\n') || null;
      const product = productInputSchema.safeParse({
        name,
        aliases,
        description,
        brand: null,
        calculationMode: 'DIRECT',
        referenceQuantity: '100',
        referenceUnit: reference[1].toLowerCase() === 'ml' ? 'ML' : 'G',
        referenceLabel: null,
        calories: number(columns.calories),
        protein: number(columns.protein),
        carbohydrates: number(columns.carbohydrates),
        fat: number(columns.fat),
        fiber: number(columns.fiber, true),
        servingSizeQuantity: null,
        servingSizeUnit: null,
        servingSizeIsEstimated: false,
        densityGramsPerMl: null,
        densityIsEstimated: false,
        verificationStatus: 'VERIFIED',
        servings: [],
      });
      if (!product.success) {
        throw new Error(
          `invalid ${product.error.issues[0].path.join('.')}: ${product.error.issues[0].message}`
        );
      }
      rows.push({
        code,
        product: product.data,
        original: Object.fromEntries(header.map((name, column) => [name, cells[column]])),
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      totalErrors++;
      if (errors.length < 10) {
        errors.push(`Row ${line}: ${error.message}`);
      }
    }
  }
  if (totalErrors) {
    throw new NevoImportError(
      `${totalErrors} invalid row${totalErrors === 1 ? '' : 's'}. ${errors.join(' ')}${totalErrors > errors.length ? ' Fix these rows and upload again to see further errors.' : ''}`
    );
  }
  return { version: version!, rows, fileHash: createHash('sha256').update(csv).digest('hex') };
}
