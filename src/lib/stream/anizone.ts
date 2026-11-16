import { TtlCache } from "@/lib/lru";

const BASE = "https://anizone.to";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type AzServer = {
  name: string;
  type: "sub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

type AzAnime = {
  slug: string;
  url: string;
  main_title: string;
  title_list: Record<string, string>;
};

type AzAnimeScored = AzAnime & { score: number };

type VidstackData = {
  src: string;
  storage: string;
  snapshot: string;
  subtitles: Array<{
    title: string;
    format: string;
    language: string;
    default: boolean;
    forced: string;
    file: string;
  }>;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similarity(candidate: string, wanted: string): number {
  const c = norm(candidate);
  const w = norm(wanted);
  if (!c || !w) return 0;
  if (c === w) return 100;
  if (c.startsWith(w) || w.startsWith(c)) return 80;
  return 0;
}

function decodeEntities(str: string): string {
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    // Strip backslashes before non-JSON-escape chars (e.g. \「エイジ」 → 「エイジ」)
    .replace(/\\([^"\\\/bfnrtu])/g, "$1")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml,*/*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractXDataItems(html: string): AzAnime[] {
  const match = /x-data="\{\s*items:\s*JSON\.parse\('([^']+)'\)/i.exec(html);
  if (!match) return [];
  try {
    const data = JSON.parse(decodeEntities(match[1])) as AzAnime[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for",
  "ep", "episode", "season", "part", "movie", "ova", "ona", "special",
  "sub", "dub", "hd", "english", "japanese", "chinese", "korean",
]);

function meaningfulWords(s: string): string[] {
  return norm(s)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function wordCoverage(queryWords: string[], titleWords: string[]): number {
  if (!queryWords.length) return 0;
  const covered = queryWords.filter((qw) =>
    titleWords.some((tw) => tw === qw),
  );
  return covered.length / queryWords.length;
}

async function searchAnime(query: string): Promise<AzAnimeScored[]> {
  const html = await getText(`${BASE}/anime`);
  if (!html) return [];
  const items = extractXDataItems(html);

  const qWords = meaningfulWords(query);

  return items
    .map((item) => {
      const titles = [item.main_title, ...Object.values(item.title_list)];
      const titleWordsList = titles.map((t) => meaningfulWords(t));

      const simScore = Math.max(
        ...titles.map((t) => similarity(t, query)),
        similarity(item.slug, query) * 0.9,
      );

      // Strict word coverage: ALL meaningful query words must appear in the title.
      // This prevents "FX Fighter Kurumi-chan" from matching a different anime
      // that merely shares one or two keywords.
      let bestCoverage = 0;
      for (const tw of titleWordsList) {
        bestCoverage = Math.max(bestCoverage, wordCoverage(qWords, tw));
      }

      // Word-overlap score for partial matches (same anime, different wording).
      let wordScore = 0;
      for (const tw of titleWordsList) {
        const shared = qWords.filter((qw) =>
          tw.some((t) => t.includes(qw) || qw.includes(t)),
        );
        const score = (shared.length / Math.max(qWords.length, 1)) * 100;
        wordScore = Math.max(wordScore, score);
      }

      // A candidate only qualifies if ALL meaningful query words appear exactly
      // in the title (100% coverage) OR there's a strong exact/prefix similarity.
      // This prevents wrong-anime matches when titles share partial keywords.
      let bestScore = 0;
      if (bestCoverage >= 1.0) {
        // Strong word coverage — accept with word-overlap score.
        bestScore = Math.max(simScore, wordScore);
      } else if (simScore >= 70) {
        // High similarity (exact/near-exact match) — accept.
        bestScore = simScore;
      } else {
        // Weak match — reject to avoid wrong-anime episodes.
        bestScore = 0;
      }

      return { ...item, score: bestScore } as AzAnimeScored;
    })
    .filter((i) => i.score >= 40)
    .sort((a, b) => b.score - a.score);
}

async function extractVidstackData(html: string): Promise<VidstackData | null> {
  const match = /x-data="vidstackPlayer\(JSON\.parse\('([^']+)'\)\)"/i.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(decodeEntities(match[1])) as VidstackData;
  } catch {
    return null;
  }
}

async function isPlayable(hlsUrl: string, referer: string): Promise<boolean> {
  for (const attempt of [0, 1]) {
    try {
      const res = await fetch(hlsUrl, {
        method: attempt === 0 ? "HEAD" : "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/vnd.apple.mpegurl,*/*",
          Referer: referer,
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        if (attempt === 0) return true;
        const text = await res.text().catch(() => "");
        return text.includes("#EXTM3U");
      }
      if (res.status !== 404 && res.status !== 410) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

const g = globalThis as unknown as { __na_az?: TtlCache<AzServer[]> };
const cache: TtlCache<AzServer[]> = (g.__na_az ??= new TtlCache<AzServer[]>(120));

export async function resolveAniZone(params: {
  romaji: string;
  english?: string | null;
  synonyms?: string[] | null;
  ep: number;
}): Promise<AzServer[]> {
  const { romaji, english, synonyms, ep } = params;
  const titles = [...new Set([romaji, english ?? "", ...(synonyms ?? [])].filter(Boolean))];
  const key = `az:${titles.join("|")}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: AzServer[], ok: boolean) => {
    cache.set(key, data, ok ? 25 * 60_000 : 5 * 60_000);
    return data;
  };

  const searches = await Promise.all(titles.map((title) => searchAnime(title)));
  const bySlug = new Map<string, AzAnimeScored>();
  for (const list of searches) {
    for (const item of list) {
      const prev = bySlug.get(item.slug);
      if (!prev || item.score > prev.score) bySlug.set(item.slug, item);
    }
  }
  const candidates = [...bySlug.values()].sort((a, b) => b.score - a.score);
  if (!candidates.length) return done([], false);

  for (const cand of candidates.slice(0, 8)) {
    const episodeUrl = `${BASE}/anime/${cand.slug}/${ep}`;
    const html = await getText(episodeUrl);
    if (!html) continue;

    const data = await extractVidstackData(html);
    if (!data || !data.src) continue;

    const hls = data.src.includes("m3u8") ? data.src : null;
    if (hls && !(await isPlayable(hls, episodeUrl))) continue;

    const vtt = data.subtitles
      .filter((t) => t.file)
      .map((t) => ({
        label: t.title || t.language || "English",
        url: t.file,
      }))
      .sort(
        (a, b) =>
          (/english|\beng\b/i.test(a.label) ? 0 : 1) -
          (/english|\beng\b/i.test(b.label) ? 0 : 1),
      );

    const server: AzServer = {
      name: "AniZone",
      type: "sub",
      hls,
      vtt,
      referer: episodeUrl,
    };
    return done([server], true);
  }

  return done([], false);
}
