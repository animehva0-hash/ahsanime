/**
 * PostgreSQL-backed fallback cache for AniList responses.
 *
 * AniList is currently degraded to 30 req/min. With only an in-memory cache a
 * server restart (or a burst of traffic) wipes the cache and every visitor hits
 * the rate limit — showing the "anime gods are busy" error page.
 *
 * This layer writes each successful AniList response to Postgres and reads it
 * back whenever the live call fails, so the site keeps serving content from the
 * last known-good data. Stale data beats an error page.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";

const g = globalThis as unknown as {
  __na_dbcache_ready?: Promise<void>;
  __na_dbcache_mem?: Map<string, string>;
};

/** Small write-through buffer so repeated reads never touch Postgres twice. */
const mem: Map<string, string> = (g.__na_dbcache_mem ??= new Map());
const MEM_MAX = 500;

function memSet(k: string, payload: string): void {
  if (mem.has(k)) mem.delete(k);
  mem.set(k, payload);
  // Bounded — oldest-first eviction so this buffer can never OOM the server.
  while (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

function ensureTable(): Promise<void> {
  if (!g.__na_dbcache_ready) {
    g.__na_dbcache_ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS anilist_cache (
          cache_key text PRIMARY KEY,
          payload   text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => {
      // Allow a later request to retry if the DB was briefly unavailable.
      g.__na_dbcache_ready = undefined;
      throw err;
    });
  }
  return g.__na_dbcache_ready;
}

function safeKey(key: string): string {
  // MangaYomi lesson: cache keys must NEVER be truncated query text.
  // Old code did `.slice(0, 400)` — the full GraphQL query is ~1500 chars, so
  // variables ({id}, {page}, {search}) lived past char 400 and got cut off.
  // Result: DETAIL id=1 vs id=2, or search "naruto" vs "one piece" produced the
  // SAME Postgres key → wrong anime / wrong covers / empty grids.
  // Fix: SHA-256 hash of the full key (like MangaYomi's hashed Isar keys).
  // Old truncated rows simply miss now (safe — they were poisoned anyway).
  const clean = key.replace(/\u0000/g, "");
  return "al_" + createHash("sha256").update(clean).digest("hex");
}

/** Store a successful response. Never throws — cache failures must not break a page. */
export async function cacheSet(key: string, value: unknown): Promise<void> {
  const k = safeKey(key);
  try {
    const payload = JSON.stringify(value);
    memSet(k, payload);
    await ensureTable();
    await db.execute(sql`
      INSERT INTO anilist_cache (cache_key, payload, updated_at)
      VALUES (${k}, ${payload}, now())
      ON CONFLICT (cache_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
    `);
  } catch {
    /* best-effort: memory copy may still be set */
  }
}

/**
 * Read a cached response. `maxAgeSec` bounds staleness; pass a large value for
 * "serve whatever we have". Returns `null` when nothing usable exists.
 */
export async function cacheGet<T>(
  key: string,
  maxAgeSec = 6 * 60 * 60,
): Promise<T | null> {
  const k = safeKey(key);

  const local = mem.get(k);
  if (local) {
    try {
      return JSON.parse(local) as T;
    } catch {
      mem.delete(k);
    }
  }

  try {
    await ensureTable();
    const res = await db.execute(sql`
      SELECT payload FROM anilist_cache
      WHERE cache_key = ${k}
        AND updated_at > now() - (${maxAgeSec} || ' seconds')::interval
      LIMIT 1
    `);
    const rows = (res as unknown as { rows?: { payload?: string }[] }).rows ?? [];
    const payload = rows[0]?.payload;
    if (!payload) return null;
    memSet(k, payload);
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/** Prune old rows so the table never grows unbounded. */
export async function cachePrune(olderThanHours = 24): Promise<void> {
  try {
    await ensureTable();
    await db.execute(sql`
      DELETE FROM anilist_cache
      WHERE updated_at < now() - (${olderThanHours} || ' hours')::interval
    `);
  } catch {
    /* ignore */
  }
}
