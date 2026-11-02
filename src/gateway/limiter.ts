import type { TrafficPolicy } from '../config.js';
import { BooksyError } from '../errors.js';
import type { TrafficLedger } from './ledger.js';

export type LimiterPolicy = Pick<
  TrafficPolicy,
  | 'minIntervalMs'
  | 'jitterRatio'
  | 'writeIntervalMs'
  | 'exportIntervalMs'
  | 'maxRequestsPerHour'
  | 'maxRequestsPerDay'
  | 'maxExportsPerDay'
>;

export type TaskKind = 'read' | 'write' | 'export';

export interface TaskOptions {
  kind?: TaskKind;
  /** How many Booksy requests this task makes. */
  weight?: number;
}

export interface LimiterOptions {
  policy: LimiterPolicy;
  ledger: TrafficLedger;
  /** Throws when nothing may be sent right now. Checked before and after waiting in line. */
  gate?: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Runs tasks one at a time, in order, with a spaced and uneven gap. There is no way to run two
 * requests at once through this class, whatever the policy says about gaps and budgets.
 */
export class SequentialLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastFinish = 0;
  private readonly lastOfKind = new Map<TaskKind, number>();
  private readonly policy: LimiterPolicy;
  private readonly ledger: TrafficLedger;
  private readonly gate: () => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: LimiterOptions) {
    this.policy = options.policy;
    this.ledger = options.ledger;
    this.gate = options.gate ?? (() => undefined);
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()));
    this.random = options.random ?? Math.random;
  }

  schedule<T>(task: () => Promise<T>, options: TaskOptions = {}): Promise<T> {
    const kind = options.kind ?? 'read';
    const weight = options.weight ?? 1;
    const run = async (): Promise<T> => {
      this.gate();
      this.assertBudget(kind, weight);
      const wait = this.waitFor(kind);
      if (wait > 0) await this.sleep(wait);
      this.gate();
      this.ledger.record('requests', weight);
      if (kind === 'export') this.ledger.record('exports');
      try {
        return await task();
      } finally {
        this.lastFinish = this.now();
        this.lastOfKind.set(kind, this.lastFinish);
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** A pause with the same uneven spread as the gaps. */
  async pause(ms: number): Promise<void> {
    if (ms > 0) await this.sleep(this.spread(ms));
  }

  private spread(ms: number): number {
    return ms * (1 + this.random() * this.policy.jitterRatio);
  }

  private waitFor(kind: TaskKind): number {
    const now = this.now();
    const sinceAny = this.lastFinish + this.spread(this.policy.minIntervalMs) - now;
    const interval =
      kind === 'write'
        ? this.policy.writeIntervalMs
        : kind === 'export'
          ? this.policy.exportIntervalMs
          : 0;
    const last = this.lastOfKind.get(kind) ?? 0;
    const sinceKind = last + this.spread(interval) - now;
    return Math.max(this.lastFinish > 0 ? sinceAny : 0, last > 0 ? sinceKind : 0);
  }

  private assertBudget(kind: TaskKind, weight: number): void {
    const { maxRequestsPerHour, maxRequestsPerDay, maxExportsPerDay } = this.policy;
    if (this.ledger.count('requests', HOUR_MS) + weight > maxRequestsPerHour) {
      throw new BooksyError(
        'budget_exhausted',
        `The hourly budget of ${maxRequestsPerHour} requests is used up. It frees up over the next ` +
          'hour. Answers already read stay available from the cache.',
      );
    }
    if (this.ledger.count('requests', DAY_MS) + weight > maxRequestsPerDay) {
      throw new BooksyError(
        'budget_exhausted',
        `The daily budget of ${maxRequestsPerDay} requests is used up. It frees up over the next ` +
          '24 hours.',
      );
    }
    if (kind === 'export' && this.ledger.count('exports', DAY_MS) >= maxExportsPerDay) {
      throw new BooksyError(
        'budget_exhausted',
        `The daily limit of ${maxExportsPerDay} report exports is used up. It frees up over the ` +
          'next 24 hours.',
      );
    }
  }
}
