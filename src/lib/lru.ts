/**
 * Bounded TTL cache (insertion-order LRU).
 *
 * Unbounded Maps were the cause of long-running instances dying: subtitle
 * payloads alone are ~80 KB each, so a busy multi-user session could exhaust
 * memory and take the whole server down. Every cache in the app now goes
 * through this helper with a hard entry cap.
 */

export type Entry<T> = { expires: number; data: T };

export class TtlCache<T> {
  private map: Map<string, Entry<T>>;
  private max: number;

  constructor(max = 200, seed?: Map<string, Entry<T>>) {
    this.map = seed ?? new Map();
    this.max = max;
  }

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.data;
  }

  /** Raw entry access (used where callers inspect sentinel values). */
  peek(key: string): Entry<T> | undefined {
    const hit = this.map.get(key);
    if (hit && hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit;
  }

  set(key: string, data: T, ttlMs: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { expires: Date.now() + ttlMs, data });
    this.trim();
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  private trim(): void {
    if (this.map.size <= this.max) return;
    const now = Date.now();
    // 1. drop expired entries first
    for (const [k, v] of this.map) {
      if (v.expires <= now) this.map.delete(k);
      if (this.map.size <= this.max) return;
    }
    // 2. still too big → evict oldest (front of insertion order)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
