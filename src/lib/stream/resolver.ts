import { TtlCache } from "@/lib/lru";
import { runtimeConfig } from "@/lib/runtime-config";
/**
 * Episode stream resolver.
 *
 * Queries an aggregated "getsources"-style API (AniKuro-compatible
 * /api/getsources/?id=<anilist>&lol=<provider>&ep=<n>) across a provider
 * chain, preferring results that carry an English VTT subtitle track.
 * Results cached ~25 minutes (CDN URLs expire anyway).
 */

export type ResolverServer = {
  id: string;
  label: string;
  url: string;
  originalUrl?: string;
  quality?: string;
  referer?: string;
};

export type ResolverSubtitle = { label: string; url: string };

export type ResolverSide = {
  servers: ResolverServer[];
  subtitles: ResolverSubtitle[];
  provider: string;
};

export type ResolvedStreams = {
  ok: boolean;
  sub: ResolverSide | null;
  dub: ResolverSide | null;
};

/**
 * Provider waves — small bursts to stay friendly with upstream rate limits.
 * Wave 1 is the most reliable pair; later waves only fire when needed.
 */
const PROVIDER_WAVES: string[][] = [
  ["anikoto", "animix"],
  ["animepahe", "senshi", "reanime"],
  ["allani", "animedao", "animedunya"],
];

const API_BASE =
  runtimeConfig("STREAM_SOURCES_API") || "https://anikuro.to/api/getsources/";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type RawSource = {
  url?: string;
  originalUrl?: string;
  upstreamReferer?: string;
  quality?: string;
  type?: string;
  isM3U8?: boolean;
  headers?: { Referer?: string };
};

type RawTrack = { label?: string; lang?: string; name?: string; url?: string; src?: string; file?: string };

type RawSide = {
  default?: string;
  sources?: RawSource[];
  subtitles?: RawTrack[];
  headers?: { Referer?: string };
  originalUrl?: string;
} | null;

type RawResponse =
  | { error?: string; sub?: RawSide; dub?: RawSide }
  | { ok: false; error: { code: string } };

/** Name servers exactly like the provider network's public embeds do. */
function serverLabel(host: string, idx: number): string {
  const h = host.toLowerCase();
  if (/^cdn\.kryntal\.top$/.test(h)) return "Vidstream-2";
  if (/^ncdn\.kryntal\.top$/.test(h)) return "HD-2";
  if (/^megap\./.test(h)) return "HD-1";
  if (/^s\d+\.akirax\.buzz$/.test(h)) return "VidPlay-1";
  if (/akirax\.buzz/.test(h)) return `VidPlay-${idx + 1}`;
  if (/kryntal\.top/.test(h)) return `HD-${idx + 1}`;
  if (/echovideo|anix|burntburst/.test(h)) return "Vidstream-E";
  return `Server-${idx + 1}`;
}

function normalizeSide(side: RawSide, provider: string): ResolverSide | null {
  if (!side) return null;

  const sources: RawSource[] = Array.isArray(side.sources) ? side.sources : [];
  const servers: ResolverServer[] = [];
  const seen = new Set<string>();

  for (const s of sources) {
    const url = s.url ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = side.originalUrl ?? s.originalUrl ?? url;
    try {
      host = new URL(s.originalUrl ?? url).host;
    } catch {}
    servers.push({
      id: `${provider}-${servers.length}`,
      label: serverLabel(host, servers.length),
      url,
      ...(s.originalUrl ? { originalUrl: s.originalUrl } : {}),
      quality: s.quality,
      referer: s.headers?.Referer ?? side.headers?.Referer ?? s.upstreamReferer,
    });
  }

  // Some providers only expose {default}.
  if (servers.length === 0 && side.default) {
    servers.push({
      id: `${provider}-0`,
      label: "HD-1",
      url: side.default,
      referer: side.headers?.Referer,
    });
  }

  const tracks: RawTrack[] = Array.isArray(side.subtitles) ? side.subtitles : [];
  const subtitles: ResolverSubtitle[] = tracks
    .map((t) => ({
      label: t.label ?? t.lang ?? t.name ?? "English",
      url: t.url ?? t.src ?? t.file ?? "",
    }))
    .filter((t) => Boolean(t.url));

  // Prefer English-labelled tracks first.
  subtitles.sort((a, b) => {
    const ae = /eng/i.test(a.label) ? 0 : 1;
    const be = /eng/i.test(b.label) ? 0 : 1;
    return ae - be;
  });

  if (servers.length === 0) return null;
  return { servers, subtitles, provider };
}

async function fetchProvider(
  anilistId: number,
  ep: number,
  provider: string,
): Promise<Record<string, RawSide> | null> {
  const url = `${API_BASE}?id=${anilistId}&lol=${provider}&ep=${ep}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: `https://anikuro.to/watch/${anilistId}:${ep}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RawResponse;
    if ("ok" in data && data.ok === false) return null;
    if ("error" in data && typeof data.error === "string") return null;
    return data as Record<string, RawSide>;
  } catch {
    return null;
  }
}

/* In-memory cache (CDN URLs are short-lived — cache briefly). */
const g = globalThis as unknown as { __na_resolver?: TtlCache<ResolvedStreams> };
const cache: TtlCache<ResolvedStreams> = (g.__na_resolver ??= new TtlCache<ResolvedStreams>(120));

export async function resolveStreams(
  anilistId: number,
  ep: number,
): Promise<ResolvedStreams> {
  const key = `${anilistId}:${ep}`;

  const hit = cache.get(key);
  if (hit) return hit;

  const subs: ResolverSide[] = [];
  const dubs: ResolverSide[] = [];

  const evaluate = (provider: string, data: Record<string, RawSide> | null) => {
    if (!data) return;
    const sub = normalizeSide(data.sub ?? null, provider);
    const dub = normalizeSide(data.dub ?? null, provider);
    if (sub) subs.push(sub);
    if (dub) dubs.push(dub);
  };

  const pickBest = (list: ResolverSide[]): ResolverSide | null =>
    list.find((s) => s.subtitles.length > 0) ?? list[0] ?? null;

  let bestSub: ResolverSide | null = null;
  let bestDub: ResolverSide | null = null;

  for (const wave of PROVIDER_WAVES) {
    const settled = await Promise.all(
      wave.map(async (provider) => ({
        provider,
        data: await fetchProvider(anilistId, ep, provider),
      })),
    );
    for (const { provider, data } of settled) evaluate(provider, data);

    bestSub = pickBest(subs);
    bestDub = pickBest(dubs);

    // Early exit when we already have a translate-ready sub AND a dub.
    if (bestSub && bestSub.subtitles.length > 0 && bestDub) break;
    // If wave 2 is done and we still have nothing, stop hammering.
    if (!bestSub && !bestDub && wave === PROVIDER_WAVES[1]) break;
  }

  const result: ResolvedStreams = {
    ok: Boolean(bestSub || bestDub),
    sub: bestSub,
    dub: bestDub,
  };

  // Negative results cached briefly (avoid hammering upstream for uncovered shows).
  cache.set(key, result, (result.ok ? 25 * 60_000 : 5 * 60_000));
  return result;
}
