import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export function proof(secret: string, label: string, first: string, second: string): string {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${label}\n${first}\n${second}`)
    .digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function newCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * Holds the bridge secret on disk and the one-time pairing code in memory. The secret only opens
 * the local bridge. It gives no access to Booksy.
 */
export class Pairing {
  private code: string | null = null;
  private codeExpires = 0;
  private attempts = 0;

  constructor(
    private readonly secretFile: string,
    private readonly now: () => number = Date.now,
  ) {}

  secret(): string | null {
    if (!existsSync(this.secretFile)) return null;
    const value = readFileSync(this.secretFile, 'utf8').trim();
    return value.length === 64 ? value : null;
  }

  /** The code to show the user, or null when already paired. */
  currentCode(): string | null {
    if (this.secret()) return null;
    if (!this.code || this.now() >= this.codeExpires) this.rotate();
    return this.code;
  }

  /** Accepts the code once. Returns the new secret, or null. */
  redeem(candidate: string): string | null {
    const code = this.currentCode();
    if (!code) return null;
    if (!safeEqual(code, candidate.trim().toUpperCase())) {
      this.attempts += 1;
      if (this.attempts >= MAX_ATTEMPTS) this.rotate();
      return null;
    }
    const secret = randomBytes(32).toString('hex');
    mkdirSync(dirname(this.secretFile), { recursive: true, mode: 0o700 });
    writeFileSync(this.secretFile, secret, { mode: 0o600 });
    chmodSync(this.secretFile, 0o600);
    this.code = null;
    this.attempts = 0;
    return secret;
  }

  reset(): void {
    rmSync(this.secretFile, { force: true });
    this.rotate();
  }

  private rotate(): void {
    this.code = newCode();
    this.codeExpires = this.now() + CODE_TTL_MS;
    this.attempts = 0;
  }
}
