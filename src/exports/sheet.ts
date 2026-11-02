import { strFromU8, unzipSync } from 'fflate';

const MAX_PART_BYTES = 256 * 1024 * 1024;

export interface Sheet {
  name: string;
  rows: string[][];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
      return ENTITIES[body] ?? whole;
    })
    .replace(/_x([0-9A-F]{4})_/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function joinText(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...withoutPhonetics.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decode(match[1] as string))
    .join('');
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((match) =>
    joinText(match[1] ?? ''),
  );
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const letter of reference.replace(/\d+$/, '')) {
    index = index * 26 + letter.toUpperCase().charCodeAt(0) - 64;
  }
  return index - 1;
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
}

/** Drops binary float noise: 9.630000000000001 becomes 9.63. */
function tidyNumber(value: string): string {
  return /^-?\d+\.\d{10,}$/.test(value) ? String(Number(Number(value).toPrecision(12))) : value;
}

function parseRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    const body = rowMatch[1] ?? '';
    let position = 0;
    for (const cell of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] as string;
      const inner = cell[2] ?? '';
      const reference = attribute(attributes, 'r');
      const index = reference ? columnIndex(reference) : position;
      position = index + 1;
      const type = attribute(attributes, 't');
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = joinText(inner);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw !== undefined) value = decode(raw);
      while (row.length < index) row.push('');
      row[index] = tidyNumber(value);
    }
    rows.push(row);
  }
  return rows;
}

/** Reads every sheet of an xlsx file into rows of strings. Formatting and formulas are ignored. */
export function readWorkbook(bytes: Uint8Array): Sheet[] {
  const parts = unzipSync(bytes, {
    filter: (file) =>
      file.originalSize <= MAX_PART_BYTES &&
      /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(
        file.name,
      ),
  });
  const text = (name: string): string | undefined => {
    const part = parts[name];
    return part ? strFromU8(part) : undefined;
  };

  const shared = sharedStrings(text('xl/sharedStrings.xml'));
  const workbook = text('xl/workbook.xml') ?? '';
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';

  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attribute(match[1] as string, 'Id');
    const target = attribute(match[1] as string, 'Target');
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sheets: Sheet[] = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attributes = match[1] as string;
    const id = /r:id="([^"]*)"/.exec(attributes)?.[1];
    const xml = id ? text(targets.get(id) ?? '') : undefined;
    if (xml) {
      sheets.push({
        name: decode(attribute(attributes, 'name') ?? ''),
        rows: parseRows(xml, shared),
      });
    }
  }
  return sheets;
}

export interface Table {
  records: Array<Record<string, string>>;
  /** The summary row, under the same column names. */
  totals: Record<string, string> | null;
  /** Filled rows below the summary, such as small extra tables. */
  extraRows: string[][];
}

/** Labels of the summary row that closes a report table. */
const TOTAL_LABEL = /^(razem|suma|łącznie|total|totals|sum|gesamt|summe)\s*:?$/i;
/** A number, a date or a time: what a data cell holds and a column label does not. */
const VALUE_LIKE = /^[-+]?\d[\d\s.,:/-]*$/;
const HEADER_SEARCH_ROWS = 30;

const filledCells = (row: string[]): string[] => row.filter((cell) => cell !== '');

function isTotalRow(row: string[]): boolean {
  return TOTAL_LABEL.test((filledCells(row)[0] ?? '').trim());
}

/**
 * Report sheets open with title lines and a period line, and may number their rows in a column
 * that has no label. So a data row can be wider than the header. The header is the first row with
 * at least half the width of the table, mostly labels rather than values. A table with values for
 * labels, such as one column per month, falls back to the first row of full width.
 */
function findHeader(rows: string[][]): number {
  const top = rows.slice(0, HEADER_SEARCH_ROWS);
  const widest = top.reduce((max, row) => Math.max(max, filledCells(row).length), 0);
  if (widest === 0) return -1;
  const labelled = top.findIndex((row) => {
    const cells = filledCells(row);
    const values = cells.filter((cell) => VALUE_LIKE.test(cell.trim())).length;
    return cells.length >= Math.max(2, widest / 2) && values * 2 < cells.length;
  });
  return labelled >= 0 ? labelled : top.findIndex((row) => filledCells(row).length === widest);
}

/** True for a column without a label that only counts rows: 1, 2, 3. */
function isCounter(values: string[]): boolean {
  return values.every((value, index) => value === '' || Number(value) === index + 1);
}

function columnNames(header: string[], rows: string[][]): Array<[number, string]> {
  const width = rows.reduce((max, row) => Math.max(max, row.length), header.length);
  const columns: Array<[number, string]> = [];
  for (let index = 0; index < width; index += 1) {
    const label = (header[index] ?? '').trim();
    const values = rows.map((row) => row[index] ?? '');
    if (label) columns.push([index, label]);
    else if (!isCounter(values)) columns.push([index, `column_${index + 1}`]);
  }
  return columns;
}

/** Finds the table on a sheet: its header, its rows up to the summary, and what lies below. */
export function toTable(rows: string[][]): Table {
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) return { records: [], totals: null, extraRows: [] };

  const body = rows.slice(headerIndex + 1);
  const end = body.findIndex(isTotalRow);
  const data = (end < 0 ? body : body.slice(0, end)).filter((row) => filledCells(row).length > 0);
  const columns = columnNames(rows[headerIndex] as string[], data);
  const record = (row: string[]): Record<string, string> =>
    Object.fromEntries(columns.map(([index, name]) => [name, row[index] ?? '']));

  return {
    records: data.map(record),
    totals: end < 0 ? null : record(body[end] as string[]),
    extraRows: end < 0 ? [] : body.slice(end + 1).filter((row) => filledCells(row).length > 0),
  };
}

export function toRecords(rows: string[][]): Array<Record<string, string>> {
  return toTable(rows).records;
}

/** RFC 4180 CSV. Text that a spreadsheet would run as a formula is neutralised. */
export function toCsv(rows: string[][]): string {
  const escape = (cell: string): string => {
    const numeric = cell !== '' && Number.isFinite(Number(cell));
    const safe = !numeric && /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(escape).join(',')).join('\r\n');
}
