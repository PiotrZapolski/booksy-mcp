import { BooksyError } from '../errors.js';

export const COOLDOWN_MS = 15 * 60 * 1000;
export const FORBIDDEN_STRIKES = 3;

/**
 * Stops all traffic after a sign that Booksy does not want this request. The tool never retries on
 * its own, and it never tries to get past a block.
 */
export class Breaker {
  private openUntil = 0;
  private strikes = 0;
  private reason = '';

  constructor(private readonly now: () => number = Date.now) {}

  assertClosed(): void {
    const remaining = this.openUntil - this.now();
    if (remaining <= 0) return;
    const minutes = Math.ceil(remaining / 60_000);
    throw new BooksyError(
      'blocked_by_booksy',
      `Paused for ${minutes} more minute(s) after: ${this.reason}. ` +
        'Open the panel yourself and check that it works before using this tool again.',
    );
  }

  trip(reason: string): void {
    this.reason = reason;
    this.openUntil = this.now() + COOLDOWN_MS;
    this.strikes = 0;
  }

  forbidden(): void {
    this.strikes += 1;
    if (this.strikes >= FORBIDDEN_STRIKES) this.trip('repeated 403 answers from Booksy');
  }

  success(): void {
    this.strikes = 0;
  }

  status(): { open: boolean; secondsLeft: number; reason: string | null } {
    const left = Math.max(0, this.openUntil - this.now());
    return {
      open: left > 0,
      secondsLeft: Math.ceil(left / 1000),
      reason: left > 0 ? this.reason : null,
    };
  }
}
