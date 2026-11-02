import { BooksyError } from '../errors.js';

export interface LimiterOptions {
  minIntervalMs: number;
  maxPerHour: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Runs tasks one at a time, in order, with a spaced and slightly uneven gap, the way a person moves
 * through the panel. There is no way to run two requests at once through this class.
 */
export class SequentialLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private readonly starts: number[] = [];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: LimiterOptions) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()));
    this.random = options.random ?? Math.random;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.assertBudget();
      const gap = this.options.minIntervalMs * (1 + this.random() * 0.5);
      const wait = this.lastStart + gap - this.now();
      if (this.lastStart > 0 && wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      this.starts.push(this.lastStart);
      return task();
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  usedThisHour(): number {
    this.trim();
    return this.starts.length;
  }

  private assertBudget(): void {
    if (this.usedThisHour() >= this.options.maxPerHour) {
      throw new BooksyError(
        'budget_exhausted',
        `Hourly request budget of ${this.options.maxPerHour} is used up. It frees up over the next hour.`,
      );
    }
  }

  private trim(): void {
    const cutoff = this.now() - HOUR_MS;
    while (this.starts.length > 0 && (this.starts[0] as number) < cutoff) this.starts.shift();
  }
}
