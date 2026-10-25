import { createReadStream } from 'node:fs';

/** Streaming RFC4180 records, including quoted newlines. Reject oversized/malformed records. */
export async function* csvRecords(file: string): AsyncGenerator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let size = 0;
  let first = true;
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    for (const char of chunk) {
      if (first) {
        first = false;
        if (char === '\uFEFF') {
          continue;
        }
      }
      if (++size > 1024 * 1024) {
        throw new Error('CSV record exceeds 1 MiB.');
      }
      if (quoted) {
        if (char === '"') {
          quoted = false;
          closed = true;
        } else {
          field += char;
        }
        continue;
      }
      if (closed && char === '"') {
        field += '"';
        quoted = true;
        closed = false;
        continue;
      }
      if (char === '"' && !field && !closed) {
        quoted = true;
      } else if (char === ',' || char === '\n') {
        row.push(field);
        field = '';
        closed = false;
        if (char === '\n') {
          if (row.some((value) => value !== '')) {
            yield row;
          }
          row = [];
          size = 0;
        }
      } else if (char !== '\r') {
        if (closed) {
          throw new Error('Unexpected character after CSV quote.');
        }
        field += char;
      }
    }
  }
  if (quoted) {
    throw new Error('Unterminated CSV quote.');
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

export function csvObject(header: string[], values: string[]) {
  if (values.slice(header.length).some((value) => value !== '')) {
    throw new Error('Unexpected extra CSV fields.');
  }
  return Object.fromEntries(header.map((key, i) => [key, values[i] ?? '']));
}
