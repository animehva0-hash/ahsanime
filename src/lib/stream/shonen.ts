import { TtlCache } from "@/lib/lru";
/**
 * shonen.to resolver.
 *
 * Chain:
 *   GET /sources/shonen?id={anilistId}&episode={n}&language={sub|dub}
 *     → { data: { source, sources: [{file, type, label, tracks:[{file,label,kind}], intro, outro}] } }
 *
 * Returns direct HLS + VTT tracks (English default + secondary languages).
 * Dub may be absent (SOURCE_NOT_FOUND) for some titles/episodes.
 */

const BASE = "https://shonen.to";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type ShonenServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  embedUrl: string;
};

async function getJson<T>(path: string, referer = `${BASE}/watch`): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: referer,
      },
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

const g = globalThis as unknown as { __na_shonen?: TtlCache<ShonenServer[]> };
const cache: TtlCache<ShonenServer[]> = (g.__na_shonen ??= new TtlCache<ShonenServer[]>(120));

export async function resolveShonen(params: {
  anilistId: number;
  romaji?: string | null;
  english?: string | null;
  ep: number;
}): Promise<ShonenServer[]> {
  const { anilistId, ep } = params;
  const key = `shonen:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: ShonenServer[], ok: boolean) => {
    cache.set(key, data, (ok ? 25 * 60_000 : 5 * 60_000));
    return data;
  };

  const out: ShonenServer[] = [];

  for (const language of ["sub", "dub"] as const) {
    const data = await getJson<{
      data?: {
        provider?: string;
        source?: string;
        sources?: Array<{
          file: string;
          type: string;
          label: string;
          tracks?: Array<{ file: string; label: string; kind?: string }>;
          intro?: { start: number; end: number } | null;
          outro?: { start: number; end: number } | null;
        }>;
      };
    }>(`/sources/shonen?id=${anilistId}&episode=${ep}&language=${language}`, `${BASE}/watch`);

    const sources = data?.data?.sources ?? [];
    if (!sources.length) continue;

    const primary = data?.data?.source;
    const servers = sources.map((s, i) => ({
      name: s.label || (i === 0 ? "Primary" : `Secondary ${i + 1}`),
      type: language as ShonenServer["type"],
      hls: s.file || primary || null,
      vtt: (s.tracks ?? [])
        .filter((t) => Boolean(t.file))
        .map((t) => ({ label: t.label, url: t.file })),
      embedUrl: "",
    }));

    out.push(...servers);
  }

  return done(out, out.length > 0);
}
