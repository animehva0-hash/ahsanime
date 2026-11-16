/**
 * Browser-direct AniList client — the "bahut IPs" layer.
 *
 * MangaYomi is a client-side app: every user's DEVICE calls AniList with the
 * user's own IP, so every user gets their own 90/min quota. Our Next.js
 * server does the opposite — the whole site shares ONE server IP (currently
 * degraded to 30/min), so one burst shows "AniList is catching its breath"
 * to everybody.
 *
 * This module is the fix: when the server can't serve (quota over / AniList
 * down but reachable from the visitor), the VISITOR'S BROWSER fetches
 * graphql.anilist.co directly (CORS: `access-control-allow-origin: *`,
 * verified). Each visitor spends their OWN quota — the site behaves like it
 * runs on as many IPs as it has visitors, exactly like MangaYomi.
 *
 * Browser-safe: no node imports (never import `@/lib/anilist` here — it pulls
 * `pg` through the DB cache and would break the client bundle). Query strings
 * are intentionally duplicated. Results are cached per-device in localStorage
 * (MangaYomi's per-device Isar cache equivalent).
 */

import type { DiscoverKind, MediaCard } from "@/lib/anime-constants";

const ANILIST_URL = "https://graphql.anilist.co";
const LS_PREFIX = "na_al_";

export type SeasonName = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export type { DiscoverKind };
export type { MediaCard };

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

export type RelationEdge = {
  relationType: string | null;
  node: MediaCard;
};

export type MediaDetail = MediaCard & {
  synonyms: string[] | null;
  source: string | null;
  countryOfOrigin: string | null;
  favourites: number | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  tags: { name: string; rank: number | null }[] | null;
  trailer: { id: string | null; site: string | null; thumbnail: string | null } | null;
  studios: { nodes: { name: string }[] };
  externalLinks: { site: string; url: string; color: string | null }[] | null;
  relations: { edges: RelationEdge[] } | null;
  recommendations: { nodes: { mediaRecommendation: MediaCard | null }[] } | null;
  characters: {
    edges: {
      role: string | null;
      node: { name: { full: string | null }; image: { medium: string | null } };
      voiceActors: { name: { full: string | null }; image: { medium: string | null } }[];
    }[];
  } | null;
};

export type Suggestion = {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { large: string | null; color: string | null };
  format: string | null;
  seasonYear: number | null;
  averageScore: number | null;
};

export type ClientListParams = {
  page?: number;
  perPage?: number;
  search?: string;
  genre?: string;
  format?: string;
  status?: string;
  sort?: string[];
  season?: SeasonName;
  seasonYear?: number;
};

/* ------------------------- per-device cache ------------------------- */

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function lsGet<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(LS_PREFIX + hashKey(key));
    if (!raw) return null;
    const { expires, data } = JSON.parse(raw) as { expires: number; data: T };
    if (Date.now() > expires) {
      window.localStorage.removeItem(LS_PREFIX + hashKey(key));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function lsSet(key: string, data: unknown, ttlMs: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      LS_PREFIX + hashKey(key),
      JSON.stringify({ expires: Date.now() + ttlMs, data }),
    );
  } catch {
    /* quota full / private mode — caching is best-effort */
  }
}

/* ------------------------------ queries ------------------------------ */

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

async function browserQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (!res.ok) throw new Error(`ANILIST_${res.status}`);
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

function seasonFor(date = new Date()): { season: SeasonName; year: number } {
  const m = date.getMonth();
  const year = date.getFullYear();
  if (m <= 1) return { season: "WINTER", year };
  if (m <= 4) return { season: "SPRING", year };
  if (m <= 7) return { season: "SUMMER", year };
  return { season: "FALL", year };
}

/* ------------------------------ API ------------------------------ */

export async function browserGetHome(): Promise<HomeData> {
  const { season, year } = seasonFor();
  const key = `home:${season}:${year}`;
  const cached = lsGet<HomeData>(key);
  if (cached) return cached;
  const data = await browserQuery<{
    trending: { media: MediaCard[] };
    latestUpdated: { media: MediaCard[] };
    seasonNow: { media: MediaCard[] };
    upcoming: { media: MediaCard[] };
    topAllTime: { media: MediaCard[] };
  }>(HOME_QUERY, { season, seasonYear: year });
  const out: HomeData = {
    trending: data.trending.media,
    latestUpdated: data.latestUpdated.media,
    seasonNow: data.seasonNow.media,
    upcoming: data.upcoming.media,
    topAllTime: data.topAllTime.media,
    season,
    seasonYear: year,
  };
  lsSet(key, out, 20 * 60_000);
  return out;
}

export async function browserSearch(params: ClientListParams): Promise<{
  pageInfo: PageInfo | null;
  media: MediaCard[];
}> {
  const vars = { page: 1, perPage: 24, ...params };
  const key = `search:${JSON.stringify(vars)}`;
  const cached = lsGet<{ pageInfo: PageInfo | null; media: MediaCard[] }>(key);
  if (cached) return cached;
  const data = await browserQuery<{ Page: { pageInfo: PageInfo; media: MediaCard[] } }>(
    SEARCH_QUERY,
    vars,
  );
  const out = { pageInfo: data.Page.pageInfo ?? null, media: data.Page.media ?? [] };
  lsSet(key, out, 10 * 60_000);
  return out;
}

export async function browserGetDetail(id: number): Promise<MediaDetail | null> {
  const key = `detail:${id}`;
  const cached = lsGet<MediaDetail>(key);
  if (cached) return cached;
  const data = await browserQuery<{ Media: MediaDetail | null }>(DETAIL_QUERY, { id });
  if (data.Media) lsSet(key, data.Media, 40 * 60_000);
  return data.Media ?? null;
}

export async function browserSuggest(q: string): Promise<Suggestion[]> {
  const key = `suggest:${q.toLowerCase()}`;
  const cached = lsGet<Suggestion[]>(key);
  if (cached) return cached;
  const data = await browserQuery<{ Page: { media: Suggestion[] } }>(SUGGEST_QUERY, {
    search: q,
  });
  const out = data.Page.media ?? [];
  lsSet(key, out, 5 * 60_000);
  return out;
}
