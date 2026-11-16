const BASE = "https://guts.to";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type GutsServer = {
  name: string;
  type: "sub" | "dub";
  hls: string | null;
  embedUrl: string | null;
  vtt: { label: string; url: string }[];
  referer: string;
};

type GutsSource = {
  type: string;
  link: string;
  server: number;
  sources: Array<{ link: string }>;
  tracks: Array<{ label: string; url: string }>;
  htmlGuide: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function similarity(candidate: string, wanted: string): number {
  const c = norm(candidate);
  const w = norm(wanted);
  if (!c || !w) return 0;
  if (c === w) return 100;
  if (c.startsWith(w) || w.startsWith(c)) return 80;
  if (c.includes(w) || w.includes(c)) return 60;
  return 0;
}

async function getText(url: string, referer?: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml,*/*",
        ...(referer ? { Referer: referer } : {}),
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

async function getJson(url: string, referer: string): Promise<any> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: referer,
        Origin: BASE,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function parseMovieIdFromHtml(html: string, query: string): number | null {
  // Search for /anime/<slug>-<movieId> links
  const matches = [...html.matchAll(/href="\/anime\/([^"-]+)-(\d+)"/g)];
  const q = norm(query);

  let best: { id: number; score: number } | null = null;

  for (const m of matches) {
    const slug = m[1];
    const id = parseInt(m[2], 10);
    const score = similarity(slug, q);
    if (!best || score > best.score) {
      best = { id, score };
    }
  }

  return best && best.score >= 40 ? best.id : null;
}

async function searchMovieId(query: string): Promise<number | null> {
  const html = await getText(`${BASE}/search?keyword=${encodeURIComponent(query)}`);
  if (!html) return null;
  return parseMovieIdFromHtml(html, query);
}

async function getServers(movieId: number, ep: number): Promise<Array<{
  name: string;
  type: "sub" | "dub";
  sourceId: string;
  serverId: number;
}>> {
  const html = await getText(
    `${BASE}/ajax/v2/episode/servers?episodeId=${ep}&mov_id=${movieId}`,
    `${BASE}/anime/dummy/episode/${ep}`,
  );
  if (!html) return [];

  try {
    const data = JSON.parse(html);
    if (!data || !data.status || !data.html) return [];

    const results: Array<{ name: string; type: "sub" | "dub"; sourceId: string; serverId: number }> = [];

    for (const block of data.html) {
      if (typeof block !== "string") continue;
      const isDub = block.includes('servers-dub');
      const type: "sub" | "dub" = isDub ? "dub" : "sub";

      // Parse each server-item individually
      const itemMatches = [...block.matchAll(/<div class="item server-item"[^>]*data-type="([^"]+)"[^>]*data-id="([^"]+)"[^>]*data-server-id="(\d+)"[^>]*>[\s\S]*?<a[^>]*class="btn"[^>]*>([^<]+)<\/a>[\s\S]*?<\/div>/g)];
      for (const m of itemMatches) {
        results.push({
          name: m[4].trim(),
          type: type as "sub" | "dub",
          sourceId: m[2],
          serverId: parseInt(m[3], 10),
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

async function getSource(sourceId: string, referer: string): Promise<GutsSource | null> {
  const data = await getJson(
    `${BASE}/ajax/v2/episode/sources?id=${encodeURIComponent(sourceId)}`,
    referer,
  );
  if (!data) return null;
  return data as GutsSource;
}

async function isPlayable(url: string, referer: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": UA,
        Referer: referer,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const g = globalThis as unknown as { __na_guts?: Map<number, GutsServer[]> };
const cache: Map<number, GutsServer[]> | null = (g.__na_guts ?? null);

export async function resolveGuts(params: {
  romaji: string;
  english?: string | null;
  synonyms?: string[] | null;
  ep: number;
}): Promise<GutsServer[]> {
  const { romaji, english, synonyms, ep } = params;

  const titles = [...new Set([romaji, english ?? "", ...(synonyms ?? [])].filter(Boolean))];

  let movieId: number | null = null;
  for (const title of titles) {
    movieId = await searchMovieId(title);
    if (movieId) break;
  }
  if (!movieId) return [];

  const cacheKey = movieId;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const watchReferer = `${BASE}/anime/dummy/episode/${ep}`;
  const servers = await getServers(movieId, ep);
  if (!servers.length) return [];

  const results: GutsServer[] = [];

  for (const sv of servers) {
    const source = await getSource(sv.sourceId, watchReferer);
    if (!source) continue;

    let url: string | null = null;
    let embedUrl: string | null = null;

    if (source.type === "iframe" || source.type === "embed") {
      embedUrl = source.link;
    } else if (source.link) {
      url = source.link;
    }

    if (!url && !embedUrl) continue;

    if (url && !(await isPlayable(url, watchReferer))) continue;

    results.push({
      name: sv.name || "Guts",
      type: sv.type,
      hls: url,
      embedUrl,
      vtt: source.tracks?.filter((t) => t.url && t.label).map((t) => ({
        label: t.label,
        url: t.url,
      })) ?? [],
      referer: watchReferer,
    });
  }

  if (!cache) {
    (g as any).__na_guts = new Map();
  }
  (g.__na_guts as Map<number, GutsServer[]>).set(cacheKey, results);

  return results;
}
