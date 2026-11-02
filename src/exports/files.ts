import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const EXTENSIONS: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/zip': '.zip',
};

function clean(name: string): string {
  const safe = basename(name)
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return safe || 'export';
}

export function extensionFor(contentType: string | null, fallback: string): string {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return (type && EXTENSIONS[type]) ?? fallback;
}

export function saveFile(
  directory: string,
  options: { base: string; filename?: string | null; extension: string; bytes: Uint8Array },
  now: Date = new Date(),
): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = options.filename ? clean(options.filename) : clean(options.base);
  const extension = extname(name) ? '' : options.extension;
  const path = join(directory, `${stamp}-${name}${extension}`);
  writeFileSync(path, options.bytes, { mode: 0o600 });
  return path;
}
