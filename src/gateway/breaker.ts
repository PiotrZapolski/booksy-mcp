import { BooksyError } from '../errors.js';
import type { TrafficLedger } from './ledger.js';

export interface BreakerStatus {
  active: boolean;
  seconds_left: number;
  until: string | null;
  reason: string | null;
}

/**
 * Stops all traffic after a sign that Booksy does not want this request. The tool never retries on
 * its own, and it never tries to get past a block. This works the same with safe mode on or off:
 * the mode only sets how long the stop lasts.
 */
export class Breaker {
  constructor(
    private readonly ledger: TrafficLedger,
    private readonly now: () => number = Date.now,
  ) {}

  assertClosed(): void {
    const block = this.ledger.blocked();
    if (!block) return;
    throw new BooksyError(
      'blocked_by_booksy',
      `Paused for ${describe(block.until - this.now())} more after: ${block.reason}. ` +
        'Open the panel yourself and check that it works before using this tool again.',
    );
  }

  /** Never shortens a longer stop that is already running. */
  trip(reason: string, cooldownMs: number): void {
    const until = this.now() + cooldownMs;
    const running = this.ledger.blocked();
    if (running && running.until >= until) return;
    this.ledger.block(until, reason);
  }

  status(): BreakerStatus {
    const block = this.ledger.blocked();
    if (!block) return { active: false, seconds_left: 0, until: null, reason: null };
    return {
      active: true,
      seconds_left: Math.ceil((block.until - this.now()) / 1000),
      until: new Date(block.until).toISOString(),
      reason: block.reason,
    };
  }
}

export function describe(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 120) return `${minutes} minute(s)`;
  return `${Math.ceil(minutes / 60)} hours`;
}
