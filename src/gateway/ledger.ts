import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

interface LedgerData {
  requests: number[];
  exports: number[];
  blockedUntil: number;
  blockReason: string | null;
}

function empty(): LedgerData {
  return { requests: [], exports: [], blockedUntil: 0, blockReason: null };
}

function times(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'number') : [];
}

/**
 * What the traffic rules have to remember. MCP clients restart the server often, so budgets and a
 * cooldown are kept in a small file. Without it a restart would quietly reset every limit. The
 * file holds timestamps and a reason, never a request or a response.
 */
export class TrafficLedger {
  private data: LedgerData;
  private warned = false;

  constructor(
    private readonly path: string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.data = this.read() ?? empty();
  }

  record(kind: 'requests' | 'exports', weight = 1): void {
    const time = this.now();
    this.trim();
    for (let i = 0; i < weight; i += 1) this.data[kind].push(time);
    this.save();
  }

  count(kind: 'requests' | 'exports', withinMs: number): number {
    const cutoff = this.now() - withinMs;
    return this.data[kind].filter((time) => time > cutoff).length;
  }

  block(until: number, reason: string): void {
    this.data.blockedUntil = until;
    this.data.blockReason = reason;
    this.save();
  }

  /** The reset-cooldown command changes the file while the server runs, so an active block rereads it. */
  blocked(): { until: number; reason: string } | null {
    if (this.data.blockedUntil > this.now() && this.path) {
      const stored = this.read();
      if (stored) {
        this.data.blockedUntil = stored.blockedUntil;
        this.data.blockReason = stored.blockReason;
      }
    }
    if (this.data.blockedUntil <= this.now()) return null;
    return { until: this.data.blockedUntil, reason: this.data.blockReason ?? 'a stop signal' };
  }

  clearBlock(): void {
    this.data.blockedUntil = 0;
    this.data.blockReason = null;
    this.save();
  }

  private trim(): void {
    const cutoff = this.now() - DAY_MS;
    this.data.requests = this.data.requests.filter((time) => time > cutoff).slice(-MAX_ENTRIES);
    this.data.exports = this.data.exports.filter((time) => time > cutoff).slice(-MAX_ENTRIES);
  }

  private read(): LedgerData | null {
    if (!this.path) return null;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<LedgerData>;
      return {
        requests: times(value.requests),
        exports: times(value.exports),
        blockedUntil: typeof value.blockedUntil === 'number' ? value.blockedUntil : 0,
        blockReason: typeof value.blockReason === 'string' ? value.blockReason : null,
      };
    } catch {
      return null;
    }
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      if (this.warned) return;
      this.warned = true;
      console.error(
        `booksy-mcp: cannot save traffic state, limits reset on restart: ${(error as Error).message}`,
      );
    }
  }
}
