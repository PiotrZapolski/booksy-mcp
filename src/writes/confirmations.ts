import { createHash, createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from '../bridge/pairing.js';
import { BooksyError } from '../errors.js';
import { stableStringify } from '../gateway/cache.js';

export const CONFIRM_TTL_SECONDS = 300;

/**
 * A confirmation token proves that this exact request was shown in a dry run a moment ago. It binds
 * the tool name and the canonical request, works once, and dies with the server process.
 */
export class Confirmations {
  private readonly key = randomBytes(32);
  private readonly used = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(tool: string, plan: unknown): string {
    const nonce = randomBytes(12).toString('hex');
    const expires = this.now() + CONFIRM_TTL_SECONDS * 1000;
    return `${nonce}.${expires}.${this.sign(tool, plan, nonce, expires)}`;
  }

  redeem(tool: string, plan: unknown, token: string): void {
    const [nonce, expires, signature] = token.split('.');
    const expiresAt = Number(expires);
    if (!nonce || !signature || !Number.isFinite(expiresAt)) throw this.invalid();
    if (!safeEqual(signature, this.sign(tool, plan, nonce, expiresAt))) throw this.invalid();
    if (this.now() >= expiresAt) {
      throw new BooksyError('invalid_confirmation', 'The dry run has expired. Run it again.');
    }
    if (this.used.has(nonce)) {
      throw new BooksyError('invalid_confirmation', 'This confirmation was already used.');
    }
    this.used.add(nonce);
  }

  private sign(tool: string, plan: unknown, nonce: string, expires: number): string {
    const digest = createHash('sha256').update(stableStringify(plan)).digest('hex');
    return createHmac('sha256', this.key)
      .update(`${tool}\n${digest}\n${nonce}\n${expires}`)
      .digest('hex');
  }

  private invalid(): BooksyError {
    return new BooksyError(
      'invalid_confirmation',
      'The confirmation does not match this request. The arguments or the record changed since ' +
        'the dry run. Run a new dry run with the same arguments.',
    );
  }
}
