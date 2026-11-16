import { TtlCache } from "@/lib/lru";
/**
 * AniKage media API resolver.
 *
 * Chain:
 *   GET /api/media/anime/search?q={title}            → slug (matched by anilistId)
 *   GET /api/media/anime/{slug}/episodes             → episode list
 *   GET /api/media/anime/{slug}/episodes/{ep}/sources?provider={p}
 *     → sources[] tokens  (m3u8 = https://gg.akage.lol/m3u8/{token})
 *     → subtitles[] tokens (vtt  = https://gg.akage.lol/stream/{token})
 *
 * Streams require Referer https://anikage.cc/ (handled by the proxy layer).
 */

const BASE = "https://anikage.cc/api/media";

// ⚠️ gg.akage.lol stream host is TLS-blocked from server-side sandboxes
//    (OpenSSL tlsv1 alert — host firewall, not fixable with headers/UA).
//    Per the "skip on error" rule this layer is now a metadata stub so the
//    streaming pipeline never sees broken links. Remove the stub when a server
//    with unrestricted egress is used — the provider list will just work then.
const DISABLE_STREAMS = true;
const RAW_STREAM_HOST = "https://gg.akage.lol";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Providers known to work; uwu carries English caption tokens. */
const PROVIDERS = ["uwu", "koto", "neko", "ken"] as const;

export type KageServer = {
  name: string;
  hls: string;
  vtt: { label: string; url: string }[];
  type: "sub" | "hsub";
  provider: string;
};

type KageSource = {
  url?: string;
  quality?: string;
  isM3U8?: boolean;
  type?: string;
  server?: string;
  embedUrl?: string;
};

type KageTrack = { file?: string; label?: string; kind?: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://anikage.cc/" },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __na_kage?: TtlCache<KageServer[]> };
const cache: TtlCache<KageServer[]> = (g.__na_kage ??= new TtlCache<KageServer[]>(120));

function isUsableToken(t: string) {
  return /^[A-Za-z0-9_\-]{32,}$/.test(t);
}

export async function resolveAnikage(params: {
  anilistId: number;
  romaji: string;
  english?: string | null;
  ep: number;
}): Promise<KageServer[]> {
  const { anilistId, romaji, english, ep } = params;
  if (DISABLE_STREAMS) return [];
  const key = `kage:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: KageServer[], ok: boolean) => {
    cache.set(key, data, (ok ? 25 * 60_000 : 5 * 60_000));
    return data;
  };

  // 1. Find the slug — prefer exact anilistId match from search results.
  let slug: string | null = null;
  for (const q of [romaji, english ?? ""].filter(Boolean)) {
    const search = await getJson<{
      data?: { slug?: string; anilistId?: number; title?: { romaji?: string | null } }[];
    }>(`${BASE}/anime/search?q=${encodeURIComponent(q)}`);
    const items = search?.data ?? [];
    const exact = items.find((i) => i.anilistId === anilistId);
    const best =
      exact ??
      items.find((i) => norm(i.title?.romaji ?? "") === norm(q));
    if (best?.slug) {
      slug = best.slug;
      break;
    }
    if (items[0]?.slug) {
      slug = items[0].slug;
      break;
    }
  }
  if (!slug) return done([], false);

  // 2. Verify the episode exists in their catalog (prevents wrong ep content).
  const episodes = await getJson<{ number?: number }[]>(`${BASE}/anime/${slug}/episodes`);
  if (episodes && !episodes.some((e) => e.number === ep)) {
    return done([], false);
  }

  // 3. Resolve providers in parallel.
  const settled = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const data = await getJson<{
        providerId?: string;
        subType?: string;
        sources?: KageSource[];
        subtitles?: KageTrack[];
      }>(`${BASE}/anime/${slug}/episodes/${ep}/sources?provider=${provider}`);
      if (!data || !Array.isArray(data.sources)) return [];

      const subs: { label: string; url: string }[] = (data.subtitles ?? [])
        .filter((t) => (t.kind === "captions" || t.kind === "subtitles" || !t.kind) && t.file && isUsableToken(t.file))
        .map((t) => ({
          label: t.label || "English",
          url: `${RAW_STREAM_HOST}/stream/${t.file}`,
        }));

      return data.sources
        .filter((s) => s.isM3U8 && s.url && isUsableToken(s.url))
        .map((s): KageServer => {
          const serverName = (s.server || provider).replace(/^\w/, (c) => c.toUpperCase());
          const rawM3u8 = `${RAW_STREAM_HOST}/m3u8/${s.url}`;
          return {
            name: `${serverName}${s.quality && s.quality !== "auto" ? ` ${s.quality}` : ""}`,
            hls: rawM3u8,
            vtt: s.type === "softsub" ? subs : [],
            type: s.type === "softsub" ? "sub" : "hsub",
            provider,
          };
        });
    }),
  );

  const servers = settled.flat();
  return done(servers, servers.length > 0);
}
