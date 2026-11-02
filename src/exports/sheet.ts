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
      row[index] = value;
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

/**
 * Turns rows into records. Exports often start with title lines, so the header is the first row
 * that has as many filled cells as the widest row.
 */
export function toRecords(rows: string[][]): Array<Record<string, string>> {
  const filled = (row: string[]): number => row.filter((cell) => cell !== '').length;
  const widest = rows.slice(0, 30).reduce((max, row) => Math.max(max, filled(row)), 0);
  const headerIndex = rows.findIndex((row) => filled(row) === widest);
  if (headerIndex < 0 || widest === 0) return [];

  const header = (rows[headerIndex] as string[]).map((cell, index) => cell || `column_${index + 1}`);
  return rows
    .slice(headerIndex + 1)
    .filter((row) => filled(row) > 0)
    .map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])));
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
