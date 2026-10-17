/** Remembers processed WhatsApp message ids so webhook retries are handled once. */
export class Deduper {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 24 * 60 * 60 * 1000, private now: () => number = Date.now) {}

  /** Returns true the first time an id is seen (within the TTL), false for duplicates. */
  firstTime(id: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, t + this.ttlMs);
    return true;
  }

  get size(): number { return this.seen.size; }
}
