import type { VttCue } from "./vtt";

/**
 * Global (cross-session) translation cache.
 *
 * A free-tier Gemini key only allows ~20 requests per day per model, so every
 * request is precious: the same episode + language must never be translated
 * twice, no matter how many users watch it. Entries are kept on globalThis so
 * Next dev hot reloads don't wipe them.
 */

export type TranslationEntry = {
  cues: VttCue[];
  /** True once the whole subtitle file has been translated. */
  full: boolean;
  lang: string;
  url: string;
  updatedAt: number;
};

type Store = Map<string, TranslationEntry>;

const g = globalThis as typeof globalThis & { __na_tx_cache?: Store };

const MAX_ENTRIES = 120;
const TTL_MS = 12 * 60 * 60_000; // 12h

function store(): Store {
  if (!g.__na_tx_cache) g.__na_tx_cache = new Map<string, TranslationEntry>();
  return g.__na_tx_cache;
}

function keyFor(url: string, lang: string): string {
  return `${lang}\u0000${url}`;
}

function sweep(now: number): void {
  const s = store();
  for (const [k, v] of s) {
    if (now - v.updatedAt > TTL_MS) s.delete(k);
  }
  // Hard cap: drop the oldest half when full.
  if (s.size > MAX_ENTRIES) {
    const oldest = [...s.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [k] of oldest.slice(0, Math.ceil(oldest.length / 2))) s.delete(k);
  }
}

function normalize(cues: VttCue[]): VttCue[] {
  return cues.map((c) => ({
    id: c.id,
    start: c.start,
    end: c.end,
    text: c.text,
    ...(c.translated ? { translated: true } : {}),
  }));
}

export function getCached(url: string, lang: string): TranslationEntry | null {
  const hit = store().get(keyFor(url, lang));
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > TTL_MS) {
    store().delete(keyFor(url, lang));
    return null;
  }
  return hit;
}

/** Cached cues for a time window (works for partial progressive requests). */
export function getCachedWindow(url: string, lang: string, t0: number, t1: number): VttCue[] | null {
  const hit = getCached(url, lang);
  if (!hit || hit.cues.length === 0) return null;
  const win = hit.cues.filter((c) => c.start >= t0 - 0.001 && c.start < t1);
  return win.length ? win : null;
}

export function putCached(
  url: string,
  lang: string,
  cues: VttCue[],
  full: boolean,
): void {
  const now = Date.now();
  const k = keyFor(url, lang);
  const existing = store().get(k);
  const merged = new Map<number, VttCue>();
  if (existing && now - existing.updatedAt <= TTL_MS) {
    for (const c of existing.cues) merged.set(c.id, c);
  }
  for (const c of normalize(cues)) merged.set(c.id, c);
  const all = [...merged.values()].sort((a, b) => a.start - b.start);
  store().set(k, { cues: all, full: full || Boolean(existing?.full), lang, url, updatedAt: now });
  sweep(now);
}
