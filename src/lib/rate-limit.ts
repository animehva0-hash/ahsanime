/**
 * In-process sliding-window rate limiter.
 * Keyed by client IP (or a supplied identity), safe for multi-instance use
 * per instance, and memory-bounded.
 */

import { TtlCache } from "./lru";

type Bucket = { hits: number[]; };

const g = globalThis as unknown as {
  __na_rl?: TtlCache<Bucket>;
};
const buckets: TtlCache<Bucket> = (g.__na_rl ??= new TtlCache<Bucket>(2000));

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetInMs: number;
  limit: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket, windowMs);
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      resetInMs: Math.max(0, windowMs - (now - oldest)),
      limit,
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket, windowMs);
  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.hits.length),
    resetInMs: windowMs,
    limit,
  };
}

/** Best-effort client IP extraction from proxy headers. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    "unknown"
  );
}
