import { TtlCache } from "@/lib/lru";
import { cacheGet, cacheSet, cachePrune } from "@/lib/db-cache";

/** Occasional prune so the fallback table stays small. */
let pruneStarted = false;
function startPruner() {
  if (pruneStarted) return;
  pruneStarted = true;
  const t = setInterval(() => void cachePrune(24).catch(() => {}), 30 * 60_000);
  t.unref?.();
}
/**
 * AniList GraphQL client with rate-limit handling.
 *
 * Docs: https://docs.anilist.co/guide/rate-limiting
 *  - 90 req/min (currently degraded to 30/min)
 *  - Responds with X-RateLimit-Limit / X-RateLimit-Remaining headers
 *  - 429 responses include Retry-After (seconds) & X-RateLimit-Reset (unix ts)
 *
 * Strategy: every request goes through a global throttle queue that keeps a
 * safe minimum interval between requests, adapts aggressiveness using the
 * X-RateLimit-Remaining header, honors Retry-After on 429, and caches
 * responses in memory so repeat page hits never touch the API.
 */

const ANILIST_URL = "https://graphql.anilist.co";

/* ---------------------------------- types --------------------------------- */

import type { DateObj, MediaCard } from "@/lib/anime-constants";
export type { DateObj, MediaCard };
import {
  DISCOVER_CONFIG,
  episodeTotal,
  pickTitle,
  type DiscoverKind,
} from "@/lib/anime-constants";
export { DISCOVER_CONFIG, episodeTotal, pickTitle };
export type { DiscoverKind };
export { GENRES, FORMATS } from "@/lib/anime-constants";


export type RelationEdge = {
  relationType: string | null;
  node: MediaCard;
};

export type CharacterEdge = {
  role: string | null;
  node: { name: { full: string | null }; image: { medium: string | null } };
  voiceActors: { name: { full: string | null }; image: { medium: string | null } }[];
};

export type MediaDetail = MediaCard & {
  synonyms: string[] | null;
  source: string | null;
  countryOfOrigin: string | null;
  favourites: number | null;
  endDate: DateObj | null;
  tags: { name: string; rank: number | null }[] | null;
  trailer: { id: string | null; site: string | null; thumbnail: string | null } | null;
  studios: { nodes: { name: string }[] };
  externalLinks: { site: string; url: string; color: string | null }[] | null;
  relations: { edges: RelationEdge[] } | null;
  recommendations: { nodes: { mediaRecommendation: MediaCard | null }[] } | null;
  characters: { edges: CharacterEdge[] } | null;
};

export type PageInfo = {
  total: number | null;
  currentPage: number | null;
  lastPage: number | null;
  hasNextPage: boolean | null;
};

export type HomeData = {
  trending: MediaCard[];
  latestUpdated: MediaCard[];
  seasonNow: MediaCard[];
  upcoming: MediaCard[];
  topAllTime: MediaCard[];
  season: string;
  seasonYear: number;
};

/* ------------------------------- rate limiter ------------------------------ */

type Limiter = {
  nextAt: number;
  remaining: number;
  resetAt: number;
  interval: number;
};

/** MangaYomi-style circuit breaker (ServiceAvailability).
 * When AniList says 429, we mark the service DOWN for a while and fail fast
 * instead of hammering it — exactly what MangaYomi's `markDown/outage`
 * does for its tracker. Without this, every visitor retries and the 30/min
 * quota never recovers. */
type Circuit = { downUntil: number; consec429: number };

const g = globalThis as unknown as {
  __na_limiter?: Limiter;
  __na_cache?: TtlCache<unknown>;
  __na_circuit?: Circuit;
  __na_inflight?: Map<string, Promise<unknown>>;
};

const limiter: Limiter = (g.__na_limiter ??= {
  nextAt: 0,
  remaining: 30,
  resetAt: 0,
  interval: 750,
});

const circuit: Circuit = (g.__na_circuit ??= { downUntil: 0, consec429: 0 });

/** Same-query coalescing: 10 parallel renders for one anime share 1 fetch. */
const inflight: Map<string, Promise<unknown>> = (g.__na_inflight ??= new Map());

function isDown(): boolean {
  return Date.now() < circuit.downUntil;
}

function markDown(retryAfterMs: number): void {
  circuit.consec429++;
  // Exponential-ish: 1st refusal ~15s, repeated refusals up to 60s.
  const backoff = Math.min(60_000, Math.max(retryAfterMs, 15_000) + circuit.consec429 * 5_000);
  circuit.downUntil = Date.now() + backoff;
  limiter.nextAt = Math.max(limiter.nextAt, circuit.downUntil);
}

function markUp(): void {
  circuit.consec429 = 0;
  circuit.downUntil = 0;
}

/** Quota stats for /api/health — reads local state, costs 0 AniList calls. */
export function anilistStats(): {
  remaining: number;
  intervalMs: number;
  circuitOpen: boolean;
  downForMs: number;
  consec429: number;
  cacheSize: number;
  inflight: number;
} {
  return {
    remaining: limiter.remaining,
    intervalMs: limiter.interval,
    circuitOpen: isDown(),
    downForMs: Math.max(0, circuit.downUntil - Date.now()),
    consec429: circuit.consec429,
    cacheSize: cache.size,
    inflight: inflight.size,
  };
}

const cache: TtlCache<unknown> = (g.__na_cache ??= new TtlCache<unknown>(400));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Multi-user friendly semaphore: up to 2 concurrent network calls. The
 * adaptive `nextAt` spacing still enforces rate-limit discipline globally.
 */
let inflightCount = 0;
const waiters: (() => void)[] = [];
const MAX_INFLIGHT = 2;

async function acquireSlot(): Promise<void> {
  if (inflightCount < MAX_INFLIGHT) {
    inflightCount++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}
function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();
  else inflightCount--;
}

async function rawQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  // Fail fast while the circuit is open — never queue network calls against
  // a service that just told us to back off (MangaYomi: ServiceAvailability.outage).
  if (isDown()) throw new Error("AniList: circuit open (backing off)");

  for (let attempt = 0; attempt <= 2; attempt++) {
    await acquireSlot();
    let res: Response;
    try {
      const wait = Math.max(0, limiter.nextAt - Date.now());
      if (wait > 0) await sleep(wait);
      limiter.nextAt = Date.now() + limiter.interval;

      res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "AHSANIME/1.0 (+https://indanime.co)",
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } finally {
      // Slot covers ONLY the network call — the old code slept for 15s while
      // holding one of 2 global slots, stalling every other user behind it.
      releaseSlot();
    }

    // Read rate limit headers (per AniList docs) to steer the throttle.
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null) limiter.remaining = Number(remaining);
    const reset = res.headers.get("x-ratelimit-reset");
    if (reset) limiter.resetAt = Number(reset) * 1000;

    // Adaptive pacing based on remaining quota.
    if (limiter.remaining <= 5) limiter.interval = 2600;
    else if (limiter.remaining <= 15) limiter.interval = 1400;
    else limiter.interval = 750;

    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get("retry-after") ?? "15");
      markDown(Math.min(retryAfterSec, 60) * 1000);
      if (attempt < 2) {
        // Bounded backoff OUTSIDE the semaphore so other cached reads proceed.
        await sleep(Math.min(retryAfterSec, 15) * 1000 + 400);
        if (isDown() && attempt >= 1) break;
        continue;
      }
      throw new Error("AniList: Too Many Requests");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // MangaYomi marks the tracker DOWN on any refusal (not just 429): a
      // disabled API (403 "temporarily disabled") or a 5xx must also fail fast
      // instead of burning quota on every new unique query.
      if (res.status === 403 || res.status >= 500) markDown(30_000);
      throw new Error(`AniList responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data: T; errors?: { message: string; locations?: unknown }[] };
    if (json.errors?.length) throw new Error(json.errors[0].message);
    markUp();
    return json.data;
  }
  throw new Error("AniList: Too Many Requests");
}

/** Live fetch shared by foreground + background paths (deduped). */
function fetchLive<T>(key: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = rawQuery<T>(query, variables).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

const STALE_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days — stale art beats no art

/** Execute a GraphQL query with in-memory caching (TTL seconds). */
export async function alQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  ttlSec = 600,
): Promise<T> {
  const key = JSON.stringify([query, variables]);
  const hit = cache.get(key);
  if (hit !== undefined) {
    const marker = hit as { __anilistTransientError?: string };
    if (marker && typeof marker.__anilistTransientError === "string") {
      throw new Error(marker.__anilistTransientError);
    }
    return hit as T;
  }
  // Coalesce parallel renders for the same key into one network call.
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  // MangaYomi pattern: serve the cached library instantly (stale-while-
  // revalidate) instead of blocking every page on a live call. If Postgres
  // has a fresh copy, return it now and refresh quietly in the background —
  // this is what keeps the site alive on 30 req/min with many visitors.
  try {
    const fresh = await cacheGet<T>(key, ttlSec).catch(() => null);
    if (fresh !== null) {
      cache.set(key, fresh, ttlSec * 1000);
      startPruner();
      void fetchLive<T>(key, query, variables)
        .then((data) => {
          cache.set(key, data, ttlSec * 1000);
          void cacheSet(key, data).catch(() => {});
        })
        .catch(() => {});
      return fresh;
    }
  } catch {
    /* fall through to live */
  }

  const live = fetchLive<T>(key, query, variables);
  try {
    const data = await live;
    cache.set(key, data, ttlSec * 1000);
    // Persist so a restart or an upstream outage can still serve content.
    startPruner();
    void cacheSet(key, data).catch(() => {});
    return data;
  } catch (err) {
    // AniList refused us (usually a 429 in the current degraded mode).
    // Serve the last known-good payload from Postgres instead of an error page.
    const fallback = await cacheGet<T>(key, STALE_MAX_AGE_SEC).catch(() => null);
    if (fallback !== null) {
      // Warm the in-memory cache too so subsequent hits skip the DB.
      cache.set(key, fallback, Math.max(ttlSec, 300) * 1000);
      return fallback;
    }

    // Nothing cached yet → negative-cache the failure so repeat queries fail
    // fast instead of re-hammering a rate-limited upstream.
    cache.set(
      key,
      { __anilistTransientError: err instanceof Error ? err.message : "error" },
      90 * 1000,
    );
    throw err;
  }
}

/* --------------------------------- queries -------------------------------- */

const CARD_FIELDS = /* GraphQL */ `
  id
  idMal
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  format
  status
  episodes
  duration
  averageScore
  popularity
  seasonYear
  season
  genres
  description(asHtml: false)
  nextAiringEpisode { airingAt episode timeUntilAiring }
  trending
  startDate { year month day }
`;

const FRAGMENT = `fragment Card on Media {\n${CARD_FIELDS}\n}`;

export type SeasonName = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export function seasonFor(date = new Date()): { season: SeasonName; year: number } {
  const m = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  if (m <= 1) return { season: "WINTER", year };
  if (m <= 4) return { season: "SPRING", year };
  if (m <= 7) return { season: "SUMMER", year };
  return { season: "FALL", year };
}

export function nextSeasonFor(): { season: SeasonName; year: number } {
  const { season, year } = seasonFor();
  const order: SeasonName[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const i = order.indexOf(season);
  return i === 3 ? { season: "WINTER", year: year + 1 } : { season: order[i + 1], year };
}

const HOME_QUERY = /* GraphQL */ `
  query Home($season: MediaSeason, $seasonYear: Int) {
    trending: Page(page: 1, perPage: 12) {
      media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ...Card }
    }
    latestUpdated: Page(page: 1, perPage: 12) {
      media(type: ANIME, status: RELEASING, sort: UPDATED_AT_DESC, isAdult: false) { ...Card }
    }
    seasonNow: Page(page: 1, perPage: 12) {
      media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, isAdult: false) { ...Card }
    }
    upcoming: Page(page: 1, perPage: 12) {
      media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) { ...Card }
    }
    topAllTime: Page(page: 1, perPage: 10) {
      media(type: ANIME, sort: SCORE_DESC, isAdult: false) { ...Card }
    }
  }
  ${FRAGMENT}
`;

export async function getHomeData(): Promise<HomeData> {
  const { season, year } = seasonFor();
  // Single attempt — alQuery already serves 7-day stale Postgres data on 429
  // and coalesces parallel calls. The old sleep-2.5s-and-retry doubled quota
  // usage exactly when quota was exhausted.
  const data = await alQuery<{
    trending: { media: MediaCard[] };
    latestUpdated: { media: MediaCard[] };
    seasonNow: { media: MediaCard[] };
    upcoming: { media: MediaCard[] };
    topAllTime: { media: MediaCard[] };
  }>(
    HOME_QUERY,
    {
      season,
      seasonYear: year,
    },
    60 * 20,
  );

  return {
    trending: data.trending.media,
    latestUpdated: data.latestUpdated.media,
    seasonNow: data.seasonNow.media,
    upcoming: data.upcoming.media,
    topAllTime: data.topAllTime.media,
    season,
    seasonYear: year,
  };
}

const SEARCH_QUERY = /* GraphQL */ `
  query Search(
    $page: Int
    $perPage: Int
    $search: String
    $genre: String
    $format: MediaFormat
    $status: MediaStatus
    $sort: [MediaSort]
    $season: MediaSeason
    $seasonYear: Int
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage perPage }
      media(
        type: ANIME
        search: $search
        genre: $genre
        format: $format
        status: $status
        sort: $sort
        season: $season
        seasonYear: $seasonYear
        isAdult: false
      ) { ...Card }
    }
  }
  ${FRAGMENT}
`;

export type ListParams = {
  page?: number;
  perPage?: number;
  search?: string;
  genre?: string;
  format?: string;
  status?: string;
  sort?: string[];
  season?: SeasonName;
  seasonYear?: number;
  ttl?: number;
};

export async function searchMedia(params: ListParams): Promise<{
  pageInfo: PageInfo | null;
  media: MediaCard[];
}> {
  const { ttl = 600, ...rest } = params;
  const data = await alQuery<{ Page: { pageInfo: PageInfo; media: MediaCard[] } }>(
    SEARCH_QUERY,
    { page: 1, perPage: 24, ...rest },
    ttl,
  );
  return { pageInfo: data.Page.pageInfo ?? null, media: data.Page.media ?? [] };
}

const DETAIL_QUERY = /* GraphQL */ `
  query Detail($id: Int) {
    Media(id: $id, type: ANIME) {
      ...Card
      synonyms
      source(version: 3)
      countryOfOrigin
      favourites
      endDate { year month day }
      tags { name rank }
      trailer { id site thumbnail }
      studios(isMain: true) { nodes { name } }
      externalLinks { site url color }
      relations { edges { relationType(version: 2) node { ...Card } } }
      recommendations(page: 1, perPage: 12, sort: RATING_DESC) {
        nodes { mediaRecommendation { ...Card } }
      }
      characters(page: 1, perPage: 10, sort: [ROLE, RELEVANCE, ID]) {
        edges {
          role
          node { name { full } image { medium } }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            name { full }
            image { medium }
          }
        }
      }
    }
  }
  ${FRAGMENT}
`;

export async function getMediaDetail(id: number): Promise<MediaDetail | null> {
  const data = await alQuery<{ Media: MediaDetail | null }>(
    DETAIL_QUERY,
    { id },
    60 * 40,
  );
  return data.Media ?? null;
}

/** Tiny query used by generateMetadata — never waits on the heavy detail body. */
const META_QUERY = /* GraphQL */ `
  query Meta($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large color }
    }
  }
`;

export type MediaMeta = {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  description: string | null;
  coverImage: { extraLarge: string | null; large: string | null; color: string | null };
};

export async function getMediaMeta(id: number): Promise<MediaMeta | null> {
  const data = await alQuery<{ Media: MediaMeta | null }>(
    META_QUERY,
    { id },
    60 * 60,
  );
  return data.Media ?? null;
}

/** Suggestion query — ultra-light for the navbar autocomplete. */
const SUGGEST_QUERY = /* GraphQL */ `
  query Suggest($search: String) {
    Page(page: 1, perPage: 8) {
      media(type: ANIME, search: $search, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
        id
        idMal
        title { romaji english native }
        coverImage { large color }
        format
        seasonYear
        averageScore
      }
    }
  }
`;

export type Suggestion = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { large: string | null; color: string | null };
  format: string | null;
  seasonYear: number | null;
  averageScore: number | null;
};

export async function getSuggestions(q: string): Promise<Suggestion[]> {
  const data = await alQuery<{ Page: { media: Suggestion[] } }>(
    SUGGEST_QUERY,
    { search: q },
    60 * 5,
  );
  return data.Page.media ?? [];
}

/** Pick a random anime id — randomized sort + deep random page for real variety. */
export async function getRandomAnimeId(): Promise<number | null> {
  const sorts: [string, number][] = [
    ["POPULARITY_DESC", 160],
    ["TRENDING_DESC", 40],
    ["SCORE_DESC", 250],
    ["FAVOURITES_DESC", 250],
    ["UPDATED_AT_DESC", 120],
  ];
  const picked = sorts[Math.floor(Math.random() * sorts.length)];
  const page = 1 + Math.floor(Math.random() * picked[1]);

  try {
    const { media } = await searchMedia({ page, perPage: 50, sort: [picked[0]] });
    if (media.length) return media[Math.floor(Math.random() * media.length)].id;
  } catch {
    /* fall through */
  }

  const fallback = await searchMedia({ page: 1, perPage: 50, sort: ["TRENDING_DESC"] });
  return fallback.media[Math.floor(Math.random() * fallback.media.length)]?.id ?? null;
}
