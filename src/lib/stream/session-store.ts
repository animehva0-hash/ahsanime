/**
 * Per-browser-session translated subtitle cache.
 *
 * - Keyed by sessionId -> episodeKey (`animeId:ep`)
 * - Per-session cache expires after exactly 10 minutes
 * - Loading a different anime/episode removes older entries for that session
 * - Sweeper runs every 60 seconds; page-exit DELETE also purges
 */

export type StoredTranslation = {
  vtt: string;
  lang: string;
  sourceUrl: string;
  createdAt: number;
  expiresAt: number;
};

type SessionEntry = {
  expiresAt: number;
  items: Map<string, StoredTranslation>;
};

const TTL_MS = 10 * 60 * 1000;

const g = globalThis as unknown as {
  __na_sessions?: Map<string, SessionEntry>;
  __na_sweeper?: NodeJS.Timeout;
};

const sessions: Map<string, SessionEntry> = (g.__na_sessions ??= new Map());

if (!g.__na_sweeper) {
  g.__na_sweeper = setInterval(() => {
    purgeIdleSessions();
    capSessions(300);
  }, 60_000);
  g.__na_sweeper.unref?.();
}

export function episodeKey(animeId: string | number, ep: string | number) {
  return `${animeId}:${ep}`;
}

/**
 * Store a translation for a session+episode. Also removes older entries for
 * that session belonging to other anime/episodes.
 */
export function putTranslation(
  sessionId: string,
  animeId: string | number,
  ep: string | number,
  item: Omit<StoredTranslation, "createdAt" | "expiresAt">,
): StoredTranslation {
  const key = episodeKey(animeId, ep);
  let entry = sessions.get(sessionId);
  const now = Date.now();
  if (!entry || entry.expiresAt <= now) {
    entry = { expiresAt: now + TTL_MS, items: new Map() };
    sessions.set(sessionId, entry);
  } else {
    // Any newer translation for a different ep -> session window resets,
    // older entries dropped.
    if (!entry.items.has(key)) entry.items.clear();
    entry.expiresAt = now + TTL_MS;
  }
  const stored: StoredTranslation = {
    ...item,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  entry.items.set(key, stored);
  return stored;
}

export function getTranslation(
  sessionId: string,
  animeId: string | number,
  ep: string | number,
  lang: string,
): StoredTranslation | null {
  const entry = sessions.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  const item = entry.items.get(episodeKey(animeId, ep));
  if (!item || item.expiresAt <= Date.now()) return null;
  if (item.lang !== lang) return null;
  return item;
}

/** Remove a single episode (or all episodes) of a session. */
export function purgeSession(
  sessionId: string,
  animeId?: string | number,
  ep?: string | number,
): number {
  const entry = sessions.get(sessionId);
  if (!entry) return 0;
  if (animeId === undefined || ep === undefined) {
    const count = entry.items.size;
    sessions.delete(sessionId);
    return count;
  }
  const key = episodeKey(animeId, ep);
  const removed = entry.items.delete(key) ? 1 : 0;
  if (entry.items.size === 0) sessions.delete(sessionId);
  return removed;
}

/**
 * Drop every session that has not been touched recently.
 *
 * Called when a viewer stops watching (page hide / unload / route change), so
 * translated subtitles only live as long as someone is actually watching and
 * server memory never fills up with stale translations.
 */
export function purgeIdleSessions(maxIdleMs = 10 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const [sid, entry] of sessions) {
    // Whole-session idle
    if (entry.expiresAt <= now) {
      removed += entry.items.size;
      sessions.delete(sid);
      continue;
    }
    for (const [key, item] of entry.items) {
      if (item.expiresAt <= now) {
        entry.items.delete(key);
        removed++;
      }
    }
    if (entry.items.size === 0) sessions.delete(sid);
  }
  return removed;
}

/** Hard cap on live sessions — oldest are evicted first. */
export function capSessions(max = 300): number {
  if (sessions.size <= max) return 0;
  const ordered = [...sessions.entries()].sort(
    (a, b) => a[1].expiresAt - b[1].expiresAt,
  );
  let removed = 0;
  while (sessions.size > max && ordered.length) {
    const [sid, entry] = ordered.shift()!;
    removed += entry.items.size;
    sessions.delete(sid);
  }
  return removed;
}

export function sessionStats() {
  return {
    sessions: sessions.size,
    entries: [...sessions.values()].reduce((n, e) => n + e.items.size, 0),
  };
}
