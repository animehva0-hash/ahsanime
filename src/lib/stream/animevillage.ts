import { TtlCache } from "@/lib/lru";

const BASE = "https://www.animevillage.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type AnimeVillageServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  embedUrl: string;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: `${BASE}/` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __na_animevillage?: TtlCache<AnimeVillageServer[]> };
const cache: TtlCache<AnimeVillageServer[]> = (g.__na_animevillage ??= new TtlCache<AnimeVillageServer[]>(120));

export async function resolveAnimeVillage(params: {
  anilistId: number;
  ep: number;
}): Promise<AnimeVillageServer[]> {
  const { anilistId, ep } = params;
  const key = `animevillage:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: AnimeVillageServer[], ok: boolean) => {
    cache.set(key, data, (ok ? 25 * 60_000 : 5 * 60_000));
    return data;
  };

  const out: AnimeVillageServer[] = [];

  for (const isDub of [false, true]) {
    const category = isDub ? "dub" : "sub";
    const episodes = await getJson<{ episodes?: Array<{ id: string; number: number }> }>(
      `${BASE}/api/episodes/${anilistId}?dub=${isDub}`,
    );
    const epEntry = episodes?.episodes?.find((e) => e.number === ep);
    if (!epEntry) continue;

    const encoded = encodeURIComponent(epEntry.id);
    const stream = await getJson<{
      sources?: Array<{ url: string; quality: string; isM3U8: boolean }>;
      subtitles?: Array<{ url: string; lang: string; label: string }>;
      embedUrl?: string;
    }>(`${BASE}/api/stream/${encoded}?category=${category}&ep=${ep}`);

    if (!stream?.sources?.length) continue;

    const src = stream.sources[0];
    out.push({
      name: isDub ? "Dub" : "Sub",
      type: category as AnimeVillageServer["type"],
      hls: src.url,
      vtt: (stream.subtitles ?? []).map((t) => ({ label: t.label, url: t.url })),
      embedUrl: stream.embedUrl ?? "",
    });
  }

  return done(out, out.length > 0);
}
