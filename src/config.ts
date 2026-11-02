import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 47821;
/** Id of the unpacked extension, pinned by the `key` field in its manifest. */
export const DEFAULT_EXTENSION_ID = 'kfihapojogijifblbfjjdelbkibkiedk';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Every traffic threshold of the project. All of them live here, and the README section
 * "Safe mode" documents the same values.
 */
export interface TrafficPolicy {
  safeMode: boolean;
  /** Gap after the previous request has finished. */
  minIntervalMs: number;
  /** Random extra on top of any gap, as a share of that gap. */
  jitterRatio: number;
  /** Gap between two writes. */
  writeIntervalMs: number;
  /** Gap between two report exports. */
  exportIntervalMs: number;
  maxRequestsPerHour: number;
  maxRequestsPerDay: number;
  maxExportsPerDay: number;
  /** Reports in one report_export_batch call. */
  maxExportsPerCall: number;
  /** Requests one tool call may make, whatever it reads: pages, windows or weeks. */
  maxPagesPerCall: number;
  /** Longest date range of a tool that reads the calendar or the shifts. */
  maxRangeDays: number;
  /** Longest period of one report. */
  maxReportDays: number;
  /** Calendar ranges are read in windows of this length. */
  windowDays: number;
  /** Extra pause between two windows or weeks of one tool call. */
  windowPauseMs: number;
  /** Read cache lifetimes are multiplied by this. */
  cacheMultiplier: number;
  /** A read with fresh=true still uses a cached answer younger than this. */
  minFreshSeconds: number;
  /** No requests when the panel tab or the computer has been unused for longer than this. */
  maxBackgroundMs: number;
  /** Pause after a 429, a captcha or a request_blocked answer. */
  blockCooldownMs: number;
  /** Pause after a plain 403, which can also mean a missing permission. */
  forbiddenCooldownMs: number;
}

/** On unless switched off in so many words. */
export const SAFE_TRAFFIC: TrafficPolicy = {
  safeMode: true,
  minIntervalMs: 4 * SECOND,
  jitterRatio: 1,
  writeIntervalMs: 30 * SECOND,
  exportIntervalMs: MINUTE,
  maxRequestsPerHour: 120,
  maxRequestsPerDay: 500,
  maxExportsPerDay: 15,
  maxExportsPerCall: 5,
  maxPagesPerCall: 15,
  maxRangeDays: 92,
  maxReportDays: 366,
  windowDays: 14,
  windowPauseMs: 10 * SECOND,
  cacheMultiplier: 5,
  minFreshSeconds: 60,
  maxBackgroundMs: 20 * MINUTE,
  blockCooldownMs: 6 * HOUR,
  forbiddenCooldownMs: HOUR,
};

/** Safe mode off: the user takes the risk. Requests stay sequential and a stop signal still stops. */
export const UNRESTRICTED_TRAFFIC: TrafficPolicy = {
  safeMode: false,
  minIntervalMs: 0,
  jitterRatio: 0,
  writeIntervalMs: 0,
  exportIntervalMs: 0,
  maxRequestsPerHour: Infinity,
  maxRequestsPerDay: Infinity,
  maxExportsPerDay: Infinity,
  maxExportsPerCall: Infinity,
  maxPagesPerCall: Infinity,
  maxRangeDays: Infinity,
  maxReportDays: Infinity,
  windowDays: 31,
  windowPauseMs: 0,
  cacheMultiplier: 1,
  minFreshSeconds: 0,
  maxBackgroundMs: Infinity,
  blockCooldownMs: 15 * MINUTE,
  forbiddenCooldownMs: 15 * MINUTE,
};

export const SAFE_MODE_OFF_WARNING =
  'Safe mode is OFF: no budgets and no gaps between requests. You take the risk of overloading ' +
  'the panel or having the account limited by Booksy.';

export interface Config {
  port: number;
  extensionIds: string[];
  configDir: string;
  exportDir: string;
  stateDir: string;
  traffic: TrafficPolicy;
  maxResultChars: number;
  /** Masks e-mails and phone numbers in everything tools return. */
  redactPii: boolean;
  /** Write tools named in the configuration, or "all" for every write that does not reach clients. */
  writeTools: string[];
  disabledTools: string[];
}

interface FileConfig {
  port?: number;
  extensionIds?: string[];
  exportDir?: string;
  safeMode?: boolean;
  minIntervalMs?: number;
  maxRequestsPerHour?: number;
  maxResultChars?: number;
  redactPii?: boolean;
  /** Former name of redactPii. */
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

/** Safe mode ends only on an explicit "off". A typo or an unknown value keeps it on. */
function safeModeOff(env: string | undefined, file: boolean | undefined): boolean {
  if (env !== undefined && env.trim() !== '') {
    return ['0', 'false', 'off', 'no'].includes(env.trim().toLowerCase());
  }
  return file === false;
}

/** Own gap and budget settings can only tighten safe mode. With safe mode off they apply as set. */
export function resolveTraffic(
  safeMode: boolean,
  own: { minIntervalMs?: number | undefined; maxRequestsPerHour?: number | undefined },
): TrafficPolicy {
  const base = safeMode ? SAFE_TRAFFIC : UNRESTRICTED_TRAFFIC;
  return {
    ...base,
    minIntervalMs: Math.max(base.minIntervalMs, own.minIntervalMs ?? 0),
    maxRequestsPerHour: Math.min(base.maxRequestsPerHour, own.maxRequestsPerHour ?? Infinity),
  };
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

  return {
    port: number(env.BOOKSY_MCP_PORT) ?? file.port ?? DEFAULT_PORT,
    extensionIds: list(env.BOOKSY_MCP_EXTENSION_ID) ?? file.extensionIds ?? [DEFAULT_EXTENSION_ID],
    configDir,
    exportDir: env.BOOKSY_MCP_EXPORT_DIR ?? file.exportDir ?? join(home, 'BooksyExports'),
    stateDir: env.BOOKSY_MCP_STATE_DIR ?? join(configDir, 'state'),
    traffic: resolveTraffic(!safeModeOff(env.BOOKSY_MCP_SAFE_MODE, file.safeMode), {
      minIntervalMs: number(env.BOOKSY_MCP_MIN_INTERVAL_MS) ?? file.minIntervalMs,
      maxRequestsPerHour: number(env.BOOKSY_MCP_MAX_REQUESTS_PER_HOUR) ?? file.maxRequestsPerHour,
    }),
    maxResultChars: number(env.BOOKSY_MCP_MAX_RESULT_CHARS) ?? file.maxResultChars ?? 150_000,
    redactPii:
      bool(env.BOOKSY_MCP_REDACT_PII) ??
      bool(env.BOOKSY_MCP_MASK_CONTACTS) ??
      file.redactPii ??
      file.maskContacts ??
      false,
    writeTools: list(env.BOOKSY_MCP_WRITE_TOOLS) ?? file.writeTools ?? [],
    disabledTools: list(env.BOOKSY_MCP_DISABLED_TOOLS) ?? file.disabledTools ?? [],
  };
}
