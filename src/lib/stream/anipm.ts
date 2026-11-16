import { TtlCache } from "@/lib/lru";
/**
 * ani.pm (19-server) resolver.
 *
 * Chain:
 *   GET /api/anime/search?q={title}                → internal catalog id
 *   GET /api/anime/ep-servers/{internalId}/{ep}    → named server tokens by type
 *   GET /api/anime/ep-embed?id={token}             → embed url
 *   embed page → data-id → stream/getSources       → real HLS + VTT
 *     (shared with the anikoto layer via sourcesFromEmbed)
 */

import { sourcesFromEmbed } from "./anikoto";

const BASE = "https://ani.pm";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type PmServer = {
  name: string;
  type: "sub" | "hsub" | "dub";
  hls: string | null;
  vtt: { label: string; url: string }[];
  embedUrl: string;
};

async function getJson<T>(path: string, referer = `${BASE}/`): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: referer },
      cache: "no-store",
      signal: AbortSignal.timeout(14_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const g = globalThis as unknown as { __na_pm?: TtlCache<PmServer[]> };
const cache: TtlCache<PmServer[]> = (g.__na_pm ??= new TtlCache<PmServer[]>(120));

export async function resolveAnipm(params: {
  anilistId: number;
  romaji: string;
  english?: string | null;
  ep: number;
}): Promise<PmServer[]> {
  const { anilistId, romaji, english, ep } = params;
  const key = `pm:${anilistId}:${ep}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const done = (data: PmServer[], ok: boolean) => {
    cache.set(key, data, (ok ? 25 * 60_000 : 5 * 60_000));
    return data;
  };

  // 1. catalog search — prefer anikoto-sourced exact title match.
  let internalId: string | number | null = null;
  for (const q of [romaji, english ?? ""].filter(Boolean)) {
    const search = await getJson<{ items?: { id?: number | string; title?: string; source?: string }[] }>(
      `/api/anime/search?q=${encodeURIComponent(q)}`,
    );
    const items = search?.items ?? [];
    const exact = items.find((i) => i.title && norm(i.title) === norm(q));
    if ((exact ?? items[0])?.id != null) {
      internalId = (exact ?? items[0]).id!;
      break;
    }
  }
  if (internalId == null) return done([], false);

  // 2. episode server catalog.
  const epData = await getJson<{ servers?: { id: string; name?: string; type?: string }[] }>(
    `/api/anime/ep-servers/${internalId}/${ep}`,
    `${BASE}/anime/${internalId}`,
  );
  const serverList = (epData?.servers ?? []).filter(
    (s) => s.id && s.name && (s.type === "sub" || s.type === "dub" || s.type === "hsub" || s.type === "h-sub"),
  );
  if (!serverList.length) return done([], false);

  // 3. resolve tokens → embeds → sources in parallel.
  const resolved = await Promise.all(
    serverList.slice(0, 12).map(async (srv): Promise<PmServer | null> => {
      const embed = await getJson<{ url?: string }>(
        `/api/anime/ep-embed?id=${encodeURIComponent(srv.id)}`,
        `${BASE}/anime/${internalId}`,
      );
      if (!embed?.url) return null;
      const type: PmServer["type"] =
        srv.type === "dub" ? "dub" : srv.type === "sub" ? "sub" : "hsub";

      let hls: string | null = null;
      let vtt: { label: string; url: string }[] = [];
      const viaEmbed = await sourcesFromEmbed(embed.url).catch(() => null);
      if (viaEmbed) {
        hls = viaEmbed.hls;
        vtt = viaEmbed.vtt;
      }
      return { name: srv.name!, type, hls, vtt, embedUrl: embed.url };
    }),
  );

  // 4. **Validate** every HLS link before exposing it — ani.pm sometimes
  //    returns expired playlist URLs (upstream 404), which previously produced
  //    dead HD-1/HD-2 pills in the UI.
  const candidates = resolved.filter((s): s is PmServer => Boolean(s));
  const validated = await Promise.all(
    candidates.map(async (srv) => {
      if (!srv.hls) return srv; // embed-only servers are always fine
      const ok = await isPlayable(srv.hls);
      return ok ? srv : { ...srv, hls: null };
    }),
  );

  const servers = validated.filter((s) => s.hls || s.embedUrl);
  // de-duplicate by name + final target
  const seen = new Set<string>();
  const unique = servers.filter((s) => {
    const k = `${s.name}|${s.hls ?? s.embedUrl}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return done(unique, unique.length > 0);
}

/** HEAD/GET probe — a playlist is "playable" when it returns m3u8 content. */
async function isPlayable(hlsUrl: string): Promise<boolean> {
  for (const attempt of [0, 1]) {
    try {
      const res = await fetch(hlsUrl, {
        method: attempt === 0 ? "HEAD" : "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/vnd.apple.mpegurl,*/*",
          Referer: hlsUrl.includes("kryntal")
            ? "https://megaplay.buzz/"
            : "https://vidtube.site/",
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
      if (res.status !== 404 && res.status !== 410) return true; // may be referer-gated upstream, keep
    } catch {
      /* retry with GET */
    }
  }
  return false;
}
