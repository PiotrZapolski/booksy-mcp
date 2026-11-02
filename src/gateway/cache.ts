const MAX_ENTRIES = 500;

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expires) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, seconds: number): void {
    if (seconds <= 0) return;
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: this.now() + seconds * 1000 });
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Stable JSON, so the same parameters in a different order hit the same entry. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const parts = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
