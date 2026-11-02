import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 47821;
/** Id of the unpacked extension, pinned by the `key` field in its manifest. */
export const DEFAULT_EXTENSION_ID = 'kfihapojogijifblbfjjdelbkibkiedk';
export const MIN_INTERVAL_FLOOR_MS = 1000;

export interface Config {
  port: number;
  extensionIds: string[];
  configDir: string;
  exportDir: string;
  stateDir: string;
  minIntervalMs: number;
  maxRequestsPerHour: number;
  maxResultChars: number;
  maskContacts: boolean;
  /** Write tools named in the configuration, or "all" for every write that does not reach clients. */
  writeTools: string[];
  disabledTools: string[];
}

interface FileConfig {
  port?: number;
  extensionIds?: string[];
  exportDir?: string;
  minIntervalMs?: number;
  maxRequestsPerHour?: number;
  maxResultChars?: number;
  maskContacts?: boolean;
  writeTools?: string[];
  disabledTools?: string[];
}

function list(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === '1' || value.toLowerCase() === 'true';
}

function readFileConfig(path: string): FileConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FileConfig;
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${(error as Error).message}`, { cause: error });
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = homedir();
  const configDir = env.BOOKSY_MCP_CONFIG_DIR ?? join(home, '.config', 'booksy-mcp');
  const file = readFileConfig(join(configDir, 'config.json'));

  const requestedInterval = number(env.BOOKSY_MCP_MIN_INTERVAL_MS) ?? file.minIntervalMs ?? 2000;

  return {
    port: number(env.BOOKSY_MCP_PORT) ?? file.port ?? DEFAULT_PORT,
    extensionIds: list(env.BOOKSY_MCP_EXTENSION_ID) ?? file.extensionIds ?? [DEFAULT_EXTENSION_ID],
    configDir,
    exportDir: env.BOOKSY_MCP_EXPORT_DIR ?? file.exportDir ?? join(home, 'BooksyExports'),
    stateDir: env.BOOKSY_MCP_STATE_DIR ?? join(configDir, 'state'),
    minIntervalMs: Math.max(requestedInterval, MIN_INTERVAL_FLOOR_MS),
    maxRequestsPerHour:
      number(env.BOOKSY_MCP_MAX_REQUESTS_PER_HOUR) ?? file.maxRequestsPerHour ?? 300,
    maxResultChars: number(env.BOOKSY_MCP_MAX_RESULT_CHARS) ?? file.maxResultChars ?? 150_000,
    maskContacts: bool(env.BOOKSY_MCP_MASK_CONTACTS) ?? file.maskContacts ?? false,
    writeTools: list(env.BOOKSY_MCP_WRITE_TOOLS) ?? file.writeTools ?? [],
    disabledTools: list(env.BOOKSY_MCP_DISABLED_TOOLS) ?? file.disabledTools ?? [],
  };
}
